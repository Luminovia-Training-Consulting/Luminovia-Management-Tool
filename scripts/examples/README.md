# Integration examples · Integrationsbeispiele

## Deutsch

Lies den veröffentlichten Kurskatalog deiner Organisation mit [curl](course-index.sh), [Python](course-index.py) oder [TypeScript](course-index.ts). Verwende die Serveradresse aus dem OpenAPI-Download deiner Installation, zum Beispiel `https://akademie.example.invalid/backend`. Erstelle in der Integrationsverwaltung einen Kurskatalog-Schlüssel und speichere ihn auf dem Server, auf dem dein Client läuft.

Wähle einen der Befehle unten. Die Antwort enthält `items` mit Kurs-ID, Titel und Zeitzone. Übergib `next_cursor` als einziges Argument für die nächste Seite. `null` kennzeichnet die letzte Seite. `HTTP 401` mit `invalid_credential` zeigt, dass die Installation den Schlüssel nicht akzeptiert. Prüfe, ob der Schlüssel zu dieser Installation gehört, noch gültig ist oder ersetzt wurde.

## English

Read your organisation’s published course index with [curl](course-index.sh), [Python](course-index.py) or [TypeScript](course-index.ts). Use the server address in your installation’s OpenAPI download, for example `https://academy.example.invalid/backend`. Create a course-index key in the integration settings and store it on the server running your client.

Choose one command below. The response includes course IDs, titles and time zones under `items`. Pass `next_cursor` as the sole argument for the next page. `null` indicates the last page. `HTTP 401` with `invalid_credential` means the installation rejected the key. Check that the key belongs to this installation and is still current.

```bash
export LUMINOVIA_API_BASE_URL='https://academy.example.invalid/backend'
read -rs LUMINOVIA_INTEGRATION_KEY
export LUMINOVIA_INTEGRATION_KEY

bash scripts/examples/course-index.sh
python3 scripts/examples/course-index.py
node --experimental-strip-types scripts/examples/course-index.ts

unset LUMINOVIA_INTEGRATION_KEY
```

Node.js 22.12+ · curl 7.55+ · Python 3.8+

## Enrolment and reports · Einschreibung und Berichte

Use a separate key for each operation. Enrolment requires an existing confirmed organisation membership, the participant's account identifier and a published course. An enrolled participant returns the same receipt on retry. A removed or completed enrolment returns HTTP 409. The reporting key returns only the course ID and aggregate counts.

Verwende pro Vorgang einen eigenen Schlüssel. Für die Einschreibung braucht der Teilnehmer eine bereits bestätigte Mitgliedschaft, eine Konto-ID und einen veröffentlichten Kurs. Bei Wiederholung liefert eine bestehende Einschreibung dieselbe Bestätigung. Zurückgenommene oder abgeschlossene Einschreibungen liefern HTTP 409. Der Bericht enthält nur die Kurs-ID und zusammengefasste Zahlen.

```bash
export LUMINOVIA_API_BASE_URL='https://academy.example.invalid/backend'
course_id='9c0c48a1-8bde-41d4-835a-f66a4cfbe378'
participant_id='LV-1111-2222-3333-4444-5555'

# Use the enrolments.write key for this command.
read -rs LUMINOVIA_INTEGRATION_KEY
export LUMINOVIA_INTEGRATION_KEY
bash scripts/examples/course-index.sh enrol "$course_id" "$participant_id"

# Replace it with the reports.read key for this command.
read -rs LUMINOVIA_INTEGRATION_KEY
bash scripts/examples/course-index.sh report "$course_id"
unset LUMINOVIA_INTEGRATION_KEY
```

## Academy invitations and course drafts · Academy-Einladungen und Kursentwürfe

The [Academy client](academy-workflows.ts) uses the API base from your installation's OpenAPI document, its public API key and a short-lived access token from the documented human sign-in. Use an authorised staging Academy with active course access. Load the token for the specific actor before each command. Account invitations use an authorised Academy administrator or manager. Learner invitations from a course use a confirmed contact for the course's company. Course drafts use an authorised course manager.

