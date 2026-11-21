export type GuideArea =
  "access" | "courses" | "administration" | "integrations" | "portal";

/** Bilingual authored content plus optional visibility hints for a known portal destination. */
export type GuideModule = {
  id: string;
  path: string;
  area?: GuideArea;
  practicePath?: string | false;
  title: { de: string; en: string };
  summary: { de: string; en: string };
  steps: { de: string[]; en: string[] };
  problem: { de: string; en: string };
  resolution: { de: string[]; en: string[] };
  keywords: string[];
  roles?: string[];
  permission?: string;
};

/** Select German language variants; all other language tags use the authored English fallback. */
export function guideText<T>(value: { de: T; en: T }, language: string): T {
  return language.toLowerCase().startsWith("de") ? value.de : value.en;
}

export type HelpCatalogue = {
  modules: GuideModule[];
  recovery: {
    title: { de: string; en: string };
    body: { de: string; en: string };
    topic: string;
  }[];
};
