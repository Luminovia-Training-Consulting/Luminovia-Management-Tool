import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import "./person-rating-i18n";

const stars = [1, 2, 3, 4, 5] as const;
const scoreSchema = z.int().min(1).max(5);
const ratingSchema = z.object({
  stars: scoreSchema.nullable(),
  comment: z.string(),
  received: z
    .array(
      z.object({
        id: z.uuid(),
        stars: scoreSchema,
        comment: z.string(),
      }),
    )
    .max(30)
    .optional(),
});
type Rating = z.infer<typeof ratingSchema>;

export function PersonRatingDialog({
  actor,
  person,
  name,
  onClose,
}: {
  actor: string;
  person: string;
  name?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("personRating");
  const online = useOnline();
  const own = actor === person;
  const client = useQueryClient();
  const key = ["person-rating", actor, person] as const;
  const rating = useQuery({
    queryKey: key,
    enabled: online,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("person_rating", { p_person_id: person })
        .abortSignal(signal);
      if (error) throw error;
      return ratingSchema.nullable().parse(data);
    },
  });
  const save = useMutation({
    mutationFn: async ({
      score,
      comment,
    }: {
      score: number;
      comment: string;
    }) => {
      requireOnline();
      const { data, error } = await db().rpc("save_person_rating", {
        p_person_id: person,
        p_stars: score,
        p_comment: comment,
      });
      if (error) throw error;
      return ratingSchema.parse(data);
    },
    onSuccess: (saved) => client.setQueryData(key, saved),
  });
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !save.isPending) onClose();
      }}
      title={own ? t("receivedTitle") : t("rateName", { name })}
      description={t(own ? "receivedHelp" : "editHelp")}
      closeDisabled={save.isPending}
    >
      {!online ? (
        <Notice>{t("offline")}</Notice>
      ) : rating.isPending ? (
        <Loading />
      ) : rating.isError ? (
        <ErrorState retry={() => void rating.refetch()} />
      ) : !rating.data ? (
        <Notice>{t("unavailable")}</Notice>
      ) : own ? (
        rating.data.received?.length ? (
          <ul className="people-review-list">
            {rating.data.received.map((review) => (
              <li key={review.id}>
                <strong>{t("score", { count: review.stars })}</strong>
                {review.comment && (
                  <p className="person-prose">{review.comment}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("empty")}</p>
        )
      ) : (
        <RatingForm
          key={person}
          initial={rating.data}
          save={(score, comment) => save.mutate({ score, comment })}
          pending={save.isPending}
          failed={save.isError}
          saved={save.isSuccess}
          resetStatus={save.reset}
        />
      )}
    </Dialog>
  );
}

function RatingForm({
  initial,
  save,
  pending,
  failed,
  saved,
  resetStatus,
}: {
  initial: Rating;
  save: (score: number, comment: string) => void;
  pending: boolean;
  failed: boolean;
  saved: boolean;
  resetStatus: () => void;
}) {
  const { t } = useTranslation("personRating");
  const id = useId();
  const [score, setScore] = useState(initial.stars);
  const [comment, setComment] = useState(initial.comment);
  return (
    <form
      className="section-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (score !== null) save(score, comment.trim());
      }}
    >
      <fieldset disabled={pending}>
        <legend>{t("scoreLabel")}</legend>
        <div className="form-actions">
          {stars.map((value) => (
            <label className="checkbox-label" key={value}>
              <input
                type="radio"
                name={id}
                value={value}
                checked={score === value}
                aria-label={t("score", { count: value })}
                required
                onChange={() => {
                  setScore(value);
                  resetStatus();
                }}
              />
              <Star
                size={16}
                fill={(score ?? 0) >= value ? "currentColor" : "none"}
                aria-hidden="true"
              />
              <span>{value}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field id={id + "-comment"} label={t("comment")}>
        <textarea
          id={id + "-comment"}
          value={comment}
          maxLength={2000}
          disabled={pending}
          onChange={(event) => {
            setComment(event.target.value);
            resetStatus();
          }}
        />
      </Field>
      {failed && <Notice kind="error">{t("failed")}</Notice>}
      {saved && <Notice>{t("saved")}</Notice>}
      <Button type="submit" disabled={score === null || pending}>
        {t("save")}
      </Button>
    </form>
  );
}
