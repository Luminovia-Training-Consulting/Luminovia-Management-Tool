/** Staff allocate one complete teaching block through an online authoritative transaction. */
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { money } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field, Notice, Loading, ErrorState } from "../../components/common";
import { refreshJobState } from "./lifecycle-api";
interface Candidate {
  id: string;
  name: string;
  eligibility: string;
  terms_version: number;
  quote: { amount: number; total_amount: number; currency: string } | null;
}
export function ManualAssignment({
  jobId,
  version,
  published,
}: {
  jobId: string;
  version: number;
  published: boolean;
}) {
  const { i18n } = useTranslation(),
    de = i18n.language.startsWith("de"),
    actor = useAuth().session!.user.id,
    client = useQueryClient(),
    online = useOnline();
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState("");
  const identity = useRef<{ target: string; key: string } | null>(null);
  const query = useQuery({
    queryKey: ["manual-assignment-candidates", actor, jobId, search],
    enabled: open,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db().rpc("manual_assignment_candidates", {
        p_job_id: jobId,
        p_search: search,
      });
      if (error) throw error;
      return data as Candidate[];
    },
  });
  const candidate = query.data?.find((p) => p.id === selected);
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!candidate || candidate.eligibility !== "eligible")
        throw Error("Choose an available lecturer");
      if (identity.current?.target !== candidate.id)
        identity.current = { target: candidate.id, key: crypto.randomUUID() };
      const { data, error } = await db().rpc("manual_assign_job", {
        p_job_id: jobId,
        p_lecturer_id: candidate.id,
        p_terms_version: candidate.terms_version,
        p_expected_job_version: version,
        p_request_id: identity.current.key,
      });
      if (error) throw error;
      return data as { status: string; claim_id?: string };
    },
    onSuccess: async (receipt) => {
      await refreshJobState(client);
      await client.invalidateQueries({
        queryKey: ["manual-assignment-candidates"],
      });
      if (receipt.status === "confirmed") {
        setOpen(false);
        setSelected("");
        identity.current = null;
      }
    },
  });
  const reason = (value: string) =>
    ({
      eligible: de ? "Verfügbar" : "Available",
      conflict: de ? "Terminüberschneidung" : "Schedule overlap",
      not_eligible: de
        ? "Voraussetzungen nicht erfüllt"
        : "Requirements not met",
      prerequisite_missing: de ? "Vertrag fehlt" : "Contract missing",
      unavailable: de ? "Nicht verfügbar" : "Unavailable",
      quote_unavailable: de
        ? "Honorar passt nicht zu Budget oder Währung"
        : "Compensation does not match budget or currency",
    })[value] ?? (de ? "Nicht zuweisbar" : "Cannot be assigned");
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          save.reset();
          setOpen(true);
        }}
        disabled={!online || !published}
      >
        {de ? "Dozent:in zuweisen" : "Assign lecturer"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={
          de ? "Dozent:in verbindlich zuweisen" : "Confirm lecturer assignment"
        }
        description={
          de
            ? "Die Zuweisung umfasst alle Termine des Auftrags. Verfügbarkeit, Voraussetzungen und Honorar werden vor der Bestätigung online geprüft."
            : "The assignment includes every session. Availability, requirements and compensation are checked online before confirmation."
        }
      >
        <Field
          id={`assign-search-${jobId}`}
          label={de ? "Dozent:innen suchen" : "Find lecturers"}
        >
          <input
            id={`assign-search-${jobId}`}
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : (
          <Field
            id={`assign-user-${jobId}`}
            label={de ? "Dozent:in" : "Lecturer"}
          >
            <select
              id={`assign-user-${jobId}`}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">
                {de ? "Bitte auswählen" : "Choose a lecturer"}
              </option>
              {query.data.map((person) => (
                <option
                  key={person.id}
                  value={person.id}
                  disabled={person.eligibility !== "eligible"}
                >
                  {person.name} · {reason(person.eligibility)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {candidate?.quote && (
          <p>
            {de
              ? "Honorar für den gesamten Auftrag: "
              : "Compensation for the complete assignment: "}
            {money(
              candidate.quote.total_amount,
              candidate.quote.currency,
              i18n.language,
            )}
          </p>
        )}
        <Button
          disabled={
            !online ||
            save.isPending ||
            query.isFetching ||
            candidate?.eligibility !== "eligible"
          }
          onClick={() => save.mutate()}
        >
          {de ? "Gesamten Auftrag zuweisen" : "Assign complete block"}
        </Button>
        {save.isError && (
          <Notice kind="error">
            {de
              ? "Die Zuweisung wurde nicht bestätigt. Lade den Auftrag neu und versuche es erneut."
              : "The assignment was not confirmed. Reload the job and try again."}
          </Notice>
        )}
        {save.isSuccess && save.data.status !== "confirmed" && (
          <Notice kind="error">{reason(save.data.status)}</Notice>
        )}
      </Dialog>
    </>
  );
}
