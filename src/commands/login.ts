import { spawn } from "node:child_process";

import { configPath, loadConfig, normalizeBaseUrl, saveConfig } from "../config.js";
import {
  DEFAULT_AUTH_ISSUER,
  DEVICE_CLIENT_ID,
  DeviceFlowError,
  credentialValidityHint,
  decodeJwtExp,
  discoverDeviceEndpoints,
  pollDeviceToken,
  requestDeviceAuthorization,
  validateApiKey,
} from "../device-auth.js";

export interface LoginOptions {
  /** 旧通道：手动贴 API Key / JWT（仍可用） */
  apiKey?: string;
  /** 发文服务地址；设备流登录时缺省 https://yyps.net */
  baseUrl?: string;
  /** auth 服务 issuer；设备流登录时缺省 https://auth.ai-as.cc */
  authIssuer?: string;
  /** 跳过「凭据仍有效」检查，无条件重新走设备流（换账号/agent 脚本切身份用） */
  force?: boolean;
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
 * - 无 --api-key：先查现有凭据，仍有效直接返回（智能登录，不弹浏览器）；
 *   无效/缺失/带 --force 才走设备流交互登录
 * - 带 --api-key：旧通道原样保存（不受智能检查影响——显式给了就是想换）
 */
export async function runLogin(options: LoginOptions): Promise<void> {
  if (!options.apiKey) {
    if (!options.force && (await hasFreshCredential(options))) {
      return;
    }
    await runDeviceLogin(options);
    return;
  }
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "https://yyps.net");
  saveConfig({ baseUrl, apiKey: options.apiKey.trim() });
  console.log(`已保存到 ${configPath()}`);
  console.log(`服务地址：${baseUrl}`);
  console.log("现在可以发文了：wxpub publish --account <账号> --file article.md");
}

/**
 * 现有凭据是否仍有效（智能登录检查）：
 * - JWT：本地解 exp（剩 >1 分钟视为有效，零网络请求）
 * - sk_ key：问 auth /api/keys/validate
 * 凭据优先级与环境变量语义同 resolveConfig：WXPUB_API_KEY > 配置文件。
 * 有效则打印状态返回 true（不重新授权）；无凭据/过期/校验失败返回 false。
 */
async function hasFreshCredential(options: LoginOptions): Promise<boolean> {
  const fromEnv = Boolean(process.env.WXPUB_API_KEY);
  const apiKey = options.apiKey ?? process.env.WXPUB_API_KEY ?? loadConfig()?.apiKey;
  if (!apiKey) return false;
  const source = fromEnv ? "（来自环境变量 WXPUB_API_KEY）" : "";
  // JWT：本地判 exp，剩 >60s 即认为够用（避免"刚登录就剩 30 秒"的边界摩擦）
  const exp = decodeJwtExp(apiKey);
  if (exp !== null) {
    const remainSec = exp - Math.floor(Date.now() / 1000);
    if (remainSec > 60) {
      console.log(
        `凭据仍有效（委托票，剩 ${Math.floor(remainSec / 60)} 分钟）${source}，未重新授权。`,
      );
      console.log("强制重登用：wxpub login --force");
      return true;
    }
    return false;
  }
  // sk_ 开头：问 auth 服务
  if (apiKey.startsWith("sk_")) {
    const issuer = normalizeBaseUrl(options.authIssuer ?? DEFAULT_AUTH_ISSUER);
    const valid = await validateApiKey(issuer, apiKey);
    if (valid) {
      console.log(`API Key 长期有效（${valid.serviceName}）${source}，无需登录。`);
      console.log("强制走设备流用：wxpub login --force");
      return true;
    }
    return false;
  }
  return false; // 未知形态：交给设备流/后续请求给出准确错误
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
    console.log(credentialValidityHint(accessToken));
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
