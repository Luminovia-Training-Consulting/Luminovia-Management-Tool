/** Local instructor bookings after the customer installation and course role gates. */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { courseWorkspaceKey } from "./api";
import "./i18n";

type Candidate = { id: string; name: string; assignment_id: string | null };

export function AcademyInstructors({
  courseId,
  actor,
}: {
  courseId: string;
  actor: string;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const cache = useQueryClient();
  const field = useId();
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState("");
  const [review, setReview] = useState<{
    candidate: Candidate;
    command: string;
  }>();
  const [reason, setReason] = useState("");
  const key = ["academy-course-instructor-candidates", actor, courseId];
  const candidates = useQuery({
    queryKey: [...key, search],
    enabled: online,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_course_instructor_candidates", {
          p_course_id: courseId,
          p_search: search,
        })
        .abortSignal(signal);
      if (error || !Array.isArray(data))
        throw error ?? new Error("invalid_academy_instructor_list");
      return data as Candidate[];
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!review) throw new Error("assignment_not_reviewed");
      const { candidate, command } = review;
      const args = { p_course_id: courseId, p_request_id: command };
      const reply = candidate.assignment_id
        ? await db().rpc("academy_release_course_instructor", {
            ...args,
            p_claim_id: candidate.assignment_id,
            p_reason: reason.trim(),
          })
        : await db().rpc("academy_assign_course_instructor", {
            ...args,
            p_instructor_id: candidate.id,
          });
      if (
        reply.error ||
        reply.data?.status !==
          (candidate.assignment_id ? "cancelled" : "confirmed")
      )
        throw new Error(
          reply.data?.status === "conflict" ? "conflict" : "unconfirmed",
        );
    },
    onSuccess: async () => {
      setReview(undefined);
      setSelection("");
      await Promise.all([
        cache.invalidateQueries({ queryKey: key }),
        cache.invalidateQueries({
          queryKey: courseWorkspaceKey(actor, courseId),
        }),
        cache.invalidateQueries({
          queryKey: ["course-operation-destinations", actor, courseId],
        }),
      ]);
    },
  });

  const candidate = candidates.data?.find(({ id }) => id === selection);
  const releasing = Boolean(review?.candidate.assignment_id);
  const action = (item: Candidate) =>
    t(item.assignment_id ? "academyRelease" : "academyAssign");
  return (
    <section
      className="panel learning-panel"
      aria-labelledby={field + "-title"}
    >
      <h2 id={field + "-title"}>{t("academyInstructors")}</h2>
      {!online ? (
        <Notice>{t("workspaceOffline")}</Notice>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSelection("");
              setSearch(filter.trim());
            }}
          >
            <Field id={field + "-search"} label={t("academyInstructorSearch")}>
              <input
                value={filter}
                maxLength={120}
                onChange={(event) => setFilter(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="secondary">
              {t("academySearch")}
            </Button>
          </form>
          {candidates.isPending && <Loading />}
          {candidates.isError && (
            <ErrorState retry={() => void candidates.refetch()} />
          )}
          {candidates.isSuccess &&
            (candidates.data.length ? (
              <div className="course-enrolment-actions">
                <Field id={field + "-choice"} label={t("academyInstructor")}>
                  <select
                    value={selection}
                    onChange={(event) => setSelection(event.target.value)}
                  >
                    <option value="">{t("academyChooseInstructor")}</option>
                    {candidates.data.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.assignment_id ? " · " + t("academyAssigned") : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  type="button"
                  disabled={!candidate || save.isPending}
                  onClick={() => {
                    if (!candidate) return;
                    save.reset();
                    setReason("");
                    setReview({ candidate, command: crypto.randomUUID() });
                  }}
                >
                  {candidate ? action(candidate) : t("academyAssign")}
                </Button>
              </div>
            ) : (
              <p>{t("academyNoInstructors")}</p>
            ))}
          {save.isSuccess && <Notice>{t("academyAssignmentSaved")}</Notice>}
        </>
      )}
      <Dialog
        open={Boolean(review)}
        onOpenChange={(open) =>
          !open && !save.isPending && setReview(undefined)
        }
        title={review ? action(review.candidate) : t("academyInstructors")}
        description={t(
          releasing ? "academyConfirmRelease" : "academyConfirmAssignment",
          { name: review?.candidate.name },
        )}
      >
        {releasing && (
          <Field id={field + "-reason"} label={t("academyReleaseReason")}>
            <textarea
              value={reason}
              maxLength={1000}
              disabled={save.isPending}
              onChange={(event) => {
                setReason(event.target.value);
                if (save.isError && review) {
                  // A corrected reason changes the requested write; a retry of the
                  // same reason keeps the idempotency key after an uncertain reply.
                  save.reset();
                  setReview({ ...review, command: crypto.randomUUID() });
                }
              }}
            />
          </Field>
        )}
        {save.isError && (
          <Notice kind="error">
            {t(
              save.error.message === "conflict"
                ? "academyInstructorConflict"
                : "saveError",
            )}
          </Notice>
        )}
        <Button
          type="button"
          disabled={
            !online || save.isPending || (releasing && reason.trim().length < 3)
          }
          onClick={() => save.mutate()}
        >
          {t("academyConfirm")}
        </Button>
      </Dialog>
    </section>
  );
}
