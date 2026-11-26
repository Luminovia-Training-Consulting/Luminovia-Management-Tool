import { createHash } from "node:crypto";

// These exact released sources used the CLI's transaction handling. Keep their
// historical bytes and give the candidate and Academy replays the same envelope.
const releasedUnwrappedMigrations = new Map([
  [
    "20261123021230_job_material_archiving.sql",
    "6f818242ba0b1da6f4e001f1ca1b374940cc329c36be49564a6c0e9fe59fafd2",
  ],
  [
    "20261126205000_lms_portfolio_lifecycle.sql",
    "51ea63a26ae826ca177ed5a5c300730d11339ba8df7facf1be86429a9f7d8da5",
  ],
]);

/** Wrap only exact historical migrations that predate an explicit envelope. */
export function migrationTransaction(filename, source) {
  const expected = releasedUnwrappedMigrations.get(filename);
  if (
    expected &&
    createHash("sha256").update(source).digest("hex") === expected
  )
    return `BEGIN;\n${source}\nCOMMIT;\n`;
  return source;
}
