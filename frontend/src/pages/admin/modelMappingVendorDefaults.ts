export type ManagedVendorMetadata = Record<string, any> | undefined;

export interface ManagedModelVendorLike {
  vendorKey?: string;
  platformKey?: string;
  label?: string;
  enabled?: boolean;
  route?: "legacy" | "tencent_vod";
  provider?: string;
  creditsPerCall?: number;
  priceYuan?: number;
  modelName?: string;
  modelVersion?: string;
  pricing?: Record<string, any>;
  metadata?: ManagedVendorMetadata;
}

export const buildSeedance20VendorConfig = (
  existingVendor: ManagedModelVendorLike | null | undefined,
  defaultMetadata: Record<string, any>
): ManagedModelVendorLike => ({
  ...existingVendor,
  vendorKey: "seedance_api",
  platformKey: "seedance_api",
  label: existingVendor?.label || "Seedance API",
  enabled: existingVendor?.enabled !== false,
  route: "legacy",
  provider: existingVendor?.provider || "doubao",
  modelName: existingVendor?.modelName || "Seedance",
  modelVersion: "2.0",
  metadata:
    existingVendor?.metadata && typeof existingVendor.metadata === "object"
      ? existingVendor.metadata
      : defaultMetadata,
});
