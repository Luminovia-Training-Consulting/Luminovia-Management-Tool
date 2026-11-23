/** Supported currencies for original amounts and per-currency reporting. */
export const currencyCodes = ["EUR", "AUD", "USD"] as const;
export type CurrencyCode = (typeof currencyCodes)[number];
