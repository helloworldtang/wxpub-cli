import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfig, saveConfig } from "../src/config.js";
import { checkCredential } from "../src/commands/update.js";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), "wxpub-cfg-")), "config.json");

describe("config: logout 后的空凭据语义", () => {
  it("apiKey 为空串时 loadConfig 视为未配置（me/publish 不拿空凭据打服务）", () => {
    const file = tmpFile();
    saveConfig({ baseUrl: "https://yyps.net", apiKey: "sk_live_x" }, file);
    // logout 的写法：保留 baseUrl，apiKey 置空
    saveConfig({ baseUrl: "https://yyps.net", apiKey: "" }, file);
    expect(loadConfig(file)).toBeNull();
    expect(JSON.parse(readFileSync(file, "utf8")).baseUrl).toBe("https://yyps.net");
  });

  it("合法配置正常读回", () => {
    const file = tmpFile();
    saveConfig({ baseUrl: "https://yyps.net", apiKey: "sk_live_x" }, file);
    expect(loadConfig(file)).toEqual({ baseUrl: "https://yyps.net", apiKey: "sk_live_x" });
  });
});

describe("update: 替换前门禁 checkCredential", () => {
  it("sk_ key 服务端校验通过 → 放行", async () => {
    const impl = (async () =>
      jsonResponse(200, { success: true, data: { service_name: "wechat-publish", is_active: true } })) as typeof fetch;
    expect(await checkCredential("sk_live_ok", impl)).toEqual({ ok: true });
  });

  it("sk_ key 校验失败 → 拒绝（不落盘的前提）", async () => {
    const impl = (async () => jsonResponse(200, { success: false })) as typeof fetch;
    const check = await checkCredential("sk_live_bad", impl);
    expect(check.ok).toBe(false);
    expect(check.error).toContain("validate");
  });

  it("已过期 JWT → 拒绝并指路 login --force", async () => {
    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const expired = `header.${b64({ exp: 1000 })}.sig`;
    const check = await checkCredential(expired);
    expect(check.ok).toBe(false);
    expect(check.error).toContain("login --force");
  });

  it("未过期 JWT / 未知形态 → 放行", async () => {
    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const valid = `header.${b64({ exp: 4000000000 })}.sig`;
    expect(await checkCredential(valid)).toEqual({ ok: true });
    expect(await checkCredential("weird_token")).toEqual({ ok: true });
  });
});
