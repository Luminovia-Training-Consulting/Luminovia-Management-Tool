# Freiwillige Kontaktfreigabe im Dozierendenteam

Auf `/profile` kann jedes aktive Teamkonto seine gespeicherte E-Mail-Adresse und Telefonnummer unabhängig für das interne Teamprofil freigeben. Beide Freigaben sind zunächst ausgeschaltet. Die Vorschau zeigt die tatsächlich gespeicherten Werte aus Auth beziehungsweise dem persönlichen Profil; ein noch nicht gespeicherter Telefonentwurf wird nicht als freigegebener Wert bestätigt. Die Einstellung bleibt nach einem Neuladen erhalten. Das Kontaktprofil bietet sichere E-Mail- und Telefonaktionen, sofern die gespeicherte Angabe dafür geeignet ist.

Die bestehenden `people_directory`- und `person_profile`-Projektionen behalten ihren bisherigen Umfang ohne E-Mail-Adresse oder Telefonnummer. Eine separate, eng begrenzte Funktion `person_contact(p_user_id)` prüft bei jedem Abruf die aktive Kontoidentität, die aktuellen vertrauenswürdigen Teamrollen beider Personen, das Profilzugriffsrecht und die expliziten Freigaben der Zielperson. Reine Auftraggeber- und Teilnahmekonten erhalten auch bei erlaubtem Kursprofilzugriff keine Teamkontaktangaben. Ein administrativer Rang umgeht diese Freigabe nicht. Bestehende eigenständige Berechtigungen der Kontoverwaltung bleiben erhalten; die Profiloberfläche erklärt diese Grenze ausdrücklich.

Die Freigabe liegt in `private.staff_contact_visibility`, geschützt durch RLS und ohne direkte Browserrechte. `contact_visibility_preferences()` liest nur den eigenen Stand. `save_contact_visibility_preferences(p_payload,p_expected_version)` akzeptiert ausschließlich zwei boolesche Freigaben und die passende Versionsnummer; eigene Identität und Kontaktdaten stammen aus dem Server. Ein veralteter oder konkurrierender Speichervorgang überschreibt keinen neueren Stand. Ein Konflikt erhält den Entwurf und bietet ausdrückliches Neuladen an. Nicht-Teamkonten dürfen keine Freigabe aktivieren.

Die freigegebenen Kontaktdaten werden bei jedem Abruf aus den aktuellen gespeicherten Quellen gelesen, nicht als Kopie im Verzeichnis gepflegt. Abschalten, Rollenverlust oder Kontosperrung unterbindet die nächste Ausgabe. Bereits von einer anderen Person gelesene Informationen lassen sich dadurch nicht zurückholen. Die Oberfläche prüft normale veraltete Daten bei Fokus/Reconnect erneut; ein dauerhaft offenes Profil benötigt für sofortigen Sichtwechsel ein Neuladen. Ein fehlgeschlagener erneuter Zugriff zeigt keine zurückbehaltenen Kontaktdaten. Neue Query-Schlüssel enthalten beide Kontoidentitäten, und die bestehende Auth-Grenze leert den privaten Cache bei Kontowechsel.

Kontaktwerte werden als Text dargestellt. E-Mail-Verweise kodieren die vollständige Adresse, damit darin enthaltene Zeichen keine zusätzlichen Mailheader einschleusen. Telefonlinks akzeptieren nur einfache Telefonnummern und typische Trennzeichen; ausführbare oder parameterisierte Inhalte werden nicht verlinkt. Keine Nachricht wird automatisch gesendet und kein Anruf automatisch ausgelöst.

## Tatsächliche fokussierte Prüfung am 16. November 2026

- Acht isolierte PostgreSQL-Prüfgruppen bestanden: private Voreinstellung, aktive Teamrollen, exakt ausgewählte Felder, Client-/Teilnehmer-/Administratorgrenzen, echte gleichzeitige Versionskonflikte, manipulierte Eingaben, aktuelle gespeicherte Werte, unveränderte Minimalprofile, Widerruf, Rollenverlust und Sperrung.
- Fünf Komponententests bestanden: sichere Kontaktaktionen, bestätigtes Speichern ohne fremde Browser-ID, Konflikt mit explizitem Neuladen, Ausblenden zurückbehaltener Werte nach verweigertem Zugriff, feindliche Werte und DE/EN-Wechsel.
- `scripts/staff-contact-api-check.mjs` und `tests/e2e/staff-contact.spec.ts` sind für den kanonischen disponiblen Gesamtprüflauf erstellt. Sie gelten erst nach tatsächlicher Ausführung als bestanden; das zentrale Arbeitsprotokoll hält den integrierten Stand fest.

```bash
node scripts/staff-contact-db-tests.mjs
npx vitest run src/features/profile/contact.test.tsx
```

Es wurden keine realen Kontaktdaten, Produktivdatensätze oder E-Mail-Zugangsdaten eingesetzt.
