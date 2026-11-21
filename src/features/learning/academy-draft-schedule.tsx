import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { zonedInstant, zonedInstantForEdit } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  academyDraftScheduleInput,
  academyDraftScheduleReceipt,
} from "./academy-draft-schema";
import { courseHubQuery, courseWorkspaceKey } from "./api";
import "./i18n";

type Schedule = ReturnType<typeof academyDraftScheduleReceipt.parse>;
type SessionInput = {
  key: string;
  original: Schedule["sessions"][number] | null;
};
const localTime = (value: string, zone: string) =>
  DateTime.fromISO(value).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm");

export function AcademyDraftSchedule({
  courseId,
  actor,
}: {
  courseId: string;
  actor: string;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const key = ["academy-draft-schedule", actor, courseId];
  const draft = useQuery({
    queryKey: key,
    enabled: open && online,
    retry: false,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_draft_schedule", { p_course_id: courseId })
        .abortSignal(signal);
      if (error) throw error;
      return academyDraftScheduleReceipt.nullable().parse(data);
    },
  });
  return (
    <details
      className="academy-draft"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary onClick={() => setSaved(false)}>
        {t("academyEditDraftSchedule")}
      </summary>
      {open && saved && <Notice>{t("academyDraftScheduleSaved")}</Notice>}
      {open &&
        online &&
        (draft.isPending ? (
          <Loading />
        ) : draft.isError ? (
          <ErrorState retry={() => void draft.refetch()} />
        ) : !draft.data ? (
          <p>{t("academyLockedDraftSchedule")}</p>
        ) : (
          <DraftScheduleForm
            key={draft.data.revision}
            courseId={courseId}
            initial={draft.data}
            refresh={() => void draft.refetch()}
            confirm={async (receipt) => {
              setSaved(true);
              cache.setQueryData(key, receipt);
              await Promise.all([
                cache.invalidateQueries({
                  queryKey: courseWorkspaceKey(actor, courseId),
                }),
                cache.invalidateQueries({
                  queryKey: courseHubQuery(actor).queryKey,
                }),
                cache.invalidateQueries({
                  queryKey: ["academy-timetable", actor],
                }),
              ]);
            }}
          />
        ))}
    </details>
  );
}

function DraftScheduleForm({
  courseId,
  initial,
  refresh,
  confirm,
}: {
  courseId: string;
  initial: Schedule;
  refresh: () => void;
  confirm: (receipt: Schedule) => Promise<void>;
}) {
  const { t } = useTranslation("learning");
  const prefix = useId();
  const focus = useRef<string>(undefined);
  const [invalid, setInvalid] = useState(false);
  const [sessions, setSessions] = useState<SessionInput[]>(() =>
    initial.sessions.map((item) => ({ key: item.id, original: item })),
  );
  const save = useMutation({
    mutationFn: async (
      payload: ReturnType<typeof academyDraftScheduleInput.parse>,
    ) => {
      requireOnline();
      const { data, error } = await db().rpc("academy_save_draft_schedule", {
        p_course_id: courseId,
        p_expected_revision: initial.revision,
        p_payload: payload,
      });
      if (error) throw error;
      return academyDraftScheduleReceipt.parse(data);
    },
    onSuccess: confirm,
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (name: string) => String(form.get(name) ?? "").trim();
    const zone = read("time_zone");
    const instant = (item: SessionInput, field: "starts_at" | "ends_at") => {
      const input = read(`${item.key}-${field}`);
      return item.original && zone === initial.time_zone
        ? zonedInstantForEdit(
            input,
            zone,
            localTime(item.original[field], zone),
            item.original[field],
          )
        : zonedInstant(input, zone);
    };
    const result = academyDraftScheduleInput.safeParse({
      time_zone: zone,
      venue: read("venue"),
      delivery_type: read("delivery_type"),
      sessions: sessions.map((item) => ({
        id: item.original?.id ?? null,
        starts_at: instant(item, "starts_at"),
        ends_at: instant(item, "ends_at"),
      })),
    });
    const invalid =
      !result.success ||
      result.data.sessions.some(
        ({ starts_at, ends_at }) =>
          Date.parse(starts_at) >= Date.parse(ends_at),
      );
    setInvalid(invalid);
    if (!invalid && result.success) save.mutate(result.data);
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={save.isPending}>
        <Field
          id={`${prefix}-zone`}
          label={t("academyTimeZone")}
          hint={t("academyDraftWallTimeHint")}
        >
          <input name="time_zone" defaultValue={initial.time_zone} required />
        </Field>
        <Field id={`${prefix}-delivery`} label={t("academyDelivery")}>
          <select name="delivery_type" defaultValue={initial.delivery_type}>
            <option value="online">{t("academyOnline")}</option>
            <option value="onsite">{t("academyOnsite")}</option>
          </select>
        </Field>
        <Field id={`${prefix}-venue`} label={t("academyVenue")}>
          <input name="venue" maxLength={500} defaultValue={initial.venue} />
        </Field>
        {sessions.map((item, index) => (
          <fieldset key={item.key} className="academy-draft-session">
            <legend>{t("sessionNumber", { number: index + 1 })}</legend>
            {(["starts_at", "ends_at"] as const).map((field) => (
              <Field
                key={field}
                id={`${item.key}-${field}`}
                label={t(
                  field === "starts_at"
                    ? "academySessionStart"
                    : "academySessionEnd",
                )}
              >
                <input
                  name={`${item.key}-${field}`}
                  type="datetime-local"
                  required
                  defaultValue={
                    item.original
                      ? localTime(item.original[field], initial.time_zone)
                      : ""
                  }
                  ref={(input) => {
                    if (
                      input &&
                      field === "starts_at" &&
                      focus.current === item.key
                    ) {
                      focus.current = undefined;
                      input.focus();
                    }
                  }}
                />
              </Field>
            ))}
            <Button
              type="button"
              variant="secondary"
              disabled={sessions.length === 1}
              onClick={() => {
                focus.current =
                  sessions[index + 1]?.key ?? sessions[index - 1]?.key;
                setSessions((items) =>
                  items.filter(({ key }) => key !== item.key),
                );
              }}
            >
              {t("academyRemoveSession", { number: index + 1 })}
            </Button>
          </fieldset>
        ))}
        <div className="academy-draft-actions form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={sessions.length >= 60}
            onClick={() => {
              const key = crypto.randomUUID();
              focus.current = key;
              setSessions((items) => [...items, { key, original: null }]);
            }}
          >
            {t("academyAddSession")}
          </Button>
          <Button type="submit">{t("academySaveDraftSchedule")}</Button>
        </div>
      </fieldset>
      {invalid && <Notice kind="error">{t("academyDraftTimesInvalid")}</Notice>}
      {save.isError && (
        <Notice kind="error">
          {t("academyDraftScheduleFailed")}{" "}
          <Button type="button" variant="secondary" onClick={refresh}>
            {t("academyReloadDraftSchedule")}
          </Button>
        </Notice>
      )}
    </form>
  );
}
