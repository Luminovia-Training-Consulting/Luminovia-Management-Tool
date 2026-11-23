import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { useRequestKey } from "../../lib/request-key";
import { z } from "zod";
import {
  classFeedback,
  classRating,
  classScore,
} from "./company-class-feedback-schema";

const messages = {
  title: ["Klassenfeedback", "Class feedback"],
  noRatings: ["Noch keine Sternebewertungen.", "No star ratings yet."],
  average: ["Sterne im Durchschnitt", "stars on average"],
  singleRating: ["Bewertung", "rating"],
  ratingCount: ["Bewertungen", "ratings"],
  teacher: ["Dozentenfeedback", "Lecturer feedback"],
  company: ["Klassenkommentar", "Class comment"],
  noComments: ["Noch kein Klassenfeedback.", "No class feedback yet."],
  previous: ["Zurück", "Previous"],
  next: ["Weiter", "Next"],
  stars: ["Sterne vergeben", "Give a star rating"],
  choose: ["Bewertung wählen", "Choose a rating"],
  rate: ["Bewertung speichern", "Save rating"],
  comment: ["Kommentar", "Comment"],
  add: ["Kommentar hinzufügen", "Add comment"],
  stored: ["Feedback gespeichert.", "Feedback saved."],
  reload: ["Aktuellen Stand laden", "Reload current version"],
  offline: [
    "Klassenfeedback ist nur online verfügbar.",
    "Class feedback is only available online.",
  ],
  changed: [
    "Die Bewertung wurde geändert. Lade den aktuellen Stand.",
    "The rating changed. Reload the current version.",
  ],
  error: [
    "Das Feedback konnte nicht gespeichert werden.",
    "Feedback could not be saved.",
  ],
  pending: [
    "Deine Bewertung ist nach dem letzten bestätigten Termin möglich.",
    "You can rate the class after the last confirmed session.",
  ],
} as const;

function useText() {
  const { i18n } = useTranslation();
  const german = i18n.language.startsWith("de");
  return {
    word: (key: keyof typeof messages) => messages[key][german ? 0 : 1],
    language: german ? "de" : "en",
  };
}

type FeedbackProps = {
  actor: string;
  classId: string;
  jobId?: string;
};

export function JobClassFeedback(props: FeedbackProps & { jobId: string }) {
  return <ClassFeedback {...props} />;
}

export function CompanyClassFeedback(
  props: Pick<FeedbackProps, "actor" | "classId">,
) {
  return <ClassFeedback {...props} />;
}

function ClassFeedback(props: FeedbackProps) {
  const { word } = useText();
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{word("title")}</summary>
      {open && (
        <FeedbackPanel
          key={`${props.actor}:${props.classId}:${props.jobId ?? ""}`}
          {...props}
        />
      )}
    </details>
  );
}

