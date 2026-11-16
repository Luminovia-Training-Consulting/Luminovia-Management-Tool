# Entwickler-Dokumentation

Dieser Index führt durch den vorhandenen Luminovia-Portal-Code und seine Betriebsgrenzen. Der gemeinsame M7/M8-Quellstand umfasst 32 Migrationen; seine vollständige native Abnahme und exakte CI-Prüfung stehen aus. Bestandene gezielte Prüfungen, geschriebene Tests und tatsächliche Gesamtläufe werden getrennt in [QA_RESULTS](QA_RESULTS.md) geführt. Der vollständige Zielumfang bleibt im Plan erhalten.

## Einstieg

Bei einer Fortsetzung zuerst [WORKLOG](WORKLOG.md), danach [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md), die [Projektregeln](../AGENTS.md) und den unverändert erhaltenen [Universal Master Prompt](UNIVERSAL_MASTER_PROMPT.txt) lesen. Aktuellen Git-Status und die tatsächlich zuständigen Quellen prüfen, bevor bestehende Arbeit verändert wird.

| Aufgabe                                                      | Dokument                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Projektüberblick, Voraussetzungen und Startbefehle           | [Repository-README](../README.md)                                                                            |
| Neuester GitHub-Stand als getrennte, persistente Vorschau    | [GitHub-Vorschau](GITHUB_LOCAL_PREVIEW.md)                                                                   |
| Lokale Dienste, Konten, Ports, Persistenz und Fehlerbehebung | [Lokale Entwicklung](LOCAL_DEVELOPMENT.md)                                                                   |
| Code-Einstiege, Datenfluss und Änderungen am Projekt         | [Entwicklerhandbuch](DEVELOPER_GUIDE.md)                                                                     |
| Bedienung aus Sicht der verschiedenen Konten                 | [Benutzerhandbuch](USER_GUIDE.md)                                                                            |
| Branches, Beiträge und Freigaben                             | [CONTRIBUTING](../CONTRIBUTING.md), [Issue-Leitfaden](ISSUE_GUIDE.md), [PR-Leitfaden](PULL_REQUEST_GUIDE.md) |

Portable Befehle aus dem Repository:

```bash
./portal github start  # neuesten main-Stand separat starten, eigene Vorschau-Daten behalten
./portal github test   # neuesten main-Stand in einer isolierten Testumgebung prüfen
./portal start        # diesen Checkout datenerhaltend starten
./portal test         # diesen Quellstand vollständig isoliert prüfen
```

Die GitHub-Vorschau verwendet eine eigene Arbeitskopie und eigene Daten. Normale Entwicklung, Vorschau und Tests sind getrennte Umgebungen. Ein Start ersetzt kein Backup; Zugangsdaten und private Testartefakte gehören nicht in Git.

## Architektur und Datenmodell

| Dokument                                         | Inhalt                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| [Architektur](ARCHITECTURE.md)                   | Technologieentscheidungen, aktuelle RPC-/RLS-Grenzen, Rollen-/Profil-Locks, Cache, private Daten und M7/M8-Verbindungen |
| [ERD](ERD.md)                                    | Physische Tabellen, Beziehungen, private Zusatzmodule und ergänzende Moduldiagramme                                     |
| [Produktübersicht](PRODUCT_SPEC.md)              | Produktziele und Rollen; zusammen mit dem vollständigen Master-Prompt lesen                                             |
| [Brand und Designsystem](BRAND_DESIGN_SYSTEM.md) | Authentische Assets, Palette, Typografie und Herkunft                                                                   |
| [Referenzquellen](REFERENCE_SOURCES.md)          | Quellen und Grenzen der verwendeten Referenzen                                                                          |
| [CBW-Vorlagen](CBW_TEMPLATES.md)                 | Bausteine, Quellrevisionen, Hashes und Verbindung von Vorlage, Durchführung und Angebot                                 |

Schemaänderungen sind additive CLI-Migrationen. Öffentliche Invoker-RPCs delegieren an eng berechtigte private Implementierungen; der aktuelle Datenbankzustand autorisiert den echten Aufrufer. Details zu Parametern, Grants und Migrationseigentum stehen in den Quellen und der API-Referenz.

## Fachmodule

