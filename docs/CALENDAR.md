# Kalender: private Termine, Aufträge und veröffentlichte globale Ereignisse

`/calendar` bietet Monats-, Wochen-, Tages- und Listenansicht in der persönlichen
IANA-Zeitzone. Eigene private Termine bleiben bearbeitbar; bestätigte Zuweisungen
verlinken auf den konkreten Auftrag. Die Titelabfrage lädt nur eigene bestätigte
Auftragskennungen. Verfügbarkeit und Sperrzeiten bleiben ein eigener verbundener
Ablauf unter `/availability`.

## Gemeinsamer Kalender

**Globale Termine** zeigt ausdrücklich veröffentlichte, nicht archivierte globale
Ereignisse sowie die weiterhin autorisierten veröffentlichten Kursdurchführungen.
Private Termine werden nicht in diesen Kalender übernommen. Die Darstellung
verwendet die Profilzeitzone; die Ereignisdetails nennen zusätzlich die gespeicherte
Ereigniszeitzone, die Beschreibung und gegebenenfalls einen ausdrücklich
anklickbaren HTTPS-Link. Beschreibungen sind einfacher Text, kein HTML.

Globale Ereignisse werden ausschließlich für den tatsächlich sichtbaren
FullCalendar-Zeitraum abgefragt. Anfang ist einschließlich, Ende ausschließlich;
ein Ereignis muss den Zeitraum wirklich überschneiden. Wechsel von Monat/Woche/Tag
oder Vor-/Zurücknavigation verändert die Abfrage über `datesSet`, ohne den Kalender
neu einzuhängen. Ein Fenster ist auf höchstens 93 Tage begrenzt. 50 Ergebnisse pro
Seite, explizites **Weitere Termine laden** und `(updated_at,id)` als eindeutiger
absteigender Cursor verhindern eine stille Vollkatalogabfrage oder die frühere
Verwechslung der globalen REST-Grenze von 1.000 Zeilen mit einem vollständigen
Bestand. Die angezeigte Zahl bezeichnet geladene globale Ereignisse, nicht die
separat eingeblendeten Kurssitzungen.

Die bestehende Kursdurchführungs-/Vorlagenabfrage behält ihre eigene Ressourcen-
Autorisierung und ihre bisherige Integration. Sie wurde hier nicht ebenfalls zu
einer neuen paginierten Kurs-API umgebaut. Eigene private Termine und bestätigte
Zuweisungen behalten ihre vorhandenen Abfragen. Es gibt keine automatische
Hintergrundschleife über andere Kalenderzeiträume.

## Globale Termine verwalten

Konten mit **aktueller `courses.manage`-Berechtigung und MFA/AAL2** sehen im globalen
Kalender eine Verwaltung für den sichtbaren Zeitraum. Sie können:

- einen Termin mit Titel, Beschreibung, Anfang/Ende, IANA-Zeitzone und optionalem
  HTTPS-Link als Entwurf anlegen;
- einen beobachteten Entwurf bearbeiten und ausdrücklich veröffentlichen;
- eine Veröffentlichung zurücknehmen;
- einen Termin archivieren und als unveröffentlichten Entwurf wiederherstellen;
- im Zeitfenster wörtlich nach Titel/Beschreibung suchen und Folgeseiten laden.

**Speichern ist ausdrücklich ein Entwurf.** Eine Bearbeitung eines veröffentlichten
Termins nimmt dessen Veröffentlichung zurück. Erst ein erneuter Klick auf
**Veröffentlichen** macht den gespeicherten Stand sichtbar. Bei Archivierung bleibt
die UUID mit ihrer Versions-/Anfragehistorie erhalten. Wiederherstellung veröffentlicht
nichts automatisch. Das unterscheidet sich bewusst vom getrennten unveröffentlichten
Revisionsmodell der Ankündigungen. Die Oberfläche erklärt diesen Ablauf vor dem
Speichern. Ein außerhalb des sichtbaren Zeitfensters gespeicherter Termin erscheint
nach Navigation in sein Zeitfenster.

Jede Änderung verwendet eine beobachtete Version und eine stabile Anfrage-UUID.
Unveränderte Wiederholung nach verlorener Antwort liefert denselben bestätigten
Serverstand. Unterschiedlicher Inhalt mit derselben Anfrage-UUID wird abgewiesen;
konkurrierende Versionen überschreiben einander nicht. Bei einem Versionskonflikt
bleibt der Entwurf zur Prüfung bestehen. Nach einem autoritativen Rechteentzug
werden private Liste und Dialog sofort ausgeblendet, auch während weiterer
Netzwerkfehler. Nur eine erfolgreiche autorisierte Aktualisierung öffnet wieder
eine saubere Ansicht. Offline werden keine Schreibvorgänge bestätigt.

## Zeit und Links

Datenbankwerte sind endliche absolute Zeitpunkte mit gespeicherter IANA-Zeitzone.
Neue API-Nutzdaten enthalten einen ausdrücklichen UTC-/Offsetanteil und vierstellige
Jahre. Die Formulareingabe wird zonenbezogen umgerechnet. Nicht existierende
Ortszeiten beim DST-Sprung und mehrdeutige neue Ortszeiten beim Rücksprung werden
abgewiesen. Unveränderte bestehende Zeitfelder behalten ihre exakten Sekunden und
bereits eindeutig gespeicherten DST-Offsets bei reinen Textänderungen.

