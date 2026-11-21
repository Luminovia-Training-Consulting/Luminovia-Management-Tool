# Example clients · Beispielclients

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

## Local verification · Lokale Prüfung

```bash
node --test scripts/runtime-course-index-examples.test.mjs
```

The test runs all three clients on a temporary loopback listener with the Edge request handler and fictional course and credential fixtures. The [database tests](../academy-course-index-db-tests.mjs) cover the persisted organisation boundaries and actual key lifecycle.

Der Test führt alle drei Clients über einen temporären lokalen Listener mit dem Edge-Handler und fiktiven Kursen und Schlüsseln aus. Die [Datenbanktests](../academy-course-index-db-tests.mjs) prüfen die gespeicherten Organisationsgrenzen sowie den tatsächlichen Lebenszyklus der Schlüssel.