function FeedbackPanel({ actor, classId, jobId }: FeedbackProps) {
  const { word, language } = useText();
  const cache = useQueryClient();
  const online = useOnline();
  const [pages, setPages] = useState<string[]>([]);
  const prefix = ["class-feedback", actor, classId] as const;
  const after = pages.at(-1) ?? null;
  const feedback = useQuery({
    queryKey: [...prefix, jobId ?? null, after],
    enabled: online,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("class_feedback", {
          p_class_id: classId,
          p_job_id: jobId ?? null,
          p_after: after,
        })
        .abortSignal(signal);
      if (error) throw error;
      return classFeedback.parse(data);
    },
  });

  const refresh = () => {
    setPages([]);
    void cache.invalidateQueries({ queryKey: prefix });
  };
  if (!online) return <Notice>{word("offline")}</Notice>;
  if (feedback.isError)
    return <ErrorState retry={() => void feedback.refetch()} />;
  if (feedback.isPending) return <Loading />;

  const { count, average, comments, rating, can_rate, can_comment } =
    feedback.data;
  return (
    <div className="space-y-3 pt-2">
      <p>
        {average === null
          ? word("noRatings")
          : `${new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(average)}/5 ${word("average")} · ${count} ${word(count === 1 ? "singleRating" : "ratingCount")}`}
      </p>
      {comments.items.length ? (
        <ul className="space-y-2">
          {comments.items.map(({ id, comment, score, source }) => (
            <li key={id}>
              <strong>
                {word(source === "company" ? "company" : "teacher")}
                {score !== null && ` · ${score}/5`}
              </strong>
              {comment && (
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {comment}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>{word("noComments")}</p>
      )}
      {(pages.length > 0 || comments.next) && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!after}
            onClick={() => setPages(pages.slice(0, -1))}
          >
            {word("previous")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!comments.next}
            onClick={() => {
              if (comments.next) setPages([...pages, comments.next]);
            }}
          >
            {word("next")}
          </Button>
        </div>
      )}
      {jobId &&
        (can_rate ? (
          <JobRatingForm
            key={rating?.version ?? 0}
            jobId={jobId}
            classId={classId}
            rating={rating}
            onSaved={refresh}
          />
        ) : (
          <p>{word("pending")}</p>
        ))}
      {can_comment && <CompanyNoteForm classId={classId} onSaved={refresh} />}
    </div>
  );
}

function JobRatingForm({
  classId,
  jobId,
  rating,
  onSaved,
}: {
  classId: string;
  jobId: string;
  rating: z.infer<typeof classRating> | null;
  onSaved: () => void;
}) {
  const { word } = useText();
  const id = useId();
  const online = useOnline();
  const [score, setScore] = useState(rating?.score ?? 0);
  const [comment, setComment] = useState(rating?.comment ?? "");
  const submit = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { data, error } = await db().rpc("save_job_class_rating", {
        p_job_id: jobId,
        p_class_id: classId,
        p_score: classScore.parse(score),
        p_comment: comment.trim(),
        p_expected_version: rating?.version ?? 0,
      });
      if (error) throw error;
      const saved = classRating.parse(data);
      if (
        saved.version !== (rating?.version ?? 0) + 1 ||
        saved.score !== score ||
        saved.comment !== comment.trim()
      ) {
        throw new Error("invalid_class_rating_receipt");
      }
    },
    onSuccess: onSaved,
  });
  const stale =
    submit.error && "code" in submit.error && submit.error.code === "PT409";
  const disabled = !online || submit.isPending;
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && score) submit.mutate();
      }}
    >
      <Field id={`${id}-score`} label={word("stars")}>
        <select
          id={`${id}-score`}
          value={score || ""}
          required
          disabled={disabled}
          onChange={(event) => setScore(Number(event.currentTarget.value))}
        >
          <option value="">{word("choose")}</option>
          {[1, 2, 3, 4, 5].map((value) => (
            <option key={value} value={value}>
              {value}/5
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${id}-rating`} label={word("comment")}>
        <textarea
          id={`${id}-rating`}
          value={comment}
          maxLength={2000}
          disabled={disabled}
          onChange={(event) => setComment(event.currentTarget.value)}
        />
      </Field>
      <div className="form-actions">
        <Button type="submit" disabled={disabled || !score}>
          {word("rate")}
        </Button>
        {stale && (
          <Button type="button" variant="secondary" onClick={onSaved}>
            {word("reload")}
          </Button>
        )}
      </div>
      {submit.isError && (
        <Notice kind="error">{word(stale ? "changed" : "error")}</Notice>
      )}
    </form>
  );
}

function CompanyNoteForm({
  classId,
  onSaved,
}: {
  classId: string;
  onSaved: () => void;
}) {
  const { word } = useText();
  const id = useId();
  const online = useOnline();
  const request = useRequestKey();
  const [comment, setComment] = useState("");
  const submit = useMutation({
    mutationFn: async (draft: string) => {
      requireOnline();
      const { data, error } = await db().rpc("add_company_class_note", {
        p_class_id: classId,
        p_comment: draft,
        p_request_id: request.forInput(draft),
      });
      if (error) throw error;
      return z.uuid().parse(data);
    },
    onSuccess: () => {
      request.clear();
      setComment("");
      onSaved();
    },
  });
  const disabled = !online || submit.isPending;
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && comment.trim()) submit.mutate(comment.trim());
      }}
    >
      <Field id={id} label={word("comment")}>
        <textarea
          id={id}
          value={comment}
          required
          maxLength={2000}
          disabled={disabled}
          onChange={(event) => setComment(event.currentTarget.value)}
        />
      </Field>
      <Button type="submit" disabled={disabled || !comment.trim()}>
        {word("add")}
      </Button>
      {submit.isSuccess && <Notice>{word("stored")}</Notice>}
      {submit.isError && <Notice kind="error">{word("error")}</Notice>}
    </form>
  );
}
