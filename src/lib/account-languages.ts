/** BCP 47 language tags for the account UI and locale-sensitive formatting. */
export const accountLanguages = ["de", "en"] as const;
export type AccountLanguage = (typeof accountLanguages)[number];

export function isAccountLanguage(value: unknown): value is AccountLanguage {
  return accountLanguages.some((language) => language === value);
}
