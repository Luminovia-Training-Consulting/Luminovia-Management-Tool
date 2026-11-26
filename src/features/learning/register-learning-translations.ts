/** Register German and English labels for a learning feature. */
import i18n from "../../lib/i18n";

export function registerLearningTranslations(
  pairs: Record<string, [string, string]>,
) {
  for (const [language, index] of [
    ["de", 0],
    ["en", 1],
  ] as const)
    i18n.addResourceBundle(
      language,
      "learning",
      Object.fromEntries(
        Object.entries(pairs).map(([key, value]) => [key, value[index]]),
      ),
      true,
      true,
    );
}
