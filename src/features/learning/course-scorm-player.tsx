/** Learner or staff projection of verified, script-free course packages. */
import "./scorm-package-i18n";
import { lazy, Suspense, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { downloadCourseScormPackage } from "../files/api";
import {
  scormPackageList,
  type CourseScormPackage,
} from "./scorm-course-schema";
import { changeCourseScormPackage, courseScormKey } from "./scorm-course-api";
import "./i18n";

const ActiveScormPlayer = lazy(() =>
  import("./active-scorm-player").then((module) => ({
    default: module.ActiveScormPlayer,
  })),
);

/** Load the archived launch only after an explicit open action and recheck its exact identity. */
function StaticScormPlayer({
  actor,
  course,
  summary,
  canComplete,
}: {
  actor: string;
  course: string;
  summary: CourseScormPackage;
  canComplete: boolean;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const cache = useQueryClient();
  const [lessonId, setLessonId] = useState(
    () =>
      summary.lessons.find(({ id }) => !summary.completed.includes(id))?.id ??
      summary.lessons[0].id,
  );
  const launch = useQuery({
    queryKey: [
      "course-scorm-launch",
      actor,
      course,
      summary.id,
      summary.sha256,
    ],
    queryFn: async ({ signal }) => {
      const loader = await import("./scorm-static-package");
      const file = await downloadCourseScormPackage(course, summary.id, signal);
      const study = await loader.loadScormStaticPackage(
        await file.arrayBuffer(),
        signal,
      );
      if (
        study.report.sha256 !== summary.sha256 ||
        study.report.organisation !== summary.title ||
        study.report.launches.length !== summary.lessons.length ||
        study.report.launches.some(
          (lesson, index) =>
            lesson.id !== summary.lessons[index].id ||
            lesson.title !== summary.lessons[index].title,
        )
      ) {
        throw new Error("scorm_publication_changed");
      }
      return study;
    },
    gcTime: 0,
    retry: false,
    staleTime: Infinity,
  });
  const completion = useMutation({
    mutationFn: (itemId: string) =>
      changeCourseScormPackage(course, summary.id, "complete", {
        item_id: itemId,
      }),
    onSuccess: () =>
      cache.invalidateQueries({ queryKey: courseScormKey(actor, course) }),
  });
  const lesson = launch.data?.report.launches.find(({ id }) => id === lessonId);
  const page = lesson && launch.data?.pages.get(lesson.path);
  return (
    <div className="space-y-3">
      <Field id={id} label={t("scormChooseLesson")}>
        <select
          value={lessonId}
          disabled={completion.isPending}
          onChange={(event) => setLessonId(event.currentTarget.value)}
        >
          {summary.lessons.map(({ id, title }) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </Field>
      {launch.isPending && <Loading />}
      {launch.isError && <Notice kind="error">{t("scormOpenError")}</Notice>}
      {lesson && page && (
        <>
          <iframe
            className="h-96 w-full rounded border"
            title={lesson.title}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={page}
          />
          {canComplete && (
            <Button
              type="button"
              disabled={
                completion.isPending || summary.completed.includes(lessonId)
              }
              onClick={() => completion.mutate(lessonId)}
            >
              {t(
                summary.completed.includes(lessonId)
                  ? "scormLessonCompleted"
                  : "scormCompleteLesson",
              )}
            </Button>
          )}
          {completion.isError && (
            <Notice kind="error">{t("scormSaveError")}</Notice>
          )}
        </>
      )}
    </div>
  );
}

/** Open catalogue and progress only in the current online course workspace. */
export function CourseScormPlayer({
  actor,
  course,
}: {
  actor: string;
  course: string;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const online = useOnline();
  const cache = useQueryClient();
  const [selected, setSelected] = useState("");
  const [opened, setOpened] = useState("");
  const [withdrawing, setWithdrawing] = useState<CourseScormPackage>();
  const catalogue = useQuery({
    queryKey: courseScormKey(actor, course),
    enabled: online,
    gcTime: 0,
    retry: false,
    refetchInterval: opened ? 15000 : false,
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("course_scorm_packages", { p_run_id: course }, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return scormPackageList.parse(data);
    },
  });
  const withdraw = useMutation({
    mutationFn: (version: string) =>
      changeCourseScormPackage(course, version, "withdraw", {}),
    onSuccess: async (_, version) => {
      if (opened === version) setOpened("");
      if (selected === version) setSelected("");
      setWithdrawing(undefined);
      await cache.invalidateQueries({
        queryKey: courseScormKey(actor, course),
      });
    },
  });
  const chosen = catalogue.data?.packages.find(({ id }) => id === selected);
  const active = catalogue.data?.packages.find(({ id }) => id === opened);
  return (
    <section
      className="panel learning-panel space-y-3"
      aria-labelledby={id + "-heading"}
    >
      <h2 id={id + "-heading"}>{t("scormCoursePackages")}</h2>
      {!online ? (
        <p role="status">{t("scormOnline")}</p>
      ) : catalogue.isError ? (
        <ErrorState retry={() => void catalogue.refetch()} />
      ) : !catalogue.data ? (
        <Loading />
      ) : catalogue.data.packages.length === 0 ? (
        <p>{t("scormNone")}</p>
      ) : (
        <>
          <Field id={id + "-package"} label={t("scormChoosePackage")}>
            <select
              value={chosen?.id ?? ""}
              onChange={(event) => {
                setSelected(event.target.value);
                setOpened("");
              }}
            >
              <option value="">{t("scormChoosePackage")}</option>
              {catalogue.data.packages.map(({ id, title }) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </Field>
          {chosen && (
            <>
              <p role="status">
                {t("scormProgress", {
                  completed: chosen.completed.length,
                  total: chosen.lessons.length,
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                {opened !== chosen.id && (
                  <Button type="button" onClick={() => setOpened(chosen.id)}>
                    {t("scormOpenPackage")}
                  </Button>
                )}
                {catalogue.data.can_publish && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      withdraw.reset();
                      setWithdrawing(chosen);
                    }}
                  >
                    {t("scormWithdraw")}
                  </Button>
                )}
              </div>
            </>
          )}
          {active &&
            (active.playback === "runtime" ? (
              <Suspense fallback={<Loading />}>
                <ActiveScormPlayer
                  key={active.id}
                  actor={actor}
                  course={course}
                  summary={active}
                />
              </Suspense>
            ) : (
              <StaticScormPlayer
                key={active.id}
                actor={actor}
                course={course}
                summary={active}
                canComplete={catalogue.data.can_complete}
              />
            ))}
        </>
      )}
      <Dialog
        open={Boolean(withdrawing)}
        closeDisabled={withdraw.isPending}
        title={t("scormWithdraw")}
        description={t("scormWithdrawHelp")}
        onOpenChange={(open) => {
          if (!open) setWithdrawing(undefined);
        }}
      >
        <Button
          type="button"
          disabled={withdraw.isPending || !online || !withdrawing}
          onClick={() => {
            if (withdrawing) withdraw.mutate(withdrawing.id);
          }}
        >
          {t("scormConfirmWithdraw")}
        </Button>
        {withdraw.isError && (
          <Notice kind="error">{t("scormSaveError")}</Notice>
        )}
      </Dialog>
    </section>
  );
}
