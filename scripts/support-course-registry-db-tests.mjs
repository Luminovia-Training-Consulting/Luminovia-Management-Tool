/** Automatically discovered optional course-registry contract regressions.
 * No PR17 Git object is required: a clearly labelled minimal private registry
 * is installed BEFORE the real support migration when the course module is absent.
 * When actual course RPCs already exist, these same checks exercise them too.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { withTestDatabase } from "./testing/database.mjs";
import {
  runSupportCourseAbsenceChecks,
  runSupportCourseRegistryChecks,
} from "./testing/support-course-registry.mjs";
// Preserve the complete accepted predecessor when pending operational versions
// are regenerated. Stable module suffixes identify the tested SQL boundaries.
const migrationFiles = (
  await readdir(new URL("../supabase/migrations/", import.meta.url))
)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const readinessFiles = migrationFiles.filter((name) =>
  name.endsWith("_course_readiness.sql"),
);
const supportFiles = migrationFiles.filter((name) =>
  name.endsWith("_internal_support_desk.sql"),
);
assert.equal(readinessFiles.length, 1);
assert.equal(supportFiles.length, 1);
const readinessFile = readinessFiles[0],
  supportFile = supportFiles[0],
  predecessor = migrationFiles.filter((name) => name < readinessFile).at(-1);
assert.ok(predecessor, "A complete accepted predecessor must be present.");
assert.ok(readinessFile < supportFile);
const support = await readFile(
  new URL("../supabase/migrations/" + supportFile, import.meta.url),
  "utf8",
);
await withTestDatabase(
  "support_course_absent",
  async (fixture) => {
    await fixture.sql(
      await readFile(
        new URL("../supabase/migrations/" + readinessFile, import.meta.url),
        "utf8",
      ),
    );
    await fixture.sql(support);
    await runSupportCourseAbsenceChecks(fixture);
  },
  { migrationsThrough: predecessor.slice(0, 14) },
);
await withTestDatabase(
  "support_course_registry",
  async (fixture) => {
    const exists =
      (await fixture.sql(
        "select to_regclass('private.course_resources')is not null",
      )) === "t";
    if (!exists)
      await fixture.sql(
        `create table private.course_resources(id uuid primary key default gen_random_uuid(),version_id uuid not null references public.document_versions(id),removed_at timestamptz);alter table private.course_resources enable row level security;revoke all on private.course_resources from public,anon,authenticated,service_role;`,
      );
    else
      assert.equal(
        await fixture.sql(
          "select to_regprocedure('public.course_workspace_action(uuid,text,jsonb,integer)')is not null and to_regprocedure('public.course_document_access(text,uuid)')is not null",
        ),
        "t",
        "Existing real registry must have its actual public APIs",
      );
    await fixture.sql(support);
    // Continue the actual current migration history after installing the
    // pre-existing optional registry/support boundary. Real merged course RPCs
    // therefore run their final implementation, not an older intermediate body.
    for (const file of (
      await readdir(new URL("../supabase/migrations/", import.meta.url))
    )
      .filter((name) => name.endsWith(".sql") && name > supportFile)
      .sort())
      await fixture.sql(
        await readFile(
          new URL("../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    await runSupportCourseRegistryChecks(fixture, {
      label: exists
        ? "current installed course RPCs"
        : "synthetic optional course registry",
      requireRealCourse: exists,
    });
  },
  { migrationsThrough: readinessFile.slice(0, 14) },
);
