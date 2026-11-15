# Persönlicher Überblick im Dashboard

Das Dashboard verbindet die vorhandenen Aufträge, Termine und Honorarkarten mit persönlichen Vorschauen. Der große Markenbereich erscheint weiterhin nur am Einstieg. Daten werden aus den bestehenden autorisierten APIs gelesen; neue Datenbankrechte oder eine zusätzliche serverseitige Datenkopie entstehen nicht.

## Inhalte nach Konto und Berechtigung

| Bereich                           | Inhalt und Grenze                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auftragsvorschläge                | Veröffentlichte Aufträge mit noch gültiger Übernahmefrist. Bestätigte, nicht abgelaufene Fachgebiete priorisieren passende Anforderungen. Die verbindliche Berechtigungs-, Vertrags- und Konfliktprüfung erfolgt weiterhin erst bei der tatsächlichen Übernahme am Server.                                                    |
| Kalender                          | Eigene private Termine der nächsten 30 Tage und eigene bestätigte Auftragstermine, zusammen nach Beginn sortiert. Die Vorschau zeigt höchstens fünf Einträge. Administrative Rechte erweitern diese Abfrage nicht auf private Termine anderer Personen.                                                                       |
| Nachrichten und Meldungen         | Ungelesene Nachrichten aus den eigenen zulässigen Chaträumen, Anzahl ungelesener Meldungen und höchstens drei aktuelle Hinweise. Die vollständigen Inhalte und aktuell geprüften Links bleiben im Chat beziehungsweise Posteingang.                                                                                           |
| Persönliche Vertragsbestätigungen | Nur eigene, aktuell wirksame aktive Verträge mit Dokumentfassung/Hash und noch fehlender Empfangsbestätigung. Bereits bestätigte, abgelaufene oder erst künftig wirksame Verträge erscheinen hier nicht als offene Aufgabe. Die Bestätigung bleibt eine Empfangsbestätigung, keine behauptete elektronische Unterschrift.     |
| Neue Dateien                      | Höchstens fünf neu hinzugefügte, saubere, nicht archivierte Dateimetadaten, die der aktuelle Actor lesen darf. Der Dateiname führt in die gefilterte Dateizentrale; es wird kein Dateiinhalte-Download im Hintergrund ausgeführt.                                                                                             |
| Verwaltungsaufgaben               | Nur bei aktuell gelieferter `jobs.manage`-Berechtigung: Entwürfe, offene Aufträge mit verstrichener Übernahmefrist und unbesetzte Aufträge mit mindestens einem Terminbeginn in den nächsten 14 Tagen. Grundlage sind bereits freigegebene Auftragszeilen, keine zusätzliche Einsicht in fremde Kalender oder Bruttohonorare. |

Reine Auftraggeber- und Teilnahmekonten laden keine Dozierenden-Auftrags-, Zuweisungs-, Expertise- oder Vertragslisten für das Dashboard. Ihr Einstieg führt in das Auftraggeberportal beziehungsweise die Kursübersicht. Persönliche Termine, verfügbare Dateien und zulässige Nachrichten bleiben erreichbar. Mehrfachrollen richten sich nach den tatsächlich vorhandenen Rollen und Fähigkeiten; eine Bezeichnung allein erweitert keine Datenbankrechte.

Die bestehenden Finanzkarten behalten ihre eigene Berechtigungsprüfung: Plattformumsatz, Auftraggeberausgaben oder persönliches Nettohonorar werden dort wie bisher rollenabhängig geliefert. Die neuen Vorschaukarten fragen keine zusätzliche Bruttoumsatz- oder fremde Vertragsliste ab.

## Aktualität ohne zusätzliche Historienabfragen

Die Meldungsvorschau verwendet exakt denselben Actor-Schlüssel und dieselbe API wie die Shell. Nur die Shell betreibt den 30-Sekunden-Takt; der Dashboard-Observer legt keinen zweiten Polling-Timer an. Auch für die Chatraumvorschau werden weder Nachrichtenhistorie noch ein zusätzlicher Drei-Sekunden-Takt geladen. Fokus und Reconnect verwenden die normale Revalidierung veralteter Daten.

Datei- und private Kalenderabfragen sind auf fünf Metadatensätze begrenzt und haben keine Intervallabfrage. Ihre Schlüssel verwenden die vorhandenen `documents`- beziehungsweise `events`-Invalidierungsprefixe, sodass eigene Dateimutationen und Kalenderänderungen die Vorschau weiterhin aktualisieren. Die Kalendervorschau besitzt außerdem eine beschriftete Aktualisieren-Schaltfläche. Veröffentlichte Inhalte oder zusätzliche Hinweise können bis zur nächsten normalen Revalidierung erscheinen; die Vorschau behauptet keine sofortige Synchronisierung aller Daten.

Alle Vorschauen bleiben im vorhandenen Arbeitsspeicher-Cache. Ein fehlgeschlagener optionaler Bereich zeigt einen eigenen erneuten Ladeversuch, ohne die anderen Dashboardbereiche auszublenden. Bei einem Fehler werden eventuell zurückbehaltene alte Vorschauwerte nicht weiter angezeigt. Ein Kontowechsel verwendet andere Actor-Schlüssel; die bereits vorhandene Auth-Grenze leert zusätzlich den Cache und setzt private lokale Zustände zurück.

## Darstellung und Prüfung

Die neuen Karten verwenden die bestehenden Markenfarben, responsive Raster, semantische Listen und benannte Regionen. Datum und Uhrzeit folgen der Profilzeitzone; ohne gültige Profilzeitzone wird `Europe/Berlin` verwendet. Die Oberfläche ist vollständig DE/EN; persönliche Titel und Dateinamen bleiben in ihrer verfassten Sprache.

Die zehn Komponententests prüfen tatsächliche Query-Aufrufe und DOM-Verhalten: Konto-/Rollenabgrenzung, persönliche Vertragsfilter, begrenzte saubere Dateimetadaten, Kalenderfehler-Isolation, Ausblenden alter Metadaten nach Zugriffsfehler oder Actorwechsel, Verwaltungscapability, Expertise-/Fristvorschläge, ein gemeinsamer Meldungstakt und Sprachwechsel ohne zusätzliche Abrufe.

```bash
npx vitest run src/features/dashboard/dashboard.test.tsx
```

Zwei zusätzliche Browserabläufe unter `tests/e2e/dashboard.spec.ts` verwenden ausschließlich den kanonischen disponiblen Testbestand. Sie prüfen echte persönliche/andere Kalender, eine tatsächliche DM mit ungelesenen Zählern, einen wirklich gescannten Datei-Upload samt Dateizentralenlink, DE/EN/Dark-Mode, mobile Breite/axe und einen MFA-Verwaltungszugang. Verfasstes Testszenario und tatsächlich bestandener Browserlauf werden in [QA_RESULTS](QA_RESULTS.md) und [WORKLOG](WORKLOG.md) getrennt dokumentiert.
