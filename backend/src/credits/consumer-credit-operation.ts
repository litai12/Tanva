import type { ResolvedManagedConsumerPolicy } from '../ai/services/model-pricing-resolver';

const CREDITS_PER_YUAN = 100;
const ROUNDING_EPSILON = 1e-9;

export interface ConsumerCreditCharge {
  listCredits: number;
  chargedCredits: number;
  multiplier: number;
  listPriceYuan?: number;
  chargedPriceYuan?: number;
  policyKey: string;
  label?: string;
  startsAt?: string;
  endsAt?: string;
}

/**
 * Applies an active consumer discount to the final user credit charge only.
 * Catalog price and provider cost are intentionally left untouched.
 */
export const applyConsumerCreditDiscount = (params: {
  listCredits: number;
  catalogPriceYuan?: number;
  consumerPolicy?: ResolvedManagedConsumerPolicy;
}): ConsumerCreditCharge | undefined => {
  const discount = params.consumerPolicy?.discount;
  const multiplier = Number(discount?.multiplier);
  if (
    !discount ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0 ||
    multiplier > 1
  ) {
    return undefined;
  }

  const listCredits = Math.max(0, Math.ceil(Number(params.listCredits) || 0));
  const catalogPriceYuan = Number(params.catalogPriceYuan);
  const hasCatalogPrice = Number.isFinite(catalogPriceYuan) && catalogPriceYuan >= 0;
  const chargedPriceYuan = hasCatalogPrice
    ? Number((catalogPriceYuan * multiplier).toFixed(6))
    : undefined;
  const chargedCredits = hasCatalogPrice
    ? Math.max(
        0,
        Math.ceil(chargedPriceYuan! * CREDITS_PER_YUAN - ROUNDING_EPSILON),
      )
    : Math.max(0, Math.ceil(listCredits * multiplier - ROUNDING_EPSILON));

  return {
    listCredits,
    chargedCredits,
    multiplier,
    ...(hasCatalogPrice ? { listPriceYuan: catalogPriceYuan, chargedPriceYuan } : {}),
    policyKey: discount.policyKey,
    ...(discount.label ? { label: discount.label } : {}),
    ...(discount.startsAt ? { startsAt: discount.startsAt } : {}),
    ...(discount.endsAt ? { endsAt: discount.endsAt } : {}),
  };
};
