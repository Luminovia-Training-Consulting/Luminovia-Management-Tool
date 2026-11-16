# Aufträge suchen und private Ansichten speichern

Die Auftragsbörse `/jobs` sucht auf dem Server und lädt jeweils 50 Ergebnisse.
**Weitere Aufträge laden** ruft die nächste Seite ab. Es wird kein vollständiger
Katalog im Hintergrund zusammengesammelt und die globale Data-API-Grenze von
1.000 Zeilen wird nicht erhöht. Die Oberfläche zeigt die tatsächlich geladene
Anzahl; erst ohne Folgeseite bezeichnet sie die aktuelle Suche als vollständig.

Das frühere `jobsQuery` lud eine ungegliederte Tabelle und filterte anschließend
im Browser. `supabase/config.toml` begrenzt solche Antworten auf 1.000 Zeilen.
Die native API-Prüfung reproduziert diese Grenze mit 1.057 eigenen Angeboten,
bevor sie denselben autorisierten Bestand vollständig über die neue API liest.
Verfasster Prüfschritt und tatsächliche native Abnahme werden getrennt in
[QA_RESULTS](QA_RESULTS.md) und [WORKLOG](WORKLOG.md) dokumentiert.

## Bedienung und Bedeutung der Filter

Trage die gewünschten Werte ein und wähle **Filter anwenden**. Tippen allein löst
keine neue Auftragsabfrage aus. Filter bleiben als URL-Parameter kopierbar und
lassen sich über die normale Browsernavigation erneut öffnen.

- Suchtext und Auftraggebertext werden wörtlich und ohne Groß-/Kleinschreibung
  verglichen. `%`, `_` und Klammern sind Text, keine Suchoperatoren. Die Suche
  berücksichtigt auch Bezeichnungen/Aliasse verknüpfter Fachgebiete.
- Mehrere Themen, Tools oder Programmiersprachen bedeuten: Das Angebot muss alle
  ausgewählten Kennungen verlangen. Archivierte bestehende Auswahl bleibt
  erkennbar; neue Auswahl verwendet aktive Katalogeinträge.
- Datumstage sind in der ausdrücklich gewählten IANA-Zeitzone zu verstehen.
  Mindestens ein tatsächlicher Termin muss einen gewählten lokalen Kalendertag
  überschneiden. Eine terminfreie Lücke zwischen Tag 1 und Tag 10 passt nicht.
  Ein über Mitternacht laufender Termin kann beide tatsächlich belegten Tage
  treffen. Tagesgrenzen werden zonenbezogen berechnet, nicht als feste 24 Stunden.
- Unterrichtsdauer ist die Summe der tatsächlichen Terminintervalle, einschließlich
  Minutenanteilen. Sie ist nicht die Zeitspanne vom ersten bis letzten Kurstag.
- Geldgrenzen und Geldsortierung verlangen eine Originalwährung. Einheitenpreise
  verlangen zusätzlich eine Honorareinheit. EUR/AUD oder Stunden-/Tagessätze werden
  nicht stillschweigend verglichen oder umgerechnet. Die öffentlichen Beträge
  bleiben Dozierendenvergütung je Position, keine Brutto-/Plattformprojektion.
- **Ohne Überschneidung in meinem Kalender** prüft ausschließlich eigene private
  Termine, aktive Zuweisungen und eigene Sperrzeiten. Zusätzlich müssen freie,
  veröffentlichte zukünftige Plätze mit offener Übernahmefrist bestehen. Ein
  positives Ergebnis reserviert nichts. Qualifikation, Vertrag, Konditionen und
  alle aktuellen Konflikte prüft weiterhin erst die atomare Auftragsübernahme.

Sortierungen sind neueste/älteste Erstellung im Datenbestand, nächster
Beginn, Titel, Unterrichtsdauer und ausdrücklich vergleichbare Gesamt-/Einheiten-
honorare. Jede Sortierung verwendet die Auftrags-UUID als eindeutigen zweiten
Schlüssel. Gleiche Zeitstempel oder Beträge erzeugen daher keine unbestimmte
Seitenreihenfolge.

