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

Dieser Stand enthält In-App-Meldungen und manuelle Erinnerungsaktualisierung. Die M7-Quelle ergänzt die unten beschriebenen In-App-Ruhezeiten; deren native Gesamtprüfung ist getrennt nachzuweisen. Ein automatischer Erinnerungs-/Versandzeitplan, E-Mail-Digests, Web Push und tatsächliche SMTP-Zustellung sind weitere Produktarbeit; sie werden nicht als bestehende Funktion dargestellt.

## Persönliche In-App-Ruhezeiten

Das zweite Formular unter `/settings` speichert eine eigene tägliche Ruhezeit mit Aktivierungsschalter, Beginn, Ende und IANA-Zeitzone. Ein Sprachwechsel erhält den Formularentwurf. Der eigene Speichern-Button heißt „Ruhezeiten speichern“; die vier bestehenden Kategorie-Schalter und deren ursprünglicher API-/Versionsvertrag bleiben unabhängig.

Ruhezeiten verändern ausschließlich die Aufmerksamkeit des **Glockenzählers**. Während des aktiven Fensters zählt er weiterhin ungelesene verbindliche Buchungs-, Storno- und neue Vertragshinweise. Das verbundene Ankündigungsmodul berücksichtigt zusätzlich ausdrücklich wichtige, aktuell freigegebene Portal-Ankündigungen; archivierte, abgelaufene oder inzwischen nicht mehr erlaubte Revisionen zählen dafür nicht. Der Posteingang und seine Vorschau enthalten weiterhin alle freigegebenen Meldungen; es wird nichts gelöscht, verworfen, verschoben oder automatisch als gelesen markiert. Beispielsweise bleiben 17 optionale Meldungen plus drei wichtige Belege als 20 ungelesene Meldungen erhalten, während die Glocke drei wichtige Meldungen zählt. Die zugängliche Beschriftung nennt zusätzlich die aktive Ruhezeit und die vollständige ungelesene Zahl. Nach dem Ausschalten verwendet die Glocke wieder den vollständigen Zähler. Erst eine ausdrückliche Gelesen-/Ungelesen-Aktion verändert den Lesestatus.

Beginn ist eingeschlossen, Ende ausgeschlossen. Unterschiedliche Zeiten dürfen über Mitternacht reichen. Maßgeblich sind die tatsächlichen lokalen Uhrzeitminuten in der gewählten IANA-Zeitzone: übersprungene DST-Minuten treten nicht auf; beide Vorkommen einer wiederholten Minute verwenden dieselbe Ruhezeitregel. Es werden keine Server- oder Browseruhren verändert. Eine gespeicherte Ruhezeit behält ihre ausdrücklich gewählte Zeitzone. Solange noch nichts gespeichert ist, verwendet die Voreinstellung die aktuelle eigene Profilzeitzone mit deaktiviertem Fenster 22:00–07:00.

Der Server berechnet `quiet_active` beim Inbox-Abruf anhand seiner aktuellen Zeit. Nur während eines aktiven Fensters kommt `attention_count` hinzu. Der vollständige `unread_count` bleibt unverändert. Die Shell verwendet ihren bestehenden 30-Sekunden-Takt sowie normale Revalidierung; die Oberfläche behauptet keine millisekundengenaue Umschaltung oder zusätzliche Zustelltechnik. Diese Funktion ist **keine** SMTP-, E-Mail-, Push- oder Hintergrundversandplanung.

Die additive Migration `20261115231704_notification_attention_preferences.sql` legt eine eigene private Präferenztabelle an. `attention_preferences()` liest nur das aktuelle aktive Konto. Vor dem ersten Speichern beträgt die eigene Versionsnummer 0, ohne eine Datenzeile zu erzeugen. `save_attention_preferences(p_payload, p_expected_version)` akzeptiert genau `enabled`, `start_time`, `end_time` und `time_zone`; das Konto stammt aus `auth.uid()`. Ein kontogebundener Transaktionslock serialisiert auch konkurrierende erste Speicherversuche. Veraltete Fassungen werden mit `40001` abgewiesen; der Entwurf bleibt bis zum ausdrücklichen Laden erhalten. Unbekannte Felder, ungültige Zeiten/Zeitzonen und gleiche Endpunkte werden abgelehnt. Normale Konten, Administratoren und bestehende gesperrte Sitzungen erhalten keine fremden Ruhezeiten. Direkte Tabellenzugriffe und anonyme Funktionsaufrufe sind nicht freigegeben.

`scripts/attention-db-tests.mjs` prüft die SQL-Grenzen einschließlich tatsächlicher IANA-/DST-Fälle. Die ergänzten **verfassten** Szenarien `scripts/attention-api-check.mjs` und `tests/e2e/attention.spec.ts` prüfen echte Auth-/REST-Konten, erste und spätere Versionskonflikte, unveränderte Kategoriepräferenzen, 17 optionale plus drei wichtige Meldungen, Konto-/Admin-/Sperrungsgrenzen und ausdrücklichen Lesestatus. Browserfälle enthalten UI-Speichern/Neuladen, DE/EN-Entwurf, Offlinezustand, Dark Mode, Mobilbreite und axe. Die tatsächliche native Ausführung und ihr Ergebnis gehören weiterhin nach [QA_RESULTS](QA_RESULTS.md) und [WORKLOG](WORKLOG.md); das Vorhandensein dieser Dateien behauptet keinen bestandenen Lauf.

## API und Prüfung

Der bestehende Inbox-/Kategorienvertrag umfasst die fünf öffentlichen Funktionen `notification_inbox`, `mark_notifications`, `notification_preferences`, `save_notification_preferences` und `refresh_my_notifications`. Die beiden oben beschriebenen Attention-RPCs ergänzen diesen Vertrag. Vollständige Parameter stehen in [API_REFERENCE](API_REFERENCE.md). Gezielte Prüfungen:

```bash
npx vitest run src/features/notifications
PORTAL_DB_CONTAINER=<eigener-testcontainer> node scripts/notifications-db-tests.mjs
./portal test
```

Die SQL-Prüfgruppen betreffen Besitzrechte, atomare Batches, Versionskonflikte, Cursorgrenzen, aktuelle Ressourcenrechte, Pflichtmeldungen, Reminder-Zeitfenster, freigegebene Zuordnungen und Qualifikationsablauf. `scripts/notifications-api-check.mjs` prüft echte Auth-/MFA-/REST-Aufrufe. `tests/e2e/notifications.spec.ts` prüft Desktop/Mobil, mehrseitigen Posteingang, Einstellungen über Neuladen, Sprache, Dark Mode, Offline und axe. Verfasste Tests sind keine bestandene Abnahme; den tatsächlich ausgeführten Gesamtstand halten [QA_RESULTS](QA_RESULTS.md) und [WORKLOG](WORKLOG.md) fest.
