/** Build or remove the migration snapshot inside this run's disposable Supabase PostgreSQL container. */
import {
  dropTestDatabaseTemplate,
  prepareTestDatabaseTemplate,
} from "./database.mjs";

if (process.env.PORTAL_TEST_MODE !== "1")
  throw new Error(
    "SQL template mutations require the isolated portal test mode.",
  );
const container = process.env.PORTAL_DB_CONTAINER;
const template = process.env.PORTAL_TEST_DB_TEMPLATE;
if (!container || !template)
  throw new Error(
    "The owned database container and random template name are required.",
  );

if (process.argv[2] === "--drop") {
  await dropTestDatabaseTemplate({ container, template });
  console.log("PASS owned SQL fixture template removed.");
} else if (process.argv.length === 2) {
  await prepareTestDatabaseTemplate({ container, template });
  console.log(
    "PASS exact migration snapshot prepared for isolated SQL fixtures.",
  );
} else {
  throw new Error("Use no arguments to prepare, or --drop to clean up.");
}
