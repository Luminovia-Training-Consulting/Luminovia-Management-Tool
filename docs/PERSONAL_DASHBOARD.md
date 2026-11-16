# Persönliches Dashboard und Unterrichtstag

Die bestehenden Dashboard-Vorschaukarten können pro Konto ein- und ausgeblendet und mit beschrifteten Auf-/Ab-Schaltflächen sortiert werden. Die fünf gespeicherten Bereiche sind Unterrichtstag, Nachrichten/Meldungen, persönliche Vertragsbestätigungen, neue Dateien und Verwaltungsaufgaben. Rollen- und Ressourcenrechte bestimmen weiterhin, welche dieser Karten Daten laden dürfen. Begrüßung, Hauptnavigation, Finanzübersicht, Auftragsvorschläge und Kalender bleiben eigenständige Bereiche.

Die Auswahl liegt in `private.dashboard_preferences`. Die RPCs `dashboard_preferences` und `save_dashboard_preferences` verwenden ausschließlich die aktuelle aktive Kontoidentität. Es gibt keinen Administratorzugriff auf fremde Auswahlen, keine Browser-IDs zur Autorisierung und keine direkten Tabellenzugriffe. Eine Versionsnummer verhindert, dass zwei Geräte sich still überschreiben. Bei Konflikten bleibt der Entwurf erhalten und kann ausdrücklich neu geladen werden. Ein fehlgeschlagener Abruf zeigt die Standardkarten mit einer Fehlermeldung; er bestätigt keine gespeicherte Auswahl. Der Browser zeigt eine neue Anordnung erst nach erfolgreicher Serverantwort.

## Mein Unterrichtstag

Die Karte zeigt ausschließlich eigene, bestätigte und nicht freigegebene Unterrichtstermine, die den heutigen Kalendertag in der Profilzeitzone schneiden. Die Datenbank berechnet beide Tagesgrenzen getrennt in der IANA-Zeitzone; es wird kein fester 24-Stunden-Tag für eine mögliche Zeitumstellung angenommen. Private Kalenderereignisse anderer Personen werden weder abgefragt noch ausgeliefert. Das Datum, die verwendete Zeitzone und eine Aktualisieren-Schaltfläche sind sichtbar. Die Karte aktualisiert sich bei normalem Fokus/Reconnect sowie auf ausdrückliche Anforderung, ohne zusätzlichen Intervall-Pollingzyklus; ein dauerhaft im Vordergrund gelassenes Dashboard benötigt nach Mitternacht eine Aktualisierung.

Jeder Termin enthält Kurstitel, den bereits zugänglichen Kundennamen, Unterrichtszeit und den im Auftrag hinterlegten Ort. Nur sichere absolute HTTPS-Adressen ohne eingebettete Zugangsdaten werden als Unterrichtslink geöffnet. Freigegebene, saubere und aktuell autorisierte Kursdateien dieses Auftrags erscheinen als bis zu 20 Metadatenlinks zur Dateizentrale; es werden keine privaten Dateien vorab heruntergeladen oder offline gespeichert. Die Karte zeigt höchstens 100 Tagestermine. Sie gibt keine Honorare, privaten Organisationsnotizen oder geschützten Kontaktdatensätze aus.

Die persönliche Vorbereitung hat drei echte gespeicherte Prüfpunkte: Unterlagen vorbereitet, Unterrichtslink/Raum geprüft und Kontaktweg geklärt. Diese Angaben sind eigene Notizen zum angenommenen Auftrag und **keine** Kundenfreigabe, Dokumenten-Empfangsbestätigung oder Fortschrittsmeldung an den Auftraggeber. `save_teaching_preparation` prüft die eigene aktive bestätigte Zuordnung erneut und sperrt sie gegen gleichzeitige Stornierung. Eine Versionsprüfung schützt vor konkurrierenden Checklistenänderungen. Checkboxen ändern ihren gespeicherten Zustand erst nach der Serverantwort.

Bestehende Kundenkontakte sind absichtlich nur über die entsprechende Verwaltungsberechtigung lesbar. Eine künftig ausdrücklich freigegebene Kursansprechperson benötigt eine eigene Datenfreigabe und Bedienoberfläche; diese Karte umgeht die bestehende Kontaktberechtigung nicht. Kundenübergreifend sichtbare Vorbereitungspläne, frei konfigurierbare Checklistenvorlagen, Fristen und Kundenfortschrittsberichte bleiben weitere Produktarbeit.

## Prüfungen

```bash
npx vitest run src/features/dashboard
node scripts/dashboard-personal-db-tests.mjs
```

Am 16. November 2026 tatsächlich bestanden: 14 Dashboard-Komponententests, darunter vier neue Abläufe für bestätigtes Speichern, Versionskonflikt/Neuladen, echte Checklistenspeicherung und sichere Unterrichtslinks mit DE/EN-Wechsel; acht echte isolierte PostgreSQL-Prüfgruppen für private Auswahlen, Administrator-/Peer-Isolation, tatsächliches gleichzeitiges Speichern, manipulierte Eingaben, heutige/unverfügbare Unterrichtstermine, freigegebene saubere Dateien, Checklisteneigentum, Zeitzonen und inaktive Konten. Diese fokussierten Ergebnisse ersetzen keine vollständige Auth/API-/Desktop-/Mobilabnahme oder Produktivaktivierung. Die zentralen Arbeitsprotokolle dokumentieren zusätzliche tatsächlich ausgeführte Gesamtprüfungen.
