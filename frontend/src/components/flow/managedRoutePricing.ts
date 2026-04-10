export interface ManagedRouteOption {
  vendorKey: string;
  platformKey?: string;
  label?: string;
  provider?: string;
  route?: string;
  modelName?: string;
  modelVersion?: string;
  creditsPerCall?: number;
}

export interface ManagedRoutesMetadata {
  modelKey: string;
  defaultVendor?: string;
  vendors: ManagedRouteOption[];
}

const asObject = (value: unknown): Record<string, any> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return null;
};

export const getManagedRoutesMetadata = (
  metadata?: Record<string, any> | null
): ManagedRoutesMetadata | null => {
  const root = asObject(metadata);
  const managedRoutes = asObject(root?.managedRoutes);
  const modelKey =
    typeof managedRoutes?.modelKey === "string" ? managedRoutes.modelKey.trim() : "";
  const vendors = Array.isArray(managedRoutes?.vendors)
    ? managedRoutes.vendors
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const vendor = item as Record<string, any>;
          const vendorKey =
            typeof vendor.vendorKey === "string" ? vendor.vendorKey.trim() : "";
          if (!vendorKey) return null;
          const credits = Number(vendor.creditsPerCall);
          return {
            vendorKey,
            platformKey:
              typeof vendor.platformKey === "string" && vendor.platformKey.trim()
                ? vendor.platformKey.trim()
                : undefined,
            label:
              typeof vendor.label === "string" && vendor.label.trim()
                ? vendor.label.trim()
                : undefined,
            provider:
              typeof vendor.provider === "string" && vendor.provider.trim()
                ? vendor.provider.trim()
                : undefined,
            route:
              typeof vendor.route === "string" && vendor.route.trim()
                ? vendor.route.trim()
                : undefined,
            modelName:
              typeof vendor.modelName === "string" && vendor.modelName.trim()
                ? vendor.modelName.trim()
                : undefined,
            modelVersion:
              typeof vendor.modelVersion === "string" && vendor.modelVersion.trim()
                ? vendor.modelVersion.trim()
                : undefined,
            creditsPerCall:
              Number.isFinite(credits) && credits >= 0 ? credits : undefined,
          } satisfies ManagedRouteOption;
        })
        .filter(Boolean) as ManagedRouteOption[]
    : [];

  if (!modelKey || vendors.length === 0) return null;

  return {
    modelKey,
    defaultVendor:
      typeof managedRoutes?.defaultVendor === "string" && managedRoutes.defaultVendor.trim()
        ? managedRoutes.defaultVendor.trim()
        : undefined,
    vendors,
  };
};

export const getManagedRouteOption = (
  metadata?: Record<string, any> | null,
  vendorKey?: string | null
): ManagedRouteOption | null => {
  const managedRoutes = getManagedRoutesMetadata(metadata);
  if (!managedRoutes) return null;
  const normalizedVendorKey = typeof vendorKey === "string" ? vendorKey.trim() : "";
  return (
    (normalizedVendorKey
      ? managedRoutes.vendors.find((item) => item.vendorKey === normalizedVendorKey)
      : undefined) ||
    managedRoutes.vendors.find((item) => item.vendorKey === managedRoutes.defaultVendor) ||
    managedRoutes.vendors[0] ||
    null
  );
};

export const getManagedRouteCredits = (
  metadata?: Record<string, any> | null,
  vendorKey?: string | null
): number | undefined => {
  const selected = getManagedRouteOption(metadata, vendorKey);
  return typeof selected?.creditsPerCall === "number" ? selected.creditsPerCall : undefined;
};
