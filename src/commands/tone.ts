import { WxpubClient } from "../client.js";
import { resolveConfig } from "../config.js";

export interface ToneOptions {
  account: string;
  json: boolean;
}

/** wxpub tone：拉账号绑定的写作调性——AI 写文前注入上下文，保证成稿跟号调性一致。 */
export async function runTone(options: ToneOptions): Promise<void> {
  const config = resolveConfig();
  const client = new WxpubClient(config);
  const result = await client.accountTone(options.account);
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          account: result.account,
          tone: result.tone
            ? {
                name: result.tone.name,
                persona: result.tone.persona,
                style_rules: result.tone.styleRules,
                length_min: result.tone.lengthMin ?? null,
                length_max: result.tone.lengthMax ?? null,
              }
            : null,
        },
        null,
        0,
      ),
    );
    return;
  }
  if (!result.tone) {
    console.log(`账号 ${result.account} 未绑定写作调性（服务端「账号管理 → 绑定调性」可配置）`);
    return;
  }
  const tone = result.tone;
  const length =
    (tone.lengthMin ?? tone.lengthMax)
      ? `（建议 ${tone.lengthMin ?? "?"}-${tone.lengthMax ?? "?"} 字）`
      : "";
  console.log(`账号 ${result.account} 的写作调性：${tone.name}${length}`);
  console.log(`\n【主笔人设】\n${tone.persona}`);
  console.log(`\n【结构规则】\n${tone.styleRules}`);
}