Der [Academy-Client](academy-workflows.ts) nutzt die Serveradresse aus dem OpenAPI-Dokument deiner Installation, den öffentlichen API-Schlüssel und ein kurzlebiges Zugriffstoken aus der dokumentierten Anmeldung. Nutze eine freigegebene Test-Academy mit aktivem Kurszugriff. Lade vor jedem Befehl das Token des passenden Kontos. Kontoeinladungen benötigen eine berechtigte Academy-Administration oder Kursverwaltung. Eine Teilnehmendeneinladung aus einem Kurs benötigt einen bestätigten Unternehmenskontakt des Kurses. Kursentwürfe benötigen die Berechtigung zur Kursverwaltung.

```bash
export LUMINOVIA_API_BASE_URL='https://academy.example.invalid/backend'
read -rs LUMINOVIA_PUBLISHABLE_KEY
read -rs LUMINOVIA_ACCESS_TOKEN
export LUMINOVIA_PUBLISHABLE_KEY LUMINOVIA_ACCESS_TOKEN
```

### Invite accounts · Konten einladen

Use fictional accounts and replace the example IDs with approved staging values. An administrator can invite a lecturer without an organisation. A company contact supplies the ID of their own course. The company invitation returns only `requested`. It does not confirm mail delivery or enrol anyone. Keep the same idempotency key and request when retrying either command.

Verwende fiktive Konten und ersetze die Beispiel-IDs durch freigegebene Testwerte. Eine Academy-Administration kann Lehrkräfte ohne Organisationszuordnung einladen. Ein Unternehmenskontakt übergibt die ID eines eigenen Kurses. Die Unternehmenseinladung meldet nur `requested`. Sie bestätigt weder den Mailversand noch eine Einschreibung. Verwende bei einer Wiederholung denselben Schlüssel und dieselben Eingaben.

```bash
node --experimental-strip-types scripts/examples/academy-workflows.ts invite-account <<'JSON'
{"idempotency_key":"a1111111-1111-4111-8111-111111111111","display_name":"Fictional Teacher","email":"teacher@example.invalid","mode":"invite","role":"lecturer","organisation_id":null}
JSON

# Load the company contact's access token before the next command.
read -rs LUMINOVIA_ACCESS_TOKEN
node --experimental-strip-types scripts/examples/academy-workflows.ts invite-learner <<'JSON'
{"idempotency_key":"a2222222-2222-4222-8222-222222222222","display_name":"Fictional Learner","email":"learner@example.invalid","course_id":"a3333333-3333-4333-8333-333333333333"}
JSON
```

### Author a course draft · Kursentwurf erstellen

Find the organisation and template first. Use their returned IDs in the next request, or send a new template title with `p_template_id` set to `null`. Supply a time zone and offset-aware session timestamps. Creation returns the draft and template IDs without publication. Retain the request ID for an identical retry.

Suche zuerst die Organisation und die Vorlage. Verwende ihre IDs im nächsten Aufruf oder übergib einen neuen Vorlagentitel mit `p_template_id` gleich `null`. Gib eine Zeitzone und Terminzeiten mit UTC-Versatz an. Der Aufruf liefert Entwurfs- und Vorlagen-ID ohne Veröffentlichung. Behalte die Anfrage-ID für eine identische Wiederholung.

```bash
# Load the course manager's access token before these commands.
read -rs LUMINOVIA_ACCESS_TOKEN
node --experimental-strip-types scripts/examples/academy-workflows.ts draft-options <<'JSON'
{"p_organisation_query":"Training","p_template_query":"Intro"}
JSON

node --experimental-strip-types scripts/examples/academy-workflows.ts create-draft <<'JSON'
{
  "p_request_id": "a4444444-4444-4444-8444-444444444444",
  "p_organisation_id": "a5555555-5555-4555-8555-555555555555",
  "p_template_id": "a6666666-6666-4666-8666-666666666666",
  "p_template_title": null,
  "p_payload": {
    "time_zone": "Europe/Berlin",
    "delivery_type": "online",
    "venue": "",
    "sessions": [{"starts_at":"2030-05-06T10:00:00+02:00","ends_at":"2030-05-06T12:00:00+02:00"}]
  }
}
JSON
unset LUMINOVIA_ACCESS_TOKEN LUMINOVIA_PUBLISHABLE_KEY
```

