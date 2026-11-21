import i18n from "../../lib/i18n";

const pairs = {
  related: ["Verbundene Bereiche", "Related areas"],
  course: ["Kursarbeitsraum öffnen", "Open course workspace"],
  lecturer_course: ["Dozierenden-Chat öffnen", "Open lecturer chat"],
  participant_course: ["Teilnehmenden-Chat öffnen", "Open participant chat"],
  unavailable: [
    "Verknüpfte Bereiche konnten nicht geladen werden.",
    "Related areas could not be loaded.",
  ],
  retry: ["Erneut versuchen", "Try again"],
} as const;
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "jobRelated",
    Object.fromEntries(
      Object.entries(pairs).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
