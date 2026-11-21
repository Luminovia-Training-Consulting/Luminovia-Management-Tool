"""Read one page of the organisation's published course index."""

import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    api_base = os.getenv("LUMINOVIA_API_BASE_URL", "")
    integration_key = os.getenv("LUMINOVIA_INTEGRATION_KEY", "")
    cursor = sys.argv[1] if len(sys.argv) > 1 else ""
    base_pattern = (
        r"(?:https://[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]+)?"
        r"|http://127\.0\.0\.1:[0-9]+)(?:/backend)?/?"
    )
    uuid = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

    if not re.fullmatch(base_pattern, api_base):
        print("Set LUMINOVIA_API_BASE_URL to the API base shown in OpenAPI.", file=sys.stderr)
        return 2
    if not re.fullmatch(rf"lvi_{uuid}_[0-9a-f]{{64}}", integration_key):
        print("Set LUMINOVIA_INTEGRATION_KEY to a course-index key.", file=sys.stderr)
        return 2
    if len(sys.argv) > 2 or (cursor and not re.fullmatch(uuid, cursor)):
        print("Pass the previous next_cursor as the only optional argument.", file=sys.stderr)
        return 2

    endpoint = api_base.rstrip("/") + "/functions/v1/company-integration?limit=25"
    if cursor:
        endpoint += "&after=" + cursor
    request = Request(endpoint, headers={
        "Authorization": "Bearer " + integration_key,
        "Accept": "application/json",
    })
    try:
        with build_opener(NoRedirect()).open(request, timeout=15) as response:
            status, body = response.status, response.read()
    except HTTPError as error:
        with error:
            status, body = error.code, error.read()
    except (URLError, TimeoutError):
        print("The course index request failed.", file=sys.stderr)
        return 1

    sys.stdout.buffer.write(body + b"\n")
    if status != 200:
        print(f"HTTP {status}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
