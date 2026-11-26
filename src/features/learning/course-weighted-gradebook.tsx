/** Manage optional versioned course grading alongside existing assessment views. */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import type { CourseWorkspace } from "./api";
import {
  saveWeightedGrade,
  weightedGradebookKey,
  weightedGradebookQuery,
} from "./weighted-gradebook-api";
import {
  weightedPolicyDraft,
  type WeightedGradebook,
  type WeightedPolicy,
  type WeightedPolicyItem,
  type WeightedResult,
  type WeightedSource,
} from "./weighted-gradebook-schema";

import "./weighted-gradebook-i18n";

type Context = { actor: string; course: CourseWorkspace };
type ItemDraft = {
  key: string;
  weight: string;
  treatment: WeightedPolicyItem["treatment"];
};

/** Invalidate grade projections only after a confirmed write. */
function useGradeWrite({ actor, course }: Context) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: saveWeightedGrade,
    onSuccess: () =>
      cache.invalidateQueries({
        queryKey: weightedGradebookKey(actor, course.id),
      }),
  });
}

/** Translate fixed source keys and display authored assignment titles as entered. */
function useSourceLabel() {
  const { t } = useTranslation("learning");
  const labels = new Map([
    ["quiz", t("weightedQuiz")],
    ["exam", t("weightedExam")],
    ["text_exam", t("weightedTextExam")],
  ]);
  return ({ key, label }: WeightedSource) =>
    label ?? labels.get(key) ?? key;
}

function WriteError({ error }: { error: unknown }) {
  const { t } = useTranslation("learning");
  if (!error) return null;
  const conflict =
    typeof error === "object" && "code" in error && error.code === "PT409";
  return (
    <Notice kind="error">
      {t(conflict ? "weightedConflict" : "weightedSaveError")}
    </Notice>
  );
}

