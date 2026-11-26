/** Course-scoped grade release and correction, backed by version-checked RPCs. */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading } from "../../components/common";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import { courseAction, courseGradebookQuery } from "./api";
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

function useGradeCommand({ actor, courseId, academy }: Props, version: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ action, payload }: Command) =>
      courseAction(courseId, action, payload, version, academy),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["course-gradebook", actor, courseId],
      }),
  });
}

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
    <div role="alert">
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
            {bands.length < 10 && (
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
          </>
        )}
        <Button type="submit">{t("gradebookSavePolicy")}</Button>
      </fieldset>
      {invalid && <p role="alert">{t("gradebookPolicyInvalid")}</p>}
      <MutationError error={save.error} refresh={refresh} />
    </form>
  );
}

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
  const [correction, setCorrection] = useState(false);
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("");
  const save = useGradeCommand(props, policy?.version ?? 0);
  const { grade, best_attempt: attempt, preview } = row;
  const disabled = !online || save.isPending;
  return (
    <li>
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
      {grade?.reason && <p className="preserve-text">{grade.reason}</p>}
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
          (correction ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (disabled || reason.trim().length < 3 || !value) return;
                save.mutate({
                  action: "gradebook_correct",
                  payload: {
                    user_id: row.user_id,
                    grade_value: value,
                    expected_revision: grade.revision,
                    reason: reason.trim(),
                  },
                });
              }}
            >
              <fieldset disabled={disabled}>
                <legend>{t("gradebookCorrect")}</legend>
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
                <Button disabled={reason.trim().length < 3} type="submit">
                  {t("gradebookSaveCorrection")}
                </Button>
              </fieldset>
            </form>
          ) : (
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => setCorrection(true)}
            >
              {t("gradebookCorrect")}
            </Button>
          ))
        ))}
      <MutationError error={save.error} refresh={refresh} />
    </li>
  );
}

export function CourseGradebook(props: Props) {
  const { t } = useTranslation("learning");
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    ...courseGradebookQuery(props.actor, props.courseId, offset),
    enabled: props.active,
  });
  const data = query.data;
  const refresh = () => void query.refetch();
  const editable = Boolean(data?.can_manage && !props.readOnly);
  return (
    <section
      className="panel learning-panel course-gradebook"
      aria-labelledby="course-gradebook-title"
    >
      <h2 id="course-gradebook-title">{t("gradebookTitle")}</h2>
      {query.isError ? (
        <ErrorState retry={refresh} />
      ) : !data ? (
        props.active ? (
          <Loading />
        ) : null
      ) : props.staff ? (
        <>
          <p>{t("gradebookHelp")}</p>
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
          <ul className="course-gradebook-list">
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
            <div className="actions">
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
        <p role="status">
          {data.own_grade
            ? t("gradebookPublished", {
                grade: mark(data.own_grade),
                revision: data.own_grade.revision,
              })
            : t("gradebookUnpublished")}
        </p>
      )}
    </section>
  );
}
