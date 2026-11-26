/** Course-scoped grade release and correction, backed by version-checked RPCs. */
import { useState, type FormEvent } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading } from "../../components/common";
import { Button } from "../../components/ui/button";
import { downloadCsv } from "../../lib/csv";
import { useOnline } from "../../lib/online";
import {
  courseAction,
  courseGradebookHistoryKey,
  courseGradebookQuery,
  fetchCourseGradebookExport,
  fetchCourseGradebookHistory,
} from "./api";
import {
  courseGradePolicySchema,
  type CourseGradebook,
  type CourseGradebookMark,
} from "./course-gradebook-schema";

type Props = {
  actor: string;
  courseId: string;
  active: boolean;
  academy: boolean;
  staff: boolean;
  readOnly: boolean;
};
type Grade = Pick<CourseGradebookMark, "grade_percent" | "grade_label">;
type Command = {
  action: "gradebook_policy" | "gradebook_publish" | "gradebook_correct";
  payload: Record<string, unknown>;
};
const mark = (grade: Grade) => grade.grade_label ?? `${grade.grade_percent}%`;

/** A command writes against the policy revision the actor reviewed. */
function useGradeCommand({ actor, courseId, academy }: Props, version: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ action, payload }: Command) =>
      courseAction(courseId, action, payload, version, academy),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({
          queryKey: ["course-gradebook", actor, courseId],
        }),
        client.invalidateQueries({
          queryKey: courseGradebookHistoryKey(actor, courseId),
        }),
      ]),
  });
}

/** Offer an explicit reload after a stale write so the actor can review the replacement preview. */
function MutationError({
  error,
  refresh,
}: {
  error: unknown;
  refresh: () => void;
}) {
  const { t } = useTranslation("learning");
  if (!error) return null;
  const conflict =
    typeof error === "object" && "code" in error && error.code === "PT409";
  return (
    <div role="alert" className="space-y-2">
      <p>{t(conflict ? "gradebookConflict" : "gradebookSaveFailed")}</p>
      {conflict && (
        <Button type="button" variant="secondary" onClick={refresh}>
          {t("refresh")}
        </Button>
      )}
    </div>
  );
}

type Projection = CourseGradebook;

