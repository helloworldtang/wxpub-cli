import { describe, expect, it } from "vitest";

import {
  DEVICE_CLIENT_ID,
  DEVICE_GRANT_URN,
  DeviceFlowError,
  decodeJwtExp,
  discoverDeviceEndpoints,
  pollDeviceToken,
  requestDeviceAuthorization,
  validateApiKey,
} from "../src/device-auth.js";

describe("智能登录凭据检查", () => {
  it("decodeJwtExp：解出 exp；非 JWT / 无 exp 返回 null", () => {
    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    expect(decodeJwtExp(`header.${b64({ exp: 1900000000 })}.sig`)).toBe(1900000000);
    expect(decodeJwtExp(`header.${b64({ sub: "1" })}.sig`)).toBeNull();
    expect(decodeJwtExp("sk_live_abc")).toBeNull();
    expect(decodeJwtExp("")).toBeNull();
  });

  it("validateApiKey：wire 契约 {api_key} → success/data.service_name；失败返回 null", async () => {
    let captured: string | undefined;
    let capturedBody: unknown;
    const impl = async (url: string, init?: RequestInit) => {
      captured = url;
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse(200, {
        success: true,
        data: { service_name: "wechat-publish", is_active: true },
      });
    };
    const result = await validateApiKey("https://auth.example.com/", "sk_live_x", impl);
    expect(result).toEqual({ serviceName: "wechat-publish" });
    expect(captured).toBe("https://auth.example.com/api/keys/validate");
    expect(capturedBody).toEqual({ api_key: "sk_live_x" });

    const invalid = async () => jsonResponse(403, { error: "key 无效" });
    expect(await validateApiKey("https://auth.example.com", "sk_live_bad", invalid)).toBeNull();
    const unreachable = async () => {
      throw new Error("network");
    };
    expect(await validateApiKey("https://auth.example.com", "sk_live_x", unreachable)).toBeNull();
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const META = {
  issuer: "https://auth.example.com",
  device_authorization_endpoint: "https://auth.example.com/oauth/device/authorize",
  token_endpoint: "https://auth.example.com/oauth/token",
  grant_types_supported: ["password", DEVICE_GRANT_URN],
};

describe("discoverDeviceEndpoints（RFC 8414 发现契约）", () => {
  it("拿到两端点；issuer 尾斜杠被规范化", async () => {
    const impl = async () => jsonResponse(200, META);
    const endpoints = await discoverDeviceEndpoints("https://auth.example.com/", impl);
    expect(endpoints.deviceAuthorizationEndpoint).toBe(META.device_authorization_endpoint);
    expect(endpoints.tokenEndpoint).toBe(META.token_endpoint);
  });

  it("grant_types_supported 缺 device URN → 明确报不支持（而不是后续莫名 400）", async () => {
    const impl = async () => jsonResponse(200, { ...META, grant_types_supported: ["password"] });
    await expect(discoverDeviceEndpoints("https://auth.example.com", impl)).rejects.toMatchObject({
      code: "unsupported_grant_type",
    });
  });

  it("发现文档请求失败 → HTTP 状态进错误信息", async () => {
    const impl = async () => jsonResponse(500, {});
    await expect(discoverDeviceEndpoints("https://auth.example.com", impl)).rejects.toMatchObject({
      code: "discovery_failed",
    });
  });
});

describe("requestDeviceAuthorization（wire 契约）", () => {
  it("发起请求带 client_id + scope；响应字段完整映射", async () => {
    let captured: { url: string; body: URLSearchParams } | undefined;
    const impl = async (url: string, init?: RequestInit) => {
      captured = { url, body: new URLSearchParams(String(init?.body)) };
      return jsonResponse(200, {
        device_code: "dBjftJeZ4CVP",
        user_code: "WDJB-MJHT",
        verification_uri: "https://auth.example.com/admin/#/device",
        verification_uri_complete: "https://auth.example.com/admin/#/device?user_code=WDJB-MJHT",
        expires_in: 600,
        interval: 5,
      });
    };
    const auth = await requestDeviceAuthorization(
      "https://auth.example.com/oauth/device/authorize",
      DEVICE_CLIENT_ID,
      impl,
    );
    expect(auth.deviceCode).toBe("dBjftJeZ4CVP");
    expect(auth.userCode).toBe("WDJB-MJHT");
    expect(auth.verificationUriComplete).toContain("user_code=WDJB-MJHT");
    expect(captured?.url).toBe("https://auth.example.com/oauth/device/authorize");
    expect(captured?.body.get("client_id")).toBe(DEVICE_CLIENT_ID);
    expect(captured?.body.get("scope")).toBe("openid profile auth:permissions");
    expect(captured?.body.get("audience")).toBe("client_wechat");
  });

  it("服务端拒绝（如 client 未启用设备流）→ 透传 error + 描述", async () => {
    const impl = async () =>
      jsonResponse(400, { error: "unauthorized_client", error_description: "无权使用设备流" });
    await expect(
      requestDeviceAuthorization(
        "https://auth.example.com/oauth/device/authorize",
        DEVICE_CLIENT_ID,
        impl,
      ),
    ).rejects.toMatchObject({
      code: "unauthorized_client",
      message: expect.stringContaining("无权使用设备流"),
    });
  });
});

describe("pollDeviceToken（RFC 8628 §3.5 轮询语义）", () => {
  const base = {
    tokenEndpoint: "https://auth.example.com/oauth/token",
    clientId: DEVICE_CLIENT_ID,
    deviceCode: "dBjftJeZ4CVP",
    intervalSecs: 5,
  };

  it("pending → 等待 → 拿到 token；轮询请求带 grant URN", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    let lastBody: URLSearchParams | undefined;
    const impl = async (_url: string, init?: RequestInit) => {
      calls += 1;
      lastBody = new URLSearchParams(String(init?.body));
      return calls === 1
        ? jsonResponse(400, { error: "authorization_pending" })
        : jsonResponse(200, {
            access_token: "eyJhbGciOiJ9.eyJzdWIiOiJ9.sig",
            refresh_token: "RT_1",
          });
    };
    const result = await pollDeviceToken({
      ...base,
      fetchImpl: impl,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.accessToken).toBe("eyJhbGciOiJ9.eyJzdWIiOiJ9.sig");
    expect(result.refreshToken).toBe("RT_1");
    expect(calls).toBe(2);
    expect(sleeps).toEqual([5000]);
    expect(lastBody?.get("grant_type")).toBe(DEVICE_GRANT_URN);
    expect(lastBody?.get("device_code")).toBe("dBjftJeZ4CVP");
  });

  it("slow_down → 间隔 +5s 递增", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const impl = async () => {
      calls += 1;
      return calls <= 2
        ? jsonResponse(400, { error: "slow_down" })
        : jsonResponse(200, { access_token: "jwt.a.b" });
    };
    await pollDeviceToken({
      ...base,
      fetchImpl: impl,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });
    // 第一次 slow_down：5+5=10s；第二次 slow_down：10+5=15s
    expect(sleeps).toEqual([10_000, 15_000]);
  });

  it("access_denied / expired_token → 终止抛 DeviceFlowError", async () => {
    const impl = async () =>
      jsonResponse(400, { error: "access_denied", error_description: "用户已拒绝" });
    await expect(
      pollDeviceToken({ ...base, fetchImpl: impl, sleepImpl: async () => {} }),
    ).rejects.toMatchObject({ code: "access_denied" });

    const impl2 = async () => jsonResponse(400, { error: "expired_token" });
    await expect(
      pollDeviceToken({ ...base, fetchImpl: impl2, sleepImpl: async () => {} }),
    ).rejects.toBeInstanceOf(DeviceFlowError);
  });
});
