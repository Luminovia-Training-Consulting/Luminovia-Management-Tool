import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { courseHubQuery } from "./api";
import { AcademyDraftSchedule } from "./academy-draft-schedule";
import {
  academyCourseCapacity,
  academyCoursePublication,
  academyPublishedCourse,
} from "./academy-publication-schema";
import "./i18n";

/** Keep the action tied to an edited, valid group size. */
function CourseCapacityForm({
  field,
  confirmedCapacity,
  review,
}: {
  field: string;
  confirmedCapacity: number | null;
  review: (capacity: number) => void;
}) {
  const { t } = useTranslation("learning");
  const [draft, setDraft] = useState(
    confirmedCapacity === null ? "" : String(confirmedCapacity),
  );
  const capacity = academyCourseCapacity.safeParse(Number(draft));
  const changed = capacity.success && capacity.data !== confirmedCapacity;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) review(capacity.data);
      }}
    >
      <Field id={field} label={t("academyCourseCapacity")}>
        <input
          name="capacity"
          type="number"
          min="1"
          max="10000"
          step="1"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          required
        />
      </Field>
      <Button type="submit" disabled={!changed}>
        {t(
          confirmedCapacity === null
            ? "academyPublishCourse"
            : "academyChangeCapacity",
        )}
      </Button>
    </form>
  );
}

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
  const [reviewed, setReviewed] = useState<{
    capacity: number;
    previous: number | null;
  }>();
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
    mutationFn: async ({
      capacity,
      previous,
    }: {
      capacity: number;
      previous: number | null;
    }) => {
      requireOnline();
      const args = { p_course_id: courseId, p_capacity: capacity };
      const { data, error } =
        previous === null
          ? await db().rpc("academy_publish_course", args)
          : await db().rpc("academy_set_course_capacity", {
              ...args,
              p_expected_capacity: previous,
            });
      if (error) throw error;
      return academyPublishedCourse.parse(data);
    },
    onSuccess: async (receipt) => {
      setReviewed(undefined);
      cache.setQueryData(key, receipt);
      await cache.invalidateQueries({
        queryKey: courseHubQuery(actor).queryKey,
      });
    },
  });
  const update = reviewed?.previous != null;
  const current = publication.data;
  if (!online || current === null) return null;
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
      {current?.published && (
        <p role="status">
          {t("academyPublishedCapacity", { count: current.capacity })}
        </p>
      )}
      {current?.published === false && <p>{t("academyUnpublishedCourse")}</p>}
      {current?.published === false && !readOnly && (
        <AcademyDraftSchedule courseId={courseId} actor={actor} />
      )}
      {current && !readOnly && (
        <CourseCapacityForm
          key={`${actor}:${courseId}:${current.capacity ?? "draft"}`}
          field={field}
          confirmedCapacity={current.capacity}
          review={(capacity) => {
            publish.reset();
            setReviewed({ capacity, previous: current.capacity });
          }}
        />
      )}
      <Dialog
        open={!readOnly && reviewed !== undefined}
        onOpenChange={(open) => {
          if (!open && !publish.isPending) setReviewed(undefined);
        }}
        title={t(update ? "academyChangeCapacity" : "academyPublishCourse")}
        description={t(
          update ? "academyConfirmCapacity" : "academyConfirmPublishCourse",
          {
            count: reviewed?.capacity,
          },
        )}
      >
        {publish.isError && (
          <Notice kind="error">
            {t(update ? "academyCapacityFailed" : "academyPublishFailed")}
          </Notice>
        )}
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={publish.isPending}
            onClick={() => {
              setReviewed(undefined);
              if (publish.isError) void publication.refetch();
            }}
          >
            {t("enrolmentCancel")}
          </Button>
          <Button
            type="button"
            disabled={publish.isPending}
            onClick={() => {
              if (reviewed) publish.mutate(reviewed);
            }}
          >
            {t("enrolmentConfirm")}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
