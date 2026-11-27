/** Edit reusable company defaults and explicitly inherit values in the course creator. */
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { TimeZoneOptions } from "../../components/time-zone-options";
import { Button } from "../../components/ui/button";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import {
  deliveryModes,
  meetingPlatforms,
  venueSchema,
} from "../training/delivery-schema";
import { contactsQuery } from "./data";
import {
  operationalPreset,
  operationalPresetPayload,
  type OperationalPreset,
} from "./operational-preset-schema";

function labels(language: string) {
  const de = language.startsWith("de");
  return {
    title: de ? "Operative Kundenvorlagen" : "Operational customer presets",
    choose: de ? "Kundenvorlage wählen" : "Choose customer preset",
    create: de ? "Neue Vorlage" : "New preset",
    edit: de ? "Vorlage bearbeiten" : "Edit preset",
    apply: de ? "Vorgaben übernehmen" : "Apply defaults",
    clear: de ? "Verknüpfung lösen" : "Remove preset link",
    applied: de ? "Vorgaben übernommen" : "Defaults applied",
    needsReview: de
      ? "Die Vorlage hat sich geändert. Übernimm die aktuelle Fassung erneut."
      : "The preset changed. Apply its current revision.",
    allowDelivery: de
      ? "Bereits bearbeitete Durchführungsart ersetzen"
      : "Replace the edited delivery mode",
    allowZone: de
      ? "Bereits bearbeitete Zeitzone ersetzen"
      : "Replace the edited time zone",
    name: de ? "Name" : "Name",
    zone: de ? "Zeitzone" : "Time zone",
    starts: de ? "Standardbeginn" : "Standard start",
    ends: de ? "Standardende" : "Standard end",
    contact: de ? "Ansprechperson" : "Contact",
    mode: de ? "Durchführungsart" : "Delivery mode",
    online: de ? "Online" : "Online",
    onsite: de ? "Präsenz" : "In person",
    hybrid: de ? "Hybrid" : "Hybrid",
    venue: de ? "Lernort" : "Venue",
    platform: de ? "Meeting-Plattform" : "Meeting platform",
    instructions: de ? "Durchführungshinweise" : "Delivery instructions",
    none: de ? "Keine Vorgabe" : "No default",
    saved: de ? "Kundenvorlage gespeichert." : "Customer preset saved.",
    missing: de
      ? "Keine operative Vorlage vorhanden."
      : "No operational presets yet.",
    archive: de ? "Vorlage archivieren" : "Archive preset",
    invalid: de
      ? "Bitte Beginn und Ende als gültiges Zeitfenster eingeben. Lernort, Plattform und Hinweise benötigen eine Durchführungsart."
      : "Enter a valid time window. A venue, platform and instructions require a delivery mode.",
    failed: de
      ? "Die Vorlage konnte nicht gespeichert werden. Lade bei einer zwischenzeitlichen Änderung die aktuelle Fassung."
      : "The preset could not be saved. Reload the current revision if it has changed.",
  };
}

type Scope = { actor: string; organisation: string };
function presetQuery({ actor, organisation }: Scope, enabled: boolean) {
  return {
    queryKey: ["training-operational-presets", actor, organisation],
    enabled,
    retry: false,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("training_operational_presets", {
          p_organisation_id: organisation,
        })
        .abortSignal(signal);
      if (error) throw error;
      return z.array(operationalPreset).parse(data);
    },
  };
}

