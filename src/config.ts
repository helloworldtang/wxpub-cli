import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** CLI 凭据配置：yyps 服务地址 + API Key。 */
export interface WxpubConfig {
  /** 服务基地址，如 https://yyps.net（不带尾斜杠） */
  baseUrl: string;
  /** API Key（sk_…）或 JWT（三段式，走 Bearer 通道） */
  apiKey: string;
}

const CONFIG_DIR = path.join(homedir(), ".wxpub");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

/** 环境变量优先于配置文件：WXPUB_BASE_URL / WXPUB_API_KEY。 */
export interface ConfigOverrides {
  baseUrl?: string;
  apiKey?: string;
}

/** 校验并规范化 baseUrl（去尾斜杠；缺协议补 https://）。 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("baseUrl 不能为空");
  }
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** 持久化配置到 ~/.wxpub/config.json（0600 权限，含密钥）。 */
export function saveConfig(config: WxpubConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

/** 读取已保存的配置；未配置返回 null。 */
export function loadConfig(): WxpubConfig | null {
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<WxpubConfig>;
    if (typeof raw.baseUrl !== "string" || typeof raw.apiKey !== "string") {
      return null;
    }
    return { baseUrl: raw.baseUrl, apiKey: raw.apiKey };
  } catch {
    return null;
  }
}

/** 配置解析优先级：显式传入 > 环境变量 > 配置文件。未配置时抛出带指引的错误。 */
export function resolveConfig(overrides: ConfigOverrides = {}): WxpubConfig {
  const file = loadConfig();
  const baseUrl = overrides.baseUrl ?? process.env.WXPUB_BASE_URL ?? file?.baseUrl;
  const apiKey = overrides.apiKey ?? process.env.WXPUB_API_KEY ?? file?.apiKey;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "未配置服务地址或 API Key。先执行 wxpub login --base-url <url> --api-key <key>，" +
        "或设置环境变量 WXPUB_BASE_URL / WXPUB_API_KEY。",
    );
  }
  return { baseUrl: normalizeBaseUrl(baseUrl), apiKey };
}

/** 配置文件路径（login 成功提示用）。 */
export function configPath(): string {
  return CONFIG_PATH;
}
