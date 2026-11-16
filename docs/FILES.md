# Dateizentrale: Suche, persönliche Tags und virtuelle Ordner

Die Dateizentrale unter `/files` sucht serverseitig in allen Dokumenten, die das aktuelle Konto tatsächlich lesen darf. Der bisherige Ablauf lud zunächst eine Liste und suchte danach nur im Browser. Weil lokale und selbst gehostete REST-Abfragen bewusst auf 1.000 Zeilen begrenzt sind, blieben ältere Dateien damit unsichtbar. Eine vor der Korrektur fehlgeschlagene Komponentenprobe hat genau diesen Leerzustand mit 1.001 Metadatenzeilen nachgestellt. Das Limit bleibt erhalten; die neue Suche filtert vor der Seitengrenze.

## Suchen und laden

`document_discovery` verwendet wörtliche Dateinamensuche, optionale Besitzer-/Kategorie-/Auftragsfilter und eigene Tag-/Ordnerfilter. `%` und `_` sind normale Suchzeichen. Die Oberfläche wartet 250 ms nach einer Eingabe, bricht überholte Transporte ab und erhält den Eingabefokus. Der vorhandene Einstieg `/files?q=…`, beispielsweise aus dem Dashboard, bleibt erhalten.

Eine Seite enthält 40 Zeilen; die API erlaubt höchstens 100. Der Cursor enthält `created_at` **und** Dokument-UUID. Gleiche Zeitstempel führen dadurch nicht zu verlorenen oder doppelten Einträgen. „Weitere Dateien laden“ lädt tatsächlich die nächste Server-Seite und führt IDs ohne Duplikate zusammen. Es gibt keine erfundene globale Ergebniszahl; angezeigt wird die Zahl geladener Dateien. Jeder Abruf prüft erneut `private.can_access_document` und das aktuelle aktive Konto. Ein leerer Auftrags-/Besitzerfilter gewährt keine zusätzlichen Rechte.

Die Discovery-Abfrage lädt keine Dateiinhalte und betreibt keine Intervallabfrage aller geladenen Seiten. Fokus, Wiederverbindung, ausdrückliches Aktualisieren und bestehende Dokumentmutationen revalidieren die Ergebnisse. Der Jobkatalog für Anhänge wird erst bei geöffnetem Upload in einem zulässigen Auftragskontext angefragt. Die bestehenden Subjekt-/Auftragsansichten und Anhänge behalten ihre bisherigen Metadaten-/Scan-/Versionierungsabfragen; dieses Dokument behauptet keine neue Pagination aller eingebetteten Altansichten.

## Nur meine Ordnung

Jedes Konto kann ein **aktuell zugängliches** Dokument unabhängig von anderen Lesenden mit bis zu 20 eigenen Tags zu je 60 Zeichen und einer eigenen virtuellen Ordnerbezeichnung zu bis zu 80 Zeichen versehen. Tags werden über den bestehenden Label-Validator normalisiert und ohne Groß-/Kleinschreibungsduplikate gespeichert. Ein Tag pro Eingabezeile erhält auch Kommas innerhalb einer Bezeichnung. Ein leerer Ordner bedeutet „ungeordnet“; die besondere Filteroption findet genau diese Dateien.

Die Zuordnung ist ein privates Paar aus Konto- und Dokumentkennung in `private.document_organisation`. Ein anderer Dozierender oder Administrator erhält weder diese Tags noch den Ordner. Bei einer gemeinsamen Datei können beide Konten unterschiedliche Ordnungen verwenden. Filter wirken über alle aktuell zugänglichen Dateien, nicht nur über bereits geladene Seiten. Tag-/Ordnerfilter vergleichen vollständige Bezeichnungen ohne Beachtung der Groß-/Kleinschreibung.

Ein virtueller Ordner ist eine persönliche Bezeichnung, kein Storage-Verzeichnis und keine hierarchische Ordnerverwaltung. Die Funktion verschiebt keine Bytes, verändert keine Eigentümerschaft oder Freigabe und behauptet weder Sicherheitsklassifikation noch DLP. Private Vertrags-/Rechnungs-/Chat-/Profildateien erhalten keine neue administrative Freigabe.

`save_document_organisation` leitet das Konto ausschließlich aus `auth.uid()` ab. Die API akzeptiert nur Dokumentkennung, `tags`, `folder` und erwartete Versionsnummer. Version `0` steht für eine noch nicht vorhandene eigene Zuordnung. Gleichzeitige Änderungen haben genau einen Gewinner; eine veraltete Fassung wird mit `40001` abgelehnt. Der Entwurf bleibt sichtbar. „Aktuelle Ordnung laden und Entwurf schließen“ verwirft ihn ausdrücklich und lädt vor einer neuen Bearbeitung aktuelle Metadaten.

Archivierung, entzogene Raum-/Auftragsrechte oder Kontosperrung lassen die Zuordnung nicht als Ersatzberechtigung weiterwirken. Verborgene Dokumente erscheinen auch über ihre eigenen Tags nicht mehr und können nicht weiter organisiert werden. Bei einem aktuellen Serverfehler werden zurückbehaltene Discovery-Daten nicht weiter angezeigt. Der vorhandene Auth-Kontowechsel leert zusätzlich den Arbeitsspeicher-Cache; die Abfrageschlüssel enthalten das Konto. Es gibt keinen persistierten Offline-Cache.

## Stabile Dialoge und aktueller Ressourcenzugriff

Ein laufender Filterabruf ersetzt die Ergebniszeilen, erhält aber einen bereits geöffneten Archiv-/Versions-/Bearbeitungsdialog und persönliche Ordnungsentwürfe. Neue Ergebnisse verwenden ihre eigenen Zeilen; es gibt keine Übernahme fremder Filter- oder Kontodaten. Ein legitimes leeres Filterergebnis beendet keine begonnene Operation.

