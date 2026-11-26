import { useId, useState, type ComponentType, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { zonedInstantForScheduleEdit } from "../../lib/dates";
import {
  assignmentTeamInput,
  type CourseAssignmentTeam,
} from "./course-assignment-schema";

type AssignmentTeamProps = {
  teams: CourseAssignmentTeam[];
  participants: Array<{ user_id: string; name: string; status: string }>;
  zone: string;
  canManage: boolean;
  command: (
    action: "save_team" | "remove_team",
    input: unknown,
    version: number,
  ) => Promise<unknown>;
  ErrorMessage: ComponentType<{ error: unknown }>;
};

type TeamEditorProps = Omit<AssignmentTeamProps, "teams" | "canManage"> & {
  team: CourseAssignmentTeam | undefined;
  onRemoved: () => void;
  onSaved: (id: string) => void;
};

function TeamEditor({
  team,
  command,
  zone,
  participants,
  ErrorMessage,
  onRemoved,
  onSaved,
}: TeamEditorProps) {
  const { t } = useTranslation("learning");
  const [teamId] = useState(() => team?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(team?.title ?? "");
  const [due, setDue] = useState(() =>
    team?.due_at
      ? DateTime.fromISO(team.due_at)
          .setZone(zone)
          .toFormat("yyyy-MM-dd'T'HH:mm")
      : "",
  );
  const [members, setMembers] = useState(team?.member_ids ?? []);
  const [invalid, setInvalid] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const choices = participants.filter(
    ({ status, user_id }) => status === "enrolled" || members.includes(user_id),
  );
  const save = useMutation({
    mutationFn: (input: typeof assignmentTeamInput._output) =>
      command("save_team", input, team?.version ?? 0),
    onSuccess: () => onSaved(teamId),
  });
  const remove = useMutation({
    mutationFn: () =>
      command("remove_team", { team_id: teamId }, team?.version ?? 0),
    onSuccess: onRemoved,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const instant = due
      ? zonedInstantForScheduleEdit(due, zone, team?.due_at ?? undefined, zone)
      : null;
    const payload = assignmentTeamInput.safeParse({
      team_id: teamId,
      title,
      due_at: instant,
      member_ids: members,
    });
    const valid = payload.success && (!due || Boolean(instant));
    setInvalid(!valid);
    if (valid) save.mutate(payload.data);
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <fieldset
        disabled={save.isPending || remove.isPending}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            {t("assignmentsTeamName")}
            <input
              required
              maxLength={100}
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </label>
          <label>
            {t("assignmentsTeamDue", { zone })}
            <input
              type="datetime-local"
              value={due}
              onChange={(event) => setDue(event.currentTarget.value)}
            />
          </label>
        </div>
        <fieldset disabled={team?.locked} className="space-y-2">
          <legend>{t("assignmentsTeamMembers")}</legend>
          {team?.locked && <p>{t("assignmentsTeamLocked")}</p>}
          {choices.length === 0 && <p>{t("assignmentsTeamNoLearners")}</p>}
          <ul className="grid max-h-56 gap-2 overflow-auto sm:grid-cols-2">
            {choices.map(({ user_id, name }) => (
              <li key={user_id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={members.includes(user_id)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setMembers((previous) =>
                        checked
                          ? [...previous, user_id]
                          : previous.filter((id) => id !== user_id),
                      );
                    }}
                  />
                  {name}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t("assignmentsTeamSave")}</Button>
          {team && !team.locked && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmRemove(true)}
            >
              {t("assignmentsTeamRemove")}
            </Button>
          )}
        </div>
        {confirmRemove && (
          <div className="space-y-2">
            <p>{t("assignmentsTeamConfirmRemove", { title: team?.title })}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => remove.mutate()}>
                {t("assignmentsTeamRemoveConfirm")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmRemove(false)}
              >
                {t("assignmentsTeamCancel")}
              </Button>
            </div>
          </div>
        )}
      </fieldset>
      {invalid && <Notice kind="error">{t("assignmentsTeamInvalid")}</Notice>}
      <ErrorMessage error={save.error ?? remove.error} />
    </form>
  );
}

export default function AssignmentTeams({
  teams,
  canManage,
  ...editor
}: AssignmentTeamProps) {
  const { t } = useTranslation("learning");
  const selectId = useId();
  const [selection, setSelection] = useState("");
  const team = teams.find(({ id }) => id === selection);
  if (!canManage) {
    return teams.length > 0 ? (
      <ul>
        {teams.map(({ id, title }) => (
          <li key={id}>{title}</li>
        ))}
      </ul>
    ) : (
      <p>{t("assignmentsTeamEmpty")}</p>
    );
  }

  return (
    <div className="space-y-3 py-2">
      {teams.length > 0 && (
        <div>
          <label htmlFor={selectId}>{t("assignmentsTeamChoose")}</label>
          <select
            id={selectId}
            value={team?.id ?? ""}
            onChange={(event) => setSelection(event.currentTarget.value)}
          >
            <option value="">{t("assignmentsTeamNew")}</option>
            {teams.map(({ id, title }) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </div>
      )}
      <TeamEditor
        key={team ? `${team.id}:${team.version}` : "new"}
        {...editor}
        team={team}
        onRemoved={() => setSelection("")}
        onSaved={setSelection}
      />
    </div>
  );
}
