/** Staff allocate one complete teaching block through an online authoritative transaction. */
import { useState } from "react";
import { useRequestKey } from "../../lib/request-key";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { money } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { refreshJobState } from "./lifecycle-api";
import "./matching-preferences-i18n";

const matchingLabels = {
  subject: "subjectMatch",
  format: "formatMatch",
  weekdays: "weekdaysMatch",
  hours: "hoursMatch",
  urgent: "urgentMatch",
} as const;

interface Candidate {
  id: string;
  name: string;
  eligibility: string;
  terms_version: number;
  match_reasons?: (keyof typeof matchingLabels)[];
  quote: { amount: number; total_amount: number; currency: string } | null;
}

export function ManualAssignment({
  jobId,
  version,
  published,
  replacement,
}: {
  jobId: string;
  version: number;
  published: boolean;
  replacement?: { claimId: string; lecturer: string };
}) {
  const { i18n } = useTranslation(),
    de = i18n.language.startsWith("de"),
    actor = useAuth().session!.user.id,
    client = useQueryClient(),
    online = useOnline();
  const matchingText = useTranslation("teachingMatching").t;
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [reasonText, setReasonText] = useState(""),
    [reviewedVersion, setReviewedVersion] = useState(version);
  const request = useRequestKey();
  const formId = replacement?.claimId ?? jobId;
  const query = useQuery({
    queryKey: [
      "manual-assignment-candidates",
      actor,
      jobId,
      replacement?.claimId,
      search,
    ],
    enabled: open,
    retry: false,
    queryFn: async () => {
      const { data, error } = replacement
        ? await db().rpc("job_replacement_candidates", {
            p_claim_id: replacement.claimId,
            p_search: search,
          })
        : await db().rpc("manual_assignment_candidates", {
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
      const input = {
        p_lecturer_id: candidate.id,
        p_terms_version: candidate.terms_version,
        p_expected_job_version: reviewedVersion,
        p_request_id: request.forInput(
          JSON.stringify([
            candidate.id,
            candidate.terms_version,
            reviewedVersion,
            reasonText.trim(),
          ]),
        ),
      };
      const { data, error } = replacement
        ? await db().rpc("replace_job_lecturer", {
            ...input,
            p_claim_id: replacement.claimId,
            p_reason: reasonText.trim(),
          })
        : await db().rpc("manual_assign_job", { ...input, p_job_id: jobId });
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
        setReasonText("");
        request.clear();
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
      terms_changed: de
        ? "Der Auftrag wurde geändert. Öffne die Zuweisung erneut."
        : "The assignment changed. Reopen the form.",
      already_assigned: de ? "Bereits zugewiesen" : "Already assigned",
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
          setReviewedVersion(version);
          setOpen(true);
        }}
        disabled={!online || (!replacement && !published)}
      >
        {replacement
          ? de
            ? "Dozent:in wechseln"
            : "Replace lecturer"
          : de
            ? "Dozent:in zuweisen"
            : "Assign lecturer"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={
          replacement
            ? de
              ? `${replacement.lecturer} ersetzen`
              : `Replace ${replacement.lecturer}`
            : de
              ? "Dozent:in verbindlich zuweisen"
              : "Confirm lecturer assignment"
        }
        description={
          replacement
            ? de
              ? "Der Wechsel umfasst alle Termine. Nach erfolgreicher Prüfung werden beide Dozent:innen im Portal benachrichtigt."
              : "The replacement covers every session. Both lecturers receive a portal notification after the change succeeds."
            : de
              ? "Die Zuweisung umfasst alle Termine des Auftrags. Verfügbarkeit, Voraussetzungen und Honorar werden vor der Bestätigung online geprüft."
              : "The assignment includes every session. Availability, requirements and compensation are checked online before confirmation."
        }
      >
        <Field
          id={`assign-search-${formId}`}
          label={de ? "Dozent:innen suchen" : "Find lecturers"}
        >
          <input
            id={`assign-search-${formId}`}
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
            id={`assign-user-${formId}`}
            label={de ? "Dozent:in" : "Lecturer"}
          >
            <select
              id={`assign-user-${formId}`}
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
        {!!candidate?.match_reasons?.length && (
          <ul className="session-list">
            {candidate.match_reasons.map((entry) => (
              <li key={entry}>{matchingText(matchingLabels[entry])}</li>
            ))}
          </ul>
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
        {replacement && (
          <Field
            id={`replacement-reason-${formId}`}
            label={de ? "Grund für den Wechsel" : "Reason for replacement"}
          >
            <textarea
              id={`replacement-reason-${formId}`}
              value={reasonText}
              maxLength={1000}
              onChange={(event) => setReasonText(event.target.value)}
            />
          </Field>
        )}
        <Button
          disabled={
            !online ||
            (Boolean(replacement) && reasonText.trim().length < 5) ||
            save.isPending ||
            query.isFetching ||
            candidate?.eligibility !== "eligible"
          }
          onClick={() => save.mutate()}
        >
          {replacement
            ? de
              ? "Dozentenwechsel bestätigen"
              : "Confirm replacement"
            : de
              ? "Gesamten Auftrag zuweisen"
              : "Assign complete block"}
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
