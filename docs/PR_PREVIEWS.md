# PR-Prüfungen und lokale Vorschaupakete

Jeder Pull Request erhält die vorhandenen Build-, TypeScript-, Stil-, Coverage-, Sicherheits-, Anwendungs- und nativen Selfhost-Prüfungen. Das gilt auch für Forks und Dependabot. GitHubs Zustimmung für erstmalige externe Workflow-Läufe kann weiterhin erforderlich sein. Fehlende Pflichtlabels lassen `PR metadata` weiterhin fehlschlagen; ein Vorschaupaket ersetzt weder diese Einordnung noch die getrennte Security-Analyse.

Der neue Job `PR preview package` wartet auf alle fünf Qualitätsaufgaben, Coverage, `verify` und `Actual isolated selfhost image compatibility`. Erst dann erstellt er ein herunterladbares Paket des tatsächlich geprüften Commitstands. Sein eigenes frisches Checkout enthält keine Zugangsdaten oder Berichte aus dem vorherigen Testlauf. Das Paket enthält:

- `portal-source.tar.gz`: ausschließlich versionierte Anwendungsquellen einschließlich Migrationen und des lokalen Starters.
- `manifest.json`: PR-Head, geprüfter Merge-Commit, Workflow-Lauf und Versuch sowie SHA-256 des Quellarchivs.
- `README.txt`: deutsche/englische Startanleitung und Voraussetzungen.
- `preview.mjs`: Einstieg in eine eigene, datenhaltende lokale PR-Laufzeit.

## Paket ausprobieren

Den Link im Summary des `PR preview package`-Jobs oder im GitHub-Deployment `pr-<Nummer>-local-preview` öffnen. Der Link führt zu einem GitHub-Actions-Artefakt; zum Herunterladen ist normalerweise eine GitHub-Anmeldung erforderlich. Es ist ausdrücklich **keine im Internet gehostete Portalinstanz**. GitHub bewahrt das Paket sieben Tage auf, sofern es nicht früher gelöscht wird.

Quellcode eines externen Beitrags vor dem lokalen Ausführen prüfen. Er wird auf dem eigenen Rechner ausgeführt, einschließlich Paketinstallation und Entwicklungswerkzeugen. Das Artefakt in ein neues, eigenes Verzeichnis entpacken. In diesem Verzeichnis:

```bash
tar -xzf portal-source.tar.gz
node preview.mjs start
node preview.mjs credentials
```

Benötigt werden Linux, Node.js mindestens22.12, npm, Docker Engine und Docker Compose mindestens2.20.2. Die Vorschauports5473/573xx müssen frei sein; der Starter beendet keine fremden Prozesse. Diese Ports unterscheiden sich von normaler Entwicklung, vollständigen Tests und der neuesten Main-Vorschau. Die übrigen Voraussetzungen stehen in [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md).

Den Wrapper verwenden; `./portal start` im entpackten kanonischen Quellverzeichnis würde dessen unveränderte normale Entwicklungsidentität verwenden. Der Wrapper bestätigt Archiv- und Konfigurationsprüfsumme, erstellt eine eigene private Kopie unter `.preview/source` und ändert ausschließlich deren Projekt-ID, Auth-URLs und Ports. Die Projekt-ID enthält PR-Nummer sowie einen Hash des geprüften Quellstands und Paketpfads; dadurch bleiben auch die Datenbank-/Storage-Volumes von einer gestoppten normalen Entwicklung getrennt. Das unveränderte Archiv und seine kanonischen Quellen dienen weiter als Referenz. Veränderte Projektkonfigurationen, fremde Verzeichnisse und verlinkter privater Laufzeitzustand werden verweigert.

Die eigene Laufzeit installiert die gesperrten Abhängigkeiten, startet die vollständige lokale Anwendung einschließlich Supabase und Mailpit und legt bei einer leeren ersten Umgebung fiktive Konten an. Das Portal öffnet sich unter <http://127.0.0.1:5473>; API und Mailpit liegen auf57321/57324. Die generierten Zugangsdaten entstehen ausschließlich lokal; echte E-Mails werden lokal abgefangen. Vorhandene Entwicklungsverzeichnisse nicht mit diesem Paket überschreiben.

```bash
node preview.mjs stop
```

Dieser Befehl stoppt die eigene Vorschau und erhält ihre lokalen Daten. `node preview.mjs status` prüft diese Laufzeit; `node preview.mjs prepare` erzeugt und prüft ausschließlich die eigene Quellkopie, ohne einen Dienst zu starten. Ein erfolgreicher Paketbau beweist nicht, dass die Vorschau auf jedem fremden Rechner bereits gestartet wurde.

