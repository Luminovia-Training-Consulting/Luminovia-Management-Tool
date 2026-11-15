# Issues sinnvoll erstellen und bearbeiten

Ein gutes Issue beschreibt ein nachvollziehbares Problem oder ein überprüfbares Ziel. Nutze die [Issue-Auswahl auf GitHub](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose). Deutsch und Englisch sind willkommen. Der allgemeine Arbeitsablauf steht in [CONTRIBUTING](../CONTRIBUTING.md).

## Vor dem Erstellen

Suche nach offenen und geschlossenen Issues sowie laufenden Pull Requests. Prüfe bei einem vermeintlich fehlenden Produktmerkmal den [aktuellen Entwicklungsplan](IMPLEMENTATION_PLAN.md). Eine dort offene Funktion darf als Vorschlag präzisiert werden; sie ist kein bereits gelieferter, fehlerhafter Ablauf.

Ein Issue behandelt ein zusammenhängendes Problem. Mehrere unabhängige Fehler erhalten getrennte Issues, damit Reproduktion, Tests und Abschluss eindeutig bleiben.

## Fehler melden

Nutze die Fehlervorlage und ergänze:

- Eine kurze, konkrete Überschrift, etwa „Dateiliste zeigt ersetzte Version nach erneutem Öffnen nicht an“.
- Verwendeten Commit oder Entwicklungsrelease, Browser/Betriebssystem und die Rolle des betroffenen Testkontos.
- Die kleinste reproduzierbare Schrittfolge mit fiktiven Daten.
- Erwartetes und tatsächlich beobachtetes Verhalten, einschließlich genauer Fehlermeldung.
- Auswirkungen und Häufigkeit; bei Terminproblemen auch Datum, Uhrzeit und IANA-Zeitzone.
- Bei Bedarf bereinigte Screenshots oder relevante Logzeilen.

Bei Startproblemen gehören der ausgeführte Befehl, Node-/Docker-Version und die sichtbare Fehlermeldung dazu. Die [lokale Anleitung](LOCAL_DEVELOPMENT.md) erklärt Dienste, Ports und Persistenz. Lösche zur Reproduktion keine benötigten Volumes und setze keine normale Datenbank zurück.

Entferne Tokens, Passwörter, Auth-Callback-URLs, QR-Codes, personenbezogene Daten und private Dokumentinhalte aus allen Anlagen. Lade keine unbearbeiteten `.local`-Verzeichnisse, Playwright-Traces, HAR-Dateien oder Datenbanksicherungen hoch. Auch scheinbar hilfreiche Netzwerkprotokolle können Sitzungen und private Antworten enthalten.

## Funktionen und Verbesserungen vorschlagen

Beschreibe zuerst, wer welches Problem hat und was heute fehlt. Ergänze den gewünschten Ablauf und überprüfbare Abnahmekriterien. Nenne betroffene Rollen, Ansichten und Berechtigungen sowie mögliche Folgen für bestehende Daten.

Ein Beispiel für ein Abnahmekriterium: „Nach Entzug einer Kurszuordnung kann das bestehende Dozierendenkonto die zugehörigen privaten Dateien auch mit unveränderter Sitzung nicht mehr herunterladen.“ Ein bloßes „sicher und benutzerfreundlich“ ist nicht überprüfbar.

Technische Lösungsideen sind willkommen. Größere Schemaänderungen, zusätzliche Dienste und Änderungen an angenommenen finanziellen Vereinbarungen brauchen eine begründete Abstimmung, bevor sie implementiert werden.

## Fragen und Dokumentationslücken

Verwende die passende Vorlage für eine Frage oder eine Dokumentationsverbesserung. Verlinke die konkrete Seite und beschreibe, welche Information fehlt oder widersprüchlich ist. Codefragen sollten eine kleine bereinigte Referenz und das angestrebte Ergebnis enthalten.

## Sicherheitsprobleme melden

Veröffentliche vermutete Sicherheitslücken, Exploit-Schritte, entwendete Daten oder Zugangsdaten **nicht in einem öffentlichen Issue oder PR**. Das gilt besonders für Rechteumgehungen, private Dateien, Sitzungen und finanzielle Daten.

Für dieses Repository ist die private Schwachstellenmeldung auf GitHub aktiviert. Verwende [Report a vulnerability](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/security/advisories/new) im Security-Bereich. Der Meldeweg übergibt die Details vertraulich an die zuständigen Maintainer. Falls du keinen Zugriff auf das Formular hast, nutze einen bereits vereinbarten privaten Kontaktweg zu `CarinaSchoppe`; veröffentliche die technischen Details nicht ersatzweise als Issue.

Eine private Meldung sollte betroffenen Commit, minimale Reproduktion mit fiktiven Daten, erwartete Berechtigungsgrenze und Auswirkungen enthalten. Führe keine zusätzlichen Zugriffe auf reale Konten oder Daten durch, um den Befund zu erweitern.

## Triage und Labels

Maintainer prüfen die Meldung, fragen bei Bedarf nach und ergänzen Labels. Bestehende Labels wie `bug`, `documentation`, `question`, `duplicate`, `good first issue` und `help wanted` bleiben nutzbar. Für zugehörige PRs gelten die zusätzlich verpflichtenden [Typ-, Bereichs- und Risikolabels](PULL_REQUEST_GUIDE.md#labels-für-pull-requests).

Du benötigst keine Labelrechte, um ein Issue zu erstellen. Nenne den vermuteten Bereich im Text. Nutze `good first issue` und `help wanted` zur Suche nach geeigneten Aufgaben; ein Label ist keine automatische Zusage über Umfang oder Reviewdauer.

## Von der Meldung zur Korrektur

1. Das Problem wird reproduziert und der gewünschte Zustand geklärt.
2. Eine Person übernimmt die Änderung und verlinkt das Issue in ihrem PR.
3. Die Korrektur erhält angemessene Tests und aktualisierte Dokumentation.
4. Nach bestandenen Prüfungen und erforderlicher Review wird der PR gemergt. `Closes #123` schließt das verlinkte Issue automatisch.

Ein geschlossenes Issue bedeutet, dass sein vereinbartes Ziel abgeschlossen wurde. Es belegt keine Produktionsinstallation. Bei einer Regression ergänze einen neuen reproduzierbaren Befund mit Verweis auf das frühere Issue.
