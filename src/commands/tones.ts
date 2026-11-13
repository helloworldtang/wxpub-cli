import { createAdminClient } from "../admin.js";

export interface TonesOptions {
  json: boolean;
}

/** wxpub tones：调性列表（system + 自己 user 级；给 draft/outline 绑 tone_preset_id）。 */
export async function runTones(options: TonesOptions): Promise<void> {
  const client = createAdminClient();
  const items = await client.listTones();
  if (options.json) {
    console.log(JSON.stringify({ tones: items }));
    return;
  }
  if (items.length === 0) {
    console.log("（无可见调性）");
    return;
  }
  console.log(`共 ${items.length} 条调性：`);
  for (const item of items) {
    const state = item.is_active ? "启用" : "停用";
    const length =
      item.length_min != null && item.length_max != null
        ? `${item.length_min}-${item.length_max}字`
        : "-";
    console.log(
      `  id:${item.id}  [${item.scope}] ${item.name}（${state}，${length}）  ${item.description ?? ""}`,
    );
  }
}
