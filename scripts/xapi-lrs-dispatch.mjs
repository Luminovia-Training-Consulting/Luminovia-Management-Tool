/** Advance per-course delivery checkpoints using the existing role-scoped xAPI export. */
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { deliverXapiArchive, xapiServiceUrl } from "./xapi-lrs-delivery.mjs";

const hour = 3_600_000;
const day = 24 * hour;
const timestamp = z.iso.datetime({ offset: true });
// A daily window and its one-hour overlap can only split this many times at millisecond precision.
const maxPendingRanges = Math.ceil(Math.log2(day + hour)) + 1;
const courseList = z
  .strictObject({
    courses: z
      .array(z.strictObject({ id: z.uuid(), from: timestamp }))
      .min(1)
      .max(32),
  })
  .refine(
    ({ courses }) =>
      new Set(courses.map(({ id }) => id)).size === courses.length,
  );
const checkpoint = z.strictObject({
  version: z.literal(1),
  courses: z.record(z.uuid(), timestamp),
  pending: z
    .record(
      z.uuid(),
      z
        .strictObject({
          configured_start: timestamp,
          anchor: timestamp,
          ranges: z
            .array(z.tuple([z.number().int(), z.number().int()]))
            .min(1)
            .max(maxPendingRanges),
        })
        .refine(({ configured_start, anchor, ranges }) => {
          const start = Date.parse(configured_start);
          const next = Date.parse(anchor);
          const until = ranges.at(-1)?.[1];
          return (
            start <= next &&
            ranges[0]?.[0] >= Math.max(start, next - hour) &&
            until > next &&
            until <= next + day &&
            ranges.every(
              ([lower, upper], index) =>
                lower < upper &&
                (index === 0 || lower === ranges[index - 1][1]),
            )
          );
        }),
    )
    .optional(),
});
const iso = (instant) => new Date(instant).toISOString();

/** Failures keep the first unconfirmed time window eligible for an identical-ID retry. */
export async function dispatchCourseArchives({
  courses,
  state,
  exportWindow,
  deliver,
  save,
  now = Date.now(),
}) {
  const latest = now - 5 * 60_000;
  const reports = [];
  for (const { id, from } of courses) {
    let remaining = 12;
    const configuredStart = Date.parse(from);
    const previous = Date.parse(state.courses[id] ?? from);
    let next = Math.max(configuredStart, previous);
    const report = {
      course: id,
      through: iso(next),
      submitted: 0,
      retries: 0,
      failure: null,
    };
    while (next < latest && remaining > 0) {
      const previousWork = state.pending?.[id];
      const anchor = iso(next);
      const configured_start = iso(configuredStart);
      const resume =
        previousWork?.anchor === anchor &&
        previousWork.configured_start === configured_start
          ? previousWork.ranges
          : null;
      const until = resume?.at(-1)[1] ?? Math.min(next + day, latest);
      if (until > latest) break;
      // A short overlap picks up late commits. The LRS receives the same
      // statement ID and payload for facts it has already acknowledged.
      const start = Math.max(configuredStart, next - hour);
      try {
        let pending = resume ?? [[start, until]];
        while (pending.length && remaining > 0) {
          remaining -= 1;
          const [[lower, upper], ...later] = pending;
          pending = later;
          const archive = await exportWindow(id, iso(lower), iso(upper));
          if (archive?.overflow) {
            const midpoint = lower + Math.floor((upper - lower) / 2);
            if (midpoint === lower) throw new Error("window_too_dense");
            pending = [[lower, midpoint], [midpoint, upper], ...pending];
            continue;
          }
          const receipt = await deliver(archive);
          report.submitted += receipt.submitted;
          report.retries += receipt.retries;
          if (receipt.failure !== null) {
            report.failure = receipt.failure;
            break;
          }
        }
        if (report.failure !== null) break;
        if (pending.length) {
          // Retain only outstanding ranges so the next run can make progress
          // without advancing the public checkpoint across an unconfirmed gap.
          const progress = {
            ...state.pending,
            [id]: { configured_start, anchor, ranges: pending },
          };
          await save({ ...state, pending: progress });
          state.pending = progress;
          report.failure = "window_budget";
          break;
        }
        const completed = iso(until);
        const { pending: previousPending, ...confirmed } = state;
        const progress = { ...previousPending };
        delete progress[id];
        const updated = {
          ...confirmed,
          courses: { ...state.courses, [id]: completed },
          ...(Object.keys(progress).length ? { pending: progress } : {}),
        };
        await save(updated);
        state.courses[id] = completed;
        if (updated.pending) state.pending = updated.pending;
        else delete state.pending;
        report.through = completed;
        next = until;
      } catch (error) {
        report.failure =
          error?.message === "window_too_dense"
            ? error.message
            : "export_or_checkpoint";
        break;
      }
    }
    reports.push(report);
  }
  return reports;
}

