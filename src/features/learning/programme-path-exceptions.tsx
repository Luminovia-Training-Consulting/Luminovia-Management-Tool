/** Course managers can review and change one enrolment's prerequisite exception. */
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import { setLearningProgramPathException } from "./learning-program-api";
import type { LearningProgramDetail } from "./learning-program-schema";

type Member = NonNullable<LearningProgramDetail["roster"]>[number];
type Selection = { position: number; revision: number };

export function ProgrammePathExceptions({
  program,
  roster,
  refresh,
}: {
  program: string;
  roster: Member[];
  refresh: () => void;
}) {
  const { t } = useTranslation("learningPrograms");
  const id = useId();
  const online = useOnline();
  const [person, setPerson] = useState("");
  const [selected, setSelected] = useState<Selection>();
  const [reason, setReason] = useState("");
  const member = roster.find(({ id }) => id === person);
  const courses = (member?.progress.steps ?? []).flatMap((step, index) =>
    index > 0 &&
    step.course_id &&
    (step.state === "locked" || step.prerequisite_exception?.active)
      ? [{ ...step, position: index + 1 }]
      : [],
  );
  const course = courses.find(
    ({ position }) => position === selected?.position,
  );
  const active = course?.prerequisite_exception?.active ?? false;
  const stale =
    selected &&
    (!course ||
      selected.revision !== (course.prerequisite_exception?.revision ?? 0));
  const save = useMutation({
    mutationFn: setLearningProgramPathException,
    onSuccess: () => {
      setSelected(undefined);
      setReason("");
      refresh();
    },
    onError: refresh,
  });
  if (!roster.length) return null;

  return (
    <details className="panel programme-panel">
      <summary>{t("pathExceptions")}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !member ||
            !selected ||
            stale ||
            save.isPending ||
            !online ||
            reason.trim().length < 3
          )
            return;
          save.mutate({
            p_program_id: program,
            p_participant_id: member.id,
            p_position: selected.position,
            p_active: !active,
            p_reason: reason,
            p_expected_revision: selected.revision,
          });
        }}
      >
        <Field id={id + "-learner"} label={t("participant")}>
          <select
            id={id + "-learner"}
            value={member?.id ?? ""}
            disabled={save.isPending}
            onChange={(event) => {
              setPerson(event.currentTarget.value);
              setSelected(undefined);
              setReason("");
              save.reset();
            }}
          >
            <option value="">{t("selectParticipant")}</option>
            {roster.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        {member &&
          (courses.length ? (
            <Field id={id + "-course"} label={t("pathExceptionCourse")}>
              <select
                id={id + "-course"}
                value={course?.position ?? ""}
                disabled={save.isPending}
                onChange={(event) => {
                  const next = courses.find(
                    ({ position }) =>
                      position === Number(event.currentTarget.value),
                  );
                  setSelected(
                    next
                      ? {
                          position: next.position,
                          revision: next.prerequisite_exception?.revision ?? 0,
                        }
                      : undefined,
                  );
                  setReason("");
                  save.reset();
                }}
              >
                <option value="">{t("selectCourse")}</option>
                {courses.map(({ position, title }) => (
                  <option key={position} value={position}>
                    {title}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <p>{t("pathExceptionEmpty")}</p>
          ))}
        {course && (
          <>
            {active && <p>{t("pathExceptionActive")}</p>}
            <Field id={id + "-reason"} label={t("pathExceptionReason")}>
              <textarea
                id={id + "-reason"}
                value={reason}
                disabled={save.isPending}
                onChange={(event) => setReason(event.currentTarget.value)}
                required
                minLength={3}
                maxLength={500}
                rows={3}
              />
            </Field>
            <Button
              type="submit"
              disabled={
                Boolean(stale) ||
                !online ||
                reason.trim().length < 3 ||
                save.isPending
              }
            >
              {t(active ? "pathExceptionWithdraw" : "pathExceptionGrant")}
            </Button>
          </>
        )}
        {save.isSuccess && <Notice>{t("pathExceptionSaved")}</Notice>}
        {(save.isError || stale) && (
          <Notice kind="error">{t("pathExceptionError")}</Notice>
        )}
      </form>
    </details>
  );
}
