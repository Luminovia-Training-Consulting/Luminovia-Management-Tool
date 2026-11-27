/** Localised controls for course delivery and organisation teaching venues. */
import i18n from "../../lib/i18n";

const text = {
  delivery: ["Durchführung und Lernorte", "Delivery and venues"],
  courseDefault: ["Standard für den Kurs", "Course default"],
  online: ["Online", "Online"],
  onsite: ["Vor Ort", "On-site"],
  hybrid: ["Hybrid", "Hybrid"],
  mixed: ["Gemischte Durchführung", "Mixed delivery"],
  mode: ["Durchführungsform", "Delivery format"],
  inherit: ["Kursstandard verwenden", "Use course default"],
  individual: [
    "Individuelle Termineinstellungen ermöglichen",
    "Allow individual session settings",
  ],
  retained: [
    "Beim Deaktivieren bleiben deine Termineinstellungen gespeichert.",
    "Turning off individual settings preserves them for later.",
  ],
  locked: [
    "Vereinbarte oder begonnene Durchführungen sind geschützt.",
    "Agreed or started delivery is protected.",
  ],
  save: ["Durchführung speichern", "Save delivery"],
  saved: ["Durchführung gespeichert.", "Delivery saved."],
  error: [
    "Durchführung konnte nicht gespeichert werden. Prüfe die Angaben und lade bei parallelen Änderungen neu.",
    "Delivery could not be saved. Check the fields and reload after concurrent changes.",
  ],
  refresh: ["Neu laden", "Reload"],
  reset: ["Auf Kursstandard zurücksetzen", "Reset to course default"],
  venue: ["Lernort", "Venue"],
  noVenue: ["Kein Lernort", "No venue"],
  historicVenue: ["Hinterlegter Lernort", "Retained venue"],
  meeting_platform: ["Meeting-Plattform", "Meeting platform"],
  meeting_url: ["Einwahllink", "Joining link"],
  meeting_id: ["Meeting-ID", "Meeting ID"],
  meeting_access: [
    "Zugangshinweise und Zugangscode",
    "Access instructions and passcode",
  ],
  teaching_instructions: [
    "Hinweise für diesen Unterricht",
    "Teaching instructions",
  ],
  choose: ["Bitte auswählen", "Select an option"],
  directory: ["Lernorte der Organisation", "Organisation venues"],
  venueFilter: ["Lernorte suchen", "Search venues"],
  noVenues: ["Keine Lernorte gefunden.", "No matching venues."],
  venueNew: ["Lernort hinzufügen", "Add venue"],
  venueEdit: ["Lernort bearbeiten", "Edit venue"],
  venueSave: ["Lernort speichern", "Save venue"],
  venueError: [
    "Der Lernort konnte nicht gespeichert werden. Prüfe auch, ob es den Namen und Raum bereits gibt.",
    "The venue could not be saved. Check whether this venue name and room already exist.",
  ],
  archived: ["Archiviert", "Archived"],
  preferred: [
    "Standardlernort für neue Kurse",
    "Default venue for new courses",
  ],
  venueMore: [
    "Kontakt, Anreise und Ausstattung",
    "Contacts, access and equipment",
  ],
  name: ["Bezeichnung", "Name"],
  street: ["Straße", "Street"],
  house_number: ["Hausnummer", "House number"],
  address_line: ["Adresszusatz", "Address line"],
  postal_code: ["Postleitzahl", "Postal code"],
  city: ["Ort", "City"],
  region: ["Region", "Region"],
  country: ["Land", "Country"],
  building: ["Gebäude", "Building"],
  floor: ["Etage", "Floor"],
  room: ["Raum", "Room"],
  time_zone: [
    "Zeitzone (z. B. Europe/Berlin)",
    "Time zone (e.g. Europe/Berlin)",
  ],
  contact_name: ["Kontaktperson", "Contact person"],
  contact_phone: ["Telefon", "Telephone"],
  contact_email: ["E-Mail-Adresse", "Email address"],
  reception: ["Empfang", "Reception"],
  access: ["Zugang vor Ort", "Access on site"],
  parking: ["Parken", "Parking"],
  transport: ["Öffentliche Verkehrsmittel", "Public transport"],
  accessibility: ["Barrierefreiheit", "Accessibility"],
  equipment: ["Ausstattung", "Equipment"],
  notes: ["Interne Notizen", "Internal notes"],
  unsupported: [
    "Für diesen Kurs gibt es noch keine neuen Durchführungsdetails.",
    "This course has no structured delivery details yet.",
  ],
  map: ["Adresse auf Karte öffnen", "Open address on map"],
} as const;
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    language,
    "trainingDelivery",
    Object.fromEntries(
      Object.entries(text).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
}
