// Tanva stores RMB amounts directly. Legacy USD fields are numeric aliases;
// persisted exchange-rate/display preferences must never reconvert them.
export const TANVA_CURRENCY_CONFIG = Object.freeze({
  symbol: '¥',
  rate: 1,
  type: 'CNY',
});

export const formatTanvaMoney = (amount, digits = 2) => {
  const number = Number(amount);
  return `¥${Number.isFinite(number) ? number.toFixed(digits) : amount}`;
};

// Stripe amount quotes do not include the checkout product's currency here.
// Show the supplier's number without claiming it is a yuan amount.
export const formatPaymentAmount = (amount, paymentMethod, digits = 2) =>
  paymentMethod === 'stripe'
    ? Number(amount).toFixed(digits)
    : formatTanvaMoney(amount, digits);
