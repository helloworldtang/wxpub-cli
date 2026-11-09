import { configPath, loadConfig, saveConfig } from "../config.js";

/**
 * wxpub logout：清除本地凭据（保留服务地址，下次 login 不用重填）。
 *
 * 只清本地：sk_ key 的吊销走 auth 管理端；JWT 委托票 15 分钟短命，自然过期无需吊销。
 */
export function runLogout(): void {
  const config = loadConfig();
  if (!config) {
    console.log("未登录（本地无凭据），无需登出。");
    return;
  }

  saveConfig({ baseUrl: config.baseUrl, apiKey: "" });
  console.log("✓ 已登出，本地凭据已清除");
  console.log(`  服务地址保留：${config.baseUrl}，重新登录：wxpub login`);
  if (process.env.WXPUB_API_KEY) {
    console.log("  注意：环境变量 WXPUB_API_KEY 仍设置着，会继续盖过配置文件。");
  }
  console.log(`  已保存到 ${configPath()}`);
}