## GitHub-Deployments und Berechtigungen

Der Workflow [pr-previews.yml](../.github/workflows/pr-previews.yml) führt ausschließlich den Publisher vom vertrauenswürdigen Standardzweig aus. Er hat `deployments: write` und ausschließlich Leserechte auf Quellen, Actions und PR-Metadaten. Er installiert keine Pakete, lädt keine Artefakte herunter, führt keinen PR-Code aus und erhält keine Hosting-Secrets. Auch das `pull_request_target`-Ereignis wird ausschließlich für die Metadatenbereinigung eines geschlossenen PRs verwendet.

Der Publisher bestätigt Repository, tatsächlichen Workflowpfad, PR-Head, aktuellen Workflow-Versuch und alle erwarteten erfolgreichen Jobs erneut über GitHubs API. Er liest lediglich Metadaten des eindeutig benannten, nicht abgelaufenen Artefakts einschließlich dessen von GitHub ermitteltem Digest. Ein neuerer Lauf oder ein veränderter/geschlossener PR darf kein altes Ergebnis als aktuell veröffentlichen. Fork-Payloads ohne direkte PR-Verknüpfung werden über die zugehörige Commit-API aufgelöst. Freie PR-Texte werden weder als Befehle noch als URLs verwendet.

Das Deployment ist als temporär und nicht produktiv markiert. Während der Prüfung steht es auf `in_progress`, bei fehlgeschlagenen Prüfungen auf `failure`. `success` bedeutet hier ausdrücklich **„lokales Vorschaupaket herunterladbar“**; der angegebene Link führt zum tatsächlichen Artefakt. Ein geschlossener PR oder eine neuere Vorschau deaktiviert ältere Datensätze. Ein täglicher Metadatenlauf deaktiviert abgelaufene, gelöschte oder inzwischen überholte Pakete. Andere Deploymentaufgaben und Produktionsumgebungen werden nicht verändert.

Der neue vertrauenswürdige Publisher wird durch `workflow_run` erst aktiv, wenn seine Workflow- und Skriptdateien auf dem Standardzweig liegen. Der PR, der ihn erstmals einführt, kann bereits sein Paket bauen. Seine erstmalige Deploymentveröffentlichung kann eine berechtigte Person nach Quellenprüfung einmalig mit demselben getesteten Metadatenpublisher gegen den tatsächlich vollständig erfolgreichen PR-Lauf ausführen. Dazu braucht der Prozess `GITHUB_REPOSITORY`, `GITHUB_EVENT_NAME=workflow_run`, einen privaten Ereignispfad mit der echten Lauf-ID und Versuchsnummer sowie ein im Prozessspeicher übergebenes `GH_TOKEN`; der Publisher bestätigt alle Daten erneut über die API. Er erhält dabei keinen Artefaktinhalt und führt keinen Beitragscode aus. Das ist eine gesondert nachzuweisende Erstveröffentlichung, keine vorgezogene Aktivierung des automatischen Standardzweig-Workflows. Ohne diesen tatsächlichen Schritt oder einen späteren automatischen Lauf dürfen lokale Tests oder gültige YAML-Dateien nicht als erfolgte Remote-Veröffentlichung beschrieben werden.

## Gehostete Vorschauen und bestehende Releases

Die vorhandene Entwicklungsinstallation `cms.luminovia.org` bleibt eine eigene, datenhaltende Umgebung für erfolgreich geprüftes `main`. Sie wird nicht für ungemergte Beiträge wiederverwendet. Der bestehende Releasejob und die unabhängigen Security- und Metadatenprüfungen bleiben erhalten; das lokale PR-Paket erhält weder produktive Schlüssel noch Zugriff auf diese Daten.

Ein dauerhaft per Browser erreichbares Portal je PR benötigt einen eigens konfigurierten Vorschauhost samt getrennter Auth-, Datenbank-, Storage- und E-Mail-Umgebung sowie geregelter Bereinigung. Eine statische Frontendkopie mit einem erfundenen Backend würde den Login und die Geschäftsabläufe nicht erfüllen. Dieser Stand registriert keinen solchen Dienst und behauptet keine öffentliche PR-URL.

Grundlagen: [GitHub-Deployment-API](https://docs.github.com/en/rest/deployments/deployments), [Deploymentstatus](https://docs.github.com/en/rest/deployments/statuses) und [Sicherheitsgrenzen privilegierter Workflows](https://docs.github.com/en/actions/reference/security/secure-use).
