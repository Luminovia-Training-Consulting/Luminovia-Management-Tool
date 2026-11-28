/** Review local calendar content before one atomic owner-scoped database import. */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { Upload } from "lucide-react";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { dateTime, validZone } from "../../lib/dates";
import { TableImport } from "../../components/table-import";
import { Button } from "../../components/ui/button";
import { Field, Notice } from "../../components/common";
import type { ImportedAppointment } from "./import-ical";
import { previewCalendarImport } from "./import-ical-preview";
import { calendarImportReceipt } from "./schema";
import "./import-i18n";
import "./import.css";

function tableAppointment(row: Record<string, string>): ImportedAppointment {
  const title = row.title.trim();
  const timeZone = row.time_zone.trim();
  const readInstant = (value: string) => {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      )
    )
      throw new Error("offset required");
    const date = DateTime.fromISO(value, { setZone: true });
    if (!date.isValid) throw new Error("invalid date");
    return date.toUTC();
  };
  const start = readInstant(row.starts_at);
  const end = readInstant(row.ends_at);
  if (
    !title ||
    title.length > 200 ||
    row.description.length > 10000 ||
    !validZone(timeZone) ||
    end <= start
  )
    throw new Error("invalid appointment");
  return {
    uid: JSON.stringify(["table", title, start.toISO(), end.toISO()]),
    title,
    description: row.description,
    starts_at: start.toISO()!,
    ends_at: end.toISO()!,
    time_zone: timeZone,
  };
}

export function CalendarImport({
  actor,
  zone,
}: {
  actor: string;
  zone: string;
}) {
  const { t, i18n } = useTranslation("calendarImport");
  const online = useOnline();
  const cache = useQueryClient();
  const [source, setSource] = useState("");
  const [from, setFrom] = useState(() =>
    DateTime.now().setZone(zone).toISODate()!,
  );
  const [until, setUntil] = useState(() =>
    DateTime.now().setZone(zone).plus({ years: 1 }).toISODate()!,
  );
  const [preview, setPreview] = useState<ImportedAppointment[] | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [],
  );
  async function saveAppointments(events: ImportedAppointment[]) {
    requireOnline();
    const { data, error } = await db().rpc("import_my_calendar", {
      p_events: events,
    });
    if (error) throw error;
    return calendarImportReceipt.parse(data);
  }

  const save = useMutation({
    mutationKey: ["calendar-import", actor],
    mutationFn: async () => {
      if (!preview) throw new Error("No reviewed import");
      return saveAppointments(preview);
    },
    onSuccess: async () => {
      setPreview(null);
      setSource("");
      await cache.invalidateQueries({ queryKey: ["events", actor] });
    },
  });

  function clearReview() {
    save.reset();
    setError("");
    setPreview(null);
  }

  async function review(input: File | string) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    clearReview();
    setReading(true);
    try {
      const text = typeof input === "string" ? input : await input.text();
      controller.signal.throwIfAborted();
      setSource(text);
      const appointments = await previewCalendarImport(
        [text, zone, from, until, t("untitled")],
        controller.signal,
      );
      controller.signal.throwIfAborted();
      setPreview(appointments);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof Error &&
          [
            "unsupported_zone",
            "invalid_window",
            "too_many",
            "empty_window",
          ].includes(cause.message)
          ? cause.message
          : "invalid_file",
      );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setReading(false);
      }
    }
  }

  const de = i18n.language.startsWith("de");
  return (
    <>
      <TableImport
        label={
          de
            ? "Private Termine aus CSV oder XLSX importieren"
            : "Import private appointments from CSV or XLSX"
        }
        filename="personal-calendar"
        columns={["title", "starts_at", "ends_at", "time_zone", "description"]}
        example={[
          "Example",
          "2027-01-11T09:00+01:00",
          "2027-01-11T10:00+01:00",
          "Europe/Berlin",
          "",
        ]}
        parse={tableAppointment}
        saveBatch={saveAppointments}
        refresh={() => cache.invalidateQueries({ queryKey: ["events", actor] })}
      />
      <details className="panel calendar-import">
        <summary>
          <Upload size={18} aria-hidden="true" /> {t("title")}
        </summary>
        <p>{t("help", { zone })}</p>
        <div className="calendar-import-window">
          <Field id="calendar-import-from" label={t("from")}>
            <input
              id="calendar-import-from"
              type="date"
              value={from}
              disabled={reading || save.isPending}
              onChange={(e) => {
                setFrom(e.target.value);
                clearReview();
              }}
            />
          </Field>
          <Field id="calendar-import-until" label={t("until")}>
            <input
              id="calendar-import-until"
              type="date"
              value={until}
              disabled={reading || save.isPending}
              onChange={(e) => {
                setUntil(e.target.value);
                clearReview();
              }}
            />
          </Field>
        </div>
        <Field id="calendar-import-file" label={t("file")}>
          <input
            id="calendar-import-file"
            type="file"
            accept=".ics,text/calendar"
            disabled={reading || save.isPending}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (!file) return;
              e.currentTarget.value = "";
              clearReview();
              setSource("");
              if (
                file.size > 2_000_000 ||
                !file.name.toLowerCase().endsWith(".ics")
              ) {
                setError("invalid_file");
                return;
              }
              void review(file);
            }}
          />
        </Field>
        {source && !preview && (
          <Button
            variant="secondary"
            disabled={reading || save.isPending}
            onClick={() => void review(source)}
          >
            {t("review")}
          </Button>
        )}
        {error && <Notice kind="error">{t(error)}</Notice>}
        {preview && (
          <section aria-label={t("preview")}>
            <h3>{t("count", { count: preview.length })}</h3>
            <ul className="calendar-import-preview">
              {preview.map((item) => (
                <li key={item.uid}>
                  <strong>{item.title}</strong>
                  <span>
                    {dateTime(item.starts_at, i18n.language, zone)} –{" "}
                    {dateTime(item.ends_at, i18n.language, zone)}
                  </span>
                </li>
              ))}
            </ul>
            <Button
              disabled={!online || save.isPending}
              onClick={() => save.mutate()}
            >
              {t("confirm")}
            </Button>
          </section>
        )}
        {save.isError && <Notice kind="error">{t("failed")}</Notice>}
        {save.isSuccess && <Notice>{t("saved", save.data)}</Notice>}
      </details>
    </>
  );
}
