import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { copySkillTo, skillSourcePath } from "../src/commands/install.js";

describe("skill 分发（Agent Skills 规范契约）", () => {
  it("SKILL.md 存在于包内且 frontmatter 含 name/description（规范必需字段）", () => {
    const content = readFileSync(skillSourcePath(), "utf8");
    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(/^name:\s*wxpub\s*$/m);
    expect(content).toMatch(/^description:\s*"/m);
  });

  it("copySkillTo 落到 <target>/wxpub/SKILL.md（name 与目录名一致——规范强制）", () => {
    const target = mkdtempSync(join(tmpdir(), "wxpub-skill-"));
    const dest = copySkillTo(target);
    expect(dest).toBe(join(target, "wxpub", "SKILL.md"));
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toContain("# wxpub");
  });

  it("幂等：重复安装不报错", () => {
    const target = mkdtempSync(join(tmpdir(), "wxpub-skill-"));
    copySkillTo(target);
    expect(() => copySkillTo(target)).not.toThrow();
  });
});
