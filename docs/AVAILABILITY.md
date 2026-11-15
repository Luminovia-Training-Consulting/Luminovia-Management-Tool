# Verfügbarkeit und Sperrzeiten

Unter `/availability` verwalten Dozierende sowie Verwaltungs- und Administrationskonten eigene Zeitfenster. Der private Kalender verlinkt diese Ansicht. „Verfügbar“ ist ein Planungshinweis; „Nicht verfügbar“ verhindert neue überlappende Auftragszuweisungen. Eine Sperrzeit verändert keine bestehenden bestätigten Aufträge: Eine widersprechende neue Sperrzeit wird stattdessen abgelehnt.

Zeitfenster haben präzise Instants, eine IANA-Zeitzone, eine private Notiz und eine ausdrücklich zu setzende Managementfreigabe. Die Freigabe ist standardmäßig aus. Sprachwechsel erhalten den Formularentwurf. Nicht vorhandene oder mehrdeutige lokale DST-Uhrzeiten werden nicht stillschweigend normalisiert; bei unveränderten Zeitfeldern einer Bearbeitung bleiben die ursprünglichen Sekunden und bereits bestimmten Offsets erhalten.

## Datenschutz und Verwaltung

Auch Administratoren können fremde Zeitfenster und Notizen nicht direkt aus der Tabelle lesen. Die eigene RLS-Policy verwendet das aktuelle aktive Konto. Die gesonderte Managementansicht verlangt `availability.read_shared` und bestätigte MFA. Sie liefert ausschließlich ausdrücklich freigegebene Zeiträume, Status, Zeitzone und Anzeigename eines weiterhin aktiven Dozierendenkontos. Sie liest weder private Termine noch private Notizen. Das Zurücknehmen der Freigabe wirkt für folgende Serverabrufe; die Ansicht bietet eine ausdrückliche Aktualisierung an.

Die Oberfläche begrenzt eine Ansicht auf 93 lokale Kalendertage und liefert höchstens 500 eigene beziehungsweise 1.000 freigegebene Zeitfenster. Die serverseitigen Zeitgrenzen sind ebenfalls endlich und begrenzt; ein kleiner UTC-Spielraum berücksichtigt die DST-Rückstellung. Die eigene API erlaubt zusätzlich bis zu 366 Tagen pro Abruf. Eine Verfügbarkeit ist keine verbindliche Kurszusage; ausschließlich die bestehende atomare Auftragsannahme bestätigt einen Auftrag.

## Transaktionen und unveränderte Historie

Die additive Migration `20261115210134_lecturer_availability.sql` folgt auf die Einführung freigegebener historischer Zuweisungen. Verfügbarkeitsänderungen und aktive Zuweisungen verwenden exakt dieselbe Sperrreihenfolge wie Auftragsannahmen: Profilzeile mit `FOR SHARE`, danach den vorhandenen benutzerbezogenen Transaktions-Advisory-Lock. Ein Upgrade auf `FOR UPDATE` innerhalb der Zuweisung wäre ein Deadlock-Risiko und wird vermieden.

Ein neuer Allocation-Trigger verweigert überlappende „Nicht verfügbar“-Fenster mit `23P01`. Der bestehende Claim-Fehlerpfad setzt dadurch den gesamten Mehrtagesblock samt vorherigen Teilzuweisungen zurück. Umgekehrt verweigert der Fenster-Trigger Sperrzeiten über bestätigten, nicht freigegebenen Zuweisungen. Stornierte und freigegebene Intervalle bleiben als Historie erhalten und blockieren keinen neuen Zeitraum. Eine Freigabe verlässt den Trigger vor neuen Profilsperren und fügt keine belegte Zeit hinzu. Private Kalendertermine werden nicht dupliziert oder umgewandelt.

Erstellen verwendet eine im Formular beibehaltene UUID. Eine identische Wiederholung nach verlorener Antwort erstellt keinen zweiten Datensatz. Bearbeiten und Entfernen prüfen eine Versionsnummer; fremde Kennungen, veraltete Änderungen und bestehende Sitzungen gesperrter Konten bleiben abgelehnt. Es gibt keine optimistische Buchungsbestätigung.

## API und Tests

- `my_availability(p_from, p_to)` liest ausschließlich eigene Zeitfenster.
- `shared_availability(p_from, p_to)` liefert die reduzierte opt-in Managementprojektion.
- `save_lecturer_availability(p_id, p_payload, p_version)` erstellt mit Version `0` oder bearbeitet eine beobachtete Fassung. Der Payload enthält nur `kind`, explizit versetzte `starts_at`/`ends_at`, `time_zone`, `notes` und `share_with_management`.
- `remove_lecturer_availability(p_id, p_version)` entfernt eine eigene beobachtete Fassung.

Die öffentlichen RPCs sind Invoker-Funktionen; privilegierte Operationen liegen im privaten Schema mit leerem Suchpfad und expliziten Ausführungsrechten. Direkte Client-Schreibrechte werden nicht vergeben.

Acht echte temporäre PostgreSQL-Prüfgruppen enthalten insbesondere die gleichzeitige Auftragsannahme gegen Sperrzeiterstellung, den Rollback eines erst im letzten Termin scheiternden Mehrtagesblocks, angrenzende Intervalle, Stornierungshistorie, MFA/Fremdzugriff/Notizschutz, Versionen, Wiederholung und Sperrung bestehender Tokens. Komponenten- und Datumstests ergänzen DST, exakte unveränderte Instants, Entwurfserhalt und echte wartende Speicherantworten. `scripts/availability-api-check.mjs` und `tests/e2e/availability.spec.ts` sind für den isolierten Gesamtbefehl vorgesehen; tatsächliche native/API/Browser-Abnahme erst in [QA_RESULTS](QA_RESULTS.md) und [WORKLOG](WORKLOG.md) behaupten.
