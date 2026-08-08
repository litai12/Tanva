import assert from "node:assert/strict";
import test from "node:test";
import {
  getManagedRoutesMetadata,
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
