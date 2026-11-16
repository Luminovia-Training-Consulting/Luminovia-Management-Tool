# GitHub-Verwaltung und Beitragsablauf

Für Beitragende beginnt der Ablauf bei [CONTRIBUTING](../CONTRIBUTING.md), dem [Issue-Leitfaden](ISSUE_GUIDE.md) und dem [PR-Leitfaden](PULL_REQUEST_GUIDE.md). Diese Seite erklärt die administrativen Quellen und die Grenzen der Ausnahmen.

## Regeln für `main`

Die drei JSON-Dateien unter `.github/rulesets/` enthalten die geprüfte Quellkonfiguration. Historie ist aktiv. Die Review-/Checkdateien beschreiben nach bestandenem Appnachweis den aktivierbaren Zielstand `active`; der tatsächliche Serverzustand bleibt bis zur unten beschriebenen Anwendung getrennt. Eine Änderung an diesen Dateien ändert GitHub noch nicht: Eine berechtigte Person muss sie über die Verwaltungs-API anwenden und danach wieder auslesen. Der aktuelle Serverzustand steht auf der [Regelseite des Repositorys](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules).

| Regel                         | Quelle                                           | Wirkung                                                                                                                                           |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main history and integrity    | [history.json](../.github/rulesets/history.json) | Behält Signatur-, Force-Push-, Lösch-, vorhandene Deployment- und Codequalitätsregeln bei; keine Bypass-Akteure.                                  |
| Main pull requests and review | [review.json](../.github/rulesets/review.json)   | PR, eine unabhängige Zustimmung, Verwerfen veralteter Zustimmungen, Prüfung des letzten Pushs und gelöste Gespräche.                              |
| Main verified checks          | [checks.json](../.github/rulesets/checks.json)   | `verify`, `Actual isolated selfhost image compatibility` und `PR metadata`; aktueller Hauptzweig als Basis, erwartete GitHub-Actions-App `15368`. |

Die Review-Ausnahme ist auf **User-ID `29256704`, `CarinaSchoppe`**, begrenzt und gilt ausschließlich beim Merge eines PRs. Sie ist unabhängig vom PR-Autor und gewährt keine Ausnahme von der CI. Allgemeine Admin-, Maintainer- oder Schreibrollen stehen nicht mehr auf der Bypass-Liste.

## Auto-Merge

Die Repository-Einstellung `allow_auto_merge` ist aktiviert. Auto-Merge wird pro geeignetem PR eingeschaltet und bleibt an die aktiven Pflichtchecks und Reviewregeln gebunden; eine vorhandene Schaltfläche ist keine Freigabe ungeprüfter Änderungen. Für andere Beitragende bleibt die unabhängige Zustimmung erforderlich, Carinas persönliche Ausnahme gilt nur für Reviews über PRs.

Solange die neue Live-Checkregel noch deaktiviert ist, wird PR10 ausdrücklich erst nach beiden erfolgreichen exakten Prüfungen gemergt. Nach Aktivierung kann der dokumentierte Ablauf `gh pr merge --auto --merge --match-head-commit <SHA>` für den geprüften PR verwenden. Die Wartungs-App behält ausschließlich ihre bereits genehmigte technische Ausnahme; keine zusätzlichen Apprechte wurden dafür eingerichtet.

## Tatsächlich bestandener Appnachweis

Der begrenzte App-Token hat einen echten temporären Probezweig trotz erforderlicher unabhängiger Zustimmung und absichtlich fehlendem Pflichtcheck geschrieben. Eine zusätzliche Signaturregel hatte **keinen** Bypass; GitHub bestätigte den erzeugten Commit `003a597c90b98c964df25aa8f5d148bf7b2d233e` als `verified: true`, `reason: valid`. Derselbe direkte Schreibversuch mit Carinas normaler Identität wurde durch PR- und Checkpflicht abgewiesen: Die persönliche Ausnahme gilt nur über PRs. Der Hauptzweig blieb exakt `9c2103b`; temporäre Regeln, Zweige und Token wurden anschließend bereinigt. [Maschinenlesbarer Nachweis](maintenance-app-protected-probe.json).