Run `node --test scripts/runtime-academy-workflow-examples.test.mjs` to check the client against the real Accounts request handler and an OpenAPI-validated draft fixture on loopback. The [Academy course creation database suite](../academy-course-creation-db-tests.mjs) checks the actual draft transaction and current-role boundary.

`node --test scripts/runtime-academy-workflow-examples.test.mjs` prüft den Client am echten Accounts-Handler und an einer lokalen Entwurfs-Fixture mit den OpenAPI-Schemas. Der [Datenbanktest für Academy-Kursentwürfe](../academy-course-creation-db-tests.mjs) prüft die echte Transaktion und die serverseitige Rollenprüfung.

## Local verification · Lokale Prüfung

```bash
node --test scripts/runtime-course-index-examples.test.mjs
```

The test runs all three index clients, plus the curl enrolment and report commands, on a temporary loopback listener with the Edge request handler and fictional credentials. The scripts print the exact JSON body and return a nonzero exit status for HTTP errors. The [database tests](../academy-course-index-db-tests.mjs) cover the persisted organisation boundaries and actual key lifecycle.

Der Test führt alle drei Katalog-Clients und die curl-Befehle für Einschreibung und Bericht über einen lokalen Listener mit dem Edge-Handler und fiktiven Schlüsseln aus. Die Skripte geben die JSON-Antwort aus und melden HTTP-Fehler über den Exit-Code. Die [Datenbanktests](../academy-course-index-db-tests.mjs) prüfen die gespeicherten Organisationsgrenzen sowie den tatsächlichen Lebenszyklus der Schlüssel.

## Signed course webhook receiver

### Deutsch

Der [Empfänger](company-course-webhook-receiver.mjs) startet mit der Node-Version aus [`.node-version`](../../.node-version) und legt eine persistente SQLite-Inbox für genau ein Abonnement an. Öffne **Admin → Unternehmen → API-Integrationen → Unternehmens-Webhooks** oder **Academy-Verwaltung → Signierte Kurs-Webhooks** und erstelle ein Abonnement mit einem vom Betreiber freigegebenen Zielalias. Für die interne Kundenabrechnung wählst du **Kundenabrechnung** und richtest dafür einen eigenen Empfänger ein. Kopiere den einmal angezeigten Signaturschlüssel in den privaten Secret Store des Empfängers.

Für die Kundenabrechnung bleiben Verrechnung und Gegenbuchung einer Gutschrift sowie Erstattung und deren Gegenbuchung getrennte Ereignisse. Sie enthalten Ereignis-ID, Typ, Zeitpunkt, Versionsnummer und die betroffene Kundenrechnungs-ID. Der Empfänger prüft die fünf Felder vor dem Speichern.

