/** Publish scanned H5P packages and launch them on a separate cookie-free site. */
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { downloadCourseArchive, uploadCourseArchive } from "../files/api";
import type { H5pPlayback } from "./h5p-runtime-package";
import "./i18n";

type Package = {
  id: string;
  title: string;
  sha256: string;
  progress: { completed: boolean; score: number | null } | null;
};
type Catalogue = {
  packages: Package[];
  can_publish: boolean;
  can_complete: boolean;
};
type Launch = {
  id: string;
  title: string;
  session: string;
  url: URL;
  assets: H5pPlayback["assets"];
};
type PlaybackProgress = { completed: boolean; score: number | null };

function runtimeHost() {
  const host = String(
    import.meta.env.VITE_H5P_CONTENT_HOST ?? "",
  ).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+){2,}(?::[1-9]\d{0,4})?$/.test(host))
    return null;
  let origin: URL;
  try {
    origin = new URL("https://" + host);
  } catch {
    return null;
  }
  const site = location.hostname.toLowerCase();
  const siteSuffix = site.split(".").slice(-2).join(".");
  const contentSuffix = origin.hostname.split(".").slice(-2).join(".");
  if (siteSuffix === contentSuffix) return null;
  return origin.host;
}

async function courseH5pAction(
  course: string,
  version: string,
  action: "publish" | "withdraw" | "progress",
  payload: Record<string, unknown>,
) {
  requireOnline();
  const { data, error } = await db().rpc("course_h5p_action", {
    p_run_id: course,
    p_version_id: version,
    p_action: action,
    p_payload: payload,
  });
  if (error || data !== true) throw error ?? new Error("h5p_action_failed");
}

function RuntimeFrame({
  launch,
  onProgress,
}: {
  launch: Launch;
  onProgress?: (result: PlaybackProgress) => void;
}) {
  const { t } = useTranslation("learning");
  const frame = useRef<HTMLIFrameElement>(null);
  const transferred = useRef(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(false);
  const progressHandler = useRef(onProgress);
  useEffect(() => {
    progressHandler.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    const error = window.setTimeout(() => setFailed(true), 30_000);
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (
        !target ||
        event.origin !== launch.url.origin ||
        event.source !== target ||
        event.data?.session !== launch.session
      )
        return;
      const data = event.data;
      if (data.type === "h5p-ready" && !transferred.current) {
        transferred.current = true;
        target.postMessage(
          { type: "h5p-open", session: launch.session, files: launch.assets },
          launch.url.origin,
          launch.assets.map(({ bytes }) => bytes),
        );
      }
      if (data.type === "h5p-error" || data.type === "h5p-started") {
        clearTimeout(error);
        setFailed(data.type === "h5p-error");
        setActive(data.type === "h5p-started");
      }
      if (
        data.type === "h5p-progress" &&
        transferred.current &&
        typeof data.completed === "boolean" &&
        (data.score === null ||
          (typeof data.score === "number" &&
            Number.isFinite(data.score) &&
            data.score >= 0 &&
            data.score <= 1))
      )
        progressHandler.current?.({
          completed: data.completed,
          score: data.score,
        });
    };
    addEventListener("message", onMessage);
    return () => {
      clearTimeout(error);
      removeEventListener("message", onMessage);
    };
  }, [launch]);

  return failed ? (
    <Notice kind="error">{t("h5pRuntimeFailed")}</Notice>
  ) : (
    <>
      {!active && <Loading />}
      <iframe
        ref={frame}
        src={launch.url.href}
        title={launch.title}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        className="min-h-[34rem] w-full rounded-md border"
      />
    </>
  );
}

