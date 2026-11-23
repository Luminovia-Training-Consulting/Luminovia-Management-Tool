# White-Label-Roadmap

Produktstand und offene Abnahmen für Academy Self-Hosted und Academy Managed. Der aktuelle [Funktionskatalog](FEATURES.md#editionen) beschreibt die vorhandenen Funktionen. Für die Abnahme gilt die konkrete, autorisierte Kundeninstallation mit ihrer Edition, signierten Lizenz und exakten Release-Revision. Die Schritte und Nachweise stehen in der [Zielabnahme](deploy/academy/TARGET-ACCEPTANCE.md).

## Produktlücken

- [x] **Befristete Supportfreigabe · WL-T39.** Kundenadmins können einem bestätigten, lokalen Supportkonto ohne Academy-Rolle eine Freigabe für Installationsdiagnosen oder einen bestimmten Kurs erteilen. Zweck, Dauer, Ablauf, Widerruf und Zugriff sind nachvollziehbar. Die Freigabe umfasst ausschließlich Diagnosen. Lerninhalte, Dateien und Nachrichten bleiben geschützt. Auf nativem PostgreSQL für beide Academy-Profile geprüft.
- [x] **Nicht-interaktiver Host-Preflight · WL-T31, WL-T36.** Der Preflight prüft den signierten Installationsplan gegen Betriebssystem, Architektur, CPU, RAM, freien Speicher, lokale Docker-/Compose-Konfiguration, Werkzeuge und Ports. Fehler beenden die Prüfung vor der Aktivierung. Der Wiederanlauf und eine echte lokale Portkollision wurden geprüft.
- [x] **Browser-SBOM und Abhängigkeitslizenzen · WL-T40.** Beide Academy-Browserpakete enthalten ein CycloneDX-Inventar der ausgelieferten Komponenten und deren Lizenztexte. Die Paketprüfung bindet beide Dateien an Edition, Git-Revision und Browserarchiv.
- [x] **API-Entwicklerpaket · WL-T16–WL-T18, WL-T37.** Die Academy-API liefert editions- und installationsgebundene TypeScript- und Python-Clients zum Download. Lokale Tests prüfen echte HTTP-Antworten und die Prüfung früherer signierter Verträge.
- [ ] **Abhängigkeitsnachweis der Runtime-Images · WL-T40.** SBOM und Lizenztexte für die tatsächlich übernommenen Container-Image-Digests dokumentieren.

## Abnahme je Kundeninstallation

- [ ] **Editionen, Identitäten und Datenschutz · WL-T01–WL-T15, WL-T27–WL-T30, WL-T34.** Gegen den exakten Release interne Bestandsabläufe und beide Academy-Profile prüfen. Rollen, direkte Kurs- und Lehrkraftzuweisung, Organisationsgrenzen und Lizenzzustände über UI, HTTP/RPC, Dateien, Suche, Realtime und Benachrichtigungen nachweisen. Dazu gehören Erstzugang, Benutzername/E-Mail und Passwort, Wiederherstellung, Namenskonflikte, Ablauf von Zugangsdaten, Sperren und fehlende Rechte. Den Zugriff mit einer zweiten unabhängigen Installation und getrennten Schlüsseln abgrenzen.
- [ ] **API und Datenflüsse · WL-T16–WL-T22, WL-T37.** Jede unterstützte Geschäftsaktion mit ihrer API oder einer begründeten Ausnahme abgleichen. Swagger, Schemas, echte Status- und Fehlerantworten, konkurrierende oder wiederholte Aufrufe, Pagination, Limits, Schlüsselwechsel, aktuelle Berechtigungen, exakte gescannte Dateien und Rückwärtskompatibilität nachweisen. Am Kundenempfänger Signatur, Zustellhistorie, Wiederholung, Deduplizierung und Widerruf von Webhooks prüfen.
- [ ] **Marke, Oberfläche und Geräte · WL-T23–WL-T26, WL-T35.** Verbliebene unnötige Luminovia-Verweise in Kundenoberflächen, Mails, Dokumenten und API-Dokumentation korrigieren. Name, Symbole, Cachewechsel, Theme, Kontrast, Tastatur und Screenreader in DE/EN auf unterstützten Geräten überprüfen. Die installierte PWA auf der tatsächlichen Origin prüfen.
- [ ] **Inbetriebnahme und Zustellung · WL-T09, WL-T25, WL-T31, WL-T36.** Den geprüften, signierten Handoff vom Aussteller zum Betreiber durchführen. Die unabhängige Installation starten, exakte Revision und Lizenz bestätigen, Domain/DNS, öffentliches TLS, Weiterleitungen und Auth-Callbacks abnehmen. Erstadministrator, Einladung und Passwortwiederherstellung mit tatsächlichem Mailbox-Empfang prüfen. Konfigurierte Kursbenachrichtigungen mit Opt-in und Opt-out testen. Vereinbart deaktivierte Kanäle entsprechend protokollieren.
- [ ] **Betrieb, Upgrade und Wiederherstellung · WL-T29, WL-T32–WL-T36.** Scanner, Storage, Kontingente, Backup-Alter und Migrationsstand an den Zielmonitor anbinden. Alarm, Wartung und Incident-Ablauf erproben. Ein verschlüsseltes Backup isoliert wiederherstellen und den exakten signierten Upgradepfad mit erhaltenen Konten, Rollen, Kursen, Fortschritt, Chat und geschützten Dateibytes ausführen. Rollback-Grenze, Datenbestand und Nachprüfung dokumentieren.

## Übergabe und Managed-Betrieb

- [ ] **Lizenz, Freigabe und Übergabe · WL-T07, WL-T34, WL-T38–WL-T40.** Ausstellung, Verlängerung und verschlüsselten Datenexport mit dem tatsächlichen Betreiber proben. Kundenvertrag, Vertriebsrechte, Drittanbieterhinweise, Datenschutz, Aufbewahrung, Support und Zuständigkeiten schriftlich klären. Die [Übergabevorlagen](docs/customer-handoff/README.md) für das konkrete Angebot ausfüllen und freigeben.
- [ ] **Managed Academy · WL-T29, WL-T32–WL-T33, WL-T36, WL-T38–WL-T39.** Betrieb auf der unabhängigen Kundenumgebung inklusive Anbieterzustellung, Backup-Zeitplan und überwachtem Upgrade abnehmen. Verantwortlichkeiten, Supportfreigabe und Vorfallkommunikation festlegen. Domainübergabe, Wechsel zwischen Self-Hosted und Managed und Offboarding mit Datenexport und verifiziertem Entzug der Zugänge erproben.
- [ ] **Releaseentscheidung · WL-T40.** Offene Abnahmen der [Produkt-Roadmap](ROADMAP.md) und dieses Dokuments auflösen. Je Ziel Revision, Edition, Ergebnis und Beleg festhalten. Alle erforderlichen Anwendungs- und Security-Checks müssen auf exakt diesem Commit grün sein. Go/No-go und Rückfallplan vor Freischaltung dokumentieren.

## Spätere Produktentscheidungen

Gesondert entscheiden, ob gemeinsame SaaS-Tenants, Sub-Brands, Air-Gap-Betrieb, Online-Zahlungen, SCORM/xAPI/LTI, Enterprise-SSO, erweiterte Prüfungsfunktionen, weitere Sprachen, Nutzungsabrechnung oder ein Reseller-Programm beauftragt werden.