/** Validate a detached scale draft and submit a new immutable policy version. */
function PolicyForm({
  props,
  policy,
  refresh,
}: {
  props: Props;
  policy: Projection["policy"];
  refresh: () => void;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const [scheme, setScheme] = useState(policy?.scheme ?? "percentage");
  const [bands, setBands] = useState(() =>
    policy?.bands.length
      ? policy.bands.map((band) => ({ ...band, minimum: String(band.minimum) }))
      : [
          { minimum: "0", label: "" },
          { minimum: "70", label: "" },
        ],
  );
  const [invalid, setInvalid] = useState(false);
  const save = useGradeCommand(props, policy?.version ?? 0);
  function submit(event: FormEvent) {
    event.preventDefault();
    const valid = courseGradePolicySchema.safeParse({
      scheme,
      bands:
        scheme === "bands"
          ? bands.map(({ minimum, label }) => ({
              minimum: minimum === "" ? NaN : Number(minimum),
              label,
            }))
          : [],
    });
    setInvalid(!valid.success);
    if (valid.success && online && !save.isPending)
      save.mutate({ action: "gradebook_policy", payload: valid.data });
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={!online || save.isPending}>
        <legend>{t("gradebookPolicy")}</legend>
        <label>
          {t("gradebookScheme")}
          <select
            value={scheme}
            onChange={(event) =>
              setScheme(event.target.value === "bands" ? "bands" : "percentage")
            }
          >
            <option value="percentage">{t("gradebookPercentage")}</option>
            <option value="bands">{t("gradebookBands")}</option>
          </select>
        </label>
        {scheme === "bands" && (
          <>
            <p>{t("gradebookBandHelp")}</p>
            {bands.map((band, index) => (
              <fieldset key={index}>
                <legend>{t("gradebookBand", { number: index + 1 })}</legend>
                <div className="course-gradebook-band-fields">
                  <label>
                    {t("gradebookMinimum")}
                    <input
                      required
                      type="number"
                      min={0}
                      max={100}
                      value={band.minimum}
                      onChange={(event) =>
                        setBands((items) =>
                          items.map((item, n) =>
                            n === index
                              ? { ...item, minimum: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    {t("gradebookLabel")}
                    <input
                      required
                      maxLength={80}
                      value={band.label}
                      onChange={(event) =>
                        setBands((items) =>
                          items.map((item, n) =>
                            n === index
                              ? { ...item, label: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                {bands.length > 2 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setBands((items) => items.filter((_, n) => index !== n))
                    }
                  >
                    {t("gradebookRemoveBand")}
                  </Button>
                )}
              </fieldset>
            ))}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t("gradebookSavePolicy")}</Button>
          {scheme === "bands" && bands.length < 10 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setBands((items) => [...items, { minimum: "", label: "" }])
              }
            >
              {t("gradebookAddBand")}
            </Button>
          )}
        </div>
      </fieldset>
      {invalid && <p role="alert">{t("gradebookPolicyInvalid")}</p>}
      <MutationError error={save.error} refresh={refresh} />
    </form>
  );
}

/**
 * Render grade history only when explicitly opened. Course/actor/learner keying
 * and immediate cache disposal avoid retaining closed sensitive projections.
 */
function GradeHistory({
  props,
  learner,
}: {
  props: Props;
  learner: string | null;
}) {
  const { t } = useTranslation("learning");
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("gradebookHistory")}</summary>
      {open && <GradeHistoryPage props={props} learner={learner} />}
    </details>
  );
}

/** Follow the cursor returned by the authorised history projection. */
function GradeHistoryPage({
  props,
  learner,
}: {
  props: Props;
  learner: string | null;
}) {
  const { t, i18n } = useTranslation("learning");
  const history = useInfiniteQuery({
    queryKey: [
      ...courseGradebookHistoryKey(props.actor, props.courseId),
      learner,
    ],
    queryFn: ({ pageParam, signal }) =>
      fetchCourseGradebookHistory(props.courseId, learner, pageParam, signal),
    initialPageParam: null as number | null,
    getNextPageParam: ({ next_before }) => next_before,
    retry: false,
    gcTime: 0,
  });
  const formatter = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium",
  });
  if (history.isPending) return <Loading />;
  if (history.isError && !history.isFetchNextPageError) {
    return <ErrorState retry={() => void history.refetch()} />;
  }

  return (
    <>
      <ol role="list" className="learning-resources">
        {history.data?.pages
          .flatMap(({ revisions }) => revisions)
          .map((revision) => (
            <li key={revision.revision}>
              <p>
                {t("gradebookPublished", {
                  grade: mark(revision),
                  revision: revision.revision,
                })}
              </p>
              <p>
                {t("gradebookHistorySource", {
                  quiz: revision.quiz_version,
                  policy: revision.policy_version,
                  date: formatter.format(new Date(revision.published_at)),
                })}
              </p>
              {revision.reason && (
                <p className="preserve-text">{revision.reason}</p>
              )}
            </li>
          ))}
      </ol>
      {history.isFetchNextPageError && (
        <p role="alert">{t("gradebookHistoryLoadFailed")}</p>
      )}
      {history.hasNextPage && (
        <Button
          type="button"
          variant="secondary"
          disabled={history.isFetching}
          onClick={() => void history.fetchNextPage()}
        >
          {t("gradebookOlderGrades")}
        </Button>
      )}
    </>
  );
}

/** Release the current preview or make a reasoned change to an existing grade. */
function GradeRow({
  props,
  row,
  policy,
  editable,
  refresh,
}: {
  props: Props;
  row: Projection["learners"][number];
  policy: Projection["policy"];
  editable: boolean;
  refresh: () => void;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const [adjustment, setAdjustment] = useState<
    null | "correct" | "recalculate"
  >(null);
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("");
  const save = useGradeCommand(props, policy?.version ?? 0);
  const { grade, best_attempt: attempt, preview } = row;
  const disabled = !online || save.isPending;
  const canRecalculate =
    grade &&
    attempt &&
    (grade.attempt_id !== attempt.id ||
      grade.policy_version !== policy?.version);
  return (
    <li className="space-y-2">
      <h3>{row.name}</h3>
      <p>
        {attempt
          ? t("gradebookScore", {
              score: attempt.score,
              version: attempt.quiz_version,
            })
          : t("gradebookNoAttempt")}
      </p>
      {preview && <p>{t("gradebookPreview", { grade: mark(preview) })}</p>}
      <p>
        {grade
          ? t("gradebookPublished", {
              grade: mark(grade),
              revision: grade.revision,
            })
          : t("gradebookUnpublished")}
      </p>
      {grade && <GradeHistory props={props} learner={row.user_id} />}
      {editable &&
        policy &&
        (!grade && attempt && preview ? (
          <Button
            disabled={disabled}
            onClick={() =>
              save.mutate({
                action: "gradebook_publish",
                payload: {
                  user_id: row.user_id,
                  attempt_id: attempt.id,
                  expected_revision: 0,
                  reason: "",
                },
              })
            }
          >
            {t("gradebookPublish")}
          </Button>
        ) : (
          grade &&
          (adjustment ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (disabled || reason.trim().length < 3) return;
                const target = {
                  user_id: row.user_id,
                  expected_revision: grade.revision,
                  reason: reason.trim(),
                };
                if (adjustment === "recalculate" && canRecalculate) {
                  save.mutate({
                    action: "gradebook_publish",
                    payload: { ...target, attempt_id: attempt.id },
                  });
                } else if (adjustment === "correct" && value) {
                  save.mutate({
                    action: "gradebook_correct",
                    payload: { ...target, grade_value: value },
                  });
                }
              }}
            >
              <fieldset disabled={disabled}>
                <legend>
                  {t(
                    adjustment === "recalculate"
                      ? "gradebookRecalculate"
                      : "gradebookCorrect",
                  )}
                </legend>
                {adjustment === "correct" && (
                  <label>
                    {t("gradebookValue")}
                    {policy.scheme === "percentage" ? (
                      <input
                        required
                        type="number"
                        min={0}
                        max={100}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                      />
                    ) : (
                      <select
                        required
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                      >
                        <option value="">{t("gradebookSelectBand")}</option>
                        {policy.bands.map((band) => (
                          <option key={band.minimum}>{band.label}</option>
                        ))}
                      </select>
                    )}
                  </label>
                )}
                <label>
                  {t("gradebookReason")}
                  <textarea
                    required
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      reason.trim().length < 3 ||
                      (adjustment === "correct" ? !value : !canRecalculate)
                    }
                    type="submit"
                  >
                    {t(
                      adjustment === "recalculate"
                        ? "gradebookPublishRecalculation"
                        : "gradebookSaveCorrection",
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setAdjustment(null);
                      setReason("");
                      setValue("");
                      save.reset();
                    }}
                  >
                    {t("gradebookCancelCorrection")}
                  </Button>
                </div>
              </fieldset>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => setAdjustment("correct")}
              >
                {t("gradebookCorrect")}
              </Button>
              {canRecalculate && (
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => setAdjustment("recalculate")}
                >
                  {t("gradebookRecalculate")}
                </Button>
              )}
            </div>
          ))
        ))}
      <MutationError error={save.error} refresh={refresh} />
    </li>
  );
}

