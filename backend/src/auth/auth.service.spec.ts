import { AuthService } from "./auth.service";

/**
 * 聚焦验证：微信扫码回调跨租户定位（H3）。
 * 回调通常打到主站(CLS=default)，而扫码会话可能由第二租户站点发起：
 *  - 先以平台态(runAsPlatform)按全局唯一 sceneKey 定位 session；
 *  - 再切到 session.tenantId(runAsTenant) 处理用户查/绑定与 session 更新。
 * 回归安全：session.tenantId='default' 时 runAsTenant('default') = 原行为。
 */
describe("AuthService.handleWechatOfficialCallback tenant routing", () => {
  const buildScanXml = (sceneKey: string) =>
    `<xml>` +
    `<ToUserName><![CDATA[gh_official]]></ToUserName>` +
    `<FromUserName><![CDATA[openid_user]]></FromUserName>` +
    `<MsgType><![CDATA[event]]></MsgType>` +
    `<Event><![CDATA[SCAN]]></Event>` +
    `<EventKey><![CDATA[${sceneKey}]]></EventKey>` +
    `</xml>`;

  const setupService = (sessionRow: any) => {
    const findFirst = jest.fn().mockResolvedValue(sessionRow);
    const update = jest.fn().mockResolvedValue({ id: sessionRow?.id });
    const $transaction = jest.fn(async (cb: any) => cb({}));

    const prisma = {
      wechatLoginSession: { findFirst, update },
      $transaction,
    };

    const runCalls: Array<{ kind: "platform" | string }> = [];
    const tenantContext = {
      runAsPlatform: jest.fn(async (fn: any) => {
        runCalls.push({ kind: "platform" });
        return fn();
      }),
      runAsTenant: jest.fn(async (tenantId: string, fn: any) => {
        runCalls.push({ kind: tenantId });
        return fn();
      }),
    };

    const telemetry = { ingestBackendEvent: jest.fn().mockResolvedValue(undefined) };

    const service = Object.create(AuthService.prototype) as AuthService;
    (service as any).prisma = prisma;
    (service as any).tenantContext = tenantContext;
    (service as any).openObserveTelemetryService = telemetry;

    // 桩掉与租户无关的外部调用
    (service as any).fetchWechatOfficialUserInfo = jest
      .fn()
      .mockResolvedValue({ unionId: null, nickname: "nick", avatarUrl: null });
    (service as any).findWechatOfficialUserByIdentity = jest
      .fn()
      .mockResolvedValue(null);
    (service as any).getWechatOfficialConfig = jest
      .fn()
      .mockReturnValue({ welcomeMessage: "welcome" });

    return { service, findFirst, update, tenantContext, runCalls };
  };

  it("用 runAsPlatform + findFirst 按 sceneKey 定位 session", async () => {
    const { service, findFirst, tenantContext } = setupService({
      id: "sess-1",
      tenantId: "default",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await service.handleWechatOfficialCallback(buildScanXml("scene-abc"));

    expect(tenantContext.runAsPlatform).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0]).toMatchObject({
      where: { sceneKey: "scene-abc" },
    });
  });

  it("第二租户会话：后续绑定与更新切到 session.tenantId", async () => {
    const { service, update, tenantContext } = setupService({
      id: "sess-2",
      tenantId: "tenant-b",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await service.handleWechatOfficialCallback(buildScanXml("scene-b"));

    expect(tenantContext.runAsTenant).toHaveBeenCalled();
    for (const call of tenantContext.runAsTenant.mock.calls) {
      expect(call[0]).toBe("tenant-b");
    }
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("回归：default 会话只切到 default（与原行为一致）", async () => {
    const { service, tenantContext } = setupService({
      id: "sess-d",
      tenantId: "default",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await service.handleWechatOfficialCallback(buildScanXml("scene-d"));

    for (const call of tenantContext.runAsTenant.mock.calls) {
      expect(call[0]).toBe("default");
    }
  });

  it("会话过期：不进入绑定/更新（不切租户处理后续）", async () => {
    const { service, update, tenantContext } = setupService({
      id: "sess-exp",
      tenantId: "tenant-b",
      expiresAt: new Date(Date.now() - 1_000),
    });

    const reply = await service.handleWechatOfficialCallback(
      buildScanXml("scene-exp")
    );

    expect(reply).toContain("登录二维码已过期");
    expect(tenantContext.runAsTenant).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
