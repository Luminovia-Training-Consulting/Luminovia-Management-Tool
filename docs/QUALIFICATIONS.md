# Qualifikationsbelege und Verifikation

Der M8-Quellstand ergänzt die bestehende manuelle Managementattestation um eine ausdrückliche Freigabe einer **bestimmten eigenen Zertifikatsversion für ein ausgewähltes Thema**. Der Belegpicker sucht serverseitig mit echten Seitencursorn (20 Einträge, höchstens 50). Upload und Quarantäne bleiben beim vorhandenen Files-/ClamAV-Pfad. Eine Datei, ein Upload oder eine Freigabe allein verifiziert keine Qualifikation.

Im eigenen Profil: Thema auswählen, saubere Zertifikatsversion wählen, Freigabetext bestätigen und speichern. Management öffnet beim betreffenden Thema „Beleg und Prüfverlauf“, lädt bei Bedarf genau diese Version herunter und bestätigt die Verifikation mit optionalem zukünftigen UTC-Ablaufdatum. Der vorhandene manuelle Prüfweg bleibt verfügbar. Ein neuer Upload/Dateiersatz ändert eine bestehende Freigabe nicht. Belegaustausch oder Zurückziehen ändern keine erteilte Verifikation und keine bereits angenommenen Aufträge. Eine fachlich erforderliche Aufhebung ist eine ausdrückliche Managemententscheidung; ihre Gültigkeit beeinflusst zukünftige Claims wie bisher bis zum letzten Kursende.

## Berechtigung und Dateiversionen

`qualifications.verify` mit aktueller MFA berechtigt zum gezielten Belegworkflow, nicht mehr zum pauschalen Lesen fremder Zertifikate. Die neue Files-Aktion `qualification_evidence_download` benötigt die aktuelle Bindungs-ID. Sie prüft Berechtigung, Besitzer, persönlichen Zertifikattyp, saubere exakte Version, Größe und SHA-256 vor dem Download und die Freigabe erneut nach dem Storageabruf. Es entstehen keine allgemeinen Dokument-/Versionsrechte und keine wiederverwendbare Storage-URL. Ein Rechteentzug oder Fehler verbirgt zwischengespeicherte Belegdetails in der Oberfläche; private Dateien werden nicht offline gehalten.

Bestehende separate Rechte bleiben erhalten: `users.manage` mit MFA kann weiterhin fremde CVs lesen; Vertrags-/Finanzrechte behalten ihren bisherigen Umfang. Die neue Qualifikationsfunktion schafft keine zusätzlichen Rechte auf CVs, Verträge oder Rechnungen. Fremde Zertifikatuploads werden jetzt vor einer Reservation abgelehnt. Der gewählte Weg ist eigener Upload und ausdrückliche Themenfreigabe.

Zurückziehen, Ersatz, Dokumentarchivierung oder Entfernen eines Themas beenden den bisherigen Belegdownload. Ein erneut hinzugefügtes Thema stellt eine alte Freigabe nicht wieder her. Der Prüfverlauf enthält Entscheidung/Basis und Ereignisse; ein historischer Eintrag erteilt keinen historischen Downloadzugriff. Bestehenden Verifikationen wird keine rückwirkend erfundene Geschichte zugeordnet.

## Datenbank und APIs

Neue CLI-Migration: `20261116004358_qualification_evidence_and_attestation_history.sql`. Die bisherigen Migrationen bleiben unverändert. Private Tabellen `qualification_states`, `qualification_evidence`, `qualification_events` und `qualification_requests` besitzen RLS und keine Browser-Tabellenrechte. Die aktuelle Themenauswahl bleibt in `lecturer_topics`; zugrunde liegende Jobclaims, angenommene Konditionen und Kalenderzuweisungen werden durch den neuen Kern nicht geändert.

