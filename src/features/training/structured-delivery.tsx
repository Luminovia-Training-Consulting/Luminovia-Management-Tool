/** Edit course defaults and per-session changes under the existing workspace authority. */
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import {
  deliveryMode,
  deliveryModes,
  deliveryView,
  meetingPlatforms,
  venueSchema,
  type DeliveryConfig,
  type Venue,
} from "./delivery-schema";
import { VenueDirectory } from "./venues";
import "./delivery-i18n";
import "./delivery.css";

type DeliveryView = z.infer<typeof deliveryView>;
type CourseProps = {
  course: string;
  zone: string;
  actor: string;
  allowEdit: boolean;
};
const platforms: Record<(typeof meetingPlatforms)[number], string> = {
  teams: "Microsoft Teams",
  zoom: "Zoom",
  meet: "Google Meet",
  webex: "Webex",
  other: "HTTPS",
};

function configInput({ venue, ...config }: DeliveryConfig) {
  void venue;
  return config;
}

function DeliveryFields({
  value,
  venues,
  inherit,
  change,
}: {
  value: DeliveryConfig;
  venues: Venue[];
  inherit: boolean;
  change: (value: DeliveryConfig) => void;
}) {
  const id = useId();
  const { t } = useTranslation("trainingDelivery");
  const selectedVenue = venues.find(({ id }) => id === value.venue_id);
  return (
    <div className="training-delivery-grid">
      <Field id={`${id}-mode`} label={t("mode")}>
        <select
          id={`${id}-mode`}
          value={value.mode ?? ""}
          onChange={(event) => {
            const mode = deliveryMode.safeParse(event.currentTarget.value).data;
            change({ ...value, mode });
          }}
        >
          {inherit && <option value="">{t("inherit")}</option>}
          {deliveryModes.map((mode) => (
            <option key={mode} value={mode}>
              {t(mode)}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${id}-venue`} label={t("venue")}>
        <select
          id={`${id}-venue`}
          value={
            value.venue_id ?? (inherit && value.venue_id === null ? "none" : "")
          }
          onChange={(event) => {
            const id = event.currentTarget.value;
            change({
              ...value,
              venue_id:
                id === "none" ? null : id || (inherit ? undefined : null),
            });
          }}
        >
          <option value="">{t(inherit ? "inherit" : "noVenue")}</option>
          {inherit && <option value="none">{t("noVenue")}</option>}
          {value.venue_id && (!selectedVenue || selectedVenue.archived_at) && (
            <option value={value.venue_id}>
              {value.venue?.name ?? t("historicVenue")}
            </option>
          )}
          {venues
            .filter(({ archived_at }) => !archived_at)
            .map(({ id, details }) => (
              <option key={id} value={id}>
                {[details.name, details.city, details.room]
                  .filter(Boolean)
                  .join(" · ")}
              </option>
            ))}
        </select>
      </Field>
      <Field id={`${id}-platform`} label={t("meeting_platform")}>
        <select
          id={`${id}-platform`}
          value={value.meeting_platform ?? ""}
          onChange={(event) => {
            const platform = event.currentTarget
              .value as DeliveryConfig["meeting_platform"];
            change({
              ...value,
              meeting_platform: platform || (inherit ? undefined : null),
            });
          }}
        >
          <option value="">{t(inherit ? "inherit" : "choose")}</option>
          {meetingPlatforms.map((platform) => (
            <option key={platform} value={platform}>
              {platforms[platform]}
            </option>
          ))}
        </select>
      </Field>
      {(
        [
          "meeting_url",
          "meeting_id",
          "meeting_access",
          "teaching_instructions",
        ] as const
      ).map((field) => (
        <Field id={`${id}-${field}`} key={field} label={t(field)}>
          <input
            id={`${id}-${field}`}
            maxLength={2000}
            type={field === "meeting_url" ? "url" : "text"}
            placeholder={inherit ? t("inherit") : undefined}
            value={value[field] ?? ""}
            onChange={(event) =>
              change({
                ...value,
                [field]:
                  event.currentTarget.value || (inherit ? undefined : null),
              })
            }
          />
        </Field>
      ))}
    </div>
  );
}

function DeliveryEditor({
  actor,
  course,
  zone,
  data,
  venues,
  onSaved,
}: CourseProps & { data: DeliveryView; venues: Venue[]; onSaved: () => void }) {
  const { t, i18n } = useTranslation("trainingDelivery");
  const online = useOnline();
  const cache = useQueryClient();
  const [defaults, setDefaults] = useState<DeliveryConfig>(() => {
    const preferred = venues.find(
      ({ is_default, archived_at }) => is_default && !archived_at,
    );
    return {
      ...data.defaults,
      ...(data.revision === 0 && preferred ? { venue_id: preferred.id } : {}),
    };
  });
  const [enabled, setEnabled] = useState(data.overrides_enabled);
  const [changes, setChanges] = useState<Record<string, DeliveryConfig | null>>(
    {},
  );
  const modes = new Set(
    data.sessions.map(
      (slot) =>
        (enabled
          ? (changes[slot.id] === undefined ? slot.override : changes[slot.id])
              ?.mode
          : undefined) ?? defaults.mode,
    ),
  );
  const mode =
    modes.size > 1
      ? "mixed"
      : (modes.values().next().value ?? defaults.mode ?? "online");
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { data: receipt, error } = await db().rpc(
        "save_training_delivery",
        {
          p_course_run_id: course,
          p_expected_revision: data.revision,
          p_payload: {
            defaults: configInput(defaults),
            overrides_enabled: enabled,
            overrides: Object.fromEntries(
              Object.entries(changes).map(([id, value]) => [
                id,
                value ? configInput(value) : null,
              ]),
            ),
          },
        },
      );
      if (error) throw error;
      return deliveryView.parse(receipt);
    },
    onSuccess: (receipt) => {
      cache.setQueryData(["training-delivery", actor, course], receipt);
      onSaved();
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (online && !save.isPending) save.mutate();
  }
  return (
    <form className="stack" onSubmit={submit}>
      <p>
        <strong>{t(mode)}</strong>
      </p>
      <fieldset>
        <legend>{t("courseDefault")}</legend>
        <DeliveryFields
          value={defaults}
          venues={venues}
          inherit={false}
          change={setDefaults}
        />
      </fieldset>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
        />
        {t("individual")}
      </label>
      {!enabled && data.sessions.some(({ override }) => override) && (
        <p className="muted">{t("retained")}</p>
      )}
      {enabled &&
        data.sessions.map((slot) => {
          const current =
            changes[slot.id] === undefined ? slot.override : changes[slot.id];
          return (
            <details className="training-delivery-session" key={slot.id}>
              <summary>
                {dateTime(slot.starts_at, i18n.language, zone)} ·{" "}
                {t(current?.mode ?? defaults.mode ?? "online")}
              </summary>
              <DeliveryFields
                value={current ?? {}}
                venues={venues}
                inherit
                change={(value) =>
                  setChanges((previous) => ({ ...previous, [slot.id]: value }))
                }
              />
              {current && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setChanges((previous) => ({ ...previous, [slot.id]: null }))
                  }
                >
                  {t("reset")}
                </Button>
              )}
            </details>
          );
        })}
      {save.isError && <Notice kind="error">{t("error")}</Notice>}
      <div className="form-actions">
        <Button type="submit" disabled={!online || save.isPending}>
          {t("save")}
        </Button>
        {save.isError && (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void cache.resetQueries({
                queryKey: ["training-delivery", actor, course],
              })
            }
          >
            {t("refresh")}
          </Button>
        )}
      </div>
    </form>
  );
}

function DeliveryFacts({ data, zone }: { data: DeliveryView; zone: string }) {
  const { t, i18n } = useTranslation("trainingDelivery");
  return (
    <div>
      <p>
        <strong>{t(data.mode)}</strong>
      </p>
      <ul className="training-venue-list">
        {data.sessions.map(({ id, starts_at, effective }) => {
          if (!effective?.mode) return null;
          const venue = effective.venue;
          const address = [
            venue?.street &&
              [venue.street, venue.house_number].filter(Boolean).join(" "),
            venue?.address_line,
            [venue?.postal_code, venue?.city].filter(Boolean).join(" "),
            venue?.region,
            venue?.country,
          ].filter(Boolean);
          return (
            <li key={id}>
              <div>
                <strong>
                  {dateTime(starts_at, i18n.language, zone)} ·{" "}
                  {t(effective.mode)}
                </strong>
                {venue && (
                  <>
                    <p>
                      {[venue.name, venue.building, venue.floor, venue.room]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {address.length > 0 && (
                      <p>
                        {address.join(", ")}{" "}
                        <a
                          href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(address.join(", "))}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("map")}
                        </a>
                      </p>
                    )}
                    {(
                      [
                        "reception",
                        "access",
                        "parking",
                        "transport",
                        "accessibility",
                        "equipment",
                      ] as const
                    ).map(
                      (key) =>
                        venue[key] && (
                          <p key={key}>
                            <strong>{t(key)}</strong> · {venue[key]}
                          </p>
                        ),
                    )}
                  </>
                )}
                {effective.meeting_url?.startsWith("https://") && (
                  <p>
                    <a
                      href={effective.meeting_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {effective.meeting_platform
                        ? platforms[effective.meeting_platform]
                        : t("meeting_url")}
                    </a>
                  </p>
                )}
                {effective.meeting_id && (
                  <p>
                    {t("meeting_id")} · {effective.meeting_id}
                  </p>
                )}
                {effective.meeting_access && <p>{effective.meeting_access}</p>}
                {effective.teaching_instructions && (
                  <p>{effective.teaching_instructions}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function StructuredDelivery(props: CourseProps) {
  const { actor, course, zone, allowEdit } = props;
  const { t } = useTranslation("trainingDelivery");
  const [saved, setSaved] = useState(false);

  const query = useQuery({
    queryKey: ["training-delivery", actor, course],
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("training_delivery_view", { p_course_run_id: course })
        .abortSignal(signal);
      if (error) throw error;
      return deliveryView.nullable().parse(data);
    },
  });
  const organisation = query.data?.organisation_id;
  const directory = useQuery({
    queryKey: ["training-venues", actor, organisation],
    enabled: Boolean(allowEdit && organisation),
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("training_venue_directory", { p_organisation_id: organisation! })
        .abortSignal(signal);
      if (error) throw error;
      return z.array(venueSchema).parse(data);
    },
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!query.data) return <p>{t("unsupported")}</p>;

  const venues = directory.data ?? [];
  const canEdit = allowEdit && query.data.can_edit;
  return (
    <div className="stack">
      {saved && <Notice kind="success">{t("saved")}</Notice>}
      {canEdit ? (
        organisation && directory.isPending ? (
          <Loading />
        ) : (
          <DeliveryEditor
            {...props}
            key={query.data.revision}
            data={query.data}
            venues={venues}
            onSaved={() => setSaved(true)}
          />
        )
      ) : (
        <>
          {allowEdit && <p className="muted">{t("locked")}</p>}
          <DeliveryFacts data={query.data} zone={zone} />
        </>
      )}
      {allowEdit &&
        organisation &&
        (directory.isPending ? (
          <Loading />
        ) : directory.isError ? (
          <ErrorState retry={() => void directory.refetch()} />
        ) : (
          <VenueDirectory
            actor={actor}
            organisation={organisation}
            zone={zone}
            venues={venues}
          />
        ))}
    </div>
  );
}
