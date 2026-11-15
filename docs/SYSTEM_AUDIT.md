# Systemprüfung: Funktionen, Leistung und Fehlerpfade

Stand: 16. November 2026, Australia/Brisbane. Ausgangspunkt ist PR #4 / `b9cdcc8`. Dieser Bericht beschreibt geprüfte Verträge und konkrete Befunde. Die tatsächliche Gesamtabnahme steht in [QA_RESULTS](QA_RESULTS.md), der vollständige noch erforderliche Produktumfang in [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md).

## Umfang und nachvollziehbare Einstiegspunkte

Die Überprüfung umfasst die gelieferten Frontend-Fachmodule, Auth-/Daten-/Datei-/Realtime-Schnittstellen, alle Anwendungsmigrationen, lokale Prozessverwaltung, isolierten Teststarter und Release-/Proxy-Grenzen. Der Compiler-Inventarlauf erkennt aktuell **85 verbundene Frontendmodule, 25 Routen und 175 Laufzeitexporte**; er meldet keine unerreichbaren Module, ungenutzten Laufzeitexporte, fehlenden relativen Imports/statischen Assets oder ungültigen literalen Routen. Dynamisch berechnete Pfade benötigen weiterhin eigene fachliche Prüfungen.

Die bestehenden 17 Migrationen bleiben unverändert. Headless-APIs, CLI-/Test-Einstiege und die dokumentierte, unveränderte Supabase-Vendor-Referenz sind absichtliche Schnittstellen. Fehlende Browserimporte allein machen sie nicht zu totem Code. Die API-Prüfung bindet tatsächliche literale Frontend-Aufrufe an migrierte Funktionen und prüft Invoker-Grenze, RLS im öffentlichen/privaten Schema, anonyme Ausführungsrechte und leere privilegierte Suchpfade.

| Bereich | Zuständige Dateien | Neue Prüfung/Korrektur |
| --- | --- | --- |
| Kontoidentität | `app/app`, bestehender Auth-Provider | Direkter A→B-Wechsel leert auch den lokalen Shell-Suchentwurf; Tokenrefresh erhält ihn; öffentliche Auth-Callbacks bleiben stabil. |
| Sprache/Theme | `lib/preferences`, `lib/i18n`, `app/shell` | Gesperrter/voller Browser-Speicher verhindert weder Start noch Änderung; ungültige gespeicherte Themes folgen dem System. |
| Dateimetadaten | `features/files/api`, `document-attachment` | Actor-Schlüssel, gemeinsame Observer, Abbruchsignal, ehrlicher Ladezustand und ausgeblendete entzogene Daten. |
| Dateiversionen | `features/files/files` | Ersetzen invalidiert die Versionshistorie; Vorschau/Downloads verwenden die exakt geprüfte Version. |
| Profilbilder | `features/profile/avatar` | Unveränderliche Bytes werden bei Fokus nicht nochmals geladen; Auswahl und aktuelle Rechte werden separat geprüft. |
| Chat | `features/chat/thread`, `realtime` | Fehlgeschlagene Lesebestätigung bleibt wiederholbar; sichtbare/reconnectete Tabs und begrenzte Ereignisbündelung ohne verspätete alte Callbacks. |
| Datei-Gateway | `functions/files/validation` | Office-Makromarker werden direkt in vorhandenen Bytes gesucht, ohne vollständige ZIP-Zeichenkopien. |
| Termine/Claims | neue Migration `20261115180559_finite_schedule_intervals.sql` | Endliche Intervalle/Fristen am Datenbankrand; vollständiger Rollback statt unbegrenzter Buchung. |
| Lokale Prozesse | `scripts/runtime-lib`, `runtime-cli` | Timeout/Abbruch ist kein Erfolg; kontrollierte SIGTERM→SIGKILL-Eskalation und bestätigtes Cleanup. |

## Reproduzierte Fehler und Leistungsbefunde

Ein weiterer Test mit echter App-/Shell-/AuthProvider-Struktur zeigte: Ein direkter nativer Kontowechsel A→B leerte den Query-Cache, erhielt aber den Suchentwurf der Shell. Nur der geschützte Outlet wird jetzt nach Benutzer-ID neu aufgebaut. Drei neue Fälle prüfen außerdem erhaltene Entwürfe bei Tokenrefresh desselben Kontos und einen unverändert gemounteten öffentlichen Einladungs-/Recovery-Callback. Ein Blob-Leck wurde dadurch nicht nachgewiesen.

