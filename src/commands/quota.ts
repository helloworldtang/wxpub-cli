import { createAdminClient } from "../admin.js";

export interface QuotaOptions {
  json: boolean;
}

/** wxpub quota：我的今日配额余量（登录即可）。 */
export async function runQuota(options: QuotaOptions): Promise<void> {
  const client = createAdminClient();
  const items = await client.myQuota();
  if (options.json) {
    console.log(JSON.stringify({ quota: items }));
    return;
  }
  if (items.length === 0) {
    console.log("（无配额记录——super/BYOK 不计量）");
    return;
  }
  console.log("我的今日配额：");
  for (const item of items) {
    const remaining = item.remaining === -1 ? "不限" : String(item.remaining);
    console.log(
      `  ${item.resource}  已用 ${item.used}/${item.limit === 0 ? "不限" : item.limit}  余 ${remaining}`,
    );
  }
}