Der Quellstand bereitet deshalb die Aktivierung vor. **Live-Aktivierung erfolgt erst nach erfolgreicher Prüfung und Merge des App-Workflows**, anschließendem tatsächlichem Workflow-Probelauf auf `main` und erneutem Auslesen der drei Regeln. Der erfolgreiche lokale App-Token-Probelauf allein ist noch keine Behauptung, dass der Main-Workflow oder die beiden Live-Regeln schon umgestellt wurden.

## Aktivierung noch ausstehend

Die neue Review- und Checkregel sind auf GitHub **deaktiviert vorbereitet** (IDs `27329000` und `27329142`). Die bisherige aktive Hauptzweig-Regel `27315671` bleibt bis zur Betriebsfreigabe unverändert. Deshalb sind diese Dateien und die beschriebenen menschlichen Merge-Regeln noch keine Behauptung einer wirksamen Aktivierung.

Die bestehende tägliche Wartung erstellt nach wirklichen Kandidatenprüfungen einen neuen signierten Commit direkt auf `main`; erst danach existiert dessen SHA für die nochmals angeforderte exakte Main-CI. Die Veröffentlichung wartet weiterhin auf Anwendungstest und native Supabase-Prüfung. Eine neue PR-/CI-Pflicht würde diese bestehende Automatik ohne passende Appidentität blockieren.

GitHub akzeptierte zwar die Bot-User-ID `41898282` in einer deaktivierten Konfiguration. Ein echter Test mit PR-Pflicht und absichtlich fehlendem Check auf ausschließlich temporären Signatur-Probezweigen bewies aber: Das normale `GITHUB_TOKEN` kann diese Regeln damit nicht umgehen. Der gescheiterte Lauf ist [43755067933](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43755067933). Die Testregel und alle Probezweige wurden anschließend entfernt; keine Hauptzweig-Regel wurde dafür abgeschaltet. Die allgemeine GitHub-Actions-App-ID `15368` wurde als Bypass-Akteur direkt abgelehnt; für die Herkunft der Pflichtchecks bleibt sie korrekt.

Die Nutzerin hat die Einrichtung jetzt ausdrücklich genehmigt und GitHubs erneute Sudo-Anmeldung bestätigt. Die private **Luminovia Portal Maintenance**-App wurde im Browser erstellt: Slug `luminovia-portal-maintenance`, App-ID **`5776881`**, nur Repository-`contents: write`, `actions: write` und obligatorisches `metadata: read`. Es wurden keine Organisations-, OAuth-, Webhook-, Administrations-, Workflowdatei- oder persönlichen Tokenrechte angefordert. Root hat anschließend die tatsächliche Installation **`182397724`** mit Auswahl **genau eines Repositorys `1458712437`** und den exakten drei Berechtigungen ausgelesen. API-JWT und aktiver Schlüssel wurden geprüft, das reine Prüftoken anschließend widerrufen. Das Environment `maintenance-signing` wurde mit ausschließlich `main`/Typ Branch eingerichtet; App-ID-Variable und verschlüsseltes Environmentsecret sind dort hinterlegt. Ein zunächst unbenutzter Schlüssel wurde nach ausdrücklicher Nutzerfreigabe widerrufen. Der oben dokumentierte geschützte App-Token-Probelauf ist inzwischen bestanden. Der tatsächliche Main-Workflow-Probelauf, aktive Live-Review-/Checkregeln und eine echte Wartungspromotion bleiben getrennte Nachweise.

Die vorbereiteten Ausnahmen sind exakt:

- Review `27329000`: User `29256704` ausschließlich `pull_request`, zusätzlich Integration `5776881` für geprüfte technische Wartung.
- Checks `27329142`: ausschließlich Integration `5776881`; Carina erhält keinen CI-Bypass. Die drei Pflichtchecks müssen weiterhin von GitHub Actions `15368` stammen.
- Historie `27315671`: unverändert aktiv, keine Ausnahme für Personen oder Apps. Signatur-, Force-Push- und Löschschutz bleiben erhalten.

