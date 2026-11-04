import { configPath, normalizeBaseUrl, saveConfig } from "../config.js";

export interface LoginOptions {
  baseUrl: string;
  apiKey: string;
}

/** wxpub login：保存服务地址与 API Key 到 ~/.wxpub/config.json。 */
export function runLogin(options: LoginOptions): void {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  saveConfig({ baseUrl, apiKey: options.apiKey.trim() });
  console.log(`已保存到 ${configPath()}`);
  console.log(`服务地址：${baseUrl}`);
  console.log("现在可以发文了：wxpub publish --account <账号> --file article.md");
}
