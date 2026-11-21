/** Online draft form for the licensed academy's local courses. */
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { zonedInstant } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { courseHubQuery } from "./api";
import {
  academyDraftOptions,
  academyDraftPayload,
  academyDraftReceipt,
} from "./academy-draft-schema";

/** Access to options and the final transaction is rechecked by the exact licensed installation. */
export function AcademyCourseDraft({ actor }: { actor: string }) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [organisationQuery, setOrganisationQuery] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [newTemplate, setNewTemplate] = useState(false);
  const [sessions, setSessions] = useState(() => [crypto.randomUUID()]);
  const [invalid, setInvalid] = useState(false);
  const lastRequest = useRef<{ content: string; id: string }>(undefined);
  const sessionToFocus = useRef<string>(undefined);
  const options = useQuery<ReturnType<typeof academyDraftOptions.parse>>({
    queryKey: [
      "academy-draft-options",
      actor,
      organisationQuery,
      templateQuery,
    ],
    enabled: online,
    staleTime: 0,
    refetchOnMount: "always",
    placeholderData: (previous, query) =>
      query?.queryKey[1] === actor ? previous : undefined,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_course_draft_options", {
          p_organisation_query: organisationQuery,
          p_template_query: templateQuery,
        })
        .abortSignal(signal);
      if (error) throw error;
      return academyDraftOptions.parse(data);
    },
  });
  const save = useMutation({
    mutationFn: async (body: {
      p_organisation_id: string;
      p_template_id: string | null;
      p_template_title: string | null;
      p_payload: ReturnType<typeof academyDraftPayload.parse>;
    }) => {
      requireOnline();
      const content = JSON.stringify(body);
      if (lastRequest.current?.content !== content)
        lastRequest.current = { content, id: crypto.randomUUID() };
      const { data, error } = await db().rpc("academy_create_course_draft", {
        ...body,
        p_request_id: lastRequest.current.id,
      });
      if (error) throw error;
      return academyDraftReceipt.parse(data);
    },
    onSuccess: async ({ course_run_id }) => {
      await cache.invalidateQueries({
        queryKey: courseHubQuery(actor).queryKey,
      });
      void navigate(`/courses/${course_run_id}/workspace`);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const timeZone = value("time_zone");
    const payload = academyDraftPayload.safeParse({
      time_zone: timeZone,
      venue: value("venue"),
      delivery_type: value("delivery_type"),
      sessions: sessions.map((id) => ({
        starts_at: zonedInstant(value(`start-${id}`), timeZone),
        ends_at: zonedInstant(value(`end-${id}`), timeZone),
      })),
    });
    save.reset();
    if (
      !payload.success ||
      payload.data.sessions.some(
        ({ starts_at, ends_at }) =>
          Date.parse(starts_at) >= Date.parse(ends_at),
      )
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    save.mutate({
      p_organisation_id: value("organisation"),
      p_template_id: newTemplate ? null : value("template"),
      p_template_title: newTemplate ? value("new_template") : null,
      p_payload: payload.data,
    });
  }

  if (!online || options.isError || options.data === null) return null;
  if (!options.data) return <Loading />;
  const disabled = save.isPending || options.isFetching;
  return (
    <details className="panel academy-draft">
      <summary>{t("academyCreateDraft")}</summary>
      <form onSubmit={submit}>
        <Field
          id="academy-draft-company-search"
          label={t("academySearchOrganisations")}
        >
          <input
            id="academy-draft-company-search"
            maxLength={100}
            value={organisationQuery}
            onChange={(event) =>
              setOrganisationQuery(event.currentTarget.value)
            }
          />
        </Field>
        <Field id="academy-draft-company" label={t("academyOrganisation")}>
          <select
            id="academy-draft-company"
            name="organisation"
            required
            defaultValue=""
          >
            <option value="">{t("choose")}</option>
            {options.data.organisations.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        {!options.data.organisations.length && (
          <Notice>{t("academyNoOrganisation")}</Notice>
        )}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={newTemplate}
            onChange={(event) => setNewTemplate(event.currentTarget.checked)}
          />
          {t("academyNewTemplate")}
        </label>
        {newTemplate ? (
          <Field id="academy-draft-title" label={t("academyTemplateTitle")}>
            <input
              id="academy-draft-title"
              name="new_template"
              required
              maxLength={200}
            />
          </Field>
        ) : (
          <>
            <Field
              id="academy-draft-template-search"
              label={t("academySearchTemplates")}
            >
              <input
                id="academy-draft-template-search"
                maxLength={100}
                value={templateQuery}
                onChange={(event) =>
                  setTemplateQuery(event.currentTarget.value)
                }
              />
            </Field>
            <Field id="academy-draft-template" label={t("academyTemplate")}>
              <select
                id="academy-draft-template"
                name="template"
                required
                defaultValue=""
              >
                <option value="">{t("choose")}</option>
                {options.data.templates.map(({ id, title }) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <Field id="academy-draft-zone" label={t("academyTimeZone")}>
          <input
            id="academy-draft-zone"
            name="time_zone"
            defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
            required
          />
        </Field>
        <Field id="academy-draft-delivery" label={t("academyDelivery")}>
          <select
            id="academy-draft-delivery"
            name="delivery_type"
            defaultValue="online"
          >
            <option value="online">{t("academyOnline")}</option>
            <option value="onsite">{t("academyOnsite")}</option>
          </select>
        </Field>
        <Field id="academy-draft-venue" label={t("academyVenue")}>
          <input id="academy-draft-venue" name="venue" maxLength={500} />
        </Field>
        {sessions.map((id, index) => (
          <fieldset key={id} className="academy-draft-session">
            <legend>{t("sessionNumber", { number: index + 1 })}</legend>
            <Field id={`start-${id}`} label={t("academySessionStart")}>
              <input
                id={`start-${id}`}
                name={`start-${id}`}
                type="datetime-local"
                required
                ref={(input) => {
                  if (input && sessionToFocus.current === id) {
                    sessionToFocus.current = undefined;
                    input.focus();
                  }
                }}
              />
            </Field>
            <Field id={`end-${id}`} label={t("academySessionEnd")}>
              <input
                id={`end-${id}`}
                name={`end-${id}`}
                type="datetime-local"
                required
              />
            </Field>
            {sessions.length > 1 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  // Keep focus in the schedule after its focused row unmounts.
                  sessionToFocus.current =
                    sessions[index + 1] ?? sessions[index - 1];
                  setSessions((items) => items.filter((item) => item !== id));
                }}
              >
                {t("academyRemoveSession", { number: index + 1 })}
              </Button>
            )}
          </fieldset>
        ))}
        {invalid && (
          <Notice kind="error">{t("academyDraftTimesInvalid")}</Notice>
        )}
        {save.isError && (
          <Notice kind="error">{t("academyDraftFailed")}</Notice>
        )}
        <div className="form-actions academy-draft-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={sessions.length >= 60 || save.isPending}
            onClick={() => {
              const id = crypto.randomUUID();
              sessionToFocus.current = id;
              setSessions((items) => [...items, id]);
            }}
          >
            {t("academyAddSession")}
          </Button>
          <Button type="submit" disabled={disabled}>
            {t("academySaveDraft")}
          </Button>
        </div>
      </form>
    </details>
  );
}