Die Ausnahmedateien enthalten keinen Standardbot, keine allgemeine GitHub-Actions-App und keine Admin-/Schreibrolle. `always` bei der privaten Integration ist für deren geprüfte direkte Main-Promotion nötig; es erweitert nicht die Installation auf andere Repositorys. Die App selbst erhält keine Berechtigung zum Ändern ihrer Regeln oder zum Schreiben von Workflowdateien.

### Schlüsselgrenze und tatsächlicher Freigabeablauf

`MAINTENANCE_APP_ID=5776881` ist eine nicht geheime Variable des Environments `maintenance-signing` und wird über den `vars`-Kontext gelesen. Der private Schlüssel gehört **ausschließlich** als `MAINTENANCE_APP_PRIVATE_KEY` in das GitHub-Environment **`maintenance-signing`**. Dieses Environment muss serverseitig auf die einzelne **Branch `main`** eingeschränkt werden: benutzerdefinierte Branchpolicy, keine Tags und keine allgemeine Freigabe aller geschützten Branches. Kein Repository-/Organisationssecret als Ersatz; kein Schlüssel in Git, Arbeitsprotokollen, Artefakten oder Konsolenausgaben. Der Workflowjob prüft außerdem die exakte Repositoryidentität, `refs/heads/main`, App-ID und den vom offiziellen Token-Action ausgegebenen App-Slug.