| RPC                              | Vertrag                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `own_qualification_certificates` | Nur eigene saubere persönliche Zertifikatsversionen, literale Suche und begrenzter Cursor                       |
| `qualification_review`           | Aktueller Themenzustand, CAS-Version und ausschließlich aktuelle freigegebene Versionsmetadaten                 |
| `save_qualification_evidence`    | Eigene ausdrückliche Bindung; `p_version_id=null` zieht Zugriff zurück; CAS und Request-ID erforderlich         |
| `attest_qualification`           | Aktuelle Managementberechtigung/MFA, CAS/Request-ID, optional exakte aktuelle Bindung                           |
| `verify_lecturer_topic`          | Unveränderte alte Signatur; delegiert als manuelle Attestation an denselben internen Entscheidungs-/Historykern |
| `qualification_history`          | Eigener oder aktuell prüfberechtigter begrenzter Ereignisverlauf mit Cursor                                     |
| `qualification_evidence_access`  | Aktuelle eng begrenzte Version für den authentifizierten Downloadadapter, niemals ein Speicherpfad              |

Mutationen sperren zuerst das aktive handelnde Profil und prüfen danach die aktuelle Rolle/Berechtigung. Rollenverwaltung und Sperrung nutzen denselben Profil-Lock. Wartende Aufrufe können einen inzwischen committed Rollenentzug nicht mit einem alten JWT umgehen. Danach werden Themen-/CAS-Zustand und Belege konsistent gesperrt. Gleiche Request-IDs mit geändertem Payload werden abgewiesen; bestätigte Wiederholungen schreiben keine weitere Entscheidung und liefern den **aktuell bereinigten Zustand**, keine widerrufenen privaten Metadaten. Maximal 30 neue Änderungen pro Akteur/Minute; Wiederholungen verbrauchen keine zweite Änderung.

Die Historie ist für Browser unveränderlich. Ausschließlich privilegierte serverseitige Bereinigung kann sie löschen: Besitzer-/Accountlöschung kaskadiert eigene private Daten, Löschen eines Prüferkontos entfernt dessen Personenreferenz, ein serverseitiger Versionspurge entfernt betroffene Belegreferenzen und ihre Ereignisse. Normaler Start, Profiländerungen, Soft-Archivierung und die Benutzeroberfläche führen keinen solchen Purge aus. Diese kontrollierte Grenze erlaubt auch die vorhandenen UUID-begrenzten Testfixture-Cleanups; sie ist keine ausgelieferte Retention-Oberfläche.

## Prüfung und Grenze

Gezielte ausführbare Prüfungen:

```bash
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-m7 node scripts/qualifications-db-tests.mjs
node_modules/.bin/deno test --allow-env supabase/functions/files/qualification-download_test.ts
npx vitest run src/features/qualifications/evidence.test.tsx src/features/admin/people.test.tsx
```

Ausgeführt im M8-Arbeitsstand: **16 echte PostgreSQL-Gruppen**, **22 Komponentenfälle** (16 neue und sechs People-Fälle), **vier Edge-Downloadtests**, Edge-Typprüfung/-Lint, TypeScript und gezieltes ESLint bestanden. Zusätzlich bestanden alle sechs API-Surface-Gruppen nach tatsächlichem Replay der aktuellen Migrationen.

Die SQL-Fälle verwenden eine zufällige eigene temporäre Datenbank im freigegebenen lokalen Scratch-Container. Sie prüfen echte Sperrbarrieren beim Rollenentzug für alten und neuen Entscheidungsweg, CAS/Retry/Rollback, ausschließlich freigegebene Versionen, Themenentfernung, MFA und kontrolliertes Cleanup. Die Edge-Tests prüfen die tatsächliche Downloadlogik einschließlich Versions-/Hash-/Besitzerverwechslung und Widerruf während des Objektabrufs. Komponentenfälle prüfen ausdrückliche Zustimmung, verlorene Antworten, Ablaufdatum, Cacheverwerfung und gezielte Abfragen.

`qualifications-api-check.mjs` und `tests/e2e/qualifications.spec.ts` sind für die kanonische isolierte `./portal test`-Umgebung bestimmt. Ihre Existenz ist noch kein durchgeführter Auth-/Scanner-/Browsernachweis. Root dokumentiert die vollständige native Abnahme nach dem tatsächlichen Lauf. Keine Zertifikats-Echtheitsprüfung durch einen externen Aussteller, Signaturprüfung, automatische E-Mail oder Rechtskonformitätsbescheinigung wird behauptet.