Die Regressionen wurden zuerst gegen das fehlerhafte Verhalten ausgeführt. Für Browser-Speicher scheiterten vier neue Fälle; zusätzlich bestätigten sieben vorher/nachher ausgeführte Logout-/Preference-Prüfungen den verbundenen UI-Vertrag. Ein fehlerhafter Test verwendete zunächst einen erfundenen Farbschema-Selektor; der Selektor wurde auf die tatsächlich vorhandene Beschriftung korrigiert.

Ein gemeinsames Listen-/Anhangsszenario machte **acht Metadatenabrufe in 20 Sekunden**, obwohl sich nichts änderte. Jetzt benötigt derselbe Komponentenversuch **zwei initiale Abrufe**, einschließlich geteilter Metadaten für doppelte Anhänge. Laufende Scans werden zunächst alle drei Sekunden geprüft. Ein seit zwei Minuten unveränderter Scan sowie abgeschlossene/leere/temporär fehlerhafte Zustände wechseln zu 60 Sekunden; explizit verbotene oder nicht mehr vorhandene Anhangsdaten stoppen den Intervallabruf. Fokus und Reconnect behalten die normale Revalidierung veralteter Daten; eigene Mutationen invalidieren sofort. Externe Umbenennungen können im ununterbrochen ruhenden Tab deshalb bis zu 60 Sekunden später erscheinen. Jeder Byteabruf prüft aktuelle Rechte am Server; diese Sicherheit wurde nicht durch längeres Caching ersetzt.

Der Browser-Gesamttest enthält zusätzlich eine echte 12-Sekunden-Beobachtung einer abgeschlossenen Dateiliste über den früheren Zehnsekundentakt hinweg, einschließlich DE/EN-/Theme-Wechsel ohne Dokument-Neuladen. Eine weitere Browserprüfung startet mit einem tatsächlich werfenden `localStorage`-Getter und prüft sichtbare, bedienbare DE/EN-/Dark-Mode-Eingaben und erhaltenen Formularentwurf. Diese Browserfälle sind bis zur Gesamtabnahme geplant, nicht allein durch die Komponentenfälle als bestanden erklärt.

Ein Fokuswechsel nach 31 Sekunden lud dieselben Profilbild-Bytes erneut. Der genaue Actor-/Ziel-/Versionsschlüssel hält diese unveränderlichen Bytes jetzt nur im Arbeitsspeicher; die Auswahl-/Berechtigungsquery revalidiert weiterhin. Entzug, Versionswechsel, Offlinezustand und Unmount verbergen beziehungsweise widerrufen Blob-URLs.

**20 Chat-INSERT-Hinweise lösten zuvor 40 sofortige Query-Invalidierungen aus.** Ein festes 150-ms-Fenster bündelt sie nun zu einer Nachrichten- und einer Raumaktualisierung. Das ist die gemessene Zahl von Invalidierungen, keine behauptete HTTP-Messung. Laufende Ereignisse verschieben die feste Frist nicht ständig. Mitgliedschaftsentzug entfernt Cache-Zeilen sofort und verwirft ausstehende/alte Refreshes. Realtime-Payloads werden nicht als autoritative Nachrichten in den Cache geschrieben.

Die bestehenden Chat-Fallbacks bleiben bei drei Sekunden für Räume, fünf für Mitglieder und zehn für Nachrichten. Geladene historische Seiten werden bei der Nachrichtenprüfung mit überprüft; die Zahl geladener Seiten wächst nur auf ausdrückliche Benutzeraktion. Diese Aktualitäts-/Revokationsfunktion wurde nicht entfernt. Größere Chat-Historien und zukünftige höhere Nutzerzahlen brauchen eine gesonderte Lastmessung; die aktuelle Änderung verspricht keinen konstanten Aufwand für beliebig große Historien.

Bei einer fiktiven **96-MiB-OOXML-Datei** wurden drei unabhängige lokale Deno-Prozesse pro Fassung gemessen: vorher **180–189 ms** und **546552–547292 KiB** maximaler Prozessspeicher, danach **52–54 ms** und **248900–249668 KiB**. Die neue Suche erhält Groß-/Kleinschreibungs-, MIME-, ZIP-Endmarker- und Makroablehnung. Dies misst die lokale Validierung, keinen vollständigen Upload und keinen gehosteten Gesamtdurchsatz. Die große synthetische Datei wurde entfernt.

