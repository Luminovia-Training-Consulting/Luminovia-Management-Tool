# Pull Requests erstellen, prüfen und mergen

> Stand 16. November 2026: Maintainer und Administratoren haben eine dauerhafte `always`-Ausnahme zum direkten Merge. Die zusätzlichen Review-/Checkpflichten für gewöhnliche Beitragende bleiben bis zum nachgewiesenen Wartungs-App-Pfad deaktiviert vorbereitet. [Aktueller Aktivierungsstand](GITHUB_WORKFLOW.md#aktivierung-noch-ausstehend).

Dieser Leitfaden beschreibt die Abnahme einer Änderung. Einrichtung und lokale Entwicklung stehen in [CONTRIBUTING](../CONTRIBUTING.md) und [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md); Meldungen beginnen mit dem [Issue-Leitfaden](ISSUE_GUIDE.md).

Die Beitragsunterlagen wurden mit [PR #6](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/6) (`18ce633`) geliefert, der getrennte lokale GitHub-Vorschaustarter mit [PR #7](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/7) (`5f89986`). Diese Merges aktivieren die oben genannten noch offenen serverseitigen Reviewregeln nicht. Der Quellenkatalog [labels.json](../.github/labels.json) enthält inzwischen 30 verwaltete Labels; neun ursprüngliche GitHub-Labels bleiben zusätzlich erhalten.

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

Wähle alle tatsächlich wesentlich betroffenen Bereiche. Die ursprünglichen Bereichslabels bleiben erhalten: `area:frontend`, `area:backend`, `area:database`, `area:auth`, `area:files`, `area:finance`, `area:courses`, `area:devops` und `area:github`. Zehn weitere Bereiche ergänzen die Einordnung:

| Bereich              | Verwendung                                               |
| -------------------- | -------------------------------------------------------- |
| `area:chat`          | Nachrichten, Kurs-/Interessengruppen und Realtime        |
| `area:knowledge`     | Wiki, Forum und Wissensverwaltung                        |
| `area:calendar`      | Termine, Verfügbarkeit, Sperrzeiten und Zeitzonen        |
| `area:notifications` | Posteingang, Meldungen und Zustellpräferenzen            |
| `area:profiles`      | Profile, Qualifikationen und Dozierendenverzeichnis      |
| `area:clients`       | Auftraggeberkonten, Organisationen und Geschäftskontakte |
| `area:pwa`           | Installation, Service Worker, Offlinezustand und Updates |
| `area:testing`       | QA, Regressionen, Browser- und Berechtigungsprüfungen    |
| `area:docs`          | Anleitungen, API-Referenzen und Betriebsdokumentation    |
| `area:taxonomy`      | Themen, Werkzeuge, Programmiersprachen und Hierarchien   |

Eine Dokumentationsänderung erhält `area:docs` und gegebenenfalls den dokumentierten Fachbereich; allgemeine Beitragsregeln zusätzlich `area:github`. Ein Test allein erfordert nicht jedes vom Gesamtsystem verwendete Label. Umgekehrt braucht eine Funktionsänderung mit Migration die tatsächlich betroffenen Fach- und Technikbereiche. Die 30 verwalteten Labels ergeben sich aus acht Typen, 19 Bereichen und drei Risikostufen; zusätzliche ursprüngliche GitHub-Labels ersetzen keine Pflichtkategorie.

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

Für einen unabhängigen Test des aktuellen Hauptzweigs gibt es `./portal github test`. `./portal github` startet stattdessen eine eigene persistente Vorschau auf `5373`/`563xx`; sie verändert weder die normale Entwicklung noch den PR-Branch. Eine erfolgreiche Prüfung von `main` beweist nicht die Abnahme eines abweichenden PR-Heads. [Vorschau, Datenhaltung und Migrationsplan](GITHUB_LOCAL_PREVIEW.md).

## Review-Regeln für `main`

Beiträge benötigen einen PR. Für gewöhnliche Beitragende muss mindestens eine andere berechtigte Person zustimmen. Eine eigene Zustimmung zählt nicht als unabhängige Review; neue Änderungen verwerfen alte Zustimmungen. Die Zustimmung zum letzten Push muss von einer anderen Person als der zuletzt pushenden kommen. Löse offene Review-Gespräche vor dem Merge und beantworte Rückfragen mit Bezug auf den aktuellen Code.

Maintainer und Administratoren erhalten eine dauerhafte Rollen-Ausnahme (`always`) und können jederzeit direkt mergen, auch bei ausstehenden Reviews oder Checks. Die frühere persönliche PR-only-Ausnahme ist ersetzt. Die Ausnahme folgt der handelnden Person, nicht dem PR-Autor; gewöhnliche Schreibrechte allein reichen nicht. GitHub kann im Merge-Dialog eine ausdrückliche Bypass-Aktion verlangen.

Die Prüfungen laufen weiterhin und liefern nachvollziehbare Ergebnisse:

- `Build`, `Typecheck`, `Lint`, `Formatting` und `Code quality` prüfen Kompilierung, Regeln, Stil und tatsächliche Quellverbindungen.
- `Tests and coverage` führt Unit-/Komponententests mit ehrlicher vollständiger Frontend-Erfassung und Mindestwerten aus.
- `verify` führt die vollständigen realen Anwendungs-/SQL-/API-/Browser-/PWA-/Wartungstests aus; `Actual isolated selfhost image compatibility` prüft echte Laufzeit und Datenübernahme.
- `PR metadata` prüft Pflichtlabels; CodeQL analysiert Sicherheitsmuster. Details: [CI_QUALITY](CI_QUALITY.md).
- `PR preview package` liefert nach vollständiger Anwendungs- und nativer Abnahme ein herunterladbares, lokal startbares Quellpaket. Der getrennte vertrauenswürdige Publisher verknüpft es mit einem temporären GitHub-Deployment; der Link führt zum Artefakt, nicht zu einer gehosteten Website. [Vorschau und Aktivierungsgrenze](PR_PREVIEWS.md).

Ein Maintainer kann einen Merge bewusst vorziehen. Das macht fehlgeschlagene Tests nicht grün und veröffentlicht kein ungeprüftes Entwicklungsupdate: Der Releasejob wartet auf alle ausdrücklich in `ci.yml` definierten Gates; der zusätzliche Security-Workflow läuft getrennt. Für andere Beitragende bleiben unabhängige Review und grüne, aktuelle Tests der vorgesehene Ablauf. Die zusätzlichen serverseitigen PR-/Checkregeln bleiben bis zur bewiesenen Wartungs-App-Anbindung deaktiviert; [aktueller Zustand](GITHUB_WORKFLOW.md#aktivierung-noch-ausstehend).

## Merge und Veröffentlichung

Maintainer und Administratoren können jederzeit selbst mergen und die konfigurierte `always`-Ausnahme ausdrücklich verwenden. Im normalen Ablauf prüfen sie Beschreibung, Labels, Tests und offene Gespräche vorab. Ein vorgezogener Merge bleibt eine bewusste Entscheidung; fehlgeschlagene CI oder ausstehende Betriebsfreigaben werden dadurch nicht als bestanden bezeichnet.

Ein Merge kann den vorhandenen Entwicklungsrelease-Prozess anstoßen. Seine unveränderlichen `cms-dev-*`-Pakete und die gehosteten Migrationsprüfungen bleiben davon getrennt. Produktionsbetrieb, echte Daten, SMTP, DNS und riskante Wartung benötigen die vorgesehenen gesonderten Freigaben. Behaupte eine gehostete Installation nur mit tatsächlichem Betriebsnachweis.

Die signierten annotierten `milestone/*`-Tags markieren geprüfte historische Entwicklungsstände. Sie sind keine PR-Labels und keine Zusage einer Semver- oder Produktionsversion. Verschiebe bestehende Tags nicht und erstelle Tags nur auf dem tatsächlich beabsichtigten Commit.

Nach dem Merge ergänze bei Bedarf den Issue-Abschluss und dokumentiere verbleibende Aufgaben separat. Eine neue Aufgabe darf die ursprünglichen Abnahmekriterien nicht stillschweigend erweitern oder als bereits erledigt erscheinen lassen.
