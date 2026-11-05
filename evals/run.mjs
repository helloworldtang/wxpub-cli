#!/usr/bin/env node
/**
 * agent evals —— 用真 agent（claude -p 无头模式）持续回归 SKILL.md 的行为质量。
 *
 * 被测对象是 skill 本身：把 SKILL.md + 场景指令喂给一个干净的 agent，
 * 要求它给出"将执行的命令 + 给用户的说明"，用规则评分：
 *   - ordered:      关键词必须按此顺序出现（如 tone 先于 publish）
 *   - must_match:   命中任一即过（正则，忽略大小写）
 *   - must_not_match: 命中任一即败（错误行为，如 --force、传 theme）
 *
 * 用法：npm run eval（改 SKILL.md / CLI 行为后跑，作为发版前质量门）
 * 成本：每用例一次 headless 调用（~$0.03），全量 6 例约 $0.2。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skill", "claude", "SKILL.md");
const CASES_PATH = join(HERE, "cases.json");

const skill = readFileSync(SKILL_PATH, "utf8");
const cases = JSON.parse(readFileSync(CASES_PATH, "utf8"));

function askAgent(scenario) {
  const prompt = [
    "你在 Claude Code 会话中，已安装 wxpub skill（内容如下）。",
    "<skill>",
    skill,
    "</skill>",
    `用户需求：「${scenario}」`,
    "",
    "请直接输出：1) 你将执行的命令（bash，逐行列出；若无需执行命令则说明）；2) 给用户的一句话说明。",
    "不要执行任何命令，不要多余寒暄。",
  ].join("\n");
  const tmp = `/tmp/wxpub-eval-${Date.now()}.json`;
  const res = spawnSync("claude", ["-p", prompt, "--output-format", "json"], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`claude -p 退出码 ${res.status}: ${(res.stderr || "").slice(0, 200)}`);
  }
  try {
    const out = JSON.parse(res.stdout);
    if (!out.result) throw new Error("响应无 result 字段");
    return out.result;
  } catch {
    // stdout 可能混入警告行，取最后一个 JSON 对象
    writeTmp(tmp, res.stdout);
    throw new Error(`响应解析失败，原文已存 ${tmp}`);
  }
}

function writeTmp(path, content) {
  writeFileSync(path, content);
}

/** 单用例评分：返回 {pass, failures[], evidence} */
function grade(answer, c) {
  const failures = [];
  const text = answer.toLowerCase();
  if (c.ordered) {
    let pos = -1;
    for (const kw of c.ordered) {
      const idx = text.indexOf(kw.toLowerCase());
      if (idx === -1) {
        failures.push(`缺少关键词「${kw}」`);
        break;
      }
      if (idx < pos) {
        failures.push(`「${kw}」出现在前置关键词之前（顺序错误）`);
        break;
      }
      pos = idx;
    }
  }
  for (const re of c.must_match ?? []) {
    if (!new RegExp(re, "i").test(answer)) failures.push(`未命中必须模式 /${re}/`);
  }
  for (const re of c.must_not_match ?? []) {
    const m = answer.match(new RegExp(re, "i"));
    if (m) failures.push(`出现禁止模式 /${re}/（命中「${m[0]}」）`);
  }
  return { pass: failures.length === 0, failures };
}

const results = [];
for (const c of cases) {
  process.stdout.write(`▶ ${c.id} … `);
  let answer;
  try {
    answer = askAgent(c.scenario);
  } catch (err) {
    results.push({ id: c.id, pass: false, failures: [err.message], answer: "" });
    console.log("✗ 评测器故障");
    continue;
  }
  const { pass, failures } = grade(answer, c);
  results.push({ id: c.id, pass, failures, answer });
  console.log(pass ? "✓" : `✗ ${failures.join("；")}`);
  if (!pass) {
    console.log(`  ┌ 回答片段：${answer.replace(/\n+/g, " ⏎ ").slice(0, 300)}`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(
  `\n${failed.length === 0 ? "✅" : "❌"} agent evals：${results.length - failed.length}/${results.length} 通过`,
);
if (failed.length > 0) {
  console.log("\n失败用例（= skill 说明书没教好，改 SKILL.md 后重跑）：");
  for (const f of failed) console.log(`  - ${f.id}: ${f.failures.join("；")}`);
  process.exit(1);
}