## Private gespeicherte Ansichten

**Angewendete Filter speichern** speichert die aktuell übernommene URL-Suche mit
selbst gewähltem Namen. Noch nicht angewendete Formulareingaben werden dadurch
nicht stillschweigend übernommen. Wähle eine gespeicherte Ansicht, um ihre Filter
und Sortierung in URL und Formular zu laden. **Ansicht umbenennen** verändert den
Namen; **Ansicht entfernen** entfernt nur diese persönliche Filterauswahl.

Ansichten liegen dauerhaft in PostgreSQL, höchstens 20 pro Konto. Ein Neuladen
oder eine neue Anmeldung entfernt sie nicht. Andere Konten und gewöhnliche
Administrationsrechte öffnen keine fremden Ansichten. Ein Versionskonflikt bleibt
sichtbar und überschreibt keinen neueren Stand. Lade die aktuelle Ansichtenliste
und prüfe die Auswahl erneut. Identische Wiederholung einer Erstellung nach
verlorener Antwort verwendet dieselbe UUID und erzeugt keine zweite Ansicht.
Offline sind diese Schreibaktionen gesperrt.

Filter werden als geschlossenes, typgeprüftes JSON gespeichert. Browserrollen,
Benutzerkennungen, unbekannte Felder oder alternative Bruttobeträge sind keine
zusätzlichen Filterrechte. Ein gespeicherter Filter erweitert keine Auftrags-
oder Kalenderberechtigung. Aktuelle Rollen/Kontosperrung werden auf jeder API-
Anfrage geprüft; reine Auftraggeber-/Teilnahmekonten laden in dieser Ansicht
keine Dozierenden-Aufträge oder gespeicherten Dozierendenansichten.

## Verbindungen und bewahrte Schnittstellen

Die Detailansicht fragt genau die angeforderte erlaubte UUID ab. Ein älterer
Auftrag bleibt deshalb über seinen Link erreichbar, auch wenn er in der früheren
ungegliederten 1.000-Zeilen-Antwort fehlte. M6-Übernahme, Konditionenzustimmung,
Idempotenz, Kapazität und Stornierungs-/Wiederöffnungsverlauf bleiben unverändert.
Die bisherigen 24 Migrationen wurden hierfür nicht bearbeitet.

Das Dashboard erhält vollständige autorisierte Zählwerte und höchstens zwei
Auftragsvorschläge aus einer eigenen Aggregatabfrage. Es verwechselt eine kleine
Vorschau nicht mit der Gesamtzahl. Eigene Zuweisungszählungen und höchstens fünf
nächste Terminmetadaten stammen ebenfalls aus dieser Abfrage. Verwaltungszähler
werden nur mit aktueller Verwaltungsberechtigung geliefert. Das Dashboard fragt
für reine Auftraggeber-/Teilnahmekonten keine Dozierendenübersicht ab.

Der Kalender holt zu eigenen bestätigten Zuweisungen nur deren erlaubte Titel.
Ohne eigene Zuweisungen startet er keine Auftrags-Titelabfrage. Er lädt nicht den
Marktplatz, um alte Termine zu beschriften. Fremde Titel oder private Kalender-
einträge werden dadurch auch für Administratoren nicht geöffnet. Globale Kurse
und private Terminbearbeitung bleiben eigene bestehende Abläufe.

Die M8-Quelle ersetzt die bisherigen Datei-/Chat-Auftragsauswahlen durch eine
[eigene zweckgebundene Suche mit Seitennavigation](JOB_PICKERS.md). Sie verwendet
jeweils die tatsächliche Upload- bzw. Kurschat-Berechtigung und lädt keine
vollständigen Marktplatz-Datensätze. Ihre native M8-Abnahme bleibt separat
nachzuweisen. Das administrative M6-Kanban bleibt ausdrücklich auf die neuesten
500 Angebote begrenzt und weist darauf hin; ältere erlaubte Angebote sind über
Suche und Detailansicht bearbeitbar.

## API und Datenbank