/** Edit a detached policy draft. Saving makes an additional immutable revision. */
function PolicyEditor({
  context,
  original,
  sources,
  close,
}: {
  context: Context;
  original: WeightedPolicy | null;
  sources: WeightedSource[];
  close: () => void;
}) {
  const { t } = useTranslation("learning");
  const fieldId = useId();
  const sourceLabel = useSourceLabel();
  const save = useGradeWrite(context);
  const [baseVersion] = useState(original?.version ?? 0);
  const stale = baseVersion !== (original?.version ?? 0);
  const [threshold, setThreshold] = useState(
    original ? String(original.threshold) : "",
  );
  const [missing, setMissing] = useState(original?.missing_required ?? "block");
  const [separate, setSeparate] = useState(
    original?.separate_reviewer ?? false,
  );
  const [items, setItems] = useState<ItemDraft[]>(
    original?.items.map(({ key, treatment, weight }) => ({
      key,
      treatment,
      weight: String(weight),
    })) ?? [{ key: "quiz", weight: "100", treatment: "required" }],
  );
  const choices = new Map(sources.map((source) => [source.key, source]));
  original?.items.forEach((item) => {
    if (!choices.has(item.key)) choices.set(item.key, item);
  });
  const parsed = weightedPolicyDraft.safeParse({
    threshold: threshold === "" ? Number.NaN : Number(threshold),
    missing_required: missing,
    separate_reviewer: separate,
    items: items.map((item) => ({ ...item, weight: Number(item.weight) })),
  });

  /** Change only the selected line in the current draft. */
  function update(index: number, patch: Partial<ItemDraft>) {
    setItems((rows) =>
      rows.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.success && !stale && !save.isPending)
          save.mutate(
            {
              p_run_id: context.course.id,
              p_action: "policy",
              p_expected_policy: baseVersion,
              p_payload: parsed.data,
            },
            { onSuccess: close },
          );
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend>{t("weightedPolicy")}</legend>
        <label htmlFor={fieldId + "-threshold"}>{t("weightedThreshold")}</label>
        <input
          id={fieldId + "-threshold"}
          type="number"
          min={0}
          max={100}
          value={threshold}
          onChange={(event) => setThreshold(event.currentTarget.value)}
          required
        />
        <label>
          <span id={fieldId + "-missing"}>{t("weightedMissingPolicy")}</span>
          <select
            aria-labelledby={fieldId + "-missing"}
            value={missing}
            onChange={(event) =>
              setMissing(
                event.currentTarget.value === "zero" ? "zero" : "block",
              )
            }
          >
            <option value="block">{t("weightedMissingBlock")}</option>
            <option value="zero">{t("weightedMissingZero")}</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={separate}
            onChange={(event) => setSeparate(event.currentTarget.checked)}
          />
          {t("weightedSecondReviewer")}
        </label>
        <p>{t("weightedPolicyHelp")}</p>
        {items.map((item, index) => (
          <fieldset key={index} className="course-gradebook-band-fields">
            <legend>{t("weightedItem", { number: index + 1 })}</legend>
            <label>
              <span id={`${fieldId}-assessment-${index}`}>
                {t("weightedAssessment")}
              </span>
              <select
                aria-labelledby={`${fieldId}-assessment-${index}`}
                value={item.key}
                onChange={(event) =>
                  update(index, { key: event.currentTarget.value })
                }
                required
              >
                <option value="">{t("weightedSelectAssessment")}</option>
                {Array.from(choices.values()).map((source) => (
                  <option
                    key={source.key}
                    value={source.key}
                    disabled={items.some(
                      (row, i) => i !== index && row.key === source.key,
                    )}
                  >
                    {sourceLabel(source)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("weightedWeight")}
              <input
                type="number"
                min={1}
                max={100}
                value={item.weight}
                required
                onChange={(event) =>
                  update(index, { weight: event.currentTarget.value })
                }
              />
            </label>
            <label>
              <span id={`${fieldId}-treatment-${index}`}>
                {t("weightedTreatment")}
              </span>
              <select
                aria-labelledby={`${fieldId}-treatment-${index}`}
                value={item.treatment}
                onChange={(event) =>
                  update(index, {
                    treatment:
                      event.currentTarget.value === "bonus"
                        ? "bonus"
                        : event.currentTarget.value === "optional"
                          ? "optional"
                          : "required",
                  })
                }
              >
                <option value="required">{t("weightedRequired")}</option>
                <option value="optional">{t("weightedOptional")}</option>
                <option value="bonus">{t("weightedBonus")}</option>
              </select>
            </label>
            {items.length > 1 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setItems((rows) => rows.filter((_, i) => i !== index))
                }
              >
                {t("weightedRemoveItem")}
              </Button>
            )}
          </fieldset>
        ))}
        <div className="form-actions">
          <Button type="submit" disabled={!parsed.success || stale}>
            {t("weightedSavePolicy")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={items.length >= Math.min(30, choices.size)}
            onClick={() =>
              setItems((rows) => [
                ...rows,
                { key: "", weight: "", treatment: "required" },
              ])
            }
          >
            {t("weightedAddItem")}
          </Button>
          <Button type="button" variant="secondary" onClick={close}>
            {t("portfolioCancel")}
          </Button>
        </div>
      </fieldset>
      {stale && <Notice kind="error">{t("weightedConflict")}</Notice>}
      <WriteError error={save.error} />
    </form>
  );
}

/** Present the frozen score or current evidence without exposing source records. */
function ResultCard({ result }: { result: WeightedResult }) {
  const { t } = useTranslation("learning");
  const sourceLabel = useSourceLabel();
  return (
    <div className="space-y-2">
      <p role="status">
        {result.percent === null
          ? t("weightedIncomplete")
          : t(result.passed ? "weightedPassed" : "weightedFailed", {
              score: result.percent,
            })}
      </p>
      <p>
        {t("weightedPolicySummary", {
          version: result.policy_version,
          threshold: result.threshold,
        })}
      </p>
      <ul className="learning-resources">
        {result.components.map((component) => (
          <li key={component.key}>
            <strong>{sourceLabel(component)}</strong>
            <p>
              {t("weightedComponent", {
                weight: component.weight,
                treatment: t(
                  component.treatment === "required"
                    ? "weightedRequired"
                    : component.treatment === "optional"
                      ? "weightedOptional"
                      : "weightedBonus",
                ),
              })}
            </p>
            <p>
              {component.status === "graded"
                ? t("weightedComponentScore", { score: component.score })
                : t(
                    component.status === "excused"
                      ? "weightedExcused"
                      : component.status === "zero"
                        ? "weightedZero"
                        : component.status === "unscored"
                          ? "weightedUnscored"
                          : "weightedMissing",
                  )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Browse immutable older releases without putting learner histories in the course list. */
function ReleasedHistory({
  context,
  learner,
  latest,
}: {
  context: Context;
  learner: string | null;
  latest: WeightedGradebook;
}) {
  const { t, i18n } = useTranslation("learning");
  const [cursors, setCursors] = useState<number[]>([]);
  const before = cursors.at(-1) ?? null;
  const old = useQuery({
    ...weightedGradebookQuery(
      context.actor,
      context.course.id,
      learner,
      before,
    ),
    enabled: before !== null,
  });
  const page = before === null ? latest : old.data;
  if (!latest.latest_release) return <p>{t("weightedNoRelease")}</p>;
  const formatter = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium",
  });
  return (
    <section className="space-y-2" aria-label={t("weightedHistory")}>
      <h3>{t("weightedHistory")}</h3>
      {old.isError ? (
        <ErrorState retry={() => void old.refetch()} />
      ) : !page ? (
        <Loading />
      ) : (
        <>
          {page.history.map((entry) => (
            <details
              key={entry.revision}
              open={entry.revision === latest.latest_release}
            >
              <summary>
                {t("weightedPublished", {
                  revision: entry.revision,
                  date: formatter.format(new Date(entry.released_at)),
                })}
              </summary>
              {entry.reason && <p className="preserve-text">{entry.reason}</p>}
              <ResultCard result={entry.result} />
            </details>
          ))}
          <div className="form-actions">
            {before !== null && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCursors((items) => items.slice(0, -1))}
              >
                {t("gradebookPrevious")}
              </Button>
            )}
            {page.next_before !== null && (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setCursors((items) => [...items, page.next_before!])
                }
              >
                {t("gradebookNext")}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Record a reason before changing the current learner's exemption for one policy item. */
function ExemptionEditor({
  context,
  learner,
  data,
  policy,
}: {
  context: Context;
  learner: string;
  data: WeightedGradebook;
  policy: WeightedPolicy;
}) {
  const { t } = useTranslation("learning");
  const sourceLabel = useSourceLabel();
  const assessmentLabelId = useId();
  const [selection, setSelection] = useState({
    key: "",
    revision: 0,
    excused: false,
  });
  const [reason, setReason] = useState("");
  const previous = data.exemptions[selection.key];
  const stale = selection.revision !== (previous?.revision ?? 0);
  const save = useGradeWrite(context);
  return (
    <details>
      <summary>{t("weightedExceptions")}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (
            selection.key &&
            reason.trim().length >= 3 &&
            !save.isPending &&
            !stale
          )
            save.mutate(
              {
                p_run_id: context.course.id,
                p_action: "exempt",
                p_expected_policy: policy.version,
                p_payload: {
                  key: selection.key,
                  user_id: learner,
                  excused: !selection.excused,
                  expected_exemption: selection.revision,
                  reason,
                },
              },
              {
                onSuccess: () => {
                  setSelection({ key: "", revision: 0, excused: false });
                  setReason("");
                },
              },
            );
        }}
      >
        <fieldset disabled={save.isPending}>
          <label>
            <span id={assessmentLabelId}>{t("weightedAssessment")}</span>
            <select
              aria-labelledby={assessmentLabelId}
              value={selection.key}
              onChange={(event) => {
                const key = event.currentTarget.value;
                const observed = data.exemptions[key];
                setSelection({
                  key,
                  revision: observed?.revision ?? 0,
                  excused: observed?.excused ?? false,
                });
                setReason("");
              }}
              required
            >
              <option value="">{t("weightedSelectAssessment")}</option>
              {policy.items.map((item) => (
                <option key={item.key} value={item.key}>
                  {sourceLabel(item)}
                </option>
              ))}
            </select>
          </label>
          {previous?.reason && (
            <p className="preserve-text">{previous.reason}</p>
          )}
          <label>
            {t("gradebookReason")}
            <textarea
              value={reason}
              minLength={3}
              maxLength={500}
              required
              onChange={(event) => setReason(event.currentTarget.value)}
            />
          </label>
          <Button
            type="submit"
            disabled={!selection.key || reason.trim().length < 3 || stale}
          >
            {t(
              selection.excused ? "weightedCancelExemption" : "weightedExcuse",
            )}
          </Button>
        </fieldset>
      </form>
      {stale && <Notice kind="error">{t("weightedExemptionChanged")}</Notice>}
      <WriteError error={save.error} />
    </details>
  );
}

/** Release uses a persisted, still matching review and optionally another instructor. */
function ReviewControls({
  context,
  learner,
  data,
  policy,
}: {
  context: Context;
  learner: string;
  data: WeightedGradebook;
  policy: WeightedPolicy;
}) {
  const { t } = useTranslation("learning");
  const [reason, setReason] = useState("");
  const save = useGradeWrite(context);
  const review = data.review;
  const fingerprint = data.fingerprint;
  const current =
    review &&
    review.fingerprint === fingerprint &&
    review.prior_release === data.latest_release &&
    review.policy_version === policy.version;
  const needsOther = policy.separate_reviewer && Boolean(review?.own_review);
  if (!data.preview || data.preview.percent === null || !fingerprint)
    return null;
  const user_id = learner;
  const common = {
    user_id,
    expected_review: review?.revision ?? 0,
    expected_release: data.latest_release,
  };
  const p_run_id = context.course.id;
  const p_expected_policy = policy.version;
  return (
    <div className="space-y-2">
      {current ? (
        <>
          {review.reason && <p className="preserve-text">{review.reason}</p>}
          {needsOther ? (
            <p role="status">{t("weightedAwaitReviewer")}</p>
          ) : (
            <Button
              type="button"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  p_run_id,
                  p_expected_policy,
                  p_action: "release",
                  p_payload: common,
                })
              }
            >
              {t("weightedRelease")}
            </Button>
          )}
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !save.isPending &&
              (data.latest_release === 0 || reason.trim().length >= 3)
            )
              save.mutate(
                {
                  p_run_id,
                  p_expected_policy,
                  p_action: "review",
                  p_payload: { ...common, fingerprint, reason },
                },
                { onSuccess: () => setReason("") },
              );
          }}
        >
          <fieldset disabled={save.isPending}>
            {data.latest_release > 0 && (
              <label>
                {t("gradebookReason")}
                <textarea
                  value={reason}
                  minLength={3}
                  maxLength={500}
                  required
                  onChange={(event) => setReason(event.currentTarget.value)}
                />
              </label>
            )}
            <Button type="submit">{t("weightedReview")}</Button>
          </fieldset>
        </form>
      )}
      <WriteError error={save.error} />
    </div>
  );
}

/** Query only the currently opened section and never display cached grades offline. */
export function CourseWeightedGradebook(context: Context) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  return (
    <section
      className="panel learning-panel course-gradebook space-y-4"
      aria-label={t("weightedTitle")}
    >
      <h2>{t("weightedTitle")}</h2>
      {online ? (
        <OnlineWeightedGradebook {...context} />
      ) : (
        <p role="status">{t("gradebookOffline")}</p>
      )}
    </section>
  );
}

