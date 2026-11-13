/**
 * wxpub draft 子命令组——写作台草稿 CRUD + AI 写作五件套
 * （大纲/扩写/规则门禁/审稿四问/标题候选），全部走 JWT 管理台通道。
 */

import type { Command } from "commander";
import { Command as CommanderCommand } from "commander";
import { writeFile } from "node:fs/promises";

import type { DraftSummary, GateReport, OutlineSection } from "../admin.js";
import { createAdminClient } from "../admin.js";
import { readArticle } from "../article.js";

/** --tone 既收数字 id 也收 null/none（显式解绑哨兵）。 */
function parseToneId(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === "null" || value === "none") return null;
  const id = Number.parseInt(value, 10);
  if (Number.isNaN(id) || String(id) !== value) {
    throw new Error(`--tone 只接受数字 id、null 或 none，收到：${value}`);
  }
  return id;
}

function printSummaryLine(item: DraftSummary): void {
  const outline = item.has_outline ? "有大纲" : "无大纲";
  console.log(
    `  id:${item.id}  [${item.status}] ${item.title}  ${item.content_chars}字 ${outline}  ${item.updated_at ?? ""}`,
  );
}

function printOutline(sections: OutlineSection[], depth = 0): void {
  for (const section of sections) {
    const indent = "  ".repeat(depth + 1);
    console.log(
      `${indent}${section.id} [${section.status}] ${section.heading}（~${section.word_target}字）`,
    );
    for (const point of section.key_points) {
      console.log(`${indent}  · ${point}`);
    }
    printOutline(section.subsection, depth + 1);
  }
}

/** lint/review 共用的 GateReport 人话输出。 */
function printGateReport(report: GateReport, withReview: boolean): void {
  const tone = report.tone;
  console.log(`调性得分：${tone.score}/5（正文 ${tone.prose_chars} 字）`);
  if (tone.issues.length > 0) {
    console.log("问题：");
    for (const issue of tone.issues) {
      console.log(`  [${issue.severity}] ${issue.rule}：${issue.message}`);
    }
  } else {
    console.log("问题：（无）");
  }
  if (tone.cliche_hits.length > 0) {
    console.log(`套话命中：${tone.cliche_hits.map(([w, n]) => `${w}×${n}`).join("、")}`);
  }
  if (withReview && report.review) {
    console.log("审稿四问：");
    for (const answer of report.review.answers) {
      console.log(`  ${answer.question} ${answer.score}/1 —— ${answer.comment}`);
    }
  }
}

