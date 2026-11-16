# Benachrichtigungen und Einstellungen

Die Glocke, das Dashboard und `/notifications` verwenden dieselbe kontogebundene Quelle. Die Vorschau zeigt acht Einträge und die tatsächliche Zahl aller ungelesenen Meldungen. Der Posteingang lädt auf Anforderung 40 weitere Meldungen mit einem stabilen Zeit-/UUID-Cursor. Gelesen/ungelesen und Sammelbestätigung werden erst nach erfolgreicher Serverantwort angezeigt. Die Sammelbestätigung betrifft nur den zuvor abgerufenen Zeitpunkt; neu eingehende Meldungen bleiben ungelesen.

`/settings` bietet deutsche/englische Sprache, helles/dunkles Farbschema und vier Benachrichtigungspräferenzen: Chats, Forum, passende/neugeöffnete Aufträge und Erinnerungen. Diese vier Schalter werden serverseitig pro Konto und mit einer Versionsnummer gespeichert. Ein konkurrierender Speichervorgang überschreibt keinen neueren Stand; der Entwurf bleibt erhalten und kann ausdrücklich neu geladen werden. Ein Sprachwechsel verwirft den Entwurf nicht. Offline sind Schreibaktionen gesperrt.

## Sicherheit und Datenfluss

Die additive Migration `20261115204354_notification_inbox_and_preferences.sql` erweitert die bestehende Benachrichtigungstabelle. Öffentliche Invoker-RPCs delegieren an private Definer-Funktionen mit leerem Suchpfad, expliziten Ausführungsrechten und Prüfung der aktuellen aktiven Kontoidentität. Administrative Rechte öffnen keinen fremden persönlichen Posteingang. Gemischte eigene/fremde ID-Batches werden vollständig abgewiesen. Die Präferenztabelle ist privat und erlaubt keine direkten Browser-Schreibzugriffe.

Die API löst Ressourcenlinks und Titel anhand der aktuellen Ressourcenrechte auf. Nach Entzug einer Chatmitgliedschaft oder Entfernung einer Ressource werden weder der alte Titel noch ein weiter nutzbarer Link ausgeliefert. Das Frontend validiert die Antwortstruktur; Links müssen interne Pfade sein. Autorentext wird als Text gerendert. Bei einem fehlgeschlagenen Abruf wird keine zuvor gecachte private Vorschau weiter angezeigt. Query-Schlüssel enthalten die Kontoidentität; Requests unterstützen Abbruchsignale. Nur die kleine Vorschau fragt alle 30 Sekunden nach, Dashboard und Posteingang eröffnen keinen weiteren Hintergrund-Pollingzyklus.

Optionale neue Meldungen beachten die Einstellungen bereits beim Einfügen. Vorhandene Meldungen werden beim Ausschalten nicht gelöscht. Bestätigung und Stornierung einer verbindlichen Zuordnung werden unabhängig von diesen Schaltern weiterhin gespeichert.

Passende Aufträge werden nach Abschluss der Veröffentlichungstransaktion aus dem endgültigen Themen-/Qualifikationssatz ermittelt. Archivierte/abgelaufene Angebote, vergangene Termine und inaktive Konten werden ausgeschlossen; Qualifikationen müssen bis zum letzten Termin gültig sein. Eine Meldung ist ein Hinweis und ersetzt keine erneute Prüfung von Vertrag, Kalender, Qualifikation und freien Plätzen bei der verbindlichen Übernahme.

## Erinnerungen und Grenzen

„Erinnerungen aktualisieren“ erzeugt ausdrücklich ausgelöste, idempotente Hinweise auf eigene bestätigte, nicht freigegebene Termine innerhalb von 24 Stunden und eigene aktive, innerhalb von 30 Tagen auslaufende Verträge. Eine serverseitige Begrenzung verhindert wiederholte Berechnung innerhalb einer Minute. Eine geänderte Einstellung erlaubt eine sofortige Neuberechnung. Freigegebene historische Zuordnungen und widerrufene Verträge erzeugen keine aktuellen Erinnerungen.

Dieser Stand enthält In-App-Meldungen und manuelle Erinnerungsaktualisierung. Ein automatischer Zeitplan, Ruhezeiten, E-Mail-Digests, Web Push und tatsächliche SMTP-Zustellung sind weitere Produktarbeit; sie werden nicht als bestehende Funktion dargestellt.

## API und Prüfung

Die fünf öffentlichen Funktionen heißen `notification_inbox`, `mark_notifications`, `notification_preferences`, `save_notification_preferences` und `refresh_my_notifications`. Vollständige Parameter stehen in [API_REFERENCE](API_REFERENCE.md). Gezielte Prüfungen:

```bash
npx vitest run src/features/notifications
PORTAL_DB_CONTAINER=<eigener-testcontainer> node scripts/notifications-db-tests.mjs
./portal test
```

Die SQL-Prüfgruppen betreffen Besitzrechte, atomare Batches, Versionskonflikte, Cursorgrenzen, aktuelle Ressourcenrechte, Pflichtmeldungen, Reminder-Zeitfenster, freigegebene Zuordnungen und Qualifikationsablauf. `scripts/notifications-api-check.mjs` prüft echte Auth-/MFA-/REST-Aufrufe. `tests/e2e/notifications.spec.ts` prüft Desktop/Mobil, mehrseitigen Posteingang, Einstellungen über Neuladen, Sprache, Dark Mode, Offline und axe. Verfasste Tests sind keine bestandene Abnahme; den tatsächlich ausgeführten Gesamtstand halten [QA_RESULTS](QA_RESULTS.md) und [WORKLOG](WORKLOG.md) fest.
