import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  companyLecturerBlock,
  companyLecturerBlocks,
  lecturerBlockOrganisation,
  lecturerBlockSearch,
  type CompanyLecturerBlock,
  type LecturerBlockOrganisation,
} from "./company-lecturer-block-schema";

const messages = {
  heading: ["Dozentensperren", "Lecturer restrictions"],
  organisation: ["Unternehmen", "Company"],
  search: ["Dozierende suchen", "Find lecturers"],
  submitSearch: ["Suchen", "Search"],
  empty: [
    "Keine passenden Dozierenden gefunden.",
    "No matching lecturers found.",
  ],
  more: [
    "Grenze die Suche weiter ein, um weitere Treffer zu finden.",
    "Refine your search to find more results.",
  ],
  locked: ["Gesperrt", "Blocked"],
  available: ["Freigegeben", "Allowed"],
  block: ["Sperren", "Block"],
  release: ["Freigeben", "Unblock"],
  intro: [
    "Eine Sperre entzieht der Person den Dozentenzugriff auf die Kurse dieses Unternehmens und verhindert neue Zuweisungen.",
    "A restriction removes lecturer access to this company's courses and prevents new assignments.",
  ],
  confirmBlock: [
    "Die Sperre gilt nur für dieses Unternehmen. Bestehende Buchungen und Abrechnungen bleiben erhalten.",
    "The restriction applies to this company. Existing assignments and billing records are retained.",
  ],
  confirmRelease: [
    "Die Freigabe stellt den Zugriff wieder her, soweit die Person weiterhin berechtigt ist.",
    "Unblocking restores access wherever the lecturer remains eligible.",
  ],
  readOnly: [
    "Sperren können derzeit nur eingesehen werden.",
    "Restrictions are currently read-only.",
  ],
  offline: [
    "Stelle eine Verbindung her, um Sperren zu verwalten.",
    "Connect to manage restrictions.",
  ],
  changed: ["Der Status wurde gespeichert.", "The status was saved."],
  conflict: [
    "Der Status hat sich geändert. Prüfe den aktuellen Stand.",
    "The status has changed. Review the current state.",
  ],
  failed: [
    "Der Status konnte nicht gespeichert werden.",
    "The status could not be saved.",
  ],
} as const;

function useText() {
  const { i18n } = useTranslation();
  return (key: keyof typeof messages) =>
    messages[key][i18n.language.startsWith("de") ? 0 : 1];
}