function OnlineWeightedGradebook(context: Context) {
  const { t } = useTranslation("learning");
  const { actor, course } = context;
  const learnerLabelId = useId();
  const [learner, setLearner] = useState("");
  const [editing, setEditing] = useState(false);
  const query = useQuery(
    weightedGradebookQuery(actor, course.id, learner || null),
  );
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  const data = query.data;
  if (!data) return <Loading />;
  return (
    <>
      {course.access.staff && (
        <>
          {data.policy && (
            <p>
              {t("weightedPolicySummary", {
                version: data.policy.version,
                threshold: data.policy.threshold,
              })}
            </p>
          )}
          {data.can_manage && !editing && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(true)}
            >
              {t("weightedEditPolicy")}
            </Button>
          )}
          {editing && data.can_manage && (
            <PolicyEditor
              context={context}
              original={data.policy}
              sources={data.sources}
              close={() => setEditing(false)}
            />
          )}
          {data.policy && (
            <label>
              <span id={learnerLabelId}>{t("weightedLearner")}</span>
              <select
                aria-labelledby={learnerLabelId}
                value={learner}
                onChange={(event) => setLearner(event.currentTarget.value)}
              >
                <option value="">{t("weightedSelectLearner")}</option>
                {course.roster
                  .filter(({ user_id }) => user_id !== actor)
                  .map(({ user_id, name }) => (
                    <option key={user_id} value={user_id}>
                      {name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {data.preview && (
            <section className="space-y-2" aria-label={t("weightedPreview")}>
              <h3>{t("weightedPreview")}</h3>
              <ResultCard result={data.preview} />
            </section>
          )}
          {learner && data.can_manage && data.policy && (
            <>
              <ExemptionEditor
                key={`exemption:${learner}:${data.policy.version}`}
                context={context}
                learner={learner}
                data={data}
                policy={data.policy}
              />
              <ReviewControls
                key={`review:${learner}:${data.policy.version}`}
                context={context}
                learner={learner}
                data={data}
                policy={data.policy}
              />
            </>
          )}
        </>
      )}
      {(!course.access.staff || learner) && (
        <ReleasedHistory
          key={learner}
          context={context}
          learner={learner || null}
          latest={data}
        />
      )}
    </>
  );
}
