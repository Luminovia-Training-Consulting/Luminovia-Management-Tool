import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import { db } from "../../lib/supabase";
import {
  companyAssignableCoursesSchema,
  companyCourseAssignmentLimit,
  companyCourseSearchLimit,
  type AssignableCompanyCourse,
} from "./company-participant-schema";

export function CompanyParticipantCourseAssignment({
  actor,
  organisationId,
  userId,
  pending,
  error,
  onAssign,
  onChange,
  onBack,
}: {
  actor: string;
  organisationId: string;
  userId: string;
  pending: boolean;
  error: "unavailable" | "unknown" | null;
  onAssign: (courseIds: string[]) => void;
  onChange: () => void;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation("operations");
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [selection, setSelection] = useState<AssignableCompanyCourse[]>([]);
  const choices = useInfiniteQuery({
    queryKey: [
      "company-participant-assignable-courses",
      actor,
      organisationId,
      userId,
      submittedSearch,
    ],
    initialPageParam: 0,
    retry: false,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await db()
        .rpc("company_participant_assignable_courses", {
          p_organisation_id: organisationId,
          p_user_id: userId,
          p_search: submittedSearch,
          p_offset: pageParam,
        })
        .abortSignal(signal);
      if (error) throw error;
      return companyAssignableCoursesSchema.parse(data);
    },
    getNextPageParam: (last, _pages, offset) =>
      last.has_more && last.items.length
        ? offset + last.items.length
        : undefined,
  });

  useEffect(() => {
    input.current?.focus();
  }, []);

  const options = new Map(
    choices.data?.pages.flatMap((page) =>
      page.items.map((course) => [course.run_id, course] as const),
    ),
  );
  const atLimit = selection.length === companyCourseAssignmentLimit;
  const remove = (courseId: string) => {
    onChange();
    setSelection((selected) =>
      selected.filter((course) => course.run_id !== courseId),
    );
  };

  return (
    <section
      className="company-course-assignment"
      aria-label={t("participantAssignCourses")}
    >
      <form
        className="company-course-search"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmittedSearch(search.trim());
        }}
      >
        <Field id={id + "-search"} label={t("participantAssignSearch")}>
          <input
            ref={input}
            type="search"
            value={search}
            maxLength={companyCourseSearchLimit}
            disabled={pending}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={pending}>
          {t("participantAssignSearchButton")}
        </Button>
        {submittedSearch && (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setSearch("");
              setSubmittedSearch("");
              input.current?.focus();
            }}
          >
            {t("participantAssignClearSearch")}
          </Button>
        )}
      </form>
      {choices.isPending && <Loading />}
      {choices.isError && <ErrorState retry={() => void choices.refetch()} />}
      {choices.isSuccess && options.size === 0 && (
        <p role="status">
          {t(
            submittedSearch
              ? "participantAssignNoResults"
              : "participantAssignNoCourses",
          )}
        </p>
      )}
      {choices.isSuccess && options.size > 0 && (
        <ul className="company-course-options">
          {[...options.values()].map((course) => {
            const checked = selection.some(
              (candidate) => candidate.run_id === course.run_id,
            );
            return (
              <li key={course.run_id}>
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={pending || (atLimit && !checked)}
                    onChange={() => {
                      if (checked) remove(course.run_id);
                      else {
                        onChange();
                        setSelection((selected) => [...selected, course]);
                      }
                    }}
                  />
                  <span>
                    <strong>{course.title}</strong>
                    <small className="muted">
                      {dateTime(
                        course.starts_at,
                        i18n.language,
                        course.time_zone,
                      )}
                      {" – "}
                      {dateTime(
                        course.ends_at,
                        i18n.language,
                        course.time_zone,
                      )}
                    </small>
                    <small className="muted">
                      {t("participantCourseTimeZone", {
                        zone: course.time_zone,
                      })}
                    </small>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {choices.hasNextPage && !choices.isError && (
        <Button
          type="button"
          variant="secondary"
          disabled={pending || choices.isFetchingNextPage}
          onClick={() => void choices.fetchNextPage()}
        >
          {t("participantMoreCourses")}
        </Button>
      )}
      {selection.length > 0 && (
        <details className="company-course-selection">
          <summary>
            {t("participantAssignSelection", { count: selection.length })}
          </summary>
          <ul>
            {selection.map((course) => (
              <li key={course.run_id}>
                <span>{course.title}</span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  aria-label={t("participantAssignDeselect", {
                    title: course.title,
                  })}
                  onClick={() => remove(course.run_id)}
                >
                  {t("remove", { ns: "translation" })}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {atLimit && (
        <p className="muted">
          {t("participantAssignLimit", { count: companyCourseAssignmentLimit })}
        </p>
      )}
      {error && (
        <Notice kind="error">
          {t(
            error === "unavailable"
              ? "participantAssignUnavailable"
              : "participantAssignError",
          )}
        </Notice>
      )}
      <div className="company-course-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={onBack}
        >
          {t("participantAssignBack")}
        </Button>
        <Button
          type="button"
          disabled={pending || selection.length === 0}
          onClick={() => onAssign(selection.map((course) => course.run_id))}
        >
          {t(
            pending
              ? "participantAssignSaving"
              : selection.length
                ? "participantAssignConfirm"
                : "participantAssignConfirmEmpty",
            { count: selection.length },
          )}
        </Button>
      </div>
    </section>
  );
}