function PresetEditor({
  actor,
  organisation,
  preset,
  onDone,
}: Scope & {
  preset: OperationalPreset | null;
  onDone: (saved: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const l = labels(i18n.language);
  const id = useId();
  const client = useQueryClient();
  const online = useOnline();
  const contacts = useQuery(contactsQuery(actor, organisation));
  const venues = useQuery({
    queryKey: ["training-venues", actor, organisation],
    enabled: online,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("training_venue_directory", {
          p_organisation_id: organisation,
        })
        .abortSignal(signal);
      if (error) throw error;
      return z.array(venueSchema).parse(data);
    },
  });
  const current = preset?.config;
  const [zone, setZone] = useState(current?.time_zone ?? "");
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: async (payload: z.infer<typeof operationalPresetPayload>) => {
      requireOnline();
      const { data, error } = await db().rpc(
        "save_training_operational_preset",
        {
          p_organisation_id: organisation,
          p_preset_id: preset?.id ?? null,
          p_expected_revision: preset?.revision ?? 0,
          p_payload: payload,
        },
      );
      if (error) throw error;
      return operationalPreset.parse(data);
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: presetQuery({ actor, organisation }, true).queryKey,
      });
      onDone(true);
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const field = (key: string) => String(fields.get(key) ?? "").trim() || null;
    const name = field("name");
    const starts_at = field("starts");
    const ends_at = field("ends");
    const mode = field("mode");
    const venue_id = field("venue");
    const meeting_platform = field("platform");
    const teaching_instructions = field("instructions") ?? "";
    const result = operationalPresetPayload.safeParse({
      name,
      archived: false,
      config: {
        time_zone: zone || null,
        starts_at,
        ends_at,
        contact_id: field("contact"),
        delivery: mode
          ? { mode, venue_id, meeting_platform, teaching_instructions }
          : null,
      },
    });
    if (
      !result.success ||
      Boolean(starts_at) !== Boolean(ends_at) ||
      (starts_at && ends_at && starts_at >= ends_at) ||
      (!mode && (venue_id || meeting_platform || teaching_instructions))
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    save.mutate(result.data);
  };
  const unavailable = (venues.isError || contacts.isError) && online;
  const ready = venues.isSuccess && contacts.isSuccess;
  const missingOption = (
    value: string | null | undefined,
    choices: readonly { id: string }[],
  ) =>
    value && !choices.some(({ id }) => id === value) ? (
      <option value={value}>{t("unavailable")}</option>
    ) : null;
  return (
    <form className="stack" onSubmit={submit}>
      <Field id={`${id}-name`} label={l.name}>
        <input
          id={`${id}-name`}
          name="name"
          required
          maxLength={120}
          defaultValue={preset?.name}
        />
      </Field>
      <div className="form-row">
        <Field id={`${id}-zone`} label={l.zone}>
          <select
            id={`${id}-zone`}
            value={zone}
            onChange={(event) => setZone(event.target.value)}
          >
            <option value="">{l.none}</option>
            <TimeZoneOptions current={zone || "Europe/Berlin"} />
          </select>
        </Field>
        <Field id={`${id}-start`} label={l.starts}>
          <input
            id={`${id}-start`}
            name="starts"
            type="time"
            defaultValue={current?.starts_at ?? ""}
          />
        </Field>
        <Field id={`${id}-end`} label={l.ends}>
          <input
            id={`${id}-end`}
            name="ends"
            type="time"
            defaultValue={current?.ends_at ?? ""}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field id={`${id}-mode`} label={l.mode}>
          <select
            id={`${id}-mode`}
            name="mode"
            defaultValue={current?.delivery?.mode ?? ""}
          >
            <option value="">{l.none}</option>
            {deliveryModes.map((mode) => (
              <option value={mode} key={mode}>
                {l[mode]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-platform`} label={l.platform}>
          <select
            id={`${id}-platform`}
            name="platform"
            defaultValue={current?.delivery?.meeting_platform ?? ""}
          >
            <option value="">{l.none}</option>
            {meetingPlatforms.map((platform) => (
              <option value={platform} key={platform}>
                {platform}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {unavailable ? (
        <ErrorState
          retry={() => {
            void venues.refetch();
            void contacts.refetch();
          }}
        />
      ) : (
        online && !ready && <Loading />
      )}
      {ready && (
        <div className="form-row">
          <Field id={`${id}-venue`} label={l.venue}>
            <select
              id={`${id}-venue`}
              name="venue"
              defaultValue={current?.delivery?.venue_id ?? ""}
            >
              <option value="">{l.none}</option>
              {missingOption(
                current?.delivery?.venue_id,
                venues.data.filter((venue) => !venue.archived_at),
              )}
              {venues.data
                .filter((venue) => !venue.archived_at)
                .map((venue) => (
                  <option
                    value={venue.id}
                    key={venue.id}
                    disabled={Boolean(venue.archived_at)}
                  >
                    {venue.details.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field id={`${id}-contact`} label={l.contact}>
            <select
              id={`${id}-contact`}
              name="contact"
              defaultValue={current?.contact_id ?? ""}
            >
              <option value="">{l.none}</option>
              {missingOption(
                current?.contact_id,
                contacts.data.filter((contact) => !contact.archived_at),
              )}
              {contacts.data
                .filter((contact) => !contact.archived_at)
                .map((contact) => (
                  <option value={contact.id} key={contact.id}>
                    {contact.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
      )}
      <Field id={`${id}-instructions`} label={l.instructions}>
        <textarea
          id={`${id}-instructions`}
          name="instructions"
          rows={3}
          maxLength={2000}
          defaultValue={current?.delivery?.teaching_instructions}
        />
      </Field>
      {invalid && <Notice kind="error">{l.invalid}</Notice>}
      {save.isError && <Notice kind="error">{l.failed}</Notice>}
      <div className="form-actions">
        <Button type="submit" disabled={!online || save.isPending || !ready}>
          {t("save")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={save.isPending}
          onClick={() => onDone(false)}
        >
          {t("cancel")}
        </Button>
        {preset && (
          <Button
            type="button"
            variant="ghost"
            disabled={!online || save.isPending}
            onClick={() =>
              save.mutate({
                name: preset.name,
                config: preset.config,
                archived: true,
              })
            }
          >
            {l.archive}
          </Button>
        )}
      </div>
    </form>
  );
}

export default function CompanyOperationalPresets(scope: Scope) {
  const { i18n } = useTranslation();
  const l = labels(i18n.language);
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<OperationalPreset | null>();
  const [saved, setSaved] = useState(false);
  const online = useOnline();
  const presets = useQuery(presetQuery(scope, open && online));
  return (
    <details
      className="company-detail-group"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{l.title}</summary>
      <div className="section-stack">
        {saved && <Notice>{l.saved}</Notice>}
        {open && online && presets.isPending && <Loading />}
        {presets.isError && <ErrorState retry={() => void presets.refetch()} />}
        {presets.data && !presets.data.length && (
          <p className="muted">{l.missing}</p>
        )}
        {editor === undefined && (
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={!online}
              onClick={() => {
                setSaved(false);
                setEditor(null);
              }}
            >
              {l.create}
            </Button>
            {presets.data?.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="ghost"
                disabled={!online}
                onClick={() => {
                  setSaved(false);
                  setEditor(preset);
                }}
              >
                {preset.name}
              </Button>
            ))}
          </div>
        )}
        {editor !== undefined && (
          <PresetEditor
            {...scope}
            key={editor?.id ?? "new"}
            preset={editor}
            onDone={(changed) => {
              setEditor(undefined);
              setSaved(changed);
            }}
          />
        )}
      </div>
    </details>
  );
}

/** Keep the tentative choice local until the manager explicitly adopts it. */
export function OperationalPresetPicker({
  actor,
  organisation,
  applied,
  dirtyZone,
  dirtyDelivery,
  disabled,
  onApply,
  onClear,
}: Scope & {
  applied?: { id: string; revision: number };
  dirtyZone: boolean;
  dirtyDelivery: boolean;
  disabled: boolean;
  onApply: (
    preset: OperationalPreset,
    inheritZone: boolean,
    inheritDelivery: boolean,
  ) => void;
  onClear: () => void;
}) {
  const { i18n } = useTranslation();
  const l = labels(i18n.language);
  const id = useId();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [replaceZone, setReplaceZone] = useState(false);
  const [replaceDelivery, setReplaceDelivery] = useState(false);
  const presets = useQuery(
    presetQuery({ actor, organisation }, online && (open || Boolean(applied))),
  );
  const choice = presets.data?.find((preset) => preset.id === selected);
  const current = presets.data?.find((preset) => preset.id === applied?.id);
  return (
    <details
      className="operations-schedule-planner"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {l.title}
        {current ? ` · ${current.name}` : ""}
      </summary>
      <div className="section-stack">
        {open && online && presets.isPending && <Loading />}
        {presets.isError && <ErrorState retry={() => void presets.refetch()} />}
        {applied && presets.isSuccess && (
          <p role="status">
            {current?.revision === applied.revision
              ? `${l.applied} · ${current.name}`
              : l.needsReview}
          </p>
        )}
        <Field id={`${id}-preset`} label={l.choose}>
          <select
            id={`${id}-preset`}
            value={selected}
            disabled={disabled || !online}
            onChange={(event) => {
              setSelected(event.target.value);
              setReplaceZone(false);
              setReplaceDelivery(false);
            }}
          >
            <option value="">{l.none}</option>
            {presets.data?.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </Field>
        {choice && (
          <p className="muted">
            {[
              choice.config.time_zone,
              choice.config.delivery ? l[choice.config.delivery.mode] : null,
              choice.config.starts_at && choice.config.ends_at
                ? `${choice.config.starts_at} – ${choice.config.ends_at}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {choice?.config.time_zone && dirtyZone && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={replaceZone}
              onChange={(event) => setReplaceZone(event.target.checked)}
            />
            {l.allowZone}
          </label>
        )}
        {choice?.config.delivery && dirtyDelivery && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={replaceDelivery}
              onChange={(event) => setReplaceDelivery(event.target.checked)}
            />
            {l.allowDelivery}
          </label>
        )}
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || !choice || !online}
            onClick={() => {
              if (choice)
                onApply(
                  choice,
                  !dirtyZone || replaceZone,
                  !dirtyDelivery || replaceDelivery,
                );
            }}
          >
            {l.apply}
          </Button>
          {applied && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={onClear}
            >
              {l.clear}
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}