export function registerDraftCommand(program: Command): Command {
  const draft = new CommanderCommand("draft").description(
    "写作台草稿（CRUD + AI 大纲/扩写/门禁/审稿/标题）——需 wxpub login 登录",
  );

  draft
    .command("list")
    .description("草稿列表")
    .option("--status <status>", "按状态过滤：draft / ready / published / archived")
    .option("--limit <n>", "条数上限（默认 100）", (value) => Number.parseInt(value, 10))
    .action(async (options) => {
      const client = createAdminClient();
      const items = await client.listDrafts({ status: options.status, limit: options.limit });
      if (program.opts().json) {
        console.log(JSON.stringify({ drafts: items }));
        return;
      }
      console.log(`共 ${items.length} 条草稿：`);
      for (const item of items) {
        printSummaryLine(item);
      }
    });

  draft
    .command("new")
    .description("新建草稿")
    .requiredOption("-t, --title <title>", "草稿标题")
    .option("-a, --account <id>", "绑定账号 id（wxpub accounts 查）", (value) =>
      Number.parseInt(value, 10),
    )
    .option("--tone <id>", "绑定调性 id（wxpub tones 查；none=不绑）")
    .option("-f, --file <path>", "初始正文 markdown 文件")
    .option("--digest <text>", "分享摘要")
    .option("--author <name>", "笔名")
    .action(async (options) => {
      const content = options.file ? (await readArticle(options.file)).content : undefined;
      const client = createAdminClient();
      const draftData = await client.createDraft({
        title: options.title,
        accountId: options.account,
        tonePresetId: parseToneId(options.tone) ?? undefined,
        content,
        digest: options.digest,
        author: options.author,
      });
      if (program.opts().json) {
        console.log(JSON.stringify(draftData));
        return;
      }
      console.log(`已创建草稿 id:${draftData.id}（后续命令用这个 id）`);
      console.log(`  标题：${draftData.title}  状态：${draftData.status}`);
    });

  draft
    .command("get")
    .description("查看草稿（--out 导出正文为 markdown 文件）")
    .argument("<id>", "草稿 id", (value) => Number.parseInt(value, 10))
    .option("--out <path>", "把正文导出为 markdown 文件")
    .action(async (id: number, options) => {
      const client = createAdminClient();
      const draftData = await client.getDraft(id);
      if (options.out) {
        await writeFile(options.out, draftData.content, "utf8");
        console.log(`已导出正文到 ${options.out}`);
        return;
      }
      if (program.opts().json) {
        console.log(JSON.stringify(draftData));
        return;
      }
      const outlineState = draftData.outline_json ? "有大纲" : "无大纲";
      console.log(
        `id:${draftData.id} [${draftData.status}] ${draftData.title}  ${draftData.content.length}字 ${outlineState}`,
      );
      console.log(
        `  账号id:${draftData.account_id ?? "-"}  调性id:${draftData.tone_preset_id ?? "-"}  更新:${draftData.updated_at ?? "-"}`,
      );
    });

  draft
    .command("save")
    .description("保存草稿（字段级合并，只传要改的）")
    .argument("<id>", "草稿 id", (value) => Number.parseInt(value, 10))
    .option("-f, --file <path>", "正文 markdown 文件（整体替换正文）")
    .option("-t, --title <title>", "标题")
    .option("--digest <text>", "分享摘要")
    .option("--author <name>", "笔名")
    .option("--status <status>", "状态：draft / ready / published / archived")
    .option("-a, --account <id>", "绑定账号 id", (value) => Number.parseInt(value, 10))
    .option("--tone <id>", "调性 id（none/null=解绑）")
    .action(async (id: number, options) => {
      const client = createAdminClient();
      const draftData = await client.updateDraft(id, {
        title: options.title,
        accountId: options.account,
        tonePresetId: parseToneId(options.tone),
        content: options.file ? (await readArticle(options.file)).content : undefined,
        digest: options.digest,
        author: options.author,
        status: options.status,
      });
      if (program.opts().json) {
        console.log(JSON.stringify(draftData));
        return;
      }
      console.log(`已保存草稿 id:${id}（${draftData.content.length}字，状态 ${draftData.status}）`);
    });

  draft
    .command("rm")
    .description("删除草稿（不确认，agent 自律）")
    .argument("<id>", "草稿 id", (value) => Number.parseInt(value, 10))
    .action(async (id: number) => {
      const client = createAdminClient();
      await client.deleteDraft(id);
      if (program.opts().json) {
        console.log(JSON.stringify({ deleted: true, id }));
        return;
      }
      console.log(`已删除草稿 id:${id}`);
    });

  draft
    .command("outline")
    .description("AI 生成大纲（LLM，结果落库）")
    .argument("<id>", "草稿 id", (value) => Number.parseInt(value, 10))
    .requiredOption("--idea <text>", "选题描述（写给谁、解决什么问题）")
    .option("--tone <id>", "调性 id（缺省用草稿绑定的）", (value) => Number.parseInt(value, 10))
    .action(async (id: number, options) => {
      const client = createAdminClient();
      const outline = await client.generateOutline(id, {
        idea: options.idea,
        tonePresetId: options.tone,
      });
      if (program.opts().json) {
        console.log(JSON.stringify(outline));
        return;
      }
      console.log(`大纲 ${outline.sections.length} 节：`);
      printOutline(outline.sections);
      console.log("逐节扩写：wxpub draft expand <id> --section <sid>");
    });

  draft
    .command("expand")
    .description("AI 扩写单节（LLM；返回回填后的整篇正文）")
    .argument("<id>", "草稿 id", (value) => Number.parseInt(value, 10))
    .requiredOption("--section <sid>", "节 id（如 s1、s1-1；见 draft outline 输出）")
    .option("--reroll", "对已扩写节重新生成", false)
    .option(
      "--key-point <kp>",
      "覆盖该节要点（可多次）",
      (value: string, previous: string[]) => {
        previous.push(value);
        return previous;
      },
      [],
    )
    .action(async (id: number, options) => {
      const client = createAdminClient();
      const result = await client.expandSection(id, {
        sectionId: options.section,
        reroll: options.reroll || undefined,
        keyPointsOverride: options.keyPoint.length > 0 ? options.keyPoint : undefined,
      });
      if (program.opts().json) {
        console.log(JSON.stringify(result));
        return;
      }
      console.log(
        `已扩写 ${result.section_id} ${result.heading}${result.replaced ? "（重写已有内容）" : ""}`,
      );
      console.log(`  正文现 ${result.content.length} 字；本节 ${result.section_md.length} 字`);
    });

  draft
    .command("lint")
    .description("规则门禁（免费本地：调性得分+套话命中）")
    .argument("<id>", "草稿 id", (value) => Number.parseInt(value, 10))
    .action(async (id: number) => {
      const client = createAdminClient();
      const report = await client.lintDraft(id);
      if (program.opts().json) {
        console.log(JSON.stringify(report));
        return;
      }
      printGateReport(report, false);
    });

  draft
    .command("review")
    .description("审稿四问（LLM：活人思考/信息增益/对话感/共鸣入口）")
    .argument("<id>", "草稿 id", (value) => Number.parseInt(value, 10))
    .action(async (id: number) => {
      const client = createAdminClient();
      const report = await client.reviewDraft(id);
      if (program.opts().json) {
        console.log(JSON.stringify(report));
        return;
      }
      printGateReport(report, true);
    });

  draft
    .command("titles")
    .description("AI 生成标题候选（LLM + 账号 few-shot，按分降序）")
    .argument("<id>", "草稿 id", (value) => Number.parseInt(value, 10))
    .action(async (id: number) => {
      const client = createAdminClient();
      const candidates = await client.generateTitles(id);
      if (program.opts().json) {
        console.log(JSON.stringify({ titles: candidates }));
        return;
      }
      console.log(`标题候选 ${candidates.length} 个（按分降序）：`);
      for (const candidate of candidates) {
        const risk = candidate.risk ? ` ⚠${candidate.risk}` : "";
        console.log(`  ${candidate.score.toFixed(1)}  ${candidate.title}${risk}`);
        if (candidate.risk_reason) {
          console.log(`        ${candidate.risk_reason}`);
        }
      }
      console.log('选定后：wxpub draft save <id> -t "选定标题"');
    });

  return draft;
}
