/** Search controls are translated; authored result titles are not. */
import i18n from "../../lib/i18n";

const de = {
  title: "Universelle Suche",
  hint: "Durchsuche freigegebene Inhalte und persönliche Unterlagen. Jeder Abruf prüft deine aktuellen Rechte.",
  query: "Suchbegriff",
  kind: "Bereich",
  all: "Alle Bereiche",
  search: "Suchen",
  more: "Weitere Treffer laden",
  empty: "Keine sichtbaren Treffer gefunden.",
  jobs: "Aufträge",
  files: "Dateien",
  wiki: "Wiki",
  forum: "Forum",
  chats: "Chatnachrichten",
  people: "Personen",
  courses: "Kurse",
  clients: "Unternehmen",
  contracts: "Verträge",
  finance: "Rechnungen",
};
const en: Record<keyof typeof de, string> = {
  title: "Universal search",
  hint: "Search authorised content and personal documents. Each request checks your current access.",
  query: "Search term",
  kind: "Area",
  all: "All areas",
  search: "Search",
  more: "Load more results",
  empty: "No visible matches found.",
  jobs: "Jobs",
  files: "Files",
  wiki: "Wiki",
  forum: "Forum",
  chats: "Chat messages",
  people: "People",
  courses: "Courses",
  clients: "Companies",
  contracts: "Contracts",
  finance: "Invoices",
};
i18n.addResourceBundle("de", "unifiedSearch", de);
i18n.addResourceBundle("en", "unifiedSearch", en);