async function readCheckpoint(path) {
  try {
    return checkpoint.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, courses: {} };
    throw error;
  }
}

/** The operator runs one process per checkpoint with its service-manager lock. */
async function saveCheckpoint(path, state) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function runXapiDispatchCli(
  configFile,
  stateFile,
  env = process.env,
  now = Date.now(),
) {
  if (!configFile || !stateFile || resolve(configFile) === resolve(stateFile)) {
    throw new Error("Pass a course list and a different checkpoint filename");
  }
  const { courses } = courseList.parse(
    JSON.parse(await readFile(configFile, "utf8")),
  );
  const state = await readCheckpoint(stateFile);
  const supabase = createClient(
    xapiServiceUrl(env.LMS_XAPI_PORTAL_URL).href,
    env.LMS_XAPI_PORTAL_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (url, init) => {
          const timeout = AbortSignal.timeout(15_000);
          return fetch(url, {
            ...init,
            redirect: "error",
            signal: init?.signal
              ? AbortSignal.any([init.signal, timeout])
              : timeout,
          });
        },
      },
    },
  );
  const { data, error } = await supabase.auth.signInWithPassword({
    email: env.LMS_XAPI_PORTAL_EMAIL,
    password: env.LMS_XAPI_PORTAL_PASSWORD,
  });
  if (error || !data.session) throw new Error("Portal authentication failed");
  const lrs = {
    endpoint: env.LMS_XAPI_LRS_ENDPOINT,
    username: env.LMS_XAPI_LRS_USERNAME,
    password: env.LMS_XAPI_LRS_PASSWORD,
  };
  const reports = await dispatchCourseArchives({
    courses,
    state,
    now,
    exportWindow: async (id, from, until) => {
      const result = await supabase.rpc("course_xapi_statements", {
        p_run_id: id,
        p_from: from,
        p_until: until,
      });
      if (result.error?.code === "54000") return { overflow: true };
      if (result.error) throw new Error("Portal export failed");
      return result.data;
    },
    deliver: (archive) => deliverXapiArchive(archive, lrs),
    save: (next) => saveCheckpoint(stateFile, next),
  });
  if (env.LMS_XAPI_MONITOR === "1") {
    for (const report of reports) {
      const { data: confirmed, error } = await supabase.rpc(
        "report_course_xapi_delivery",
        {
          p_run_id: report.course,
          p_through: report.through,
          p_submitted: report.submitted,
          p_retries: report.retries,
          p_failure:
            typeof report.failure === "number" || report.failure === "transport"
              ? "delivery"
              : report.failure,
        },
      );
      if (error || confirmed !== true) report.monitor_failed = true;
    }
  }
  return reports;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 4)
      throw new Error("Pass a course list and a delivery checkpoint");
    const report = await runXapiDispatchCli(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(report));
    if (
      report.some(
        ({ failure, monitor_failed }) => failure !== null || monitor_failed,
      )
    )
      process.exitCode = 1;
  } catch {
    console.error(
      "Could not load xAPI dispatch configuration, checkpoint or portal session.",
    );
    process.exitCode = 1;
  }
}