Die offizielle [Create-App-Token-Action](https://github.com/actions/create-github-app-token) ist auf Commit `64ab729a6294000f5aa4a4bc0b73d1f32bc45510` gepinnt. Owner und Repository werden beide ausdrücklich gesetzt. Der Signaturtest fordert nur Contents-Schreibrecht; die Promotion zusätzlich Actions-Schreibrecht für die exakte CI. Das normale Jobtoken behält `contents: read`. Das Installationstoken bleibt nur in den jeweiligen Jobs und wird durch den unveränderten Standard-Postschritt automatisch widerrufen (`skip-token-revoke` wird nicht gesetzt). Kandidaten-/Kombinationstests erhalten keinen Appschlüssel und kein Appschreibtoken.

Der vorbereitete Workflow muss zunächst geprüft auf `main` ankommen, damit der Schlüssel nicht für einen ungeprüften Branchworkflow geöffnet werden muss. Danach:

1. Erledigte Einrichtungsgrenze bewahren: Installation182397724 enthält ausschließlich `Luminovia-Training-Consulting/Luminovia-Management-Tool`; Environment-Branchpolicy ist genau `main`/Typ Branch. Vor einem Lauf diese Grenzen ohne Ausgabe des Schlüssels erneut prüfen.
2. Den Main-Workflow mit `signature_probe_only=true` verwenden. Für den tatsächlichen Bypassnachweis gilt eine **temporäre** aktive Regel ausschließlich für `codex/maintenance-signature-probe-*`, mit PR-Pflicht und absichtlich fehlendem Check, dessen Ausnahme genau Integration `5776881` ist. Die App muss dort einen verifiziert signierten Commit mit exaktem Parent erzeugen und ihren neu erstellten Probezweig anschließend entfernen. Ohne diese aktive Testregel beweist grünes Signieren keinen Bypass.
3. Auch den Fehlerpfad prüfen: kein breites Branchlöschen, kein Main-Commit, kein erfundener Check. Testregel/Probezweige wieder vollständig entfernen. Die Privilegien reichen für Inhalte/Actions; Regeln verwaltet weiterhin die berechtigte Person, nicht die App.
4. Erst nach geprüftem Workflow, tatsächlichem Installations-/Signatur-/geschütztem Bypassnachweis und grünem exaktem PR-CI Review und Checks über die Verwaltungs-API aktivieren und die exakten Akteure erneut auslesen. Die lokale JSON-Vorbereitung allein aktiviert nichts.
5. Eine spätere echte Wartungspromotion bleibt gesonderte Betriebsabnahme: erlaubte Dateien, geprüfter Basis-SHA, signierter Parent, exakte Main-CI, unveränderliches Release und installierter Stand werden jeweils anhand ihrer echten Nachweise erfasst. App-Pushes können selbst Push-CI auslösen; der zusätzliche Dispatch bindet den exakten SHA, und die vorhandene Main-Concurrency fasst Doppelstarts zusammen.

Der [Wartungsablauf](../deploy/hostinger/maintenance/README.md) beschreibt unveränderte Kandidaten-/Restore-/Releasegrenzen. Eine geänderte Appberechtigung wird vor ihrer Erweiterung ausdrücklich geprüft und angefragt.

Grundlagen: [Rules-API](https://docs.github.com/en/rest/repos/rules?apiVersion=2026-03-10), [Rulesets verwalten](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository).

## Labels und Metadatenprüfung

[labels.json](../.github/labels.json) ist der gemeinsame Katalog für 30 verwaltete zusätzliche Labels und die lokale/CI-Prüfung. Die neun vorhandenen GitHub-Standardlabels bleiben erhalten. Genau ein `type:*`, genau ein `risk:*` und mindestens ein `area:*` sind für jeden PR erforderlich. Andere Labels dürfen hinzukommen; unbekannte Werte innerhalb dieser drei Kategorien werden abgelehnt. Der [PR-Leitfaden](PULL_REQUEST_GUIDE.md#labels-für-pull-requests) erklärt die Auswahl.

Der [Metadatenworkflow](../.github/workflows/pr-metadata.yml) reagiert auch auf Labeländerungen. Er liest die aktuellen Labels, prüft Repository, PR-Nummer und Commitidentität und behandelt Texte als Daten. Er installiert keine Abhängigkeiten und fordert ausschließlich `contents: read` und `pull-requests: read` an. Die acht Regressionstests werden durch `./portal test` automatisch entdeckt:

```bash
node --test scripts/runtime-pr-metadata.test.mjs scripts/runtime-documentation.test.mjs
```

Externe Autorinnen und Autoren können ihre vorgeschlagenen Labels in der Beschreibung nennen; ein Maintainer setzt sie. Fehlende Labels sollen nicht durch einen erfundenen grünen Status übergangen werden. Auch Workflowänderungen selbst müssen geprüft werden, da normale PR-Workflows ihren vorgeschlagenen Quellstand ausführen.

## Git-Tags und Entwicklungspakete

Labels ordnen Issues und PRs ein. Git-Tags markieren einen unveränderlichen Quellstand. Die folgenden signierten annotierten Tags benennen bereits gemergte Entwicklungsmeilensteine:

| Tag                                | Tatsächlicher Merge-Commit                 | Bedeutung                                                          |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `milestone/m3-accounts-commission` | `00db7c9630dbf413000feab7ec7e0c2f56cb5b3a` | Konten, Profile, Auftraggeber und Umsatzteilung; PR #3.            |
| `milestone/m4-cbw-templates`       | `b9cdcc89758451bc8258f3a9f173e95ee1a23736` | Bausteinvorlagen, Profilbilder und Kommentare; PR #4.              |
| `milestone/m5-system-audit`        | `bb322746d3cf18b1a0f1eae0eaa96450d26e26cd` | Systemprüfung und konkrete Funktions-/Leistungskorrekturen; PR #5. |

Diese Tags sind keine Produktionsfreigaben oder neuen Semver-Versionen. Sie verändern keine bestehenden `cms-dev-*`-Release-Tags. Die vorhandenen Workflows veröffentlichen Entwicklungspakete nach erfolgreicher Main-CI; ein Push dieser `milestone/*`-Tags löst keinen dieser Releasejobs aus. Verschiebe oder ersetze veröffentlichte Tags nicht.

## Öffentliche und private Meldungen

Fehler und Funktionswünsche beginnen über die [Issue-Auswahl](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose). Freie leere Issues sind zugunsten der Vorlagen deaktiviert. Das ist eine Einstellung der Auswahloberfläche, keine technische Zugriffssperre für die Issue-API.

GitHubs private Sicherheitsmeldungen sind aktiviert und über [SECURITY](../SECURITY.md) erreichbar. Das macht weder Secret-Scanning noch andere kostenpflichtige Dienste automatisch aktiv. Es wurden keine Personen eingeladen, keine Nachrichten versendet und keine Hosting- oder Produktionsänderungen vorgenommen.