/** Keep private grade state mounted only in the active, online course panel. */
export function CourseGradebook(props: Props) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  return (
    <section
      className="panel learning-panel course-gradebook space-y-4"
      aria-labelledby="course-gradebook-title"
    >
      <h2 id="course-gradebook-title">{t("gradebookTitle")}</h2>
      {props.active &&
        (online ? (
          <OnlineGradebook {...props} />
        ) : (
          <p role="status">{t("gradebookOffline")}</p>
        ))}
    </section>
  );
}

/** Export only after the current staff request succeeds, with CSV cell protection. */
function GradeExport({ courseId }: { courseId: string }) {
  const { t } = useTranslation("learning");
  const [empty, setEmpty] = useState(false);
  const report = useMutation({
    mutationFn: () => fetchCourseGradebookExport(courseId),
    gcTime: 0,
  });
  function exportGrades() {
    setEmpty(false);
    report.mutate(undefined, {
      onSuccess: (rows) => {
        if (rows.length === 0) {
          setEmpty(true);
          report.reset();
          return;
        }
        downloadCsv(`quiz-grades-${courseId}.csv`, [
          [
            "participant_id",
            "name",
            "grade_percent",
            "grade_label",
            "revision",
            "policy_version",
            "quiz_version",
            "published_at",
          ],
          ...rows.map(({ user_id, name, grade }) => [
            user_id,
            name,
            grade.grade_percent,
            grade.grade_label,
            grade.revision,
            grade.policy_version,
            grade.quiz_version,
            grade.published_at,
          ]),
        ]);
        report.reset();
      },
    });
  }
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        disabled={report.isPending}
        onClick={exportGrades}
      >
        {t("gradebookExport")}
      </Button>
      {empty && <p role="status">{t("gradebookExportEmpty")}</p>}
      {report.isError && <p role="alert">{t("gradebookExportFailed")}</p>}
    </div>
  );
}

/** Mount the sensitive projection only while the gradebook is open and online. */
function OnlineGradebook(props: Props) {
  const { t } = useTranslation("learning");
  const [offset, setOffset] = useState(0);
  const query = useQuery(
    courseGradebookQuery(props.actor, props.courseId, offset),
  );
  const data = query.data;
  const refresh = () => void query.refetch();
  const editable = Boolean(data?.can_manage && !props.readOnly);
  return (
    <>
      {query.isError ? (
        <ErrorState retry={refresh} />
      ) : !data ? (
        <Loading />
      ) : props.staff ? (
        <>
          <p>{t("gradebookHelp")}</p>
          <GradeExport courseId={props.courseId} />
          {data.policy && (
            <p>
              {t("gradebookPolicyVersion", { version: data.policy.version })}
            </p>
          )}
          {editable && (
            <PolicyForm
              key={data.policy?.version ?? 0}
              props={props}
              policy={data.policy}
              refresh={refresh}
            />
          )}
          {!data.learners.length && <p>{t("gradebookNoLearners")}</p>}
          <ul role="list" className="learning-resources">
            {data.learners.map((row) => (
              <GradeRow
                key={`${row.user_id}:${row.grade?.revision}:${data.policy?.version}`}
                props={props}
                row={row}
                policy={data.policy}
                editable={editable}
                refresh={refresh}
              />
            ))}
          </ul>
          {data.total > data.limit || offset > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - data.limit))}
              >
                {t("gradebookPrevious")}
              </Button>
              <Button
                variant="secondary"
                disabled={offset + data.limit >= data.total}
                onClick={() => setOffset(offset + data.limit)}
              >
                {t("gradebookNext")}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p role="status">
            {data.own_grade
              ? t("gradebookPublished", {
                  grade: mark(data.own_grade),
                  revision: data.own_grade.revision,
                })
              : t("gradebookUnpublished")}
          </p>
          {data.own_grade && <GradeHistory props={props} learner={null} />}
        </>
      )}
    </>
  );
}