## Endliche Kalenderdaten und sichere Migration

Nachgewiesen wurde ein tatsächlich bestätigter Auftrag aus `create_job` mit `ends_at: "infinity"`; die alte API legte eine unbegrenzte Zuweisung an. Auch ein eigener privater Termin erlaubte dies. PostgreSQL akzeptiert diese besonderen Zeitwerte, eine gültige Portalsitzung benötigt jedoch konkrete endliche Zeitpunkte.

Die neue 18. Migration ergänzt validierte CHECKs an `course_sessions`, `job_sessions`, `assignment_sessions`, `personal_events`, `global_events` und an der optionalen Auftragsfrist. Eine fehlende Frist bleibt `NULL`. Ungültige Altbestände stoppen die gesamte Migration atomar; keine angenommenen Termine, Honorare, Rollen oder IDs werden automatisch geändert.

Sechs echte temporäre PostgreSQL-Fälle prüfen den Rückbau des gesamten fehlerhaften Auftragsgraphen, private Inserts/Updates, beide unendlichen Fristen, gültige angrenzende Termine/akzeptierte Snapshots, alle fünf Schreibgrenzen und die atomare Migrationsablehnung bei ungültigen Altzeilen. Die reale HTTP-Suite prüft zusätzlich REST-Ablehnung mit `23514` und erhaltene frühere Ereignisinstants.

SHA-256: `6af0a55e86a352b1448bafc95378b7d3b72884b8a5551916cac261445ac7af92`.

## Prozesse und Tests

Ein Unterprozess konnte SIGTERM ignorieren und über den Timeout hinaus weiterlaufen. Ein anderer beendete sich nach Timeout mit Code 0 und wurde als Erfolg behandelt. Abbruch konnte den Timer vor echter Beendigung entfernen. Die gemeinsame Prozessfunktion wartet jetzt auf das tatsächliche Schließen, eskaliert nach begrenzter Gnadenfrist und erhält Timeout/Abbruch als Fehler. Tests prüfen echte, eindeutig eigene Kindprozesse mit einem zusätzlichen Backstop.

`stop` verlangt eine passende PID-/Session-/`stopped`-Bestätigung des Supervisors. Ein verschwundener Prozess oder ein expliziter Cleanupfehler ergibt keinen Erfolg. Runtime-Version 3 bewirkt beim nächsten normalen Start einen datenerhaltenden Supervisorwechsel. Die drei Stop-Fixtures verwenden ausschließlich temporäre Skripte und Fake-Docker; der echte Neustart wird zusätzlich durch den Gesamtbefehl geprüft.

Die neuen Tests werden automatisch durch `./portal test` entdeckt. Abgedeckt werden Quelle/Graph, Komponenten, Edge, echte PostgreSQL-Transaktionen, native Auth/MFA/REST/Storage/Realtime/ClamAV/Mailpit, Browser/axe und die gebaute PWA. Ein verfasster Test oder eine lokale synthetische Messung ersetzt kein vollständig bestandenes Protokoll.

## Betriebsgrenzen

Dieses Audit verändert weder den normalen Datenbestand noch Hosting, DNS, echte E-Mails oder Bankaufträge. Die M4-Operatorprüfung bleibt bestehen. Der [historische M4-Prüfer](REVIEWED_M4_MIGRATIONS.md) ist absichtlich auf 14→17 Quellen beschränkt und lehnt ein 18-Migrationen-Manifest ab; er ist kein Installer für diese neuere Fassung. Eine spätere gehostete Freigabe muss die vollständigen vier ausstehenden Quellen und die neue Vorbedingung endlicher Altdaten prüfen, Datenbank plus tatsächliche Objekte sichern und die echte Instanz separat abnehmen. Es gibt keinen neuen Apply-/Bypass-Pfad.

Physische PWA-Installation, andere Browser, manuelle Barrierefreiheit, gehostete gleichzeitige Großuploads/Last, echte SMTP-Zustellung, gesetzliche Aufbewahrung und vollständiger Restumfang des Master-Prompts bleiben eigene Freigaben. Die überprüften Datenflüsse sind damit genauer abgesichert; eine allgemeine Fehlerfreiheit aller möglichen Eingaben wird nicht behauptet.
