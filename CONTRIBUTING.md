# Zum Luminovia Portal beitragen

> Stand 16. November 2026: Das Review-/Merge-Regelwerk unten ist vorbereitet. Seine serverseitige Aktivierung wartet auf die Freigabe einer beschränkten Wartungs-App; die bisherigen Hauptzweig-Regeln bleiben bis dahin wirksam. [Aktueller Aktivierungsstand](docs/GITHUB_WORKFLOW.md#aktivierung-noch-ausstehend).

Willkommen! Hier steht, wie aus einer Idee oder Fehlermeldung eine nachvollziehbare, getestete Änderung wird. **English contributions are welcome.** Please follow the same issue, test and pull-request process; German is the main documentation language, and application interface changes need both German and English strings.

Das Portal ist eine React-/TypeScript-PWA mit Supabase. Der vollständige Produktumfang bleibt im [Entwicklungsplan](docs/IMPLEMENTATION_PLAN.md) sichtbar. Eine funktionierende Entwicklungsfassung ist keine Produktionsfreigabe.

## Den passenden Einstieg finden

| Vorhaben                                                   | Einstieg                                                                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fehler melden, Frage stellen oder Verbesserung vorschlagen | [Issue-Leitfaden](docs/ISSUE_GUIDE.md) und passende [Issue-Vorlage](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose) |
| Code oder Dokumentation ändern                             | Dieser Ablauf, anschließend der [PR-Leitfaden](docs/PULL_REQUEST_GUIDE.md)                                                                                        |
| Architektur, Datenmodell und Tests verstehen               | [Entwicklerhandbuch](docs/DEVELOPER_GUIDE.md), [Architektur](docs/ARCHITECTURE.md), [Testplan](docs/TEST_PLAN.md)                                                 |
| Lokales System starten oder Fehler beim Start untersuchen  | [Lokale Entwicklung](docs/LOCAL_DEVELOPMENT.md)                                                                                                                   |
| Eine mögliche Sicherheitslücke melden                      | [Privater Meldeweg](docs/ISSUE_GUIDE.md#sicherheitsprobleme-melden); keine öffentlichen Exploitdetails                                                            |

## 1. Vorhandenen Stand lesen

Lies [Arbeitsprotokoll](docs/WORKLOG.md), [Entwicklungsplan](docs/IMPLEMENTATION_PLAN.md), [Projektregeln](AGENTS.md) und den verbindlichen [Master-Prompt](docs/UNIVERSAL_MASTER_PROMPT.txt). Suche vor einem neuen Issue oder PR nach bestehenden Meldungen und laufender Arbeit. Größere fachliche Änderungen sollten zuerst in einem Issue mit Problem, Ziel und Abnahmekriterien beschrieben werden.

Bewahre funktionierenden Code und bereits ausgelieferte Migrationen. Die öffentliche Luminovia-Website ist eine Designreferenz und gehört nicht zum Änderungsumfang dieses Repositorys.

## 2. Einen eigenen Branch verwenden

Externe Beitragende erstellen einen Fork und einen Branch darin. Mit Schreibrechten im Repository genügt ein eigener Branch. Für Agentenarbeit verwenden wir `codex/`; für andere Beiträge sind zum Beispiel `fix/kurzer-name`, `feature/kurzer-name` und `docs/kurzer-name` geeignet.

```bash
git clone https://github.com/DEIN_GITHUB_NAME/Luminovia-Management-Tool.git
cd Luminovia-Management-Tool
git remote add upstream https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool.git
git fetch upstream
git switch -c fix/kurzer-name upstream/main
```

Halte den Branch auf eine zusammenhängende Änderung begrenzt. Nutze aussagekräftige, signierte Commits, beispielsweise `fix: preserve invoice version on download` oder `docs: explain local startup`. Zugangsdaten und reale Personen- oder Kundendaten gehören weder in Commits noch in Screenshots oder Test-Fixtures.

## 3. Lokal entwickeln und prüfen

Die unterstützten Voraussetzungen stehen vollständig in [LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md): Linux, die in `.node-version` gepinnte Node-Version, npm und Docker Engine/Compose. Die vollständigen Prüfungen benötigen zusätzlich Python 3, `flock` sowie die offiziellen `age`-/`age-keygen`-Werkzeuge. Verwende den Lockfile-Stand; führe kein ungeprüftes `audit fix --force` aus.

```bash
./portal start
./portal test
./portal stop
```

`start` startet das echte lokale System und bewahrt seine Daten. `test` verwendet einen getrennten temporären Datenbestand und prüft unter anderem Komponenten, Datenbankrechte, APIs, Browser und die gebaute PWA. `stop` beendet die verwaltete Entwicklungsumgebung datenerhaltend. Eine normale Datenbank wird für einen Test nicht zurückgesetzt. Der erste Start benötigt Downloads und ausreichend RAM für die Dienste samt Malware-Scanner.

Während der Entwicklung sind gezielte Prüfungen sinnvoll, zum Beispiel `npm test`, `npm run lint` und `npm run typecheck`, sobald die lokalen Abhängigkeiten installiert sind. Vor der Abnahme ist `./portal test` maßgeblich. Führe nur Prüfungen aus, deren Ziel und Ressourcen du verstanden hast; veröffentliche keine unbearbeiteten privaten Testartefakte.

## 4. Die fachlichen Verträge erhalten

- **Berechtigungen:** Datenbank und API entscheiden über Zugriffe. Prüfe andere Konten, entzogene Rechte und abgelehnte Anfragen; ein ausgeblendeter Button reicht nicht.
- **Termine und Honorare:** Buchungen werden erst nach bestätigter Datenbanktransaktion angezeigt. Angenommene Termine und finanzielle Vereinbarungen bleiben unveränderliche Snapshots.
- **Datenbank:** Ergänze neue Migrationen, statt ausgelieferte Dateien zu ändern. Prüfe RLS, Grants, Constraints, Nebenläufigkeit und vorhandene Daten gemeinsam mit der API und Oberfläche.
- **Oberfläche:** Ergänze DE/EN-Texte, Lade-, Fehler- und Leerzustände. Prüfe Tastaturbedienung, Mobilansicht sowie helle und dunkle Darstellung. Screenshots enthalten ausschließlich fiktive Daten.
- **Dokumentation:** Aktualisiere betroffene Anleitungen und API-Beschreibungen. Halte im Arbeitsprotokoll tatsächliche Änderungen, ausgeführte Prüfungen und offene Grenzen fest.

Tests sollten das veränderte Verhalten und relevante Fehlerpfade nachweisen. Ein sinnvoller Regressionstest schlägt vor der Fehlerkorrektur fehl und besteht danach. Umfang und Testnachweise richten sich nach dem Risiko; dokumentiere eine nicht ausgeführte Prüfung ausdrücklich.

## 5. Pull Request eröffnen

Öffne einen PR gegen `main` und fülle die Vorlage aus. Ein Draft eignet sich für noch nicht prüfbereite Arbeit. Beschreibe Problem, resultierendes Verhalten, tatsächliche Testnachweise und Risiken. Verlinke das Issue; `Closes #123` schließt es beim Merge, während `Refs #123` es nur zuordnet.

Jeder PR braucht genau ein `type:*`-Label, mindestens ein `area:*`-Label und genau ein `risk:*`-Label. Die vollständigen Werte, Beispiele und Verantwortlichkeiten stehen im [PR-Leitfaden](docs/PULL_REQUEST_GUIDE.md#labels-für-pull-requests). Externe Beitragende können Labels normalerweise nicht selbst setzen: Nenne deine Vorschläge im PR, ein Maintainer setzt sie vor der Abnahme.

## Review und Merge

Beiträge an `main` laufen über einen Pull Request. Für gewöhnliche Beitragende ist mindestens eine unabhängige zustimmende Review erforderlich; neue Änderungen machen eine vorherige Zustimmung ungültig. Beantworte offene Rückfragen und halte die CI grün.

`CarinaSchoppe` kann mit der auf ihr Konto begrenzten Ausnahme die Reviewpflicht **innerhalb eines PRs** übergehen und selbst mergen. Die Ausnahme gilt für die handelnde Person, nicht automatisch für PRs eines bestimmten Autors. Sie erlaubt keinen direkten menschlichen Push auf `main` und hebt für sie keine verpflichtende CI-Prüfung auf. Andere Admin- oder Schreibrechte allein ergeben diese Ausnahme nicht.

Die verpflichtenden PR-Prüfungen heißen `verify`, `Actual isolated selfhost image compatibility` und `PR metadata`. Die native Supabase-Prüfung ergänzt den vollständigen Anwendungstest um eine reale Datenübernahme. Fehlende oder fehlgeschlagene Checks müssen vor einem menschlichen Merge geklärt werden.

Eine getrennte Ausnahme erhält ausschließlich die bestehende GitHub-Actions-Wartungsautomatik. Sie prüft reale Kandidaten samt Datenübernahme vor der signierten direkten Promotion nach `main` und fordert danach die CI für genau den neuen Commit an. Ein Entwicklungspaket wird erst nach deren erfolgreicher Abnahme veröffentlicht. Diese technische Bot-Ausnahme überträgt keine Bypass-Rechte auf Beitragende oder andere Apps. Signaturen sowie das Verbot von Force-Push und Branchlöschung bleiben eigenständige Regeln.

Ein Merge kann die bestehende **Entwicklungsrelease-Automatik** anstoßen. Eine Produktionsinstallation, riskante Migration oder Änderung an Hosting, DNS und echten Daten benötigt weiterhin die dafür vorgesehene separate Freigabe. Der GitHub-Merge ist kein Ersatz für diese Betriebsfreigabe.

## Tags und Veröffentlichungen

Labels ordnen Issues und PRs ein. Git-Tags markieren dagegen einen bestimmten Commit. Die signierten, annotierten Tags `milestone/m3-accounts-commission`, `milestone/m4-cbw-templates` und `milestone/m5-system-audit` kennzeichnen angenommene Entwicklungsmeilensteine. Sie behaupten weder einen vollständigen Produktumfang noch eine Produktionsfreigabe.

Bestehende `cms-dev-*`-Tags gehören zur Entwicklungsrelease-Automatik. Verschiebe oder ersetze veröffentlichte Tags nicht. Neue Meilenstein- oder Versionsmarkierungen werden von den Maintainerinnen und Maintainern mit dem tatsächlich geprüften Commit verknüpft; ein PR-Label erzeugt keinen Git-Tag.

## Lizenz und Zusammenarbeit

Das Repository steht unter GNU GPLv3; vorhandene Lizenz- und Herkunftshinweise bleiben erhalten. Für mitgelieferte Fonts und Markenmaterial gelten die jeweiligen Hinweise. Beschreibe technische Meinungsverschiedenheiten sachlich, begründe Entscheidungen und behandle Rückmeldungen respektvoll.
