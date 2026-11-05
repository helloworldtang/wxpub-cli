import { spawn } from "node:child_process";

import { configPath, normalizeBaseUrl, saveConfig } from "../config.js";
import {
  DEFAULT_AUTH_ISSUER,
  DEVICE_CLIENT_ID,
  DeviceFlowError,
  discoverDeviceEndpoints,
  pollDeviceToken,
  requestDeviceAuthorization,
} from "../device-auth.js";

export interface LoginOptions {
  /** 旧通道：手动贴 API Key / JWT（仍可用） */
  apiKey?: string;
  /** 发文服务地址；设备流登录时缺省 https://yyps.net */
  baseUrl?: string;
  /** auth 服务 issuer；设备流登录时缺省 https://auth.ai-as.cc */
  authIssuer?: string;
}

/** 尽力打开浏览器（平台差异吞错；失败时用户手点打印出的 URL）。 */
function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // 打印的 URL 就是完整兜底
  }
}

/**
 * wxpub login：
 * - 无 --api-key：设备流交互登录（给个 URL 浏览器确认 → 轮询拿 JWT 存配置）
 * - 带 --api-key：旧通道原样保存
 */
export async function runLogin(options: LoginOptions): Promise<void> {
  if (!options.apiKey) {
    await runDeviceLogin(options);
    return;
  }
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://yyps.net");
  saveConfig({ baseUrl, apiKey: options.apiKey.trim() });
  console.log(`已保存到 ${configPath()}`);
  console.log(`服务地址：${baseUrl}`);
  console.log("现在可以发文了：wxpub publish --account <账号> --file article.md");
}

/** 设备流交互登录：discovery → 授权 URL → 轮询 → 存 JWT。 */
async function runDeviceLogin(options: LoginOptions): Promise<void> {
  const issuer = normalizeBaseUrl(options.authIssuer ?? DEFAULT_AUTH_ISSUER);
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://yyps.net");
  console.log(`连接授权服务器：${issuer}`);
  const endpoints = await discoverDeviceEndpoints(issuer);
  const auth = await requestDeviceAuthorization(endpoints.deviceAuthorizationEndpoint);

  console.log();
  console.log("请在浏览器完成登录并批准：");
  console.log(`  ${auth.verificationUriComplete}`);
  console.log(`  用户码：${auth.userCode}（${auth.expiresIn} 秒内有效）`);
  openBrowser(auth.verificationUriComplete);
  console.log();
  console.log("等待授权…（批准后自动继续；拒绝或超时会退出）");

  try {
    const { accessToken } = await pollDeviceToken({
      tokenEndpoint: endpoints.tokenEndpoint,
      clientId: DEVICE_CLIENT_ID,
      deviceCode: auth.deviceCode,
      intervalSecs: auth.interval,
    });
    // JWT 走现有 Bearer 通道（client.ts 三段点分判定），publish 等接口零改动
    saveConfig({ baseUrl, apiKey: accessToken });
    console.log("✓ 授权成功，登录态已保存");
    console.log(`已保存到 ${configPath()}`);
    console.log(`服务地址：${baseUrl}`);
    console.log("现在可以发文了：wxpub publish --account <账号> --file article.md");
    console.log("提示：token 有时效，过期后重跑 wxpub login 即可。");
  } catch (err) {
    if (err instanceof DeviceFlowError && err.code === "access_denied") {
      console.error("✗ 你在浏览器里拒绝了本次授权");
    } else if (err instanceof DeviceFlowError && err.code === "expired_token") {
      console.error("✗ 设备码已过期，请重跑 wxpub login");
    } else {
      throw err;
    }
    process.exitCode = 1;
  }
}
