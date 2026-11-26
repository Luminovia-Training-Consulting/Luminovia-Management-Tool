/** Send an exact archived SCO to an isolated origin without transferring a portal credential. */
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { Field, Loading, Notice } from "../../components/common";
import { db } from "../../lib/supabase";
import { downloadCourseScormPackage } from "../files/api";
import type { CourseScormPackage } from "./scorm-course-schema";
import { scormRuntimeAddress } from "./scorm-runtime-address";
import { lessonRuntimeState, scormCommitPayload } from "./scorm-runtime-schema";

type Payload = z.infer<typeof scormCommitPayload>;

function scormTotalTime(centiseconds: number) {
  const hours = String(Math.floor(centiseconds / 360000)).padStart(4, "0");
  const minutes = String(Math.floor((centiseconds % 360000) / 6000)).padStart(
    2,
    "0",
  );
  const seconds = String(Math.floor((centiseconds % 6000) / 100)).padStart(
    2,
    "0",
  );
  return (
    hours +
    ":" +
    minutes +
    ":" +
    seconds +
    "." +
    String(centiseconds % 100).padStart(2, "0")
  );
}

type Props = { actor: string; course: string; summary: CourseScormPackage };

export function ActiveScormPlayer({ actor, course, summary }: Props) {
  const { t } = useTranslation("learning");
  const id = useId();
  const [lesson, setLesson] = useState(
    () =>
      summary.lessons.find((item) => !summary.completed.includes(item.id)) ??
      summary.lessons[0],
  );
  return (
    <div className="space-y-3">
      <Field id={id} label={t("scormChooseLesson")}>
        <select
          value={lesson.id}
          onChange={(event) => {
            const next = summary.lessons.find(
              ({ id }) => id === event.currentTarget.value,
            );
            if (next) setLesson(next);
          }}
        >
          {summary.lessons.map(({ id, title }) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </Field>
      <ScormLaunch
        key={lesson.id}
        actor={actor}
        course={course}
        summary={summary}
        lesson={lesson}
      />
    </div>
  );
}

function ScormLaunch({
  actor,
  course,
  summary,
  lesson,
}: Props & { lesson: { id: string; title: string } }) {
  const { t } = useTranslation("learning");
  const [launchId] = useState(() => crypto.randomUUID());
  const [runtime] = useState(() =>
    scormRuntimeAddress(launchId, new URL(location.href)),
  );
  const [status, setStatus] = useState<
    "loading" | "playing" | "saving" | "saved" | "error"
  >("loading");
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const version = summary.id;
  const item = lesson.id;
  const context = { p_run_id: course, p_version_id: version, p_item_id: item };
  const launch = useQuery({
    queryKey: ["active-scorm", actor, course, version, summary.sha256, item],
    gcTime: 0,
    retry: false,
    staleTime: Infinity,
    enabled: Boolean(runtime),
    queryFn: async ({ signal }) => {
      const [file, state, parser] = await Promise.all([
        downloadCourseScormPackage(course, version, signal),
        db()
          .rpc("read_course_scorm_runtime", context, { get: true })
          .abortSignal(signal),
        import("./scorm-package"),
      ]);
      if (state.error) throw state.error;
      const files = new Map<string, Uint8Array<ArrayBuffer>>();
      const report = await parser.reviewScormPackage(
        await file.arrayBuffer(),
        signal,
        undefined,
        files,
      );
      if (
        report.sha256 !== summary.sha256 ||
        report.organisation !== summary.title ||
        report.launches.length !== summary.lessons.length ||
        report.launches.some(
          (page, index) =>
            page.id !== summary.lessons[index].id ||
            page.title !== summary.lessons[index].title,
        )
      )
        throw new Error("SCORM publication changed");
      const launchItem = report.launches.find(({ id }) => id === item);
      if (!launchItem) throw new Error("SCORM lesson missing");
      return {
        files,
        path: launchItem.path,
        state: lessonRuntimeState.parse(state.data),
      };
    },
  });

  useEffect(() => {
    if (!runtime) return;
    const address = runtime.origin;
    const detect = (event: MessageEvent) => {
      if (
        event.origin === address &&
        event.source === frame.current?.contentWindow &&
        event.data?.launch === launchId &&
        event.data.type === "scorm:ready"
      ) {
        window.clearTimeout(timeout);
        setReady(true);
      }
    };
    window.addEventListener("message", detect);
    const timeout = window.setTimeout(() => setStatus("error"), 12000);
    return () => {
      window.removeEventListener("message", detect);
      window.clearTimeout(timeout);
    };
  }, [launchId, runtime]);

  useEffect(() => {
    if (!runtime || !launch.data || !ready) return;
    const receiver = frame.current?.contentWindow;
    if (!receiver) return;
    const { state, path, files } = launch.data;
    const origin = runtime.origin;
    const abort = new AbortController();
    let revision = state.revision;
    let pending: Payload | null = null;
    let saving = false;
    async function save() {
      if (saving || !state.can_write) return;
      saving = true;
      setStatus("saving");
      try {
        while (pending && !abort.signal.aborted) {
          const cmi = pending;
          pending = null;
          const { data: session } = await db().auth.getSession();
          abort.signal.throwIfAborted();
          if (session.session?.user.id !== actor)
            throw new Error("SCORM learner changed");
          const result = await db()
            .rpc("save_course_scorm_runtime", {
              p_run_id: course,
              p_version_id: version,
              p_item_id: item,
              p_session_id: launchId,
              p_expected_revision: revision,
              p_cmi: cmi,
            })
            .abortSignal(abort.signal);
          if (result.error || result.data !== revision + 1)
            throw new Error("SCORM save not confirmed");
          revision = result.data;
        }
        if (!abort.signal.aborted) setStatus("saved");
      } catch {
        if (!abort.signal.aborted) setStatus("error");
      } finally {
        saving = false;
      }
    }
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== origin ||
        event.source !== receiver ||
        event.data?.launch !== launchId
      )
        return;
      if (event.data.type === "scorm:error") setStatus("error");
      if (event.data.type === "scorm:commit" && state.can_write) {
        const parsed = scormCommitPayload.safeParse(event.data.cmi);
        if (parsed.success) {
          pending = parsed.data;
          void save();
        }
      }
    };
    window.addEventListener("message", receive);
    receiver.postMessage(
      {
        type: "scorm:launch",
        launch: launchId,
        files: [...files],
        path,
        cmi: state.cmi,
        title: lesson.title,
        adapter: {
          studentId: state.student_id,
          studentName: "Learner",
          preview: !state.can_write,
          totalTime: scormTotalTime(state.total_elapsed_cs),
          hasPreviousState: state.revision > 0,
          launchData: "",
          masteryScore: null,
        },
      },
      origin,
    );
    setStatus("playing");
    return () => {
      window.removeEventListener("message", receive);
      abort.abort();
    };
  }, [
    actor,
    course,
    item,
    launch.data,
    launchId,
    lesson.title,
    ready,
    runtime,
    version,
  ]);

  if (!runtime)
    return <Notice kind="error">{t("scormRuntimeUnavailable")}</Notice>;
  return (
    <>
      {launch.isError || status === "error" ? (
        <Notice kind="error">{t("scormRuntimeError")}</Notice>
      ) : null}
      {!launch.isError && status === "loading" && <Loading />}
      {status === "saving" && <p role="status">{t("scormRuntimeSaving")}</p>}
      {status === "saved" && <p role="status">{t("scormRuntimeSaved")}</p>}
      <iframe
        className="h-96 w-full rounded border"
        title={lesson.title}
        ref={frame}
        src={runtime.href}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        onLoad={() =>
          frame.current?.contentWindow?.postMessage(
            {
              type: "scorm:hello",
              launch: launchId,
            },
            runtime.origin,
          )
        }
      />
    </>
  );
}