/** Uses the existing company selector where available, with one exact scope per panel. */
export function CompanyLecturerBlocks({
  actor,
  organisations,
}: {
  actor: string;
  organisations: LecturerBlockOrganisation[];
}) {
  const word = useText();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [selected, select] = useState("");
  const organisation =
    organisations.find((item) => item.id === selected) ?? organisations[0];
  if (!organisation) return null;
  return (
    <details
      className="panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{word("heading")}</summary>
      {open && (
        <div className="form">
          {organisations.length > 1 && (
            <Field id={id} label={word("organisation")}>
              <select
                id={id}
                value={organisation.id}
                onChange={(event) => select(event.target.value)}
              >
                {organisations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p>{word("intro")}</p>
          <CompanyLecturerBlockList
            key={`${actor}:${organisation.id}`}
            actor={actor}
            organisation={organisation.id}
          />
        </div>
      )}
    </details>
  );
}

function CompanyLecturerBlockList({
  actor,
  organisation,
}: {
  actor: string;
  organisation: string;
}) {
  const word = useText();
  const online = useOnline();
  const cache = useQueryClient();
  const id = useId();
  const [search, setSearch] = useState("");
  const [appliedSearch, applySearch] = useState("");
  const [row, choose] = useState<CompanyLecturerBlock>();
  const [returnFocus, setReturnFocus] = useState<HTMLButtonElement>();
  const prefix = ["company-lecturer-blocks", actor, organisation];
  const list = useQuery({
    queryKey: [...prefix, appliedSearch],
    enabled: online,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc(
          "company_lecturer_blocks",
          {
            p_organisation_id: organisation,
            p_search: appliedSearch,
          },
          { get: true },
        )
        .abortSignal(signal);
      if (error) throw error;
      const result = companyLecturerBlocks.parse(data);
      if (result.organisation_id !== organisation)
        throw new Error("invalid_company_scope");
      return result;
    },
  });
  const save = useMutation({
    mutationFn: async (entry: CompanyLecturerBlock) => {
      requireOnline();
      const { data, error } = await db().rpc("set_company_lecturer_block", {
        p_organisation_id: organisation,
        p_lecturer_id: entry.lecturer_id,
        p_blocked: !entry.blocked,
        p_expected_version: entry.version,
      });
      if (error) throw error;
      const result = companyLecturerBlock.parse(data);
      if (result.lecturer_id !== entry.lecturer_id)
        throw new Error("invalid_lecturer_scope");
      return result;
    },
    onSettled: async () => {
      await cache.invalidateQueries({ queryKey: prefix });
      choose(undefined);
    },
  });

  if (!online) return <Notice>{word("offline")}</Notice>;
  const action = row?.blocked ? "release" : "block";
  return (
    <>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          applySearch(lecturerBlockSearch.parse(search.trim()));
        }}
      >
        <Field id={id} label={word("search")}>
          <input
            id={id}
            type="search"
            value={search}
            maxLength={120}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Button type="submit" variant="secondary">
          {word("submitSearch")}
        </Button>
      </form>
      {list.isError ? (
        <ErrorState retry={() => void list.refetch()} />
      ) : !list.isFetchedAfterMount || !list.data ? (
        <Loading />
      ) : (
        <>
          {!list.data.can_write && <Notice>{word("readOnly")}</Notice>}
          {list.data.rows.length === 0 ? (
            <p>{word("empty")}</p>
          ) : (
            <ul className="form">
              {list.data.rows.map((entry) => (
                <li className="section-heading" key={entry.lecturer_id}>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {entry.display_name} ·{" "}
                    {word(entry.blocked ? "locked" : "available")}
                  </span>
                  {list.data.can_write && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0"
                      disabled={save.isPending}
                      aria-label={`${word(entry.blocked ? "release" : "block")} ${entry.display_name}`}
                      onClick={(event) => {
                        save.reset();
                        setReturnFocus(event.currentTarget);
                        choose(entry);
                      }}
                    >
                      {word(entry.blocked ? "release" : "block")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {list.data.more && <p>{word("more")}</p>}
        </>
      )}
      {save.isSuccess && <p role="status">{word("changed")}</p>}
      {save.isError && (
        <Notice kind="error">
          {word(
            (save.error as { code?: string }).code === "PT409"
              ? "conflict"
              : "failed",
          )}
        </Notice>
      )}
      <Dialog
        open={Boolean(row)}
        onOpenChange={(next) => {
          if (!next && !save.isPending) choose(undefined);
        }}
        title={row ? `${word(action)} ${row.display_name}` : word("heading")}
        description={word(
          action === "block" ? "confirmBlock" : "confirmRelease",
        )}
        returnFocusTo={returnFocus}
        closeDisabled={save.isPending}
      >
        <Button
          type="button"
          disabled={!row || save.isPending || !list.data?.can_write}
          onClick={() => {
            if (row) save.mutate(row);
          }}
        >
          {word(action)}
        </Button>
      </Dialog>
    </>
  );
}

export function AcademyCompanyLecturerBlocks({ actor }: { actor: string }) {
  const directory = useQuery({
    queryKey: ["academy-lecturer-block-organisations", actor],
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_lecturer_block_organisations", {}, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return lecturerBlockOrganisation.array().parse(data);
    },
  });
  if (!directory.isSuccess || !directory.isFetchedAfterMount) return null;
  return <CompanyLecturerBlocks actor={actor} organisations={directory.data} />;
}