| Bereich / Einstieg                                               | Leitfäden und wichtige Verbindung                                                                                                                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard `/`                                                    | [Dashboard](DASHBOARD.md): echte autorisierte Gesamtzahlen und begrenzte persönliche Vorschauen                                                                                                                       |
| Aufträge `/jobs`, `/jobs/:id`, `/admin`                          | [Discovery und gespeicherte Ansichten](JOB_DISCOVERY.md), [Lebenszyklus und Kapazität](JOB_LIFECYCLE.md): Server-Paging, aktuelle Bedingungen, atomare vollständige Zuweisung, Storno und ausdrückliche Wiederöffnung |
| Administrative Auswahl in Dateien/Chat                           | [Zweckgebundene Auftrags-/Kurswähler](JOB_PICKERS.md): begrenzte Metadaten, exakte Auswahl und separate `jobs.manage`-/`courses.manage`-Berechtigung                                                                  |
| Kalender `/calendar`                                             | [Kalender](CALENDAR.md): eigene Termine/Zuweisungen, sichtbare Zeitfenster und ausdrückliche globale Entwurfs-/Publikationsverwaltung                                                                                 |
| Verfügbarkeit `/availability`                                    | [Verfügbarkeit](AVAILABILITY.md): private Sperrzeiten, ausdrückliche reduzierte Freigabe und serverseitige Konfliktprüfung                                                                                            |
| Themen `/topics`                                                 | [Taxonomie](TAXONOMY.md): Hierarchie, Aliase, Versionen, Archivierung und neue Auswahlreferenzen                                                                                                                      |
| Profile `/profile`, `/people`, `/my-reviews`                     | [Profile und Kursbewertungen](PROFILES_REVIEWS.md), [Profilbilder](PROFILE_AVATARS.md)                                                                                                                                |
| Qualifikationen im Profil und unter `/admin/people`              | [Belege und Prüfverlauf](QUALIFICATIONS.md): eigene ausdrückliche Themenfreigabe einer exakten Zertifikatsversion, Widerruf und Managementattestation                                                                 |
| Kunden, Kurse und Auftraggeber `/clients`, `/courses`, `/client` | [Organisationen und Kurse](OPERATIONS.md), [CBW-Vorlagen](CBW_TEMPLATES.md), [Konten und Umsatzteilung](ACCOUNTS_REVENUE_SPEC.md)                                                                                     |
| Konten `/admin/accounts`, Sicherheit `/security`                 | [Konten-/Plattformprüfung](ACCOUNTS_PLATFORM_AUDIT.md), [Account-/Umsatzvertrag](ACCOUNTS_REVENUE_SPEC.md), [API-Referenz](API_REFERENCE.md)                                                                          |
| Dateien `/files`                                                 | [Dateien](FILES.md): Quarantäne/Scan, exakte Versionen, persönliche Tags/Ordner und Rechteverlust im geöffneten Dateidialog                                                                                           |
| Chat `/chats`                                                    | [Chat](CHAT.md), [Chat-Sicherheitsmodell](CHAT_SECURITY.md): echte Mitgliedschaften, Realtime, versionsgebundene Erwähnungen und getrennte Kursräume                                                                  |
| Ressourcenkommentare                                             | [Kommentare](RESOURCE_COMMENTS.md): auftrags-/bausteinbezogene Berechtigung, Bearbeitung und Moderation                                                                                                               |
| Wissen `/wiki`, `/forum`, Suche `/search`                        | [Wissens- und Suchsicherheit](KNOWLEDGE_SECURITY.md), [Entwicklerhandbuch](DEVELOPER_GUIDE.md): erlaubte Inhalte, Revisionen und ressourcenbezogene Suche                                                             |
| Verträge und Finanzen `/contracts`, `/finance`                   | [Kommerzielle Implementierung](COLLABORATION_AND_COMMERCIAL_IMPLEMENTATION.md), [Vertrag-/Rechnungssicherheit](COMMERCIAL_SECURITY.md), [Auftraggeber und Provision](CLIENT_COMMISSION_SECURITY.md)                   |
| Meldungen `/notifications`, Einstellungen `/settings`            | [Benachrichtigungen und Ruhezeiten](NOTIFICATIONS.md): eigene Inbox, getrennte Versionsverträge und kritische Meldungen                                                                                               |
| Ankündigungen `/announcements`, `/admin/announcements`           | [Ankündigungen](ANNOUNCEMENTS.md): Entwürfe, unveränderliche veröffentlichte Revisionen, aktuelle Zielrollen und persönliche Bestätigung                                                                              |
| Audit `/admin/audit`                                             | [Admin-Audit](ADMIN_AUDIT.md): aktuelles MFA-/Capability-Gate und reduzierte, begrenzte Metadatenprojektion                                                                                                           |

