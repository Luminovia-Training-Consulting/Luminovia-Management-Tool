# GitHub-Prüfungen, Sicherheit und Coverage

Die Workflows laufen bei Pull Requests und auf `main`; eine manuelle Ausführung ist ebenfalls möglich. Sie benötigen keine VPS-Zugangsdaten, privaten Supabase-Schlüssel oder Produktionsdaten. Die bestehenden realen Anwendungs-/Datenbank-/API-/Browserprüfungen bleiben erhalten.

## Sichtbare Aufgaben

| Check                                        | Tatsächliche Prüfung                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build                                        | Produktionskompilierung und PWA-Build mit ausschließlich synthetischer öffentlicher Supabase-Konfiguration. Kein Zugriff auf eine echte Instanz. |
| Typecheck                                    | TypeScript-Projektprüfung mit `npm run typecheck`.                                                                                               |
| Lint                                         | ESLint ohne erlaubte Warnungen.                                                                                                                  |
| Formatting                                   | Bestehende Quellformatierung und GitHub-Konfigurationen.                                                                                         |
| Code quality                                 | Vorhandene compilerbasierte Prüfung erreichbarer Module, Exporte und Verbindungen.                                                               |
| Tests and coverage                           | Alle Vitest-Unit-/Komponententests, V8-Coverage und echte Mindestwerte; HTML/LCOV/JSON als herunterladbare Artefakte.                            |
| verify                                       | `./portal test`: real isolierte SQL/RLS/API/Edge-/Browser-/PWA-, Sicherheits-, Wiederanlauf- und Wartungsprüfungen.                              |
| Actual isolated selfhost image compatibility | Echte gepinnte Supabase-Images und Datenübernahme aus dem vorherigen Quellstand.                                                                 |
| PR metadata                                  | Aktuelle PR-Labels und passende Repository-/Commitidentität.                                                                                     |

Der Releasejob benötigt die schnellen Qualitätsgates und beide vollständigen Anwendungs-/Selfhost-Gates. Ein früher Maintainer-Merge kann die Repo-Regeln umgehen, veröffentlicht aber kein fehlgeschlagenes Paket. Die VPS-Automatik prüft weiterhin den erfolgreichen gesamten exakten Main-CI-Lauf.

[CodeQL](../.github/workflows/security.yml) analysiert zusätzlich JavaScript/TypeScript, Python und GitHub Actions bei PRs/Main und montags um 05:23 UTC (15:23 Brisbane). Das ist statische Sicherheitsanalyse, kein Ersatz für tatsächliche RLS-/Auth-/Dateizugriffstests. Erkenntnisse stehen unter GitHubs Security/Code scanning; ein erfolgreich abgeschlossener Scan allein bedeutet nicht, dass keine Warnungen vorliegen. Dieser separate Security-Workflow ist derzeit kein zusätzlicher Release-`needs`-Gate; die Veröffentlichungsbedingungen stehen ausdrücklich im `ci.yml`.

## Coverage ausführen und richtig lesen

```bash
npm ci
npm run test:coverage
```

Der Bericht liegt lokal in `coverage/index.html`, maschinenlesbar in `coverage/coverage-summary.json` und `coverage/lcov.info`. In GitHub Actions steht der Coverage-Bericht beim jeweiligen Lauf unter Artifacts zur Verfügung. `coverage/` ist bewusst nicht versioniert.

Erfasst werden **alle ausführbaren `src`-TS/TSX-Dateien und `scripts/public-config.ts`**, auch nicht importierte Module. Tests, Testsetup und Deklarationen sind ausgeschlossen. Die V8-Abdeckung stammt aus Unit-/Komponententests; SQL, Edge, Python/Node-Wartung und echte Browserabläufe werden nicht zu einer erfundenen Gesamtzahl zusammengerechnet.

Die erste vollständige Messung mit den ergänzten Fällen besteht mit **197 Tests in 46 Dateien**: Statements 47,09 %, Branches 41,61 %, Functions 37,07 %, Lines 48,89 % über 106 erfasste Quelldateien. Die globalen Mindestwerte 46,5/41/36,5/48 begrenzen Rückschritte gegenüber dieser ehrlichen Basis mit kleiner Messreserve. Ungetestete UI-Pfade bleiben sichtbar; eine beliebige 80%-Vorgabe wird nicht durch Ausschluss dieser Dateien hergestellt.

