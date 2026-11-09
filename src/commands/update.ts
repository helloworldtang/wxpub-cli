import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { configPath, loadConfig, normalizeBaseUrl, saveConfig } from "../config.js";
import {
  DEFAULT_AUTH_ISSUER,
  credentialValidityHint,
  decodeJwtExp,
  validateApiKey,
} from "../device-auth.js";

export interface UpdateOptions {
  /** 新凭据：API Key（sk_…）或 JWT；缺省交互粘贴 */
  apiKey?: string;
}

export interface CredentialCheck {
  ok: boolean;
  /** 不通过时的原因（落盘前给用户看） */
  error?: string;
}

/**
 * 凭据可用性检查（替换前的门禁）：
 * - sk_ key：问 auth /api/keys/validate（fetchImpl 注入供测试）
 * - JWT：本地解 exp，已过期拒绝（重新授权走 login --force）
 * - 未知形态：放行，交由后续真实请求给出准确错误
 */
export async function checkCredential(
  apiKey: string,
  fetchImpl?: typeof fetch,
): Promise<CredentialCheck> {
  if (apiKey.startsWith("sk_")) {
    const issuer = normalizeBaseUrl(DEFAULT_AUTH_ISSUER);
    const valid = await validateApiKey(issuer, apiKey, fetchImpl);
    if (!valid) {
      return { ok: false, error: "凭据校验失败（auth /api/keys/validate 未通过）" };
    }
    return { ok: true };
  }
  const exp = decodeJwtExp(apiKey);
  if (exp !== null && exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, error: "该 JWT 已过期，请走 wxpub login --force 重新授权" };
  }
  return { ok: true };
}

/**
 * wxpub update：替换凭据。用户已拿到新凭据（服务端新签发 / 管理端复制）时本地换上，
 * 不管新凭据怎么来——要重新走设备流获取用 wxpub login --force。
 *
 * 校验不通过不落盘，避免无效凭据覆盖现有有效配置。
 */
export async function runUpdate(options: UpdateOptions): Promise<void> {
  let apiKey = options.apiKey?.trim() ?? "";
  if (!apiKey) {
    const rl = readline.createInterface({ input, output });
    try {
      apiKey = (await rl.question("新凭据（API Key sk_… 或 JWT，回车取消）：")).trim();
    } finally {
      rl.close();
    }
  }
  if (!apiKey) {
    console.log("未提供凭据，未改动。");
    return;
  }

  const check = await checkCredential(apiKey);
  if (!check.ok) {
    console.error(`✗ ${check.error}，未保存。`);
    process.exitCode = 1;
    return;
  }

  const baseUrl = loadConfig()?.baseUrl ?? normalizeBaseUrl("https://yyps.net");
  saveConfig({ baseUrl, apiKey });
  console.log(`✓ 凭据已替换，已保存到 ${configPath()}`);
  console.log(`服务地址：${baseUrl}`);
  console.log(credentialValidityHint(apiKey));
}