Die tatsächlichen Routen liegen in `src/app/app.tsx`. Eine Route oder ein Guide behauptet keine vollständige Umsetzung aller Anforderungen des Master-Prompts. Das administrative Auftragsboard bleibt ausdrücklich auf die neuesten **500** Angebote begrenzt; die paginierte Marktplatzsuche und die zweckgebundenen Wähler sind davon getrennt. Weitere Grenzen stehen in den Featureguides und im Plan.

## APIs und Integrationen

- [API_REFERENCE](API_REFERENCE.md) inventarisiert die echten öffentlichen SQL-RPCs nach Migration-Replay einschließlich Signaturen und Rechten. Das Inventar ersetzt keine ausgeführten Geschäfts- oder Browsertests.
- [Entwicklerhandbuch](DEVELOPER_GUIDE.md) erklärt Actor-bezogene Query-Schlüssel, lokale Entwürfe, Mutationen und den Auth-/MFA-Datenfluss.
- [Account-/Umsatzvertrag](ACCOUNTS_REVENUE_SPEC.md) beschreibt die getrennten Konten und kommerziellen Projektionen. Die Account-HTTP-Fassade und ihr OpenAPI-Einstieg stehen in der Repository-README und API-Referenz.
- [Dateien](FILES.md), [Profilbilder](PROFILE_AVATARS.md) und [Qualifikationen](QUALIFICATIONS.md) erklären authentifizierte Edge-Gateways, Scan, Hash und erneute aktuelle Berechtigungsprüfung vor Byteausgabe.
- [Auftragssuche](JOB_DISCOVERY.md), [Wähler](JOB_PICKERS.md), [Kalender](CALENDAR.md) und [Ankündigungen](ANNOUNCEMENTS.md) dokumentieren ihre jeweiligen Cursor-, Filter-, Versions- und Wiederholungsverträge.

Kein übermittelter Benutzer-/Rollenwert und keine Auswahl in einem Picker erteilt Rechte. Zweckgebundene Kursmetadaten verleihen weder Zugriff auf verborgene Auftragsdetails noch finanzielle Berechtigungen.

## Tests und Nachweise

| Prüfart                                      | Zweck und maßgebliche Dokumentation                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Typen, Lint, Format und Compilergraph        | Quellen, Imports, tatsächliche Routen/Assets und Laufzeitexports; [Entwicklerhandbuch](DEVELOPER_GUIDE.md) und [Testplan](TEST_PLAN.md) |
| Vitest / Komponenten                         | Zustände, Dialoge, Auswahl, Fehler, Cachegrenzen und Bedienung; Ausführung und Grenzen in den Featureguides                             |
| Temporäres PostgreSQL                        | Vollständiger Migration-Replay, Grants/RLS, Sperrbarrieren, CAS, Nebenläufigkeit und Regressionen; nur eigene UUID-Testdatenbanken      |
| Edge-Tests und echte HTTP-/Auth-APIs         | Handlerlogik getrennt von tatsächlichem JWT/MFA-, Scanner-, Storage- und Einladungsnachweis                                             |
| Browser und gebaute PWA                      | Desktop/Mobil-Workflows, Barrierefreiheit und Offline-Shell im isolierten Gesamtprüflauf                                                |
| Native selbst gehostete Images / Datenerhalt | Reale Dienste, Stop/Start, Passwort/MFA, private Daten und Storage-Bytes; getrennt vom Quellcode-Preflight                              |
| Exakte CI und Host-/Geräteabnahme            | Commitgebundene CI, installierter Host und physische Browser-/PWA-Prüfung bleiben verschiedene Nachweise                                |

[TEST_PLAN](TEST_PLAN.md) beschreibt den kanonischen `./portal test`-Lauf und gezieltes Debugging. Mutierende Integrationsskripte gehören in dessen isolierte Umgebung, nicht gegen normale Entwicklung oder echte Daten. [QA_RESULTS](QA_RESULTS.md) enthält tatsächliche Ergebnisse und Fehler; [WORKLOG](WORKLOG.md) ordnet sie dem Quellstand zu. Historische [Systemprüfung](SYSTEM_AUDIT.md) und [funktionale Codeprüfung](FUNCTIONAL_CODE_AUDIT.md) behalten ihren jeweiligen damaligen Umfang.

## Sicherheit und Datenschutz

Die Datenbank prüft aktuelle Rollen und MFA. Mutationen mit Rollenentzugsrennen sperren das handelnde Profil vor der erneuten Autorisierung. Private Kalender, Verfügbarkeitsnotizen, DMs und Vertragsdokumente erhalten keinen pauschalen Admin-Lesezugriff. Angenommene kommerzielle Snapshots bleiben unverändert; Dozierendenprojektionen enthalten keine privaten Gesamtpreise/Plattformanteile.

