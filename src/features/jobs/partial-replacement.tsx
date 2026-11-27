/** Staff review specific future dates and an explicit cover fee before the atomic handover. */
import { useId, useState, type FormEvent } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { SessionScroll } from "../../components/session-scroll";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { currencyCodes } from "../../lib/currencies";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { useRequestKey } from "../../lib/request-key";
import { db } from "../../lib/supabase";
import { refreshJobState } from "./lifecycle-api";
import "./partial-replacement-i18n";

const options = z
  .object({
    sessions: z.array(
      z.object({
        id: z.uuid(),
        starts_at: z.iso.datetime({ offset: true }),
        ends_at: z.iso.datetime({ offset: true }),
      }),
    ),
    candidates: z.array(z.object({ id: z.uuid(), name: z.string() })),
    currency: z.enum(currencyCodes),
  })
  .nullable();
const receipt = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("confirmed"),
    job_id: z.uuid(),
    claim_id: z.uuid(),
  }),
  z.object({
    status: z.enum([
      "unavailable",
      "terms_changed",
      "not_eligible",
      "conflict",
      "prerequisite_missing",
      "idempotency_conflict",
      "cancelled",
      "filled",
      "already_assigned",
      "quote_unavailable",
    ]),
  }),
]);

export default function PartialTeachingReplacement({
  actor,
  claimId,
  version,
  zone,
}: {
  actor: string;
  claimId: string;
  version: number;
  zone: string;
}) {
  const { t, i18n } = useTranslation("partialReplacement");
  const id = useId();
  const cache = useQueryClient();
  const online = useOnline();
  const request = useRequestKey();
  const [open, setOpen] = useState(false);
  const [reviewedVersion, setReviewedVersion] = useState(version);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const query = useQuery({
    queryKey: ["partial-replacement-options", actor, claimId, search],
    enabled: open && online,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc(
          "partial_replacement_options",
          { p_claim_id: claimId, p_search: search },
          { get: true },
        )
        .abortSignal(signal);
      if (error) throw error;
      return options.parse(data);
    },
  });
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      requireOnline();
      const input = {
        p_claim_id: claimId,
        p_expected_job_version: reviewedVersion,
        p_lecturer_id: target,
        p_session_ids: [...selected].sort(),
        p_total: String(form.get("fee") ?? "")
          .trim()
          .replace(",", "."),
        p_terms: String(form.get("terms") ?? "").trim(),
        p_reason: String(form.get("reason") ?? "").trim(),
      };
      const { data, error } = await db().rpc("replace_teaching_sessions", {
        ...input,
        p_request_id: request.forInput(JSON.stringify(input)),
      });
      if (error) throw error;
      return receipt.parse(data);
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      online &&
      selected.length &&
      !query.isPlaceholderData &&
      query.data?.candidates.some((candidate) => candidate.id === target)
    )
      save.mutate(new FormData(event.currentTarget));
  };
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={!online}
        onClick={() => {
          setReviewedVersion(version);
          setOpen(true);
          setSelected([]);
          setSearch("");
          setTarget("");
          request.clear();
          save.reset();
        }}
      >
        {t("action")}
      </Button>
      <Dialog
        open={open}
        title={t("title")}
        description={t("description")}
        closeDisabled={save.isPending}
        onOpenChange={(next) => {
          if (save.isPending) return;
          setOpen(next);
          if (
            !next &&
            (save.data?.status === "confirmed" ||
              save.data?.status === "terms_changed")
          ) {
            void refreshJobState(cache);
            void cache.invalidateQueries({
              queryKey: ["partial-replacement-options", actor, claimId],
            });
          }
        }}
      >
        {save.data?.status === "confirmed" ? (
          <div className="section-stack">
            <Notice kind="success">{t("confirmed")}</Notice>
            <Link
              to={"/jobs/" + save.data.job_id}
              onClick={() => void refreshJobState(cache)}
            >
              {t("openCover")}
            </Link>
          </div>
        ) : query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : !query.data ? (
          <Notice>{t("unavailable")}</Notice>
        ) : (
          <form className="section-stack" onSubmit={submit}>
            <fieldset disabled={save.isPending || !online}>
              <legend>{t("sessions")}</legend>
              <SessionScroll label={t("sessions")}>
                <ul className="session-list">
                  {query.data.sessions.map((slot) => (
                    <li key={slot.id}>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={selected.includes(slot.id)}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked;
                            setSelected((choices) =>
                              checked
                                ? [...choices, slot.id]
                                : choices.filter(
                                    (choice) => choice !== slot.id,
                                  ),
                            );
                          }}
                        />
                        {dateTime(slot.starts_at, i18n.language, zone)} –{" "}
                        {dateTime(slot.ends_at, i18n.language, zone)}
                      </label>
                    </li>
                  ))}
                </ul>
              </SessionScroll>
            </fieldset>
            <div className="form-row">
              <Field id={id + "-search"} label={t("search")}>
                <input
                  id={id + "-search"}
                  maxLength={200}
                  value={search}
                  disabled={save.isPending}
                  onChange={(event) => {
                    setSearch(event.currentTarget.value);
                    setTarget("");
                  }}
                />
              </Field>
              <Field id={id + "-target"} label={t("lecturer")}>
                <select
                  id={id + "-target"}
                  value={target}
                  disabled={save.isPending || query.isPlaceholderData}
                  required
                  onChange={(event) => setTarget(event.currentTarget.value)}
                >
                  <option value="">—</option>
                  {query.data.candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              id={id + "-fee"}
              label={t("fee", { currency: query.data.currency })}
            >
              <input
                id={id + "-fee"}
                name="fee"
                inputMode="decimal"
                pattern="[0-9]{1,10}([.,][0-9]{1,2})?"
                disabled={save.isPending}
                required
              />
            </Field>
            <Field id={id + "-terms"} label={t("terms")}>
              <textarea
                id={id + "-terms"}
                rows={3}
                name="terms"
                maxLength={8000}
                disabled={save.isPending}
                required
              />
            </Field>
            <Field id={id + "-reason"} label={t("reason")}>
              <textarea
                id={id + "-reason"}
                rows={2}
                name="reason"
                minLength={5}
                maxLength={1000}
                disabled={save.isPending}
                required
              />
            </Field>
            {(save.isError || save.data) && (
              <Notice kind="error">
                {t(
                  save.data?.status === "conflict"
                    ? "conflict"
                    : save.data?.status === "terms_changed"
                      ? "changed"
                      : "failed",
                )}
              </Notice>
            )}
            <div className="form-actions">
              <Button
                type="submit"
                disabled={
                  !online ||
                  save.isPending ||
                  query.isPlaceholderData ||
                  !selected.length ||
                  !target
                }
              >
                {t("confirm")}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
