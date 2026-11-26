/** Staff-moderated peer exchange with private learner text, explicit opt-in and dispute handling. */
import { useId, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import type { PeerFeedbackState } from "./peer-feedback-schema";
import "./peer-feedback-i18n";

type Props = { actor: string; course: string; staff: boolean };
type Command = {
  action:
    | "open"
    | "entry"
    | "withdraw"
    | "approve_entry"
    | "start"
    | "feedback"
    | "approve_feedback"
    | "release"
    | "dispute"
    | "resolve";
  payload?: Record<string, unknown>;
};
type Controls = {
  state: PeerFeedbackState;
  pending: boolean;
  run: (command: Command) => void;
};

/** Open on demand so only an active, online actor fetches current peer content. */
export function CoursePeerFeedback(props: Props) {
  const { t } = useTranslation("learning");
  const [open, setOpen] = useState(false);
  const online = useOnline();
  return (
    <details
      className="panel learning-panel space-y-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("peerTitle")}</summary>
      {open &&
        (online ? (
          <OpenPeerFeedback {...props} />
        ) : (
          <p role="status">{t("peerOffline")}</p>
        ))}
    </details>
  );
}

function OpenPeerFeedback({ actor, course, staff }: Props) {
  const { t } = useTranslation("learning");
  const cache = useQueryClient();
  const selectorId = useId();
  const [round, setRound] = useState<number | null>(null);
  const key = ["course-peer-feedback", actor, course];
  const query = useQuery({
    queryKey: [...key, round],
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_peer_feedback", {
          p_run_id: course,
          ...(round === null ? {} : { p_round_number: round }),
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as PeerFeedbackState;
    },
  });
  const write = useMutation({
    mutationFn: async ({ action, payload }: Command) => {
      requireOnline();
      const { data, error } = await db().rpc("course_peer_feedback_action", {
        p_run_id: course,
        p_action: action,
        p_payload: {
          ...payload,
          round:
            action === "open"
              ? (query.data?.rounds[0]?.number ?? 0) + 1
              : query.data?.round_number,
        },
      });
      if (error) throw error;
      if (data !== true) throw new Error("Unconfirmed peer feedback command");
    },
    onSuccess: (_, { action }) => {
      if (action === "open") setRound(null);
      return cache.invalidateQueries({ queryKey: key });
    },
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  const conflict =
    typeof write.error === "object" &&
    write.error !== null &&
    "code" in write.error &&
    write.error.code === "PT409";
  const controls: Controls = {
    state: query.data,
    pending: write.isPending,
    run: write.mutate,
  };

  return (
    <>
      <p>{t("peerPrivacy")}</p>
      {query.data.rounds.length > 1 && (
        <Field id={selectorId} label={t("peerSelectRound")}>
          <select
            id={selectorId}
            value={round ?? ""}
            disabled={write.isPending}
            onChange={(event) => {
              write.reset();
              setRound(event.target.value ? Number(event.target.value) : null);
            }}
          >
            {query.data.rounds.map(({ number, prompt, stage }, index) => (
              <option key={number} value={index ? number : ""}>
                {t("peerRoundOption", {
                  number,
                  prompt,
                  stage: t(`peerRound_${stage}`),
                })}
              </option>
            ))}
          </select>
        </Field>
      )}
      {query.isPlaceholderData ? (
        <Loading />
      ) : (
        <>
          {query.data.prompt && (
            <p className="preserve-text">{query.data.prompt}</p>
          )}
          {query.data.assignment_rubric && (
            <section>
              <h3>{t("peerCriteriaTitle")}</h3>
              <p>{t("peerCriteriaOption", query.data.assignment_rubric)}</p>
              <ul>
                {query.data.assignment_rubric.criteria.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
            </section>
          )}
          {staff ? (
            <PeerModeration key={query.data.round_number ?? 0} {...controls} />
          ) : (
            <LearnerExchange key={query.data.round_number ?? 0} {...controls} />
          )}
          {staff &&
            query.data.can_moderate &&
            query.data.stage === "released" &&
            query.data.round_number === query.data.rounds[0]?.number && (
              <details>
                <summary>{t("peerOpenNext")}</summary>
                <StartPeerRound key={query.data.round_number} {...controls} />
              </details>
            )}
        </>
      )}
      {write.isSuccess && <Notice>{t("saved")}</Notice>}
      {write.isError && (
        <Notice kind="error">
          {t(conflict ? "peerConflict" : "saveError")}
          {conflict && (
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                write.reset();
                void query.refetch();
              }}
            >
              {t("peerReload")}
            </Button>
          )}
        </Notice>
      )}
    </>
  );
}

/** Keep each text input local to its own command and make response release explicit. */
function PeerTextForm({
  label,
  submitLabel,
  pending,
  initial = "",
  max = 2000,
  onSubmit,
  children,
}: {
  label: string;
  submitLabel: string;
  pending: boolean;
  initial?: string;
  max?: number;
  onSubmit: (body: string) => void;
  children?: React.ReactNode;
}) {
  const id = useId();
  const [body, setBody] = useState(initial);
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && body.trim().length >= 3) onSubmit(body);
      }}
    >
      <Field id={id} label={label}>
        <textarea
          required
          minLength={3}
          maxLength={max}
          rows={3}
          value={body}
          disabled={pending}
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>
      {children}
      <Button type="submit" disabled={pending || body.trim().length < 3}>
        {submitLabel}
      </Button>
    </form>
  );
}

