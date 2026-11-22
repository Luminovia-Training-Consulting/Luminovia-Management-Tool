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
```

### Edit, staff and publish the draft · Entwurf bearbeiten, besetzen und veröffentlichen

Keep the returned course ID. Read the schedule before editing. Send the returned revision and all sessions, retaining their IDs. Use `null` for a new session ID. A stale revision returns HTTP 409. Read the new schedule before deciding whether to repeat the edit.

Behalte die zurückgegebene Kurs-ID. Lies vor dem Bearbeiten den Terminplan und übergib die erhaltene Revision und alle Termine mit ihren IDs. Übergib bei einem neuen Termin `null` als ID. Eine veraltete Revision liefert HTTP 409. Lies dann den aktuellen Terminplan und entscheide, ob die Änderung weiterhin passt.

```bash
node --experimental-strip-types scripts/examples/academy-workflows.ts draft-schedule <<'JSON'
{"p_course_id":"a7777777-7777-4777-8777-777777777777"}
JSON

node --experimental-strip-types scripts/examples/academy-workflows.ts save-draft-schedule <<'JSON'
{
  "p_course_id": "a7777777-7777-4777-8777-777777777777",
  "p_expected_revision": 1,
  "p_payload": {
    "time_zone": "Europe/Berlin",
    "delivery_type": "online",
    "venue": "",
    "sessions": [
      {"id":"a8888888-8888-4888-8888-888888888888","starts_at":"2030-05-06T11:00:00+02:00","ends_at":"2030-05-06T13:00:00+02:00"}
    ]
  }
}
JSON
```

Find an eligible instructor and inspect the assignment result. Publish only after the assignment returns `confirmed`. Publishing the same capacity is repeatable. A different capacity on an already published course uses the separate capacity-change operation.

Suche eine berechtigte Lehrkraft und prüfe das Ergebnis der Zuweisung. Veröffentliche erst nach dem Status `confirmed`. Eine Veröffentlichung mit derselben Kapazität lässt sich wiederholen. Änderungen an der Kapazität eines veröffentlichten Kurses erfolgen über den separaten Kapazitätsaufruf.

```bash
node --experimental-strip-types scripts/examples/academy-workflows.ts instructor-candidates <<'JSON'
{"p_course_id":"a7777777-7777-4777-8777-777777777777","p_search":"Teacher"}
JSON

node --experimental-strip-types scripts/examples/academy-workflows.ts assign-instructor <<'JSON'
{"p_course_id":"a7777777-7777-4777-8777-777777777777","p_instructor_id":"a9999999-9999-4999-8999-999999999999","p_request_id":"b1111111-1111-4111-8111-111111111111"}
JSON

node --experimental-strip-types scripts/examples/academy-workflows.ts publish-course <<'JSON'
{"p_course_id":"a7777777-7777-4777-8777-777777777777","p_capacity":12}
JSON
```

## Internal Portal invitations and courses · Einladungen und Kurse im internen Portal

Use the internal Portal's server address, public key and current actor's access token. Staff invitations require user and role management. Omitting `role` selects lecturer. Use the separate Premium invitation for a participant and provide their company's ID. Read the returned status. `requested` acknowledges a company request. `sent` and `already_sent` confirm the recorded staff-invitation state. Retain the original invitation ID key and fields across retries.

Verwende die Serveradresse des internen Portals, den zugehörigen öffentlichen Schlüssel und das aktuelle Zugriffstoken. Einladungen für Mitarbeitende erfordern die Benutzer- und Rollenverwaltung. Ohne `role` wird eine Lehrkraft eingeladen. Teilnehmende werden über die separate Premium-Einladung mit der Firmen-ID eingeladen. Prüfe den erhaltenen Status. `requested` quittiert die Unternehmensanfrage. `sent` und `already_sent` bestätigen den gespeicherten Status der Mitarbeitendeneinladung. Behalte bei Wiederholungen denselben Anfrageschlüssel und dieselben Felder.

```bash
export LUMINOVIA_API_BASE_URL='https://portal.example.invalid/backend'
read -rs LUMINOVIA_PUBLISHABLE_KEY
read -rs LUMINOVIA_ACCESS_TOKEN
export LUMINOVIA_PUBLISHABLE_KEY LUMINOVIA_ACCESS_TOKEN

node --experimental-strip-types scripts/examples/academy-workflows.ts invite-portal-account <<'JSON'
{"email":"teacher@example.invalid","display_name":"Fictional Teacher","idempotency_key":"b2222222-2222-4222-8222-222222222222"}
JSON

