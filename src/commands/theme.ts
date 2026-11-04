import { WxpubClient } from "../client.js";
import { resolveConfig } from "../config.js";

export interface ThemeOptions {
  account: string;
  json: boolean;
}

/** wxpub theme：查询账号默认主题（不传 theme 发文时服务端即用它渲染）。 */
export async function runTheme(options: ThemeOptions): Promise<void> {
  const config = resolveConfig();
  const client = new WxpubClient(config);
  const theme = await client.accountTheme(options.account);
  if (options.json) {
    console.log(
      JSON.stringify({
        account: theme.account,
        theme_key: theme.themeKey ?? null,
        theme_name: theme.themeName ?? null,
      }),
    );
    return;
  }
  if (theme.themeKey) {
    console.log(
      `账号 ${theme.account} 的默认主题：${theme.themeName ?? theme.themeKey}（${theme.themeKey}）`,
    );
  } else {
    console.log(`账号 ${theme.account} 未配置默认主题，发文时将使用服务端内置 default 主题`);
  }
}