function StartPeerRound({ state, pending, run }: Controls) {
  const { t } = useTranslation("learning");
  const id = useId();
  const [assignment, setAssignment] = useState<string>("");
  const selected = state.available_assignments.find(
    ({ id, version }) => `${id}:${version}` === assignment,
  );
  const stale = Boolean(assignment && !selected);
  return (
    <PeerTextForm
      label={t("peerPrompt")}
      submitLabel={t("peerOpen")}
      max={1000}
      pending={pending || stale}
      onSubmit={(body) =>
        run({
          action: "open",
          payload: {
            body,
            ...(selected
              ? {
                  assignment_id: selected.id,
                  assignment_version: selected.version,
                }
              : {}),
          },
        })
      }
    >
      {(state.available_assignments.length > 0 || stale) && (
        <Field id={id} label={t("peerCriteriaAssignment")}>
          <select
            id={id}
            value={assignment}
            disabled={pending}
            onChange={(event) => setAssignment(event.currentTarget.value)}
          >
            <option value="">{t("peerCriteriaNone")}</option>
            {stale && (
              <option value={assignment} disabled>
                {t("peerCriteriaChanged")}
              </option>
            )}
            {state.available_assignments.map((option) => (
              <option key={option.id} value={`${option.id}:${option.version}`}>
                {t("peerCriteriaOption", option)}
              </option>
            ))}
          </select>
        </Field>
      )}
    </PeerTextForm>
  );
}

