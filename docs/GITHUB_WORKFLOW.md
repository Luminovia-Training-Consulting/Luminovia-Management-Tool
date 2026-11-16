# GitHub-Verwaltung und Beitragsablauf

Für Beitragende beginnt der Ablauf bei [CONTRIBUTING](../CONTRIBUTING.md), dem [Issue-Leitfaden](ISSUE_GUIDE.md) und dem [PR-Leitfaden](PULL_REQUEST_GUIDE.md). Diese Seite erklärt die administrativen Quellen und die Grenzen der Ausnahmen.

## Regeln für `main`

Die JSON-Dateien unter `.github/rulesets/` spiegeln die tatsächlich ausgelesene Repository-Konfiguration. Dateien allein aktivieren keine Regel; maßgeblich bleiben die [Serverregeln](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules). Die aktuelle Anweisung ersetzt die frühere persönliche PR-only-Ausnahme: **Maintainer und Administratoren dürfen jederzeit direkt mergen und Regeln bei Bedarf übergehen.**

| Regel                         | Quelle                                           | Aktueller Zustand                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch Protection             | [history.json](../.github/rulesets/history.json) | Aktiv; Signaturen, kein Löschen/Force-Push, vorhandene Deployment-/Codequalitätsregeln. Bereits vorhandene `always`-Ausnahmen für Repository-Rollen `maintain` (ID2) und `admin` (ID5) bleiben erhalten. |
| Main pull requests and review | [review.json](../.github/rulesets/review.json)   | Weiter deaktiviert vorbereitet: PR, eine unabhängige Zustimmung, letzter Push und gelöste Gespräche. Beide Rollen erhalten `always` statt der alten persönlichen PR-only-Ausnahme.                       |
| Main verified checks          | [checks.json](../.github/rulesets/checks.json)   | Weiter deaktiviert vorbereitet: vollständige Anwendung, native Selfhost-Kompatibilität, Metadaten sowie die neuen Build-/Qualitäts-/Coverage-Checks; beide Rollen erhalten `always`.                     |

`always` gilt für die handelnde Person mit tatsächlicher Maintainer-/Adminrolle, unabhängig von PR-Autor, eigener Review oder noch laufenden/fehlgeschlagenen Checks. In GitHubs Oberfläche kann dafür eine ausdrückliche Bypass-Aktion nötig sein. Ein Maintainer-Merge startet die Prüfungen weiterhin; er macht sie nicht künstlich grün. Die automatische Veröffentlichung und VPS-Installation warten unverändert auf den erfolgreichen vollständigen `ci.yml`-Lauf; der separate Security-Workflow liefert zusätzliche Analyse und ist kein weiterer Release-Gate. Gewöhnliche Schreibrechte erhalten keinen solchen Bypass. Es wurden keine zusätzlichen Personen eingeladen oder Rollen vergeben.

## Aktivierung noch ausstehend

Die zusätzlichen Review-/Checkregeln (IDs27329000/27329142) bleiben bewusst deaktiviert. Ihr ungeprüftes Aktivieren würde die bestehende signierte tägliche Direktpromotion mit dem normalen `GITHUB_TOKEN` blockieren. Die tatsächliche Maintainer-/Admin-Ausnahme der aktiven Regel gilt bereits; die zusätzlichen Pflichten für andere Beitragende sind dadurch **noch nicht serverseitig erzwungen**.

Der frühere echte Test [43755067933](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43755067933) zeigte, dass eine Bot-User-Ausnahme die temporäre PR-/fehlender-Check-Regel für das Standardtoken nicht zuverlässig umgeht. Seine temporären Regeln/Zweige wurden entfernt. Die allgemeine GitHub-Actions-App15368 bleibt die geprüfte Herkunft der Statuschecks, nicht eine erfundene Bypass-Identität.

Bei der aktuellen Bestandsaufnahme existiert inzwischen die private App **Luminovia Portal Maintenance**, Integrations-ID5776881, mit einer `selected`-Installation182397724 und `contents/actions: write`. Die bisherige pauschale Aussage, es gebe noch keine App, ist überholt. Der genaue ausgewählte Repositoryumfang und eine funktionierende Installationstoken-Promotion wurden in dieser Aufgabe nicht nachgewiesen; die nötigen Repositoryvariablen/-Secrets und der App-Workflow sind auf aktuellem Main nicht als vollständig eingerichtet bestätigt.

Für spätere Aktivierung: bestehenden App-Auftrag koordinieren, tatsächlichen Repositoryumfang und kurzlebige Token prüfen, geschützten Signatur-/Promotiontest ausführen, App-Workflow und präzise App-Ausnahme gemeinsam übernehmen und erst danach zusätzliche Regeln aktivieren/auslesen. Maintainer-/Admin-`always` bleibt erhalten. Keine App, privaten Schlüssel oder Bezahlfunktion wurde für diese CI-Aufgabe neu registriert.

Die effektiven Main-Regeln und Repository-Rollen wurden über REST/GraphQL ausgelesen; die allgemeine Organisations-Regelauflistung war mit dem bestehenden Token nicht verfügbar. Die Konfiguration behauptet keine Änderung anderer Repositorys oder der Organisation.

Grundlagen: [Rulesets und Ausnahmen](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [Rules-API](https://docs.github.com/en/rest/repos/rules). Prüfungen und Coverage erklärt [CI_QUALITY](CI_QUALITY.md).

## Labels und Metadatenprüfung

[labels.json](../.github/labels.json) ist der gemeinsame Katalog für 20 zusätzliche Labels und die lokale/CI-Prüfung. Die neun vorhandenen GitHub-Standardlabels bleiben erhalten. Genau ein `type:*`, genau ein `risk:*` und mindestens ein `area:*` sind für jeden PR erforderlich. Andere Labels dürfen hinzukommen; unbekannte Werte innerhalb dieser drei Kategorien werden abgelehnt. Der [PR-Leitfaden](PULL_REQUEST_GUIDE.md#labels-für-pull-requests) erklärt die Auswahl.

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
