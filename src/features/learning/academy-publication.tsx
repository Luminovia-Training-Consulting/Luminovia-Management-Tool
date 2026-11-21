import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { courseHubQuery } from "./api";
import {
  academyCourseCapacity,
  academyCoursePublication,
  academyPublishedCourse,
} from "./academy-publication-schema";
import "./i18n";

/** Show the confirmed course state and let a course manager review publication. */
export function AcademyCoursePublication({
  courseId,
  actor,
  readOnly,
}: {
  courseId: string;
  actor: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const cache = useQueryClient();
  const field = useId();
  const [reviewedCapacity, setReviewedCapacity] = useState<number>();
  const key = ["academy-course-publication", actor, courseId];
  const publication = useQuery({
    queryKey: key,
    retry: false,
    enabled: online,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_course_publication", { p_course_id: courseId })
        .abortSignal(signal);
      if (error) throw error;
      return academyCoursePublication.parse(data);
    },
  });
  const publish = useMutation({
    mutationFn: async (capacity: number) => {
      requireOnline();
      const { data, error } = await db().rpc("academy_publish_course", {
        p_course_id: courseId,
        p_capacity: capacity,
      });
      if (error) throw error;
      return academyPublishedCourse.parse(data);
    },
    onSuccess: async (receipt) => {
      setReviewedCapacity(undefined);
      cache.setQueryData(key, receipt);
      await cache.invalidateQueries({
        queryKey: courseHubQuery(actor).queryKey,
      });
    },
  });
  if (!online || publication.data === null) return null;
  return (
    <section
      className="panel learning-panel"
      aria-labelledby={`${field}-title`}
    >
      <h2 id={`${field}-title`}>{t("academyPublication")}</h2>
      {publication.isPending && <Loading />}
      {publication.isError && (
        <ErrorState retry={() => void publication.refetch()} />
      )}
      {publication.data?.published && (
        <p role="status">
          {t("academyPublishedCapacity", { count: publication.data.capacity })}
        </p>
      )}
      {publication.data?.published === false && (
        <>
          <p>{t("academyUnpublishedCourse")}</p>
          {!readOnly && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const capacity = academyCourseCapacity.safeParse(
                  Number(form.get("capacity")),
                );
                if (capacity.success) {
                  publish.reset();
                  setReviewedCapacity(capacity.data);
                }
              }}
            >
              <Field id={field} label={t("academyCourseCapacity")}>
                <input
                  name="capacity"
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  required
                />
              </Field>
              <Button type="submit">{t("academyPublishCourse")}</Button>
            </form>
          )}
        </>
      )}
      <Dialog
        open={!readOnly && reviewedCapacity !== undefined}
        onOpenChange={(open) => {
          if (!open && !publish.isPending) setReviewedCapacity(undefined);
        }}
        title={t("academyPublishCourse")}
        description={t("academyConfirmPublishCourse", {
          count: reviewedCapacity,
        })}
      >
        {publish.isError && (
          <Notice kind="error">{t("academyPublishFailed")}</Notice>
        )}
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={publish.isPending}
            onClick={() => setReviewedCapacity(undefined)}
          >
            {t("enrolmentCancel")}
          </Button>
          <Button
            type="button"
            disabled={publish.isPending}
            onClick={() => {
              if (reviewedCapacity !== undefined)
                publish.mutate(reviewedCapacity);
            }}
          >
            {t("enrolmentConfirm")}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
