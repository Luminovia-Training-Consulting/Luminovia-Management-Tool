# Den neuesten GitHub-Stand lokal ausprobieren

```bash
./portal github
```

Der Befehl holt den aktuellen `main` von **Luminovia-Training-Consulting/Luminovia-Management-Tool**, zeigt dessen vollständige Commit-ID und startet ihn als eigenständiges lokales Portal unter **http://127.0.0.1:5373**. Deine aktuelle Arbeitskopie und ihre nicht eingecheckten Änderungen bleiben erhalten. Es wird weder `git pull` in deinem Entwicklungsbranch ausgeführt noch eine bestehende Datenbank zurückgesetzt.

Voraussetzungen entsprechen der [lokalen Entwicklung](LOCAL_DEVELOPMENT.md): Linux, Node/npm, Git, Docker Engine/Compose, Python 3 und util-linux `flock`. Der erste Start lädt die gesperrten Abhängigkeiten, Supabase-Dienste und Scanner-Signaturen. Parallel laufende Entwicklungs- und Vorschauumgebungen benötigen jeweils Speicher für ihren eigenen Scanner; die vollständige QA benötigt weitere Ressourcen.

## Befehle

| Befehl                                         | Wirkung                                                                                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./portal github` oder `./portal github start` | Aktuellen GitHub-Stand holen, erforderlichenfalls die eigene Vorschau aktualisieren und starten.                                                                 |
| `./portal github update`                       | Aktuellen Stand holen; eine neue Version datenerhaltend übernehmen und starten.                                                                                  |
| `./portal github status`                       | Gespeicherte Commit-ID, tatsächliche Supervisorphase und lokale Adressen anzeigen; kein Netzwerkabruf.                                                           |
| `./portal github stop`                         | Ausschließlich die verwaltete Vorschau stoppen; ihre Daten bleiben erhalten.                                                                                     |
| `./portal github credentials`                  | Das ursprüngliche Passwort der eigenen fiktiven Vorschaukonten bewusst anzeigen. Nicht teilen.                                                                   |
| `./portal github plan`                         | Aktuellen GitHub-Stand und neue Migrationen samt Prüfbedarf anzeigen, ohne eine laufende Vorschau zu aktualisieren oder zu stoppen.                              |
| `./portal github test`                         | Den neuesten Commit in einer getrennten Testarbeitskopie mit dem vollständigen `./portal test` prüfen. Eine laufende Vorschau bleibt auf ihrem bisherigen Stand. |

Jeder Start-/Update-/Testaufruf muss den aktuellen Hauptzweig tatsächlich abrufen können. Ein Netzwerk- oder Git-Fehler wird gemeldet; der Launcher behauptet dann keinen aktuellen Stand und startet keine alte Ersatzversion. Eine schon laufende Vorschau wird bei einem fehlgeschlagenen Abruf nicht beendet. `status`, `stop` und `credentials` benötigen keinen GitHub-Abruf.

## Getrennte Dienste und dauerhafte Testdaten

| Umgebung            | Portal | Supabase API | PostgreSQL | Mailpit |
| ------------------- | ------ | ------------ | ---------- | ------- |
| Normale Entwicklung | `5173` | `54321`      | `54322`    | `54324` |
| GitHub-Vorschau     | `5373` | `56321`      | `56322`    | `56324` |
| Vollständige QA     | `5273` | `55321`      | `55322`    | `55324` |

Alle Adressen binden an Loopback. Die Vorschau erhält ein eigenes stabiles Supabase-Projekt `luminovia-portal-github-…`, abgeleitet vom Launcher-Verzeichnis. Neue leere Vorschauen bekommen ausschließlich die vorhandenen fiktiven Beispielkonten. Passwörter, MFA, Profile, Termine und Storage-Dateien werden durch Stop/Start und erfolgreiche Vorwärtsupdates nicht neu initialisiert. Es werden keine Zugangsdaten oder echten Daten aus deiner normalen Entwicklungsumgebung kopiert.

Die verwaltete Quelle liegt unter `.local/github-preview/source/`. Dort bleiben ihre eigenen ignorierten `.local/`- und Umgebungsdateien bei einem Update erhalten. Git speichert den exakten Hauptzweig-Commit; ausschließlich `supabase/config.toml` erhält eine dokumentierte lokale Projekt-/Portanpassung. Der Launcher prüft deren Fingerabdruck vor jedem Update. Die Quellkopie ist zum Ausprobieren gedacht: Eigene Codeänderungen gehören in einen normalen Entwicklungsbranch. Geänderte oder fremde Dateien in der verwalteten Quelle werden abgelehnt und nicht überschrieben.

Die GitHub-Testarbeitskopien liegen getrennt unter `.local/github-preview/test-<vollständige Commit-ID>/`. Der kanonische Teststarter erzeugt darin weiterhin eine zufällige, kurzlebige QA-Datenbank und verwendet die gemeinsame systemweite QA-Sperre. Seine Berichte bleiben im jeweiligen `.local/tests/` erhalten. Testarbeitskopien und installierte Abhängigkeiten belegen zusätzlichen Plattenplatz; sie werden nicht automatisch mitsamt möglichen Diagnoseinformationen gelöscht.

Ein lokales Docker-Volume ersetzt kein Backup. Dieses Werkzeug synchronisiert keine Produktionsdaten und nimmt keine gehostete Installation vor.

## Migrationen und unterbrochene Updates

Neue additive Migrationen werden beim normalen Start durch die bestehende lokale Laufzeit angewendet. Zurückgesetzte Git-Historie, geänderte/entfernte historische Migrationen, rückdatierte Migrationen, eine andere PostgreSQL-Hauptversion oder eine umgebogene Remote-Adresse werden vor einer Datenänderung abgelehnt.

Für neue Migrationen verwendet der Vorschauplan dieselbe SQL-Kompatibilitätsprüfung wie der vorhandene Updater. Änderungen mit Prüfbedarf werden **vor dem Stoppen** zurückgewiesen. Prüfe dann die genannten SQL-Dateien im konkreten Commit und sichere relevante eigene Vorschau-Daten. Nur nach bewusstem Prüfen kannst du genau den angezeigten Plan übernehmen:

```bash
./portal github plan
./portal github update --accept-migration-plan ANGEZEIGTER_SHA256_DIGEST
```

Der Platzhalter ist durch den vollständigen angezeigten Digest zu ersetzen. Der Digest bindet Ziel-Commit, bisherigen Stand und neue Migrationsquellen. Eine inzwischen geänderte Version verlangt einen neuen Plan. Diese Bestätigung ist ausschließlich eine lokale Operatorentscheidung; sie ist keine Produktionsfreigabe und umgeht weder die Historienprüfung noch die Sperre für PostgreSQL-Hauptversionswechsel. Daten, die eine bewusst akzeptierte Migration fachlich verändert, werden dadurch nicht automatisch rückgängig gemacht.

Eine private Übergangsnotiz ermöglicht es, einen Abbruch genau zwischen Git-Checkout und Schreiben der lokalen Portkonfiguration zu erkennen. Nur der aufgezeichnete alte oder neue Commit mit unveränderten Quelldateien wird normalisiert. Unbekannte Änderungen werden abgelehnt. Der Launcher setzt dabei keine Datenbank zurück und führt keinen verdeckten Datenbank-Rollback aus. Falls ein anschließender Dienststart scheitert, bleiben die eigene Quelle, Daten und privaten Protokolle für die Diagnose erhalten.

## Entwicklung und Abnahme des Launchers

Die elf `runtime-github.test.mjs`-Fälle verwenden echte temporäre Git-Repositories und echte Node-Unterprozesse. Sie prüfen Versionswechsel, erhaltene fiktive Passwort-/Dateibytes, unangetastete Entwicklungsänderungen, Daten-/Historiengrenzen, getrennte Testarbeitskopien, vorhandene und ins Leere zeigende Symlinks, unterbrochene Konfigurationsübergänge und die Freigabe der Kernel-Sperre nach Prozessende. Der dortige Dienstadapter ist ausdrücklich eine Fixture; diese Fälle ersetzen keine echte Supabase-Auth-/Storage-Neustartabnahme.

```bash
node --test scripts/runtime-github.test.mjs
```

Der reguläre Gesamtbefehl entdeckt diese Fälle automatisch. Tatsächlich ausgeführte Gesamt- und native Prüfungen sowie der reale Vorschau-Neustart werden im [Arbeitsprotokoll](WORKLOG.md) und in [QA_RESULTS](QA_RESULTS.md) getrennt festgehalten.
