# Pull Requests erstellen, prüfen und mergen

> Stand 16. November 2026: Das Review-/Merge-Regelwerk unten ist vorbereitet. Seine serverseitige Aktivierung wartet auf die Freigabe einer beschränkten Wartungs-App; die bisherigen Hauptzweig-Regeln bleiben bis dahin wirksam. [Aktueller Aktivierungsstand](GITHUB_WORKFLOW.md#aktivierung-noch-ausstehend).

Dieser Leitfaden beschreibt die Abnahme einer Änderung. Einrichtung und lokale Entwicklung stehen in [CONTRIBUTING](../CONTRIBUTING.md) und [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md); Meldungen beginnen mit dem [Issue-Leitfaden](ISSUE_GUIDE.md).

## Branch und Titel

Erstelle einen eigenen Branch vom aktuellen `main`; externe Beitragende verwenden einen Fork. Ein PR löst ein zusammenhängendes Problem. Agentenbranches beginnen mit `codex/`. Ein früher Draft ist sinnvoll, wenn du fachliches Feedback brauchst, bevor die Umsetzung prüfbereit ist.

Wähle einen Titel, der das Ergebnis beschreibt, etwa `fix: keep accepted fee when editing a course` oder `docs: explain private file permissions`. Ein Präfix hilft beim Lesen, ersetzt aber kein Label. Commits sollen signiert und inhaltlich nachvollziehbar sein.

## Inhalt der Beschreibung

Fülle die PR-Vorlage aus. Beschreibe das konkrete Problem und das Verhalten nach der Änderung. Verlinke das Issue mit `Closes #123`, wenn dessen Ziel vollständig erfüllt ist; verwende sonst `Refs #123`.

Gib ausgeführte Prüfungen mit Befehl und Ergebnis an. Schreibe „nicht ausgeführt“, wenn ein Nachweis fehlt, und begründe es. Neue Tests allein beweisen noch keinen bestandenen Lauf. Trenne lokale, CI-, native Supabase- und tatsächliche gehostete Abnahme klar.

Bei sichtbaren Änderungen helfen fiktive Desktop-/Mobil-Screenshots mit DE/EN und heller/dunkler Darstellung. Beschreibe bei Datenbankänderungen Migration, vorhandene Daten, RLS/Grants und Wiederherstellung. Halte veröffentlichte Migrationen unverändert; eine zusätzliche Migration trägt die neue Änderung.

## Labels für Pull Requests

Jeder PR braucht **genau ein Typ-Label**, **mindestens ein Bereichslabel** und **genau ein Risikolabel**. `PR metadata` prüft diese Einordnung. Die vorhandenen allgemeinen GitHub-Labels werden beibehalten; `bug` oder `documentation` allein erfüllen die PR-Kategorien nicht.

| Typ                 | Verwendung                                                      |
| ------------------- | --------------------------------------------------------------- |
| `type:fix`          | Fehler in geliefertem Verhalten korrigieren                     |
| `type:feature`      | Neues fachliches Verhalten ergänzen                             |
| `type:docs`         | Anleitungen oder Referenzen ändern                              |
| `type:refactor`     | Struktur bei beabsichtigt gleichem Verhalten verbessern         |
| `type:tests`        | Eigenständige Testverbesserung ohne fachliche Änderung          |
| `type:maintenance`  | Laufzeit-, Build- oder Repositorypflege                         |
| `type:security`     | Abgestimmte Sicherheitskorrektur; keine öffentliche Erstmeldung |
| `type:dependencies` | Geprüfte Abhängigkeitsaktualisierung                            |

Verfügbare Bereiche sind `area:frontend`, `area:backend`, `area:database`, `area:auth`, `area:files`, `area:finance`, `area:courses`, `area:devops` und `area:github`. Wähle alle tatsächlich wesentlich betroffenen Bereiche; für eine reine Dokumentationsänderung den dokumentierten Fachbereich, bei allgemeinen Beitragsregeln `area:github`.

| Risiko        | Einordnung                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `risk:low`    | Eng begrenzte Änderung mit geringen Auswirkungen, zum Beispiel eine korrigierte Anleitung                              |
| `risk:medium` | Geändertes Verhalten oder mehrere verbundene Komponenten mit überschaubarer Rückwirkung                                |
| `risk:high`   | Berechtigungen, Auth, Geld, Migrationen, Datenverlust-/Wiederherstellungsrisiko oder vergleichbar weitreichende Folgen |

Beispiele: Eine Anleitungskorrektur kann `type:docs`, `area:github`, `risk:low` erhalten. Eine Buchungskorrektur mit Migration kann `type:fix`, `area:backend`, `area:database`, `area:courses`, `risk:high` benötigen. Ein Label schafft keine Deployfreigabe und ersetzt keine Prüfung.

Externe Autorinnen und Autoren haben meist keine Labelrechte. Schlage die passenden Werte in der Beschreibung vor; ein Maintainer setzt sie. Bis dahin darf `PR metadata` fehlende Labels anzeigen. Bei Änderungen an Umfang oder Risiko wird die Einordnung angepasst. Auch eigene PRs von `CarinaSchoppe` brauchen die Pflichtlabels.

## Welche Nachweise nötig sind

| Änderung             | Relevante Nachweise                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Fehlerkorrektur      | Reproduzierbarer Fehler, aussagekräftiger Regressionstest und verbesserter Fehlerpfad                                   |
| UI/Formular          | Komponenten-/Browserprüfung, Tastatur und Mobilansicht, DE/EN, Lade-/Leer-/Fehlerzustände                               |
| API/Berechtigung     | Tatsächliche Aufrufe mit getrennten Konten, erlaubter und verweigerter Zugriff, entzogene Rechte und vorhandene Sitzung |
| Datenbank/Buchung    | Frische und vorhandene Daten, Constraints/RLS/Grants, atomarer Fehlerfall und reale Nebenläufigkeit                     |
| Dateien/Profilbilder | Versions-/Scan-/Byteprüfung, Berechtigungen und Entzug, fehlgeschlagene Anfragen und Cache-Lebensdauer                  |
| Laufzeit/Deployment  | Gezielte Prozess-/Konfigurationsprüfungen, Datenübernahme, sichere Rückkehr und bestehende Operatorgrenzen              |
| Dokumentation        | Auflösbare Links, zutreffende Befehle und klare Trennung von geprüftem und offenem Stand                                |

Führe während der Entwicklung passende gezielte Prüfungen aus. Der vollständige lokale Abnahmebefehl ist `./portal test`. Die CI verlangt zusätzlich den separaten nativen Supabase-Nachweis. Verwende fiktive Daten und veröffentliche keine unbearbeiteten Traces, Zugangsdaten oder privaten Datenbank-/Dateisicherungen.

## Review-Regeln für `main`

Beiträge benötigen einen PR. Für gewöhnliche Beitragende muss mindestens eine andere berechtigte Person zustimmen. Eine eigene Zustimmung zählt nicht als unabhängige Review; neue Änderungen verwerfen alte Zustimmungen. Die Zustimmung zum letzten Push muss von einer anderen Person als der zuletzt pushenden kommen. Löse offene Review-Gespräche vor dem Merge und beantworte Rückfragen mit Bezug auf den aktuellen Code.

`CarinaSchoppe` erhält eine gezielt auf ihr Konto begrenzte Ausnahme. Sie kann die Reviewpflicht beim Merge eines PRs umgehen. GitHub ordnet diese Ausnahme der **handelnden Person** zu: Sie hängt nicht vom PR-Autor ab und gilt nicht automatisch für andere Administratoren oder Personen mit Schreibrechten. Direkte menschliche Pushes nach `main` bleiben untersagt.

Die Ausnahme hebt folgende Pflichtprüfungen nicht auf:

- `verify`: gemeinsamer vollständiger Anwendungs-/Datenbank-/API-/Browser-/PWA- und Wartungstest.
- `Actual isolated selfhost image compatibility`: tatsächliche Supabase-Laufzeit und Übernahme bestehender Testdaten.
- `PR metadata`: vorgeschriebene Typ-, Bereichs- und Risikolabels.

Ein grüner einzelner Job genügt nicht. Verwende den exakt geprüften aktuellen PR-Stand. Der Branch muss gegenüber `main` aktuell sein: Wenn `main` zwischenzeitlich fortgeschritten ist, übernimm die Änderungen und lasse die Kombination erneut prüfen. Ausstehende, fehlgeschlagene oder veraltete Nachweise werden geklärt, statt die allgemeinen Regeln abzuschalten.

Für die bereits vorhandene signierte GitHub-Actions-Wartung gibt es eine separate technische Ausnahme: Sie prüft Kandidaten einschließlich tatsächlicher Datenübernahme vor einer direkten Promotion auf `main`. Anschließend fordert sie die vollständige CI für genau den neuen Commit an; erst nach deren Erfolg kann ein Entwicklungspaket erscheinen. Dieser Botpfad ist kein beitragsberechtigtes Konto und keine Freigabe für andere Apps. Die eigenständigen Signatur-, Force-Push- und Löschregeln bleiben erhalten.

## Merge und Veröffentlichung

Wenn Beschreibung, Labels, Tests, offene Gespräche und erforderliche Review passen, kann ein berechtigter Maintainer mergen. Für `CarinaSchoppe` entfällt nur die externe Review. Die UI kann dafür eine ausdrückliche Bypass-Aktion verlangen; prüfe dabei, dass ausschließlich die Review-Regel betroffen ist.

Ein Merge kann den vorhandenen Entwicklungsrelease-Prozess anstoßen. Seine unveränderlichen `cms-dev-*`-Pakete und die gehosteten Migrationsprüfungen bleiben davon getrennt. Produktionsbetrieb, echte Daten, SMTP, DNS und riskante Wartung benötigen die vorgesehenen gesonderten Freigaben. Behaupte eine gehostete Installation nur mit tatsächlichem Betriebsnachweis.

Die signierten annotierten `milestone/*`-Tags markieren geprüfte historische Entwicklungsstände. Sie sind keine PR-Labels und keine Zusage einer Semver- oder Produktionsversion. Verschiebe bestehende Tags nicht und erstelle Tags nur auf dem tatsächlich beabsichtigten Commit.

Nach dem Merge ergänze bei Bedarf den Issue-Abschluss und dokumentiere verbleibende Aufgaben separat. Eine neue Aufgabe darf die ursprünglichen Abnahmekriterien nicht stillschweigend erweitern oder als bereits erledigt erscheinen lassen.