export function CourseH5pPlayback({
  actor,
  course,
}: {
  actor: string;
  course: string;
}) {
  const { t } = useTranslation("learning");
  const formId = useId();
  const host = runtimeHost();
  const online = useOnline();
  const cache = useQueryClient();
  const key = ["course-h5p-packages", actor, course];
  const [reviewed, setReviewed] = useState<{
    file: File;
    playback: H5pPlayback;
    clientId: string;
  } | null>(null);
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [withdraw, setWithdraw] = useState<Package | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const packages = useQuery({
    queryKey: key,
    enabled: online,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_h5p_packages", { p_run_id: course }, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return data as Catalogue;
    },
  });
  const review = useMutation({
    mutationFn: async (file: File) => ({
      file,
      playback: await (
        await import("./h5p-runtime-package")
      ).readH5pPlayback(file),
      clientId: crypto.randomUUID(),
    }),
    onSuccess: setReviewed,
  });
  const publish = useMutation({
    mutationFn: async (selection: NonNullable<typeof reviewed>) => {
      const version = await uploadCourseArchive(
        "h5p",
        selection.file,
        course,
        selection.clientId,
      );
      await courseH5pAction(course, version, "publish", {
        title: selection.playback.title,
        sha256: selection.playback.sha256,
      });
    },
    onSuccess: async () => {
      setReviewed(null);
      setFileKey((value) => value + 1);
      await cache.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: (item: Package) =>
      courseH5pAction(course, item.id, "withdraw", {}),
    onSuccess: async () => {
      setWithdraw(null);
      setLaunch(null);
      await cache.invalidateQueries({ queryKey: key });
    },
  });
  const open = useMutation({
    mutationFn: async (item: Package) => {
      if (!host) throw new Error("h5p_runtime_not_configured");
      const blob = await downloadCourseArchive(
        "h5p",
        course,
        item.id,
        AbortSignal.timeout(30_000),
      );
      const prepared = await (
        await import("./h5p-runtime-package")
      ).readH5pPlayback(blob);
      if (item.sha256 !== prepared.sha256 || item.title !== prepared.title)
        throw new Error("h5p_version_changed");
      const session = crypto.randomUUID();
      const url = new URL(`https://${session}.${host}/h5p/`);
      url.searchParams.set("session", session);
      return {
        id: item.id,
        title: item.title,
        session,
        url,
        assets: prepared.assets,
      };
    },
    onSuccess: setLaunch,
  });
  const progress = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PlaybackProgress }) =>
      courseH5pAction(course, id, "progress", data),
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });

  return (
    <section className="panel learning-panel" aria-label={t("h5pRuntime")}>
      <h2>{t("h5pRuntime")}</h2>
      {!host && <p>{t("h5pRuntimeUnconfigured")}</p>}
      {!online ? (
        <p role="status">{t("workspaceOffline")}</p>
      ) : packages.isPending ? (
        <Loading />
      ) : packages.isError ? (
        <ErrorState retry={() => void packages.refetch()} />
      ) : (
        <>
          {packages.data.can_publish && (
            <details>
              <summary>{t("h5pRuntimePublish")}</summary>
              <Field id={formId} label={t("h5pRuntimeFile")}>
                <input
                  key={fileKey}
                  id={formId}
                  type="file"
                  accept=".h5p"
                  disabled={review.isPending || publish.isPending}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    setReviewed(null);
                    review.reset();
                    publish.reset();
                    if (file) review.mutate(file);
                  }}
                />
              </Field>
              {reviewed && (
                <>
                  <p className="preserve-text">{reviewed.playback.title}</p>
                  <Button
                    type="button"
                    disabled={!host || publish.isPending}
                    onClick={() => publish.mutate(reviewed)}
                  >
                    {t("h5pRuntimePublish")}
                  </Button>
                </>
              )}
            </details>
          )}
          {!packages.data.packages.length && <p>{t("h5pRuntimeEmpty")}</p>}
          <ul className="learning-resources">
            {packages.data.packages.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                {item.progress?.completed && <p>{t("h5pRuntimeCompleted")}</p>}
                {item.progress?.score != null && (
                  <p>
                    {t("score", {
                      score: Math.round(item.progress.score * 100),
                    })}
                  </p>
                )}
                <div className="form-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!host || open.isPending}
                    onClick={() => {
                      setLaunch(null);
                      open.mutate(item);
                    }}
                  >
                    {t("h5pRuntimeOpen")}
                  </Button>
                  {packages.data.can_publish && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setWithdraw(item)}
                    >
                      {t("h5pRuntimeWithdraw")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {launch && (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setLaunch(null)}
              >
                {t("h5pRuntimeClose")}
              </Button>
              <RuntimeFrame
                key={launch.session}
                launch={launch}
                onProgress={
                  packages.data.can_complete
                    ? (data) => progress.mutate({ id: launch.id, data })
                    : undefined
                }
              />
            </>
          )}
        </>
      )}
      {(review.isError ||
        publish.isError ||
        open.isError ||
        progress.isError) && (
        <Notice kind="error">{t("h5pRuntimeFailed")}</Notice>
      )}
      <Dialog
        open={withdraw !== null}
        onOpenChange={(visible) => {
          if (!visible) setWithdraw(null);
        }}
        title={t("h5pRuntimeWithdraw")}
        description={withdraw?.title ?? ""}
      >
        {remove.isError && (
          <Notice kind="error">{t("h5pRuntimeFailed")}</Notice>
        )}
        <div className="form-actions">
          <Button
            type="button"
            variant="danger"
            disabled={!withdraw || remove.isPending}
            onClick={() => {
              if (withdraw) remove.mutate(withdraw);
            }}
          >
            {t("h5pRuntimeWithdraw")}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
