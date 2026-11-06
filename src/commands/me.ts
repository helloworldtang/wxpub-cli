import { WxpubClient } from "../client.js";
import { loadConfig } from "../config.js";
import { credentialStatus } from "../device-auth.js";

export interface MeOptions {
  json: boolean;
}

/** 凭据一行摘要（文本模式）：委托票给剩余时间，过期给重登指引，sk_ 长期有效。 */
function credentialLine(status: ReturnType<typeof credentialStatus>): string {
  if (status.kind === "api_key") return "凭据状态：API Key（长期有效）";
  if (status.kind !== "jwt" || status.remainSec === null) return "凭据状态：未知形态";
  if (status.remainSec <= 0) return "凭据状态：委托票已过期，请重跑 wxpub login";
  const remain =
    status.remainSec >= 60 ? `剩 ${Math.floor(status.remainSec / 60)} 分钟` : `剩 ${status.remainSec} 秒`;
  return `凭据状态：委托票，${remain}（至 ${status.expireAt}）`;
}

/** wxpub me：登录态展示 + 服务健康检查。 */
export async function runMe(options: MeOptions): Promise<void> {
  const config = loadConfig();
  if (!config) {
    if (options.json) {
      console.log(JSON.stringify({ configured: false, healthy: false }));
    } else {
      console.log("未配置。先执行：wxpub login --base-url <url> --api-key <key>");
    }
    return;
  }
  const client = new WxpubClient(config);
  const healthy = await client.health();
  const masked = `${config.apiKey.slice(0, 6)}…${config.apiKey.slice(-4)}`;
  const status = credentialStatus(config.apiKey);
  if (options.json) {
    console.log(
      JSON.stringify({
        configured: true,
        baseUrl: config.baseUrl,
        apiKey: masked,
        healthy,
        credential: { kind: status.kind, remainSec: status.remainSec, expireAt: status.expireAt },
      }),
    );
  } else {
    console.log(`服务地址：${config.baseUrl}`);
    console.log(`API Key：${masked}`);
    console.log(credentialLine(status));
    console.log(`服务健康：${healthy ? "正常" : "不可达"}`);
  }
}
