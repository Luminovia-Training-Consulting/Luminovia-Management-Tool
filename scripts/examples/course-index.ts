/** Read one page of the organisation's published course index. */

async function main(): Promise<number> {
  const apiBase = process.env.LUMINOVIA_API_BASE_URL ?? "";
  const integrationKey = process.env.LUMINOVIA_INTEGRATION_KEY ?? "";
  const [cursor = "", ...extra] = process.argv.slice(2);
  const basePattern =
    /^(?:https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]+)?|http:\/\/127\.0\.0\.1:[0-9]+)(?:\/backend)?\/?$/;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

  if (!basePattern.test(apiBase)) {
    console.error(
      "Set LUMINOVIA_API_BASE_URL to the API base shown in OpenAPI.",
    );
    return 2;
  }
  if (!new RegExp(`^lvi_${uuid}_[0-9a-f]{64}$`).test(integrationKey)) {
    console.error("Set LUMINOVIA_INTEGRATION_KEY to a course-index key.");
    return 2;
  }
  if (extra.length || (cursor && !new RegExp(`^${uuid}$`).test(cursor))) {
    console.error(
      "Pass the previous next_cursor as the only optional argument.",
    );
    return 2;
  }

  const endpoint = new URL(
    "functions/v1/company-integration",
    apiBase.replace(/\/$/, "") + "/",
  );
  endpoint.searchParams.set("limit", "25");
  if (cursor) endpoint.searchParams.set("after", cursor);

  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: "Bearer " + integrationKey,
        Accept: "application/json",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    console.log(await response.text());
    if (response.status !== 200) {
      console.error(`HTTP ${response.status}`);
      return 1;
    }
    return 0;
  } catch {
    console.error("The course index request failed.");
    return 1;
  }
}

process.exitCode = await main();
