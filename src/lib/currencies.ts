/** Supported currencies for original amounts and per-currency reporting. */
export const currencyCodes = ["EUR", "AUD", "USD", "CHF"] as const;
export type CurrencyCode = (typeof currencyCodes)[number];