function PeerModeration({ state, pending, run }: Controls) {
  const { t } = useTranslation("learning");
  const blocked = pending || !state.can_moderate;
  if (!state.stage)
    return state.can_moderate ? (
      <StartPeerRound state={state} pending={blocked} run={run} />
    ) : (
      <p>{t("peerNoRound")}</p>
    );

  if (state.stage === "collecting")
    return (
      <>
        <ul className="learning-resources">
          {state.entries.map((entry) => (
            <li key={entry.id} className="space-y-2">
              <p className="preserve-text">{entry.body}</p>
              {entry.approved ? (
                <p>{t("peerApprovedEntry")}</p>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={blocked}
                  onClick={() =>
                    run({
                      action: "approve_entry",
                      payload: { id: entry.id, revision: entry.revision },
                    })
                  }
                >
                  {t("peerApproveEntry")}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p>{t("peerStartHelp")}</p>
        <Button
          type="button"
          disabled={
            blocked ||
            state.entries.filter(({ approved }) => approved).length < 3
          }
          onClick={() => run({ action: "start" })}
        >
          {t("peerStart")}
        </Button>
      </>
    );

  return (
    <>
      <ul className="learning-resources">
        {state.reviews.map((review) => (
          <li key={review.id} className="space-y-2">
            <p className="preserve-text">{review.feedback}</p>
            {state.stage === "reviewing" && !review.approved && (
              <Button
                type="button"
                variant="secondary"
                disabled={blocked}
                onClick={() =>
                  run({
                    action: "approve_feedback",
                    payload: { id: review.id },
                  })
                }
              >
                {t("peerApproveFeedback")}
              </Button>
            )}
            {review.dispute && (
              <p className="preserve-text">{review.dispute}</p>
            )}
            {review.resolution && (
              <p className="preserve-text">{review.resolution}</p>
            )}
            {review.dispute && !review.resolution && state.can_moderate && (
              <ResolutionForm id={review.id} pending={pending} run={run} />
            )}
          </li>
        ))}
      </ul>
      {state.stage === "reviewing" && (
        <>
          <p>{t("peerReleaseHelp")}</p>
          <Button
            type="button"
            disabled={
              blocked || !state.reviews.some(({ approved }) => approved)
            }
            onClick={() => run({ action: "release" })}
          >
            {t("peerRelease")}
          </Button>
        </>
      )}
    </>
  );
}

function ResolutionForm({
  id,
  pending,
  run,
}: {
  id: string;
  pending: boolean;
  run: Controls["run"];
}) {
  const { t } = useTranslation("learning");
  const [keep, setKeep] = useState(false);
  return (
    <PeerTextForm
      label={t("peerResolution")}
      submitLabel={t("peerResolve")}
      max={1000}
      pending={pending}
      onSubmit={(body) =>
        run({ action: "resolve", payload: { id, body, keep } })
      }
    >
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={keep}
          disabled={pending}
          onChange={(event) => setKeep(event.target.checked)}
        />
        {t("peerKeep")}
      </label>
    </PeerTextForm>
  );
}

function LearnerExchange({ state, pending, run }: Controls) {
  const { t } = useTranslation("learning");
  if (!state.stage) return <p>{t("peerNoRound")}</p>;
  if (state.stage === "collecting")
    return (
      <>
        {state.can_write && (
          <PeerTextForm
            key={state.own_entry?.revision ?? 0}
            label={t("peerEntry")}
            submitLabel={t("peerSaveEntry")}
            pending={pending}
            initial={state.own_entry?.body}
            onSubmit={(body) =>
              run({
                action: "entry",
                payload: { body, revision: state.own_entry?.revision ?? 0 },
              })
            }
          />
        )}
        {state.own_entry && (
          <>
            {!state.can_write && (
              <p className="preserve-text">{state.own_entry.body}</p>
            )}
            <p>
              {t(
                state.own_entry.approved
                  ? "peerApprovedEntry"
                  : "peerPendingEntry",
              )}
            </p>
            {state.can_write && (
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  run({
                    action: "withdraw",
                    payload: { revision: state.own_entry?.revision ?? 0 },
                  })
                }
              >
                {t("peerWithdraw")}
              </Button>
            )}
          </>
        )}
      </>
    );
  if (state.stage === "reviewing")
    return state.assignment ? (
      <>
        <h3>{t("peerAssignment")}</h3>
        <p className="preserve-text">{state.assignment.body}</p>
        {state.assignment.feedback ? (
          <p className="preserve-text">{state.assignment.feedback}</p>
        ) : (
          state.can_write && (
            <PeerTextForm
              label={t("peerWriteFeedback")}
              submitLabel={t("peerSubmitFeedback")}
              pending={pending}
              onSubmit={(body) =>
                run({ action: "feedback", payload: { body } })
              }
            />
          )
        )}
      </>
    ) : (
      <p>{t("peerNoAssignment")}</p>
    );

  return (
    <>
      <h3>{t("peerReceived")}</h3>
      {state.received?.feedback ? (
        <p className="preserve-text">{state.received.feedback}</p>
      ) : (
        !state.received?.dispute && <p>{t("peerNoFeedback")}</p>
      )}
      {state.received?.dispute && (
        <>
          <p className="preserve-text">{state.received.dispute}</p>
          {state.received.resolution ? (
            <>
              <h4>{t("peerResolution")}</h4>
              <p className="preserve-text">{state.received.resolution}</p>
            </>
          ) : (
            <p>{t("peerReportPending")}</p>
          )}
        </>
      )}
      {state.received?.feedback &&
        !state.received.dispute &&
        state.can_write && (
          <PeerTextForm
            label={t("peerDispute")}
            submitLabel={t("peerReportFeedback")}
            max={1000}
            pending={pending}
            onSubmit={(body) => run({ action: "dispute", payload: { body } })}
          />
        )}
    </>
  );
}
