import { HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  WECHAT_LOGIN_SESSION_COOLDOWN_MS,
  WechatLoginSessionRateLimitService,
} from "../src/auth/wechat-login-session-rate-limit.service";
import { AuthService } from "../src/auth/auth.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectRateLimited(
  action: () => Promise<void>,
  expectedRetryAfterMs: number
) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof HttpException, "重复刷新必须返回 HttpException");
    assert(error.getStatus() === 429, "重复刷新必须返回 HTTP 429");
    const response = error.getResponse() as { retryAfterMs?: number };
    assert(
      response.retryAfterMs === expectedRetryAfterMs,
      `retryAfterMs 应为 ${expectedRetryAfterMs}，实际为 ${response.retryAfterMs}`
    );
    return;
  }
  throw new Error("重复刷新未被限流");
}

async function main() {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  const noRedisConfig = {
    get: () => undefined,
  } as unknown as ConfigService;
  const service = new WechatLoginSessionRateLimitService(noRedisConfig);
  const visitor = {
    clientId: "wechat-login-client-0001",
    ip: "10.0.0.1",
    userAgent: "verification-agent",
  };

  try {
    await service.assertAllowed(visitor);
    await expectRateLimited(
      () => service.assertAllowed(visitor),
      WECHAT_LOGIN_SESSION_COOLDOWN_MS
    );

    now += WECHAT_LOGIN_SESSION_COOLDOWN_MS - 1;
    await expectRateLimited(() => service.assertAllowed(visitor), 1);

    now += 1;
    await service.assertAllowed(visitor);

    await service.assertAllowed({
      clientId: "wechat-login-client-0002",
      ip: visitor.ip,
      userAgent: visitor.userAgent,
    });

    const legacyService = new WechatLoginSessionRateLimitService(
      noRedisConfig
    );
    await legacyService.assertAllowed({
      ip: "::ffff:115.45.159.23",
      userAgent: "legacy-browser",
    });
    await expectRateLimited(
      () =>
        legacyService.assertAllowed({
          ip: "115.45.159.23",
          userAgent: "legacy-browser",
        }),
      WECHAT_LOGIN_SESSION_COOLDOWN_MS
    );
    await legacyService.onModuleDestroy();

    const tokenConfig = new ConfigService({
      WECHAT_OFFICIAL_APP_ID: "verification-app-id",
      WECHAT_OFFICIAL_APP_SECRET: "verification-app-secret",
      WECHAT_OFFICIAL_TOKEN: "verification-callback-token",
    });
    const authService = new AuthService(
      undefined as never,
      undefined as never,
      undefined as never,
      tokenConfig,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never
    );
    const loadAccessToken = (
      authService as unknown as {
        getWechatOfficialAccessToken(forceRefresh?: boolean): Promise<string>;
      }
    ).getWechatOfficialAccessToken.bind(authService);

    const originalFetch = globalThis.fetch;
    let resolveUpstream: (() => void) | undefined;
    const upstreamGate = new Promise<void>((resolve) => {
      resolveUpstream = resolve;
    });
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      await upstreamGate;
      return new Response(
        JSON.stringify({ access_token: "verification-token", expires_in: 7200 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      const firstToken = loadAccessToken();
      const secondToken = loadAccessToken();
      assert(fetchCount === 1, "并发 access token 获取必须只请求一次上游");
      resolveUpstream?.();
      const tokens = await Promise.all([firstToken, secondToken]);
      assert(
        tokens.every((token) => token === "verification-token"),
        "并发调用必须复用相同 access token 结果"
      );
      await loadAccessToken();
      assert(fetchCount === 1, "有效 access token 缓存不应再次请求上游");
    } finally {
      globalThis.fetch = originalFetch;
    }

    console.log("wechat login session rate-limit verification passed");
  } finally {
    Date.now = originalNow;
    await service.onModuleDestroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