Kritische Teilbereiche haben strengere Gates: 100 % für Browser-Key-Konfiguration, Zeitzonen-/DST-/Datumslogik und Terminplanung; hohe eigene Statement-/Branch-/Function-/Line-Grenzen für Dateitransfer und sichere Wissensinhalte. Die exakten Werte stehen in [vite.config.ts](../vite.config.ts). Künftige Verbesserungen erhöhen die gemessene Abdeckung; Mindestwerte werden nicht automatisch abgesenkt.

Neue echte Fälle prüfen unter anderem Uploads erst nach Online-/Auth-Bestätigung, Fortschritt höchstens 95 % vor bestätigtem Clean-Status, Quarantäne/Timeout/Retry-Kontext, versionsgenaue `no-store`-Downloads sowie die Ablehnung geheimer Browser-Schlüssel. Der Testlauf braucht dafür keine echte Benutzer- oder Kundendatei.

## Dependabot und Sicherheitsfunktionen

[dependabot.yml](../.github/dependabot.yml) ergänzt Updates für SHA-gepinnte GitHub Actions (montags 04:17 UTC / 14:17 Brisbane) und npm-Sicherheitskorrekturen (tägliche Konfiguration 04:47 UTC / 14:47 Brisbane). Normale npm-/Node-/JSR-/Container-Versionen bleiben beim bestehenden täglichen vollständigen Kandidatenprüfpfad; so arbeiten nicht zwei unkoordinierte Systeme an denselben regulären Updates. Vitest und `@vitest/*` werden dort als gemeinsame exakte Peer-Familie behandelt.

Dependabot-PRs erhalten passende vorhandene Typ-/Bereichs-/Risikolabels und laufen durch dieselben Prüfungen. Es gibt keinen pauschalen Auto-Merge ungeprüfter Abhängigkeiten. Dependabot-Alerts waren bereits aktiv; Security-Update-PRs sowie Secret Scanning und Push Protection sind jetzt auf dem öffentlichen Repository aktiviert und ausgelesen. Der zunächst deaktivierte Dependency Graph wurde auf der Repository-Einstellungsseite aktiviert; die echte Dependency-Review-Wiederholung und der Vergleich der12geänderten Abhängigkeiten bestanden. Es wurde kein kostenpflichtiger Dienst hinzugebucht. Der vollständige npm-Audit meldet weiterhin die vier bereits dokumentierten niedrigen Build-Tool-Befunde in der unveränderten `deepmerge`/Workbox-Kette; der Produktionsaudit ist separat. Dependency review bewertet neu eingeführte Befunde und erklärt diese Altlast nicht für behoben.

## Maintainer und serverseitige Regeln

Maintainer und Administratoren erhalten `always`-Ausnahmen; gewöhnliche Schreibrechte erhalten keinen Bypass. Die aktive Regel hatte diese Rollen bereits. Die beiden zusätzlich vorbereiteten Review-/Checkregeln wurden mit derselben aktuellen Anweisung synchronisiert, bleiben bis zum bewiesenen Wartungs-App-Pfad deaktiviert. Details und tatsächlicher Aktivierungsstand: [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md).

Die Einrichtung wurde in [PR11](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/11) gemergt. Alle sechs neuen Qualitäts-/Coverage-Aufgaben und der korrigierte Sicherheitslauf bestanden am tatsächlichen PR-Stand; der Maintainer-Merge gelang auch während laufender Langtests. Hauptzweigprüfungen laufen anschließend erneut und bleiben die Veröffentlichungsbedingung. Scanner-Job und erzeugter CodeQL-Befundcheck wurden getrennt geprüft; der anfängliche Test-Fixture-Befund wurde durch exakte URL-Origin-Prüfung behoben. Der erste komplette Main-Scan meldet zusätzlich vorhandene Betriebs-/Testskripthinweise. Sie sind in [CODE_SCANNING_TRIAGE](CODE_SCANNING_TRIAGE.md) einzeln eingeordnet; ein erfolgreicher PR-Diffscan bedeutet keinen warnungsfreien Main-Scan.

Offizielle Grundlagen: [GitHub CodeQL](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql), [Dependabot](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates), [Vitest-Coverage](https://vitest.dev/guide/coverage.html). Exakte ausgeführte Prüfungen und GitHub-Läufe werden im [WORKLOG](WORKLOG.md) dokumentiert.