Optionale Links akzeptieren ausschließlich `https://` mit ASCII-DNS-Namen oder
vollständiger IPv4-Adresse und gültigem optionalem Port. Zugangsdaten, Leer-/Steuer-
zeichen, Backslashes, ungültige Hosts/Ports und andere Protokolle werden server-
und clientseitig abgewiesen. Der Browser öffnet Links mit `noopener noreferrer`.
Die Plattform lädt das Ziel nicht serverseitig und behauptet keine Prüfung seiner
Erreichbarkeit oder externen Inhalte.

## API und Berechtigungen

Additive, mit dem tatsächlich gepinnten Supabase CLI angelegte Migration:
`20261116003733_global_calendar_publications.sql`. Bestehende `global_events`-Zeilen
und IDs bleiben erhalten; ergänzt werden Beschreibung, Link, Archivstatus und
Versions-/Aktualisierungsmetadaten.

| RPC                                                                                     | Zweck                                                                                                                                                                |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `global_calendar_events(p_from,p_to,p_manage,p_search,p_before_at,p_before_id,p_limit)` | Autorisierte Überlappung im begrenzten Zeitraum; maximal 100 Datensätze, `has_more` und Tuple-Cursor. `p_manage=true` benötigt aktuelle Verwaltungsberechtigung/MFA. |
| `manage_global_event(p_id,p_action,p_expected_version,p_request_id,p_payload)`          | Versionierte/idempotente Aktionen `save`, `publish`, `unpublish`, `archive`, `recover`. Neue Entwürfe verwenden `p_id=null`, Version 0.                              |

Öffentliche Funktionen sind Invoker-Einstiege zu privaten Implementierungen mit
leerem Suchpfad. Interne Hilfsfunktionen sind nicht für PUBLIC/anon/authenticated
ausführbar. Die private Anfragehistorie hat RLS und keine Browser-Tabellenrechte.
Normale aktive Auftraggeber-/Teilnahme-/Dozierendenkonten dürfen nur die aktuellen
Veröffentlichungen lesen. Direkte Tabellenabfragen bleiben ebenfalls durch RLS
begrenzt. Ein `p_manage`-Flag, fremde UUIDs oder veränderbare JWT-Nutzermetadaten
vergeben keine Rechte.

Schreibzugriffe sperren zuerst das eigene Profil `FOR SHARE`. Die ausdrücklich
VOLATILE-Implementierung prüft danach in einem eigenen Statement aktuelle Rollen,
Aktivierung und MFA, bevor sie Anfrage-/Ereignissperren erwirbt. Die bestehende
Rollenverwaltung sperrt dasselbe Profil `FOR UPDATE`; ein bereits laufender
Rollenentzug gewinnt dadurch vor einem wartenden Schreibzugriff. Auf private
Kalender anderer Personen gibt es keinen administrativen Bypass.

Die Auditprojektion ergänzt genau `calendar.global_save`, `calendar.global_publish`,
`calendar.global_unpublish`, `calendar.global_archive`, `calendar.global_recover`
und bewahrt die bestehende Allowlist einschließlich Ankündigungen. Der Viewer
liefert weiterhin ausschließlich Akteursname, Aktion, Ressourcen-UUID und Zeitpunkt;
Beschreibungen, URLs und JSON-Details werden nicht weitergegeben.

## Prüfungen und Grenzen

Tatsächlich fokussiert ausgeführt: **11 RTL-/Unitfälle**, **9 PostgreSQL-Testgruppen**
in eigenen temporären UUID-Datenbanken und **6 generische API-Flächenprüfungen**.
Geprüft sind mehr als 1.000 gleichzeitige Sortierwerte, vollständige Seiten,
Berechtigungen/MFA, echte konkurrierende CAS-Updates, ein kontrollierter öffentlicher
Rollenentzug gegen einen wartenden Schreibzugriff, sichere Links, endliche Grenzen,
Archiv-/Veröffentlichungsablauf, private Kalendergrenzen und sichere Auditfilter.
Frontendfälle prüfen erhaltene DE/EN-/CAS-Entwürfe, verlorene Antworten, Rechteentzug,
DST und Bereichswechsel ohne Kalender-Remount.

```bash
npx vitest run src/features/calendar
PORTAL_DB_CONTAINER=<eigener-testcontainer> node scripts/calendar-global-db-tests.mjs
PORTAL_DB_CONTAINER=<eigener-testcontainer> node scripts/api-surface-db-tests.mjs
./portal test
```

`calendar-global-api-check.mjs` ist für tatsächliche Auth/MFA/REST-Prüfungen verfasst;
`calendar-global.spec.ts` ergänzt Desktop/Mobil, Veröffentlichung/Entwurf,
Beschreibung/Link, DE/EN, Offline-Schreibsperre, Dark Mode und axe. Diese nativen
Szenarien wurden bei der fokussierten Implementierung **nicht ausgeführt**. Ihre
Abnahme und kombinierte PWA-/Persistenz-/CI-Ergebnisse dokumentiert der spätere
Gesamtlauf separat in `QA_RESULTS.md` und `WORKLOG.md`.

Hierdurch werden keine Datei-Anhänge an globalen Ereignissen, Einladungen,
Hintergrund-Erinnerungen, SMTP-/Push-Zustellung, automatische Veröffentlichung,
ICS-Abonnements oder private Drag-and-drop-Terminbearbeitung als fertig bezeichnet.
Diese verbleiben im vollständigen Masterprompt-Plan. Produktivdienste, reale
Personen und die öffentliche Website wurden nicht verändert.