Nur tatsächlich geöffnete Ziele erhalten eine begrenzte genaue Metadatenprüfung über die vorhandene `documentQuery`. Konto, Dokumentkennung, erfolgreiche Listenbeobachtung und Fokusgeneration trennen diese Prüfung von alten Antworten. Während einer ungeklärten Prüfung bleiben Schreibaktionen gesperrt. `null`, gelöschte/falsche Zielkennungen und Berechtigungsfehler verwerfen das betroffene Modal samt geschützten Entwürfen. Das gilt auch für einzelne Raumrechteentzüge, bei denen die Listenantwort erfolgreich, aber leer ist. Subject-/Auftragsdateilisten verwenden denselben Schutz.

Ein zuvor gesperrter Dateiname darf nicht aus einem alten Suchcache oder einer lediglich angehängten Seite wieder erscheinen. Nur eine wirklich neue vollständige Antwort des aktuellen Beobachters kann diese Quarantäne erneuern. Netzwerk- und Versionskonflikte erhalten erlaubte Entwürfe; `42501` verwirft das ursprüngliche Ziel. Verspätete Erfolge oder Fehler einer alten Operation schließen keinen inzwischen geöffneten anderen Entwurf. Es entstehen weder Abfragen pro Ergebniszeile noch eine zusätzliche Polling-Schleife.

Diese Korrektur wurde vorab reproduziert und durch **47 bestandene Datei-Komponentenfälle** mit kontrollierten Transportbarrieren, Cache-/Paging-/Fokusübergängen und exakten Schreibanzahlen geprüft. Die native Gesamtabnahme bleibt separat in [QA_RESULTS](QA_RESULTS.md) erfasst.

## Bewahrte Dateipipeline

Upload, Byte-/MIME-/Größenprüfung, Quarantäne und tatsächlicher ClamAV-Scan, private Storage-Ablage, Versionshistorie, Preview-Blob-Lebensdauer, Umbenennen und Archivieren bleiben verbunden. Downloads verwenden weiterhin das bestehende authentifizierte Dateigateway mit aktueller Ressourcenprüfung und ausgewählter Version; Tags oder Ordner liefern keine öffentliche URL und keinen Storage-Bypass. Eine Metadatenzeile ist kein Nachweis einer gescannten vorhandenen Datei.

Die additive CLI-generierte Migration ist `20261115230604_file_discovery_personal_organisation.sql`. Frühere 24 Migrationen werden nicht ersetzt. Die neue Tabelle hat RLS, keine Client-Schreibrechte und keine Admin-Ausnahme. Öffentliche RPCs bleiben Invoker-Einstiege in eingeschränkte private Implementierungen mit leerem Suchpfad und expliziten Ausführungsrechten. Ein Zeit-/UUID-Index unterstützt die Discovery-Seiten, ein kontogebundener Ordnerindex die privaten Filter.

## Prüfstand und Fortsetzung

```bash
npx vitest run src/features/files
PORTAL_DB_CONTAINER=<eigener-testcontainer> node scripts/files-discovery-db-tests.mjs
```

Vor der gemeinsamen M7-Abnahme bestanden gezielt 18 Datei-Komponenten-/Unitfälle, sechs echte Discovery-PostgreSQL-Prüfgruppen und sechs generische API-Surface-Prüfgruppen. Der API-Surface-Lauf fand keine anonym ausführbaren Anwendungsfunktionen; tatsächliche native Auth-/REST-/Browserabnahme ist damit nicht behauptet. TypeScript, eigene ESLint-/Formatprüfungen und Skriptsyntax bestanden ebenfalls.

Die gezielten SQL-Prüfungen verwenden eigene temporäre UUID-Datenbanken. Sie zeigen das alte 1.000-Zeilen-Problem und prüfen mehr als 1.000 zugängliche Metadaten, wörtliche Suche, vollständige und gleichzeitige Gleichzeitstempel-Pagination, Fremd-/Adminzugriff, private gemeinsame-Datei-Zuordnungen, CAS-Rennen, ungültige Payloads, Archivierung, entzogene Rechte und bestehende gesperrte Token-Identitäten. Komponentenprüfungen decken Deep Link, Fokus während einer wartenden Antwort, echte Cursorübergabe, DE/EN-Entwürfe, ausstehendes Speichern, Konflikte, Offlinezustand und Ausblenden alter Daten ab. Bestehende Scan-Polling-, Versions- und exakte Downloadprüfungen bleiben erhalten.

`scripts/files-discovery-api-check.mjs` reproduziert den echten REST-Zeilendeckel mit über 1.000 fiktiven Metadaten und prüft die neue API mit tatsächlichen Auth-Konten. `tests/e2e/file-discovery.spec.ts` ergänzt Desktop/Mobil, wirkliche Seiten, einen echten gescannten Upload und bytegleichen Download nach Organisation, Rollenabgrenzung, DE/EN, Dark Mode, Offline, Archivierung und axe. Verfasste native API-/Browserfälle sind **keine** bestandenen Läufe. Den tatsächlich ausgeführten Gesamtstand dokumentieren [WORKLOG](WORKLOG.md) und [QA_RESULTS](QA_RESULTS.md).

Eigenständige Kurs-/Organisationsdateikontexte, hierarchische gemeinsame Ordner, ablaufende Freigabelinks, begrenzte Archivformate und Retention-/Purge-Werkzeuge bleiben weitere Master-Prompt-Aufgaben. Diese Änderung richtet keine externe Ablage, öffentliche Freigabe oder neue Infrastruktur ein.