Migration: `20261115230702_job_discovery_and_saved_views.sql`.

| Öffentliche RPC                                           | Zweck                                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `job_discovery(p_filters,p_cursor,p_limit)`               | Bis zu 100 autorisierte Angebote, `has_more`, Folgeseitencursor und kanonische Filter als begrenzte JSON-Antwort. |
| `job_detail(p_job_id)`                                    | Ein erlaubter Auftrag mit Sitzungen, Anforderungen und aggregierten Platzzahlen.                                  |
| `job_dashboard()`                                         | Autorisierte Zählwerte, zwei Vorschläge und begrenzte eigene nächste Zuweisungen.                                 |
| `assignment_job_titles(p_job_ids)`                        | Nur Titel eigener bestätigter Zuweisungen, höchstens 1.000 angefragte Kennungen.                                  |
| `saved_job_views()`                                       | Höchstens 20 eigene versionierte Ansichten.                                                                       |
| `save_job_view(p_id,p_name,p_filters,p_expected_version)` | Erstellung mit stabiler UUID/Version 0 oder Aktualisierung einer beobachteten eigenen Version.                    |
| `remove_job_view(p_id,p_expected_version)`                | Entfernen einer beobachteten eigenen Version.                                                                     |

Öffentliche Invoker-Einstiege rufen eingeschränkte private Implementierungen mit
leerem Suchpfad auf. Interne Filter-/Projektionshelfer haben keine Ausführungs-
rechte für PUBLIC/anon/authenticated. Die private Ansichtentabelle hat RLS und
keine direkten Browserrechte. Auftragszugriff verwendet die bestehende
`can_read_job`-Grenze; die Suche legt weder angenommene Honorare neu fest noch
führt sie einen Administratorzugriff auf fremde private Kalender ein.

Cursor enthalten Sortierwert, UUID und Fingerabdruck der kanonischen Filter.
Fremde Suchcursor, nicht endliche Werte und ungültige Seitengrößen werden
abgewiesen. Eine Seite ist eine aktuell autorisierte Abfrage, kein über mehrere
HTTP-Aufrufe eingefrorener Datenbanksnapshot. Neue oder umsortierte Angebote
können ein erneutes Laden der Suche erfordern.

## Verifikation

Gezielte Befehle:

```bash
npx vitest run src/features/jobs src/features/dashboard/dashboard.test.tsx src/features/calendar/calendar.test.tsx
PORTAL_DB_CONTAINER=<eigener-testcontainer> node scripts/job-discovery-db-tests.mjs
PORTAL_DB_CONTAINER=<eigener-testcontainer> node scripts/api-surface-db-tests.mjs
./portal test
```

Die SQL-Suite verwendet ausschließlich eigene temporäre UUID-Datenbanken.
Sie prüft mehr als 1.000 Datensätze mit gleichen Zeitstempeln, vollständige stabile
Seiten, exakte ältere Detailkennungen, Originalwährungen/Einheiten, tatsächliche
Terminlücken/Zeitzonen, eigene Kalenderkonflikte, private Ansichten/Quoten,
konkurrierende CAS-Änderungen und Rollen-/Kontoentzug. Der allgemeine API-Test
prüft weiterhin alle tatsächlichen öffentlichen Referenzen, RLS, Invoker-Grenzen,
fehlende anonyme Rechte und leere Definer-Suchpfade.

`job-discovery-api-check.mjs` ergänzt echte Auth-/REST-Abnahme einschließlich der
alten 1.000-Zeilen-Grenze und Anmeldung in einer neuen Sitzung.
`job-discovery.spec.ts` umfasst Desktop/Mobil, wirkliche Folgeseiten, gespeicherte
Ansichten über Neuladen, private Kontogrenzen, DE/EN, Dark Mode und axe. Bestehende
Übernahme-/Lifecycle-Browsertests behalten die tatsächlichen Buchungs- und
Snapshotprüfungen; ihre Detailaktualisierung wartet nun auf die präzise neue
Detail-API. Verfasste Tests allein sind keine bestandene native Abnahme.
