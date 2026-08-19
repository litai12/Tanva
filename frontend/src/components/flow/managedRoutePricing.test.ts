import assert from "node:assert/strict";
import test from "node:test";
import {
  getManagedRoutesMetadata,
  resolveManagedRouteConsumerPolicy,
  sanitizeVideoManagedRoutes,
} from "./managedRoutePricing.ts";
import { normalizeViduModelValue } from "../../services/videoProviderParams.ts";

test("VOD-capable video metadata is reduced to the Tencent route", () => {
  const sanitized = sanitizeVideoManagedRoutes({
    managedRoutes: {
      modelKey: "kling-3.0",
      defaultVendor: "apimart",
      vendors: [
        { vendorKey: "apimart", platformKey: "apimart" },
        { vendorKey: "tencent_vod", platformKey: "tencent_vod" },
      ],
    },
  });
  const routes = getManagedRoutesMetadata(sanitized);

  assert.equal(routes?.defaultVendor, "tencent_vod");
  assert.deepEqual(routes?.vendors.map((route) => route.vendorKey), ["tencent_vod"]);
});

test("models without a Tencent route keep their original route", () => {
  const metadata = {
    managedRoutes: {
      modelKey: "seedance-2.0",
      defaultVendor: "seedance_api",
      vendors: [{ vendorKey: "seedance_api", platformKey: "ark" }],
    },
  };

  assert.equal(sanitizeVideoManagedRoutes(metadata), metadata);
});

test("Vidu q3-mix remains a distinct VOD model variant", () => {
  assert.equal(normalizeViduModelValue("q3-mix"), "q3-mix");
  assert.equal(normalizeViduModelValue("q3mix"), "q3-mix");
});

test("consumer policies expire automatically and can disable one spec", () => {
  const metadata = {
    managedRoutes: {
      modelKey: "seedance-2.0",
      defaultVendor: "seedance_api",
      vendors: [
        {
          vendorKey: "seedance_api",
          pricing: {
            consumerPolicies: [
              {
                policyKey: "1080p_campaign",
                enabled: true,
                priority: 100,
                startsAt: "2026-08-14T14:00:00+08:00",
                endsAt: "2026-09-17T14:00:00+08:00",
                conditions: {
                  all: [
                    { field: "seedanceModel", op: "eq", value: "seedance-2.5" },
                    { field: "resolution", op: "eq", value: "1080P" },
                  ],
                },
                discount: { multiplier: 0.72 },
              },
              {
                policyKey: "4k_unavailable",
                enabled: true,
                priority: 110,
                conditions: {
                  all: [
                    { field: "seedanceModel", op: "eq", value: "seedance-2.5" },
                    { field: "resolution", op: "eq", value: "4K" },
                  ],
                },
                availability: { available: false, message: "暂未开放" },
              },
            ],
          },
        },
      ],
    },
  };

  assert.equal(
    resolveManagedRouteConsumerPolicy(
      metadata,
      "seedance_api",
      { seedanceModel: "seedance-2.5", resolution: "1080P" },
      new Date("2026-08-17T12:00:00+08:00")
    )?.discount?.multiplier,
    0.72
  );
  assert.equal(
    resolveManagedRouteConsumerPolicy(
      metadata,
      "seedance_api",
      { seedanceModel: "seedance-2.5", resolution: "1080P" },
      new Date("2026-09-17T14:00:00+08:00")
    ),
    null
  );
  assert.deepEqual(
    resolveManagedRouteConsumerPolicy(
      metadata,
      "seedance_api",
      { seedanceModel: "seedance-2.5", resolution: "4K" },
      new Date("2026-08-17T12:00:00+08:00")
    )?.availability,
    { available: false, message: "暂未开放", policyKey: "4k_unavailable" }
  );
});

test("an empty-condition availability policy disables the whole managed model", () => {
  const metadata = {
    managedRoutes: {
      modelKey: "seedance-2.0",
      defaultVendor: "seedance_api",
      vendors: [
        {
          vendorKey: "seedance_api",
          pricing: {
            consumerPolicies: [
              {
                policyKey: "whole_model_offline",
                enabled: true,
                priority: 100,
                conditions: { all: [], any: [] },
                availability: { available: false, message: "模型维护中" },
              },
              {
                policyKey: "4k_only",
                enabled: true,
                priority: 110,
                conditions: {
                  all: [{ field: "resolution", op: "eq", value: "4K" }],
                },
                availability: { available: false, message: "4K 暂未开放" },
              },
            ],
          },
        },
      ],
    },
  };

  assert.deepEqual(
    resolveManagedRouteConsumerPolicy(
      metadata,
      "seedance_api",
      { seedanceModel: "seedance-2.0" },
      new Date("2026-08-18T12:00:00+08:00")
    )?.availability,
    {
      available: false,
      message: "模型维护中",
      policyKey: "whole_model_offline",
    }
  );
});
