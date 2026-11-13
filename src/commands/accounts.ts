import { createAdminClient } from "../admin.js";

export interface AccountsOptions {
  json: boolean;
}

/** wxpub accounts：列出自己归属的公众号账号（account_key 发现）。 */
export async function runAccounts(options: AccountsOptions): Promise<void> {
  const client = createAdminClient();
  const items = await client.listAccounts();
  if (options.json) {
    console.log(JSON.stringify({ accounts: items }));
    return;
  }
  if (items.length === 0) {
    console.log("（没有归属你的账号）");
    return;
  }
  console.log(`共 ${items.length} 个账号：`);
  for (const item of items) {
    const state = item.is_active ? "启用" : "停用";
    console.log(
      `  id:${item.id}  ${item.account_key}（${item.account_name}，${state}）  主题:${item.default_theme_key ?? "-"}  调性id:${item.tone_preset_id ?? "-"}`,
    );
  }
}
