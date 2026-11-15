# GitHub-Verwaltung und Beitragsablauf

Für Beitragende beginnt der Ablauf bei [CONTRIBUTING](../CONTRIBUTING.md), dem [Issue-Leitfaden](ISSUE_GUIDE.md) und dem [PR-Leitfaden](PULL_REQUEST_GUIDE.md). Diese Seite erklärt die administrativen Quellen und die Grenzen der Ausnahmen.

## Regeln für `main`

Die drei JSON-Dateien unter `.github/rulesets/` enthalten die beabsichtigte aktive Konfiguration. Eine Änderung an diesen Dateien ändert GitHub noch nicht: Eine berechtigte Person muss sie über die Verwaltungs-API anwenden und danach wieder auslesen. Der aktuelle Serverzustand steht auf der [Regelseite des Repositorys](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules).

| Regel                         | Quelle                                           | Wirkung                                                                                                                                           |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main history and integrity    | [history.json](../.github/rulesets/history.json) | Behält Signatur-, Force-Push-, Lösch-, vorhandene Deployment- und Codequalitätsregeln bei; keine Bypass-Akteure.                                  |
| Main pull requests and review | [review.json](../.github/rulesets/review.json)   | PR, eine unabhängige Zustimmung, Verwerfen veralteter Zustimmungen, Prüfung des letzten Pushs und gelöste Gespräche.                              |
| Main verified checks          | [checks.json](../.github/rulesets/checks.json)   | `verify`, `Actual isolated selfhost image compatibility` und `PR metadata`; aktueller Hauptzweig als Basis, erwartete GitHub-Actions-App `15368`. |

Die Review-Ausnahme ist auf **User-ID `29256704`, `CarinaSchoppe`**, begrenzt und gilt ausschließlich beim Merge eines PRs. Sie ist unabhängig vom PR-Autor und gewährt keine Ausnahme von der CI. Allgemeine Admin-, Maintainer- oder Schreibrollen stehen nicht mehr auf der Bypass-Liste.

Die bestehende tägliche Wartung benötigt eine gesonderte technische Ausnahme für **User-ID `41898282`, `github-actions[bot]`** bei PR- und CI-Regeln. Sie erstellt nach wirklichen Kandidatenprüfungen einen neuen signierten Commit direkt auf `main`; erst danach existiert dessen SHA für die nochmals angeforderte exakte Main-CI. Die Veröffentlichung wartet weiterhin auf Anwendungstest und native Supabase-Prüfung. Signaturen und Schutz der Historie bleiben ohne Ausnahme.

Diese Bot-Ausnahme ist technisch an das Botkonto gebunden, **nicht an eine einzelne Workflow-Datei**. Deshalb gehören Änderungen an Workflows und Schreibberechtigungen in die Codeprüfung. Fork-PRs erhalten im neuen Metadatenjob nur Lesezugriff, keine Secrets und keine Schreiboperationen. Es wird weder ein persönliches Token hinterlegt noch eine allgemeine Ausnahme für andere Personen oder Apps eingerichtet.

GitHubs API akzeptiert hier direkte `User`-Akteure mit Version `2026-03-10`. Die allgemeine App-ID von GitHub Actions wurde als Bypass-Akteur vom Server abgelehnt; die separat geprüfte Botidentität ersetzt sie. Die App-ID bleibt für die Herkunft der Pflichtchecks korrekt. Grundlagen: [Rules-API](https://docs.github.com/en/rest/repos/rules?apiVersion=2026-03-10), [Rulesets verwalten](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository).

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
