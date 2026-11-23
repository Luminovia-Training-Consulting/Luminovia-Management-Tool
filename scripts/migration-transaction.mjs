import { createHash } from "node:crypto";

/** Preserve the accepted bytes of a release that shipped without an envelope. */
export function migrationTransaction(filename, source) {
  if (
    filename === "20261123021230_job_material_archiving.sql" &&
    createHash("sha256").update(source).digest("hex") ===
      "6f818242ba0b1da6f4e001f1ca1b374940cc329c36be49564a6c0e9fe59fafd2"
  )
    return `BEGIN;\n${source}\nCOMMIT;\n`;
  return source;
}
