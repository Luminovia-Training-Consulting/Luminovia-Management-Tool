/** Manage organisation-owned structured venues without leaving the course workspace. */
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { venueFields, type Venue, type VenueField } from "./delivery-schema";

const basic = venueFields.slice(0, 13);
const additional = venueFields.slice(13);
const required = new Set<VenueField>(["name", "city", "country", "time_zone"]);

function VenueForm({
  venue,
  zone,
  organisation,
  onDone,
  actor,
}: {
  venue: Venue | null;
  zone: string;
  organisation: string;
  onDone: () => void;
  actor: string;
}) {
  const { t } = useTranslation("trainingDelivery");
  const id = useId();
  const online = useOnline();
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: async (payload: {
      details: Record<string, string>;
      is_default: boolean;
      archived: boolean;
    }) => {
      requireOnline();
      const { error } = await db().rpc("save_training_venue", {
        p_organisation_id: organisation,
        p_venue_id: venue?.id ?? null,
        p_expected_revision: venue?.revision ?? 0,
        p_payload: payload,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ["training-venues", actor, organisation],
      });
      onDone();
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const archived = form.has("archived");
    save.mutate({
      details: Object.fromEntries(
        venueFields.map((key) => [key, String(form.get(key) ?? "").trim()]),
      ),
      archived,
      is_default: !archived && form.has("is_default"),
    });
  }
  const fields = (keys: readonly VenueField[]) =>
    keys.map((key) => (
      <Field id={`${id}-${key}`} label={t(key)} key={key}>
        <input
          id={`${id}-${key}`}
          name={key}
          maxLength={key === "name" ? 160 : 500}
          required={required.has(key)}
          defaultValue={
            venue?.details[key] ?? (key === "time_zone" ? zone : "")
          }
          type={
            key === "contact_email"
              ? "email"
              : key === "contact_phone"
                ? "tel"
                : "text"
          }
        />
      </Field>
    ));
  return (
    <form className="stack training-venue-form" onSubmit={submit}>
      <div className="training-delivery-grid">{fields(basic)}</div>
      <details>
        <summary>{t("venueMore")}</summary>
        <div className="training-delivery-grid">{fields(additional)}</div>
      </details>
      <label className="checkbox-label">
        <input
          name="is_default"
          type="checkbox"
          defaultChecked={venue?.is_default}
        />
        {t("preferred")}
      </label>
      {venue && (
        <label className="checkbox-label">
          <input
            name="archived"
            type="checkbox"
            defaultChecked={Boolean(venue.archived_at)}
          />
          {t("archived")}
        </label>
      )}
      {save.isError && <Notice kind="error">{t("venueError")}</Notice>}
      <div className="form-actions">
        <Button type="submit" disabled={!online || save.isPending}>
          {t("venueSave")}
        </Button>
      </div>
    </form>
  );
}

export function VenueDirectory({
  venues,
  organisation,
  zone,
  actor,
}: {
  venues: Venue[];
  organisation: string;
  zone: string;
  actor: string;
}) {
  const { t } = useTranslation("trainingDelivery");
  const id = useId();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Venue | null>();
  const rows = venues.filter(({ details }) =>
    [details.name, details.city, details.room].some((field) =>
      field?.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()),
    ),
  );
  return (
    <details className="training-venue-directory">
      <summary>{t("directory")}</summary>
      <div className="training-delivery-grid training-venue-search">
        <Field id={id} label={t("venueFilter")}>
          <input
            id={id}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
          />
        </Field>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setEditing(null)}
        >
          {t("venueNew")}
        </Button>
      </div>
      {rows.length ? (
        <ul className="training-venue-list">
          {rows.map((venue) => (
            <li key={venue.id}>
              <span>
                {[
                  venue.details.name,
                  venue.details.city,
                  venue.details.room,
                  venue.archived_at && t("archived"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <Button
                size="sm"
                type="button"
                variant="secondary"
                onClick={() => setEditing(venue)}
              >
                {t("venueEdit")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("noVenues")}</p>
      )}
      {editing !== undefined && (
        <VenueForm
          key={editing?.id ?? "new"}
          actor={actor}
          organisation={organisation}
          zone={zone}
          venue={editing}
          onDone={() => setEditing(undefined)}
        />
      )}
    </details>
  );
}
