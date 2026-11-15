# Administrationsprotokoll

`/admin/audit` ergänzt die vorhandenen serverseitigen Audit-Ereignisse um eine tatsächlich lesbare, durchsuchbare Oberfläche. Die neue Berechtigung `audit.read` wird ausschließlich `owner` und `admin` zugeordnet. Jeder API-Abruf prüft aktuelle Datenbankrollen, die Aktivierung des Kontos und bestätigte MFA. Gewöhnliche Management-, Senior-, Dozierenden-, Auftraggeber- und Teilnehmendenrollen erhalten keinen Zugriff. Eine ausdrücklich zugeteilte zusätzliche Berechtigung wird berücksichtigt; eine hierarchische Rollenannahme oder editierbare Auth-Metadaten ersetzen sie nicht.

## Bewusst reduzierte Projektion

Die Quelle bleibt `public.audit_events`; es wird keine zweite Ereigniskopie oder neue Schreib-API angelegt. Die Oberfläche ist ausschließlich lesend. Sie liefert Ereigniskennung, aktuellen Anzeigenamen des handelnden Kontos, Aktionskennung, optionale Ressourcen-UUID und Zeitpunkt. Anzeigenamen sind aktuelle Profilnamen, keine nachträglich behaupteten historischen Namens-Snapshots. Sie erscheinen als Text, auch wenn der Inhalt HTML ähnelt.

Die exakte Positivliste `private.admin_audit_actions()` enthält die tatsächlich vorhandenen Aktionen für Kontorollen/-status, Einladungen, Qualifikationsprüfung, Auftraggeberzuordnung/-aufträge, Organisationen, Kursvorlagen/-durchläufe/-einschreibung, Auftragsveröffentlichung/-lebenszyklus/-kapazität, Stornierung und Taxonomieverwaltung. Neue oder nur ähnlich benannte Aktionen bleiben unsichtbar, bis ihre Aufnahme ausdrücklich geprüft wird. Ereignisdetails werden weder ausgewählt noch durchsucht. Insbesondere fehlen private Profiländerungen, Kalender und Verfügbarkeiten, Chats, Dokumente, Verträge, Rechnungsereignisse und persönliche Bewertungen. Ressourcenkennungen werden nicht automatisch in Links aufgelöst und umgehen keine Ressourcenrechte.

Die bestehende Tabellen-RLS und bestehende administrative Tabellenrechte werden durch diese Migration nicht verändert. Die reduzierte Ansicht ersetzt keine eigenständige Retention-, revisionssichere Archivierungs- oder Manipulationsschutzlösung für privilegierte Datenbankbetreiber. Browserkonten können den Verlauf nicht ergänzen, verändern oder löschen. Vorhandene serverseitige Schreibvorgänge und Betriebs-/Testbereinigung bleiben erhalten.

## Abfrage und Oberfläche

`admin_audit_events(p_from, p_to, p_action, p_search, p_before_at, p_before_id, p_limit)` ist ein öffentlicher Invoker-Einstieg in eine eingeschränkte private Definer-Funktion mit leerem Suchpfad und expliziten Ausführungsrechten. Ohne Zeitangaben verwendet die API die vergangenen 30 Tage. Jeder Abruf ist auf ein endliches Fenster von höchstens 93 Tagen plus zwei Stunden DST-Spielraum und 1–100 Ergebnisse begrenzt. Es gibt keine unbeschränkte Gesamtzählung und keinen automatischen historischen Abruf.

Die Oberfläche verwendet 40 Ergebnisse pro Seite, ein explizites IANA-Zeitzonenfeld und inklusive lokale Kalendertage. Datumseingaben und Zeitzone werden vor der UTC-Umwandlung geprüft; übersprungene lokale Kalendertage werden abgelehnt. Der Sprachwechsel bewahrt Filterentwürfe. Die Suche behandelt Zeichen wie `%` und `_` wörtlich und umfasst ausschließlich Anzeigename, Aktionskennung und Ressourcenkennung. Der Aktionsfilter erhält die überprüfte Auswahl aus der API.

Ein zusammengesetzter Index auf `created_at DESC, id DESC` unterstützt begrenzte Zeitabfragen und die stabile Keyset-Navigation. Der Cursor enthält beide Werte; gleiche Zeitstempel führen deshalb weder zu Auslassungen noch zu Wiederholungen. Folgeseiten behalten die Zeitgrenzen bei. Neuere Ereignisse können bei einer erneuten ersten Seite oder einer Aktualisierung erscheinen; es wird kein unveränderlicher datenbankweiter Snapshot über mehrere HTTP-Anfragen behauptet. Fehlgeschlagene aktuelle Zugriffsprüfungen blenden zuvor geladene Zeilen aus. Es gibt keinen persistierten Offline-Cache, keine Hintergrundabfrage aller Seiten und keinen CSV-Vollabzug.

## Prüfung

Die additive, durch den tatsächlich gepinnten Supabase-CLI erzeugte Migration heißt `20261115213550_admin_audit_viewer.sql`. Gezielte Befehle:

```bash
npx vitest run src/features/audit
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-m6 node scripts/admin-audit-db-tests.mjs
```

Die PostgreSQL-Prüfung erstellt und entfernt ausschließlich eine eigene temporäre Datenbank. Sie prüft Rollen/MFA, Positivliste und Detailschutz, wörtliche Suche, Zeit-/Cursorgrenzen, tatsächlich gleichzeitig eingefügte Ereignisse mit gleichem Zeitstempel, Schreibverbote sowie Berechtigungsentzug und Kontosperrung bei bestehenden Token-Identitäten. Die native Auth-/TOTP-/REST-Prüfung liegt in `scripts/admin-audit-api-check.mjs`; Desktop-/Mobil-Journeys, DE/EN, Dark Mode, Offlinezustand, Rollenentzug und axe in `tests/e2e/admin-audit.spec.ts`.

Verfasste API-/Browser-Prüfungen sind keine bestandene Abnahme. Den tatsächlich ausgeführten Gesamtstand dokumentieren [QA_RESULTS](QA_RESULTS.md) und [WORKLOG](WORKLOG.md). Es werden keine operative Überwachung, Lösch-/Retention-Aktion, E-Mail oder produktive Bereitstellung behauptet.
