import { WxpubClient } from "../client.js";
import { resolveConfig } from "../config.js";

export interface MaterialsOptions {
  account: string;
  type?: string;
  offset?: number;
  count?: number;
  json: boolean;
}

/** wxpub materials：查询账号永久素材列表。 */
export async function runMaterials(options: MaterialsOptions): Promise<void> {
  const config = resolveConfig();
  const client = new WxpubClient(config);
  const result = await client.listMaterials(options.account, {
    type: options.type,
    offset: options.offset,
    count: options.count,
  });
  if (options.json) {
    console.log(
      JSON.stringify({
        total_count: result.totalCount,
        items: result.items.map((item) => ({
          media_id: item.mediaId,
          name: item.name ?? null,
          url: item.url ?? null,
        })),
      }),
    );
    return;
  }
  console.log(`共 ${result.totalCount} 条素材（类型 ${options.type ?? "image"}）：`);
  if (result.items.length === 0) {
    console.log("（空）");
    return;
  }
  for (const item of result.items) {
    console.log(`  ${item.mediaId}  ${item.name ?? ""}  ${item.url ?? ""}`);
  }
}
