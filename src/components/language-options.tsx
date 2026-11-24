import { accountLanguages } from "../lib/account-languages";

const languageLabels = {
  de: ["Deutsch", "DE"],
  en: ["English", "EN"],
  "de-CH": ["Deutsch (Schweiz)", "DE-CH"],
} as const;

export function LanguageOptions({ compact = false }: { compact?: boolean }) {
  return accountLanguages.map((language) => (
    <option key={language} value={language} lang={language}>
      {languageLabels[language][compact ? 1 : 0]}
    </option>
  ));
}