# Load the scoped company actor's token for the participant invitation.
read -rs LUMINOVIA_ACCESS_TOKEN
node --experimental-strip-types scripts/examples/academy-workflows.ts invite-portal-participant <<'JSON'
{"email":"participant@example.invalid","display_name":"Fictional Participant","organisation_id":"b3333333-3333-4333-8333-333333333333","idempotency_key":"b4444444-4444-4444-8444-444444444444"}
JSON
```

Create a template with the course manager's token. Use its returned ID to create a scheduled course. The CMS save operations have no request key for creation. After an ambiguous network failure, check the course list before creating another record. Set `published` to `false` to keep your first save in draft.

Erstelle mit dem Token der Kursverwaltung eine Vorlage und verwende die zurückgegebene ID für den terminierten Kurs. Die CMS-Speicheraufrufe verwenden bei der Neuanlage keinen Anfrageschlüssel. Prüfe nach einem unklaren Netzwerkfehler die Kursliste vor einer weiteren Neuanlage. Mit `published: false` bleibt der erste gespeicherte Stand ein Entwurf.

```bash
read -rs LUMINOVIA_ACCESS_TOKEN
node --experimental-strip-types scripts/examples/academy-workflows.ts create-portal-template <<'JSON'
{"p_id":null,"p_payload":{"title":"Fictional Portal Course"}}
JSON

node --experimental-strip-types scripts/examples/academy-workflows.ts create-portal-run <<'JSON'
{
  "p_id": null,
  "p_payload": {
    "template_id": "b5555555-5555-4555-8555-555555555555",
    "organisation_id": null,
    "time_zone": "Europe/Berlin",
    "delivery_type": "online",
    "venue": "",
    "published": false,
    "sessions": [{"starts_at":"2030-05-06T10:00:00+02:00","ends_at":"2030-05-06T12:00:00+02:00"}]
  }
}
JSON
unset LUMINOVIA_ACCESS_TOKEN LUMINOVIA_PUBLISHABLE_KEY
```

Run `node --test scripts/runtime-academy-workflow-examples.test.mjs` to check the client against the real Accounts request handler and an OpenAPI-validated draft fixture on loopback. The [Academy course creation database suite](../academy-course-creation-db-tests.mjs) checks the actual draft transaction and current-role boundary.

`node --test scripts/runtime-academy-workflow-examples.test.mjs` prüft den Client am echten Accounts-Handler und an einer lokalen Entwurfs-Fixture mit den OpenAPI-Schemas. Der [Datenbanktest für Academy-Kursentwürfe](../academy-course-creation-db-tests.mjs) prüft die echte Transaktion und die serverseitige Rollenprüfung.

## Internal Portal permissions and scoped actions · Berechtigungen und Aktionen im internen Portal

Use your Internal Portal OpenAPI server URL and the publishable key. Load the current user's token. Inspect their permissions and list the members of a chat they can access. Acknowledge the published revision currently visible to that user. For cancellation, load the token of a current contact of the request's company or an authorised gross-finance account. Use your own disposable unpublished request as this action changes its state.

Nutze die Serveradresse aus der OpenAPI-Datei des internen Portals und den öffentlichen Schlüssel. Lade das aktuelle Benutzertoken. Lies die Berechtigungen und die Mitglieder eines Chats, auf den das Konto Zugriff hat. Bestätige die aktuell veröffentlichte und für dieses Konto sichtbare Mitteilung. Lade zur Stornierung das Token eines aktuellen Kontakts des anfragenden Unternehmens oder eines berechtigten Finanzkontos mit Bruttozugriff. Verwende eine eigene unveröffentlichte Testanfrage, deren Status geändert werden darf.

```bash
export LUMINOVIA_API_BASE_URL='https://portal.example.invalid/backend'
read -rs LUMINOVIA_PUBLISHABLE_KEY
read -rs LUMINOVIA_ACCESS_TOKEN
export LUMINOVIA_PUBLISHABLE_KEY LUMINOVIA_ACCESS_TOKEN

node --experimental-strip-types scripts/examples/academy-workflows.ts portal-permissions <<'JSON'
{}
JSON

node --experimental-strip-types scripts/examples/academy-workflows.ts portal-chat-members <<'JSON'
{"p_room_id":"e1111111-1111-4111-8111-111111111111"}
JSON

node --experimental-strip-types scripts/examples/academy-workflows.ts acknowledge-portal-announcement <<'JSON'
{"p_revision_id":"e2222222-2222-4222-8222-222222222222"}
JSON

read -rs LUMINOVIA_ACCESS_TOKEN
node --experimental-strip-types scripts/examples/academy-workflows.ts cancel-portal-course-request <<'JSON'
{"p_request_id":"e3333333-3333-4333-8333-333333333333"}
JSON
unset LUMINOVIA_ACCESS_TOKEN LUMINOVIA_PUBLISHABLE_KEY
```

Replace example IDs with records visible to the test user. Permissions and members are JSON arrays. Acknowledging the same visible revision again returns the original timestamp. Successful cancellation and its retry return HTTP 204 with an empty body. On HTTP errors the client writes the status and any recognised error code to stderr and exits with code 1.

Ersetze die Beispiel-IDs durch Datensätze, die das jeweilige Testkonto sehen darf. Berechtigungen und Chatmitglieder sind JSON-Listen. Eine erneute Bestätigung derselben sichtbaren Mitteilung liefert den ursprünglichen Zeitstempel. Eine erfolgreiche Stornierung und ihre Wiederholung liefern HTTP 204 mit leerem Antwortkörper. Bei HTTP-Fehlern meldet der Client Status und gegebenenfalls Fehlercode auf stderr und beendet sich mit Exit-Code 1.

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
