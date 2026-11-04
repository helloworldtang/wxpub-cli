import { WxpubClient } from "../client.js";
import { loadConfig } from "../config.js";

export interface MeOptions {
  json: boolean;
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
  if (options.json) {
    console.log(
      JSON.stringify({ configured: true, baseUrl: config.baseUrl, apiKey: masked, healthy }),
    );
  } else {
    console.log(`服务地址：${config.baseUrl}`);
    console.log(`API Key：${masked}`);
    console.log(`服务健康：${healthy ? "正常" : "不可达"}`);
  }
}
