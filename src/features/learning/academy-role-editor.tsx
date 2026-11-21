/** Edit explicit local role assignments using current database authority. */
import { useId, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import "./academy-role-editor.css";
import {
  academyMemberRolesQuery,
  setAcademyMemberRole,
} from "../accounts/academy-api";
import {
  academyAccountRole,
  type AcademyAccountRole,
  type AcademyRoleAssignment,
  type AcademyAdministration,
} from "../accounts/academy-schema";

type Props = {
  actor: string;
  accountId: string;
  organisations: AcademyAdministration["organisations"];
  word: (de: string, en: string) => string;
  roleLabel: (role: AcademyAccountRole) => string;
  explainError: (error: unknown) => string;
  changed: () => Promise<unknown>;
};

/** Avoid requesting role details for every account in a possibly large directory. */
export function AcademyRoleEditor(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="academy-role-editor"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{props.word("Rollen verwalten", "Manage roles")}</summary>
      {open && <RoleAssignments {...props} />}
    </details>
  );
}

/** Each request adds or removes a single reviewed grant and its exact scope. */
function RoleAssignments({
  actor,
  accountId,
  organisations,
  word,
  roleLabel,
  explainError,
  changed,
}: Props) {
  const formId = useId();
  const cache = useQueryClient();
  const request = academyMemberRolesQuery(actor, accountId);
  const query = useQuery(request);
  const [role, setRole] = useState<AcademyAccountRole | "">("");
  const [organisation, setOrganisation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [learnerRevocation, setLearnerRevocation] = useState<{
    assignment: AcademyRoleAssignment;
    revision: string;
  }>();
  if (query.isPending) return <Loading />;
  if (query.isError || !query.data)
    return <ErrorState retry={() => void query.refetch()} />;

  const { roles, revision, can_write, can_grant } = query.data;
  const scoped = role === "client" || role === "participant";
  const enabled = Boolean(role) && (!scoped || Boolean(organisation));
  const assignmentExists = roles.some(
    (assignment) =>
      assignment.role === role &&
      assignment.organisation_id === (scoped ? organisation : null),
  );

  async function save(
    assignment: Pick<AcademyRoleAssignment, "role" | "organisation_id">,
    grant: boolean,
    expectedRevision = revision,
  ) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const confirmed = await setAcademyMemberRole(
        accountId,
        assignment,
        grant,
        expectedRevision,
      );
      cache.setQueryData(request.queryKey, confirmed);
      if (grant) {
        setRole("");
        setOrganisation("");
      }
      await changed();
    } catch (requestError) {
      setError(explainError(requestError));
      await query.refetch();
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role || !enabled || assignmentExists) return;
    void save({ role, organisation_id: scoped ? organisation : null }, true);
  }

  return (
    <>
      <ul className="academy-role-editor-assignments">
        {roles.map((assignment) => {
          const label = [
            roleLabel(assignment.role),
            assignment.organisation_name,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={`${assignment.role}:${assignment.organisation_id ?? ""}`}>
              <span>{label}</span>
              {can_write && roles.length > 1 && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  aria-label={word(`Entziehen · ${label}`, `Revoke · ${label}`)}
                  onClick={() => {
                    if (
                      assignment.role === "participant" &&
                      assignment.organisation_id
                    )
                      setLearnerRevocation({ assignment, revision });
                    else void save(assignment, false);
                  }}
                >
                  {word("Entziehen", "Revoke")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {can_grant && (
        <form onSubmit={add}>
          <Field
            id={`${formId}-role`}
            label={word("Zusätzliche Rolle", "Additional role")}
          >
            <select
              value={role}
              disabled={busy}
              onChange={(event) => {
                const selected = academyAccountRole.safeParse(
                  event.target.value,
                );
                setRole(selected.success ? selected.data : "");
                setOrganisation("");
              }}
            >
              <option value="">
                {word("Rolle auswählen", "Select a role")}
              </option>
              {academyAccountRole.options.map((option) => (
                <option key={option} value={option}>
                  {roleLabel(option)}
                </option>
              ))}
            </select>
          </Field>
          {scoped && (
            <Field
              id={`${formId}-organisation`}
              label={word("Zugehöriges Unternehmen", "Associated organisation")}
            >
              <select
                value={organisation}
                disabled={busy}
                onChange={(event) => setOrganisation(event.target.value)}
                required
              >
                <option value="">
                  {word("Unternehmen auswählen", "Select an organisation")}
                </option>
                {organisations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Button type="submit" disabled={busy || !enabled || assignmentExists}>
            {word("Rolle hinzufügen", "Add role")}
          </Button>
        </form>
      )}
      {learnerRevocation && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setLearnerRevocation(undefined);
          }}
          title={word("Teilnehmerrolle entziehen", "Revoke learner role")}
          description={word(
            "Offene Einschreibungen in diesem Unternehmen werden beendet. Abgeschlossene Kurse bleiben im Verlauf.",
            "Current enrolments for this organisation will end. Completed courses stay in the account history.",
          )}
        >
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            onClick={() => {
              setLearnerRevocation(undefined);
              void save(
                learnerRevocation.assignment,
                false,
                learnerRevocation.revision,
              );
            }}
          >
            {word("Teilnehmerrolle entziehen", "Revoke learner role")}
          </Button>
        </Dialog>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </>
  );
}