Der Download eines fremden Qualifikationsbelegs benötigt eine aktive ausdrückliche Freigabe der exakten Zertifikatsversion und aktuelle Prüfberechtigung/MFA. Er eröffnet keine CV-/Vertragsbibliothek; das bestehende separate `users.manage`/MFA-Recht auf CVs und die manuelle Qualifikationsattestation bleiben erhalten. Sowohl SQL als auch Edge-Download prüfen die aktuellen Grenzen. Service-Schlüssel und private Daten gehören weder ins Browser-Bundle noch in Offline-Caches oder öffentliche Fehlerartefakte.

- [SECURITY](../SECURITY.md): private Sicherheitsmeldung und unterstützter Meldeweg.
- [Sicherheits-/Datenschutzcheckliste](SECURITY_PRIVACY_CHECKLIST.md), [Backend-Sicherheitsreview](BACKEND_SECURITY_REVIEW.md) und [Abhängigkeitsprüfung](DEPENDENCY_AUDIT.md).
- Fachprüfungen: [Chat](CHAT_SECURITY.md), [Wissen](KNOWLEDGE_SECURITY.md), [Verträge/Rechnungen](COMMERCIAL_SECURITY.md), [Auftraggeber/Provision](CLIENT_COMMISSION_SECURITY.md) und [Konten](ACCOUNTS_PLATFORM_AUDIT.md).

Audits beschreiben ihren tatsächlichen Prüfstand; sie sind keine pauschale Zusage rechtlicher Konformität oder Fehlerfreiheit.

## Betrieb und Beiträge

| Aufgabe                                                                              | Dokument                                                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Lokale persistente Entwicklung und sicher getrennte Tests                            | [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md)                                                                      |
| Neuester GitHub-Stand, eigener Preview-Datenbestand und Migrationsgrenzen            | [GITHUB_LOCAL_PREVIEW](GITHUB_LOCAL_PREVIEW.md)                                                                |
| Aktuelle selbst gehostete Hostinger-Entwicklung                                      | [HOSTINGER_DEVELOPMENT](HOSTINGER_DEVELOPMENT.md), [KVM-1-Kapazität](KVM1_PERFORMANCE.md)                      |
| Geprüfte Entwicklungsupdates und Wiederherstellung                                   | [HOSTINGER_AUTOMATIC_UPDATES](HOSTINGER_AUTOMATIC_UPDATES.md)                                                  |
| Release, Datenbank **und Storage** sichern, Restore/Rollback und Produktionsfreigabe | [DEPLOYMENT_RUNBOOK](DEPLOYMENT_RUNBOOK.md), [geprüfte M4-Migrationsgrenze](REVIEWED_M4_MIGRATIONS.md)         |
| GitHub-Regeln, tatsächlicher Aktivierungsstand, Wartungs-App und Labelkatalog        | [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md)                                                                          |
| Beiträge und nachvollziehbare Issues/PRs                                             | [CONTRIBUTING](../CONTRIBUTING.md), [ISSUE_GUIDE](ISSUE_GUIDE.md), [PULL_REQUEST_GUIDE](PULL_REQUEST_GUIDE.md) |

Der gemeinsame Katalog umfasst **35 verwaltete Labels** zusätzlich zu den neun ursprünglichen GitHub-Labels. PRs brauchen genau ein `type:*`, genau ein `risk:*` und mindestens ein `area:*`. Alle drei Regelwerke sind aktiv. Maintainer und Repository-Admins dürfen über einen PR ohne fremde Reviewzustimmung mergen; die neun erforderlichen CI-Prüfungen und Signaturen bleiben Pflicht. Auto-Merge ist aktiviert und wartet auf die geltenden Anforderungen. Die getrennte Wartungs-App-Ausnahme gilt für Review und Checks; das History-/Signaturregelwerk hat keine Ausnahme. Der [GitHub-Betriebsleitfaden](GITHUB_WORKFLOW.md) dokumentiert den aktuellen Zustand und den verbleibenden Workflow-Nachweis.

Die öffentliche Luminovia-Website bleibt eine unveränderte, nur lesbare Brand-Referenz. Produktionsveröffentlichung, echte SMTP-Zustellung, Banktransfers und weitergehende Hostingänderungen sind getrennte autorisierte Schritte. Die Softwaredokumentation verbleibt im Repository; die Formatregeln für Unterrichtsmaterialien ändern dieses Dokumentationsformat nicht.