Starte den Empfänger mit dem unten gezeigten Befehl. Richte für echte Zustellungen einen HTTPS-Reverse-Proxy ein, der `POST /course-events` unverändert an den Loopback-Port weitergibt. Hinterlege die öffentliche HTTPS-Adresse einschließlich Pfad in der Zielzuordnung des [Workers](../../OPERATIONS.md#company-course-webhooks). Sieh in der Zustellhistorie im Portal nach und lies die letzten 50 Einträge mit `receipts`. Für einen Schlüsselwechsel widerrufst du das bisherige Abonnement, erstellst ein neues und startest den Empfänger mit dem neuen Signaturschlüssel.

`204` bestätigt einen gespeicherten Eintrag oder die bestätigte Wiederholung derselben Event-ID. Eine abweichende Nutzlast unter derselben ID liefert `409`. Bei ungültiger Signatur, abgelaufenem Zeitstempel oder unpassender ID liefert der Empfänger `401`. Verarbeitet die Inbox einen Schreibvorgang gerade nicht, fordert `503` den Worker zum erneuten Versuch auf. Die Reihenfolge der Zustellung kann von `occurred_at` abweichen. Für eine CRM-Verarbeitung liest ein separater Consumer die Inbox und verwendet die Event-ID auch bei seinen eigenen Änderungen. Sichere die Inbox und behalte Einträge, solange ein erneuter Zustellversuch oder eine Wiederverarbeitung möglich ist.

### English

The [receiver](company-course-webhook-receiver.mjs) runs with the Node version in [`.node-version`](../../.node-version) and opens a durable SQLite inbox for one subscription. In **Admin → Companies → API integrations → Company webhooks** or **Academy administration → Signed course webhooks**, create a subscription for an operator-approved receiver alias. For internal customer accounting, choose **Customer accounting** and configure a separate receiver. Copy the one-time subscription signing key to the receiver's private secret store.

Customer accounting delivers separate events for a credit application, its reversal, a refund and its reversal. The receiver validates five fields before storing the event. These are the event ID, type, timestamp, version and affected customer invoice ID.

Start the receiver with the command below. For real deliveries, configure an HTTPS reverse proxy to forward `POST /course-events` and preserve its original body and signature headers. Set the full public HTTPS URL in the [worker destination map](../../OPERATIONS.md#company-course-webhooks). Check the delivery history in the portal and use `receipts` to read the latest 50 entries. To rotate the key, revoke the old subscription, create a new subscription and restart the receiver with its signing key.

`204` acknowledges a durable entry or a verified repeat of the same event ID. Changed payload under the same ID returns `409`. Invalid signatures, expired timestamps and mismatched IDs return `401`. If the inbox cannot commit a write, `503` requests a retry. Delivery order can differ from `occurred_at`. A separate CRM consumer reads the inbox and uses the event ID to deduplicate its own changes. Back up the inbox and retain its entries for as long as deliveries or downstream work can be replayed.

```bash
receiver_state="$HOME/.local/state/luminovia-course-sync"
install -d -m 700 "$receiver_state"
export LUMINOVIA_WEBHOOK_RECEIVER_DB="$receiver_state/events.sqlite"
read -rs LUMINOVIA_WEBHOOK_RECEIVER_SECRET
export LUMINOVIA_WEBHOOK_RECEIVER_SECRET
node scripts/examples/company-course-webhook-receiver.mjs
unset LUMINOVIA_WEBHOOK_RECEIVER_SECRET

node scripts/examples/company-course-webhook-receiver.mjs receipts
```

Default bind address · Standardadresse: `127.0.0.1:8788`. Use `LUMINOVIA_WEBHOOK_RECEIVER_PORT` for a different local port.

Example HTTPS proxy · Beispiel für einen HTTPS-Proxy:

```caddyfile
events.example.invalid {
  @course_event {
    path /course-events
    method POST
  }
  handle @course_event {
    reverse_proxy 127.0.0.1:8788
  }
  handle {
    respond 404
  }
}
```

Local verification · Lokale Prüfung:

```bash
node --test scripts/runtime-company-course-webhook{,-receiver}.test.mjs
```

The suites cover raw-byte HMAC verification, replay after restart, conflicting event IDs, invalid input and temporary SQLite failure. The internal and Academy PostgreSQL suites run the actual worker and the same receiver over loopback.

Die Tests prüfen die Signatur über die Originalbytes, Wiederholungen nach Neustart, widersprüchliche Event-IDs, ungültige Eingaben und einen vorübergehenden SQLite-Fehler. Die PostgreSQL-Tests der internen und der Academy-Edition führen den echten Worker und denselben Empfänger über Loopback aus.
