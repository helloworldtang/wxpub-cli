import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { homedir } from "node:os";

/** 包根目录（dist/commands/install.js 的上两级）。 */
function packageRoot(): string {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

/** 源 SKILL.md（随 npm 包分发的 skill/claude/SKILL.md）。 */
export function skillSourcePath(): string {
  return join(packageRoot(), "skill", "claude", "SKILL.md");
}

/**
 * 把 SKILL.md 复制到目标 skill 目录（~/.claude/skills/wxpub/），幂等覆盖。
 * 返回写入的文件路径。目标目录可注入，测试用。
 */
export function copySkillTo(targetDir: string): string {
  const src = skillSourcePath();
  const content = readFileSync(src, "utf8");
  // 规范自检：name 必须与目录名一致（agentskills.io spec）
  const match = content.match(/^name:\s*(\S+)/m);
  const name = match?.[1];
  if (!name) {
    throw new Error("SKILL.md 缺少 frontmatter name 字段（Agent Skills 规范必需）");
  }
  const dest = join(targetDir, name, "SKILL.md");
  mkdirSync(join(targetDir, name), { recursive: true });
  copyFileSync(src, dest);
  return dest;
}

export interface InstallOptions {
  json: boolean;
}

/** wxpub install：把 skill 装进 Claude Code（~/.claude/skills/wxpub/）。 */
export function runInstall(options: InstallOptions): void {
  const targetRoot = join(homedir(), ".claude", "skills");
  const dest = copySkillTo(targetRoot);
  if (options.json) {
    console.log(JSON.stringify({ installed: true, skill: dest }));
    return;
  }
  console.log(`✓ skill 已安装：${dest}`);
  console.log("  新会话生效（Claude Code 启动时发现个人技能）");
  console.log("  现在可以直接说「把这篇文章发到丹心」——agent 会走 tone→写→illustrate→publish 链路");
}
