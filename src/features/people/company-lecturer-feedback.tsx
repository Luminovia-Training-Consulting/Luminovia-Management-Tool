/** Read-only lecturer discovery for company accounts. Booking-scoped profile
 * history, private documents and course feedback stay in their original views. */
import { PersonRatingButton } from "./person-rating";
import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  companyLecturerDirectory,
  companyLecturerProfile,
} from "./company-lecturer-feedback-schema";
import "./i18n";

/** Keep each page scoped to the active identity and clear private query data on unmount. */
function feedbackRequest(
  userId: string | null,
  search: string,
  after: string | null,
  signal: AbortSignal,
) {
  return db()
    .rpc("company_lecturer_feedback", {
      p_user_id: userId,
      p_search: search,
      p_after: after,
    })
    .abortSignal(signal);
}

type SetCursors = React.Dispatch<React.SetStateAction<string[]>>;

/** A server cursor can be re-used to revisit exactly one page; no hidden rows are loaded. */
function FeedbackPages({
  cursors,
  next,
  setCursors,
}: {
  cursors: string[];
  next: string | null;
  setCursors: SetCursors;
}) {
  const { t } = useTranslation("people");
  if (!cursors.length && !next) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={!cursors.length}
        onClick={() => setCursors((items) => items.slice(0, -1))}
      >
        {t("companyFeedbackPrevious")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={!next}
        onClick={() => next && setCursors((items) => [...items, next])}
      >
        {t("companyFeedbackNext")}
      </Button>
    </div>
  );
}

/** Search all active lecturer summaries without broadening original People permissions. */
export function CompanyLecturerDirectory({ actor }: { actor: string }) {
  const { t } = useTranslation("people");
  const online = useOnline();
  const searchId = useId();
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors.at(-1) ?? null;
  const query = useQuery({
    queryKey: ["company-lecturer-feedback", actor, search, after],
    enabled: online,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await feedbackRequest(
        null,
        search,
        after,
        signal,
      );
      if (error) throw error;
      return companyLecturerDirectory.parse(data);
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setCursors([]);
    setSearch(draft.trim());
  }
  return (
    <>
      <PageHeading
        title={t("companyFeedbackDirectory")}
        description={t("companyFeedbackHelp")}
      />
      <div className="panel space-y-3">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <Field id={searchId} label={t("search")}>
            <input
              id={searchId}
              type="search"
              maxLength={100}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <Button type="submit">{t("search")}</Button>
        </form>
        <Button asChild variant="ghost">
          <Link to="/people?lecturers=booked">
            {t("companyFeedbackBooked")}
          </Link>
        </Button>
      </div>
      {!online ? (
        <Notice>{t("reviewOffline")}</Notice>
      ) : query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <section
          className="panel space-y-3"
          aria-label={t("companyFeedbackDirectory")}
        >
          {query.data.lecturers.length ? (
            <ul className="divide-y">
              {query.data.lecturers.map((lecturer) => (
                <li key={lecturer.id} className="py-2">
                  <Link to={`/people/${lecturer.id}?lecturers=feedback`}>
                    {lecturer.display_name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("empty")}</p>
          )}
          <FeedbackPages
            cursors={cursors}
            next={query.data.next}
            setCursors={setCursors}
          />
        </section>
      )}
    </>
  );
}

/** Show the anonymized individual scores and current verified qualifications. */
export function CompanyLecturerFeedback({
  actor,
  lecturer,
}: {
  actor: string;
  lecturer: string;
}) {
  const { t, i18n } = useTranslation("people");
  const online = useOnline();
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors.at(-1) ?? null;
  const query = useQuery({
    queryKey: ["company-lecturer-feedback", actor, lecturer, after],
    enabled: online,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await feedbackRequest(
        lecturer,
        "",
        after,
        signal,
      );
      if (error) throw error;
      return companyLecturerProfile.parse(data);
    },
  });
  const format = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 2,
  });
  return (
    <>
      <PageHeading
        title={
          query.data?.lecturer.display_name ?? t("companyFeedbackDirectory")
        }
      />
      <Button asChild variant="ghost">
        <Link to="/people">{t("back")}</Link>
      </Button>
      {!online ? (
        <Notice>{t("reviewOffline")}</Notice>
      ) : query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <div className="section-stack">
          <div className="page-actions">
            <PersonRatingButton
              actor={actor}
              person={lecturer}
              name={query.data.lecturer.display_name}
            />
          </div>
          <section className="panel space-y-3">
            <h2>{t("companyFeedbackQualifications")}</h2>
            <p>
              {t("companyFeedbackHours", {
                hours: format.format(query.data.lecturer.teaching_minutes / 60),
              })}
            </p>
            {query.data.qualifications.length ? (
              <ul className="list-disc pl-5">
                {query.data.qualifications.map((topic) => (
                  <li key={topic.id}>
                    {i18n.language.startsWith("de")
                      ? topic.label_de
                      : topic.label_en}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("companyFeedbackNoQualifications")}</p>
            )}
          </section>
          <section className="panel space-y-3">
            <h2>{t("ratings")}</h2>
            {query.data.reviews.length ? (
              <ul className="divide-y">
                {query.data.reviews.map((review) => (
                  <li key={review.id} className="py-2">
                    {t("ratingValue", { value: review.score })} ·{" "}
                    {t(
                      review.rater_role === "learner"
                        ? "participant"
                        : "companyFeedbackRater",
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("noReviews")}</p>
            )}
            <FeedbackPages
              cursors={cursors}
              next={query.data.next}
              setCursors={setCursors}
            />
          </section>
        </div>
      )}
    </>
  );
}
