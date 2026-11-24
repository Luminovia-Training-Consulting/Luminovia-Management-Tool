import { useState } from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import "./i18n";

type Lecturer = { id: string; display_name: string };
type Roster = { members: Lecturer[]; candidates: Lecturer[]; can_add: boolean };

export const companyLecturersQuery = (actor: string, organisation: string) =>
  queryOptions({
    queryKey: ["company-lecturers", actor, organisation],
    enabled: Boolean(organisation),
    queryFn: async () => {
      const { data, error } = await db().rpc(
        "company_lecturer_roster",
        {
          p_organisation_id: organisation,
        },
        { get: true },
      );
      if (error) throw error;
      return data as Roster;
    },
  });

function RosterPanel({
  actor,
  organisation,
}: {
  actor: string;
  organisation: string;
}) {
  const { t } = useTranslation("operations");
  const client = useQueryClient();
  const online = useOnline();
  const [candidate, setCandidate] = useState("");
  const roster = useQuery(companyLecturersQuery(actor, organisation));
  const change = useMutation({
    mutationFn: async ({
      lecturer,
      remove,
    }: {
      lecturer: string;
      remove: boolean;
    }) => {
      requireOnline();
      const { error } = await db().rpc("set_company_lecturer", {
        p_organisation_id: organisation,
        p_lecturer_id: lecturer,
        p_remove: remove,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setCandidate("");
      await client.invalidateQueries({
        queryKey: ["company-lecturers", actor],
      });
    },
  });
  if (roster.isPending) return <Loading />;
  if (roster.isError) return <ErrorState retry={() => void roster.refetch()} />;
  return (
    <div className="section-stack">
      {roster.data.members.length ? (
        <ul>
          {roster.data.members.map((lecturer) => (
            <li key={lecturer.id}>
              {lecturer.display_name}{" "}
              <Button
                type="button"
                variant="ghost"
                disabled={!online || change.isPending}
                aria-label={t("companyLecturerRemoveNamed", {
                  name: lecturer.display_name,
                })}
                onClick={() =>
                  change.mutate({ lecturer: lecturer.id, remove: true })
                }
              >
                {t("companyLecturerRemove")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("companyLecturerEmpty")}</p>
      )}
      {roster.data.can_add && (
        <div className="page-actions">
          <Field
            id="company-lecturer-candidate"
            label={t("companyLecturerChoose")}
          >
            <select
              id="company-lecturer-candidate"
              value={candidate}
              onChange={(event) => setCandidate(event.target.value)}
            >
              <option value="">{t("companyLecturerChoose")}</option>
              {roster.data.candidates.map((lecturer) => (
                <option key={lecturer.id} value={lecturer.id}>
                  {lecturer.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Button
            type="button"
            disabled={
              !online ||
              change.isPending ||
              !roster.data.candidates.some(({ id }) => id === candidate)
            }
            onClick={() =>
              change.mutate({ lecturer: candidate, remove: false })
            }
          >
            {t("companyLecturerAdd")}
          </Button>
        </div>
      )}
      {change.isError && (
        <Notice kind="error">{t("companyLecturerError")}</Notice>
      )}
      {change.isSuccess && <Notice>{t("companyLecturerSaved")}</Notice>}
    </div>
  );
}

export function CompanyLecturers({
  actor,
  organisations,
}: {
  actor: string;
  organisations: readonly { id: string; name: string }[];
}) {
  const { t } = useTranslation("operations");
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const organisation =
    organisations.find(({ id }) => id === selected)?.id ?? organisations[0]?.id;
  if (!organisation) return null;
  return (
    <details
      className="panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("companyLecturers")}</summary>
      {open && (
        <>
          {organisations.length > 1 && (
            <Field id="company-lecturer-organisation" label={t("organisation")}>
              <select
                id="company-lecturer-organisation"
                value={organisation}
                onChange={(event) => setSelected(event.target.value)}
              >
                {organisations.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <RosterPanel
            key={organisation}
            organisation={organisation}
            actor={actor}
          />
        </>
      )}
    </details>
  );
}
