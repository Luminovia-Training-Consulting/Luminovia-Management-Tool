import i18n from "../../lib/i18n";
const de = {
  search: "Auftrag oder Kurs suchen",
  apply: "Auswahl durchsuchen",
  chooseJob: "Auftrag für die Datei",
  chooseCourse: "Kurs für den Teilnahmechat",
  choose: "Bitte auswählen",
  more: "Weitere Auswahlmöglichkeiten laden",
  loaded_one: "{{count}} Auswahlmöglichkeit geladen",
  loaded_other: "{{count}} Auswahlmöglichkeiten geladen",
  complete: "Alle passenden Auswahlmöglichkeiten sind geladen.",
  none: "Keine passenden Auswahlmöglichkeiten.",
  selectionHint:
    "Die bisherige Auswahl bleibt außerhalb dieser Suchseite erhalten. Ändere sie ausdrücklich im Auswahlfeld.",
  unscheduled: "Ohne Termin",
  runReference: "Durchlauf {{id}}",
  denied:
    "Die aktuelle Berechtigung für diese Auswahl fehlt. Lade die Berechtigungen neu, bevor du fortfährst.",
};
const en: Record<keyof typeof de, string> = {
  search: "Search for an offer or course",
  apply: "Search choices",
  chooseJob: "Offer for this file",
  chooseCourse: "Course for the participant channel",
  choose: "Please select",
  more: "Load more choices",
  loaded_one: "{{count}} choice loaded",
  loaded_other: "{{count}} choices loaded",
  complete: "All matching choices are loaded.",
  none: "No matching choices.",
  selectionHint:
    "Your current selection is retained outside this search page. Change it explicitly in the selection field.",
  unscheduled: "Unscheduled",
  runReference: "Run {{id}}",
  denied:
    "Current permission for this selection is missing. Refresh permissions before continuing.",
};
i18n.addResourceBundle("de", "jobPicker", de, true, true);
i18n.addResourceBundle("en", "jobPicker", en, true, true);
