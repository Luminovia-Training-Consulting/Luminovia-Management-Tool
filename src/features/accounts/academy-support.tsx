/** Authorise or inspect local operational support without entering the teaching workspace. */
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ErrorState,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { Button } from "../../components/ui/button";
import { Preferences } from "../../components/preferences";
import { useOnline } from "../../lib/online";
import { installationBrand } from "../../lib/installation-brand";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import { SignOutButton } from "../auth/sign-out-button";
import {
  academySupportReply,
  academySupportRequest,
  type AcademySupportRequest,
  type AcademySupportReply,
} from "./academy-support-schema";
import "./academy-support.css";

async function support(request: AcademySupportRequest) {
  const { data, error } = await db().rpc("academy_support_access", request);
  if (error) throw error;
  const result = academySupportReply.parse(data);
  if (
    result.action !== request.p_action ||
    result.installation_id !== installationBrand.installationId
  )
    throw new Error("Unexpected support response");
  return result;
}

type List = Extract<AcademySupportReply, { action: "list" }>;
type Localize = (de: string, en: string) => string;

export function AcademySupportAccessPage() {
  const { session } = useAuth();
  const { i18n } = useTranslation();
  const online = useOnline();
  const word: Localize = (de, en) => (i18n.language.startsWith("de") ? de : en);
  return (
    <main className="academy-main">
      <PageHeading
        title={word("Befristeter Supportzugriff", "Temporary support access")}
        action={<SignOutButton />}
      />
      <div className="section-stack">
        <Preferences />
        {online && session ? (
          <SupportAccess
            key={session.user.id}
            actor={session.user.id}
            word={word}
          />
        ) : (
          <Notice>
            {word(
              "Online-Verbindung erforderlich.",
              "Connect to use support access.",
            )}
          </Notice>
        )}
      </div>
    </main>
  );
}

function SupportAccess({ actor, word }: { actor: string; word: Localize }) {
  const list = useQuery({
    queryKey: [
      "academy-support-access",
      installationBrand.installationId,
      actor,
    ],
    queryFn: async () => {
      const result = await support({ p_action: "list" });
      if (result.action !== "list") throw new Error("Unexpected support list");
      return result;
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchInterval: 10_000,
  });
  const action = useMutation({
    mutationFn: support,
    onSuccess: async (result) => {
      if (result.action === "grant" || result.action === "revoke")
        await list.refetch();
    },
  });
  if (list.isPending || !list.isFetchedAfterMount) return <Loading />;
  if (list.isError) return <ErrorState retry={() => void list.refetch()} />;
  const data = list.data;
  return (
    <>
      {data.can_manage && (
        <Button asChild variant="ghost">
          <Link to="/administration">
            {word("Zur Akademieverwaltung", "Back to academy administration")}
          </Link>
        </Button>
      )}
      {data.can_issue && (
        <SupportGrantForm
          word={word}
          issue={(request) => action.mutateAsync(request)}
          busy={action.isPending}
        />
      )}
      <section className="panel">
        <h2>{word("Freigaben", "Grants")}</h2>
        {data.grants.length ? (
          <ul className="academy-support-grants">
            {data.grants.map((grant) => (
              <SupportGrantItem
                key={grant.id}
                grant={grant}
                administrator={data.can_manage}
                canRead={data.can_read}
                word={word}
                busy={action.isPending}
                select={(verb) =>
                  action.mutate({ p_action: verb, p_payload: { id: grant.id } })
                }
              />
            ))}
          </ul>
        ) : (
          <p>
            {word(
              "Keine Freigaben für dieses Konto.",
              "There are no grants for this account.",
            )}
          </p>
        )}
      </section>
      {action.isError && (
        <Notice kind="error">
          {word(
            "Die Supportaktion wurde nicht bestätigt.",
            "The support action was not confirmed.",
          )}
        </Notice>
      )}
      {action.data && (
        <SupportResult data={data} result={action.data} word={word} />
      )}
    </>
  );
}

function SupportGrantForm({
  word,
  issue,
  busy,
}: {
  word: Localize;
  issue: (request: AcademySupportRequest) => Promise<AcademySupportReply>;
  busy: boolean;
}) {
  const [scope, setScope] = useState<"installation" | "course">("installation");
  const [retry, setRetry] = useState<{ id: string; signature: string }>();
  const [invalid, setInvalid] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const details = {
      recipient_email: String(fields.get("recipient") ?? "").trim(),
      scope,
      course_id:
        scope === "course" ? String(fields.get("course") ?? "").trim() : null,
      purpose: String(fields.get("purpose") ?? "").trim(),
      duration_minutes: Number(fields.get("duration")),
    };
    const signature = JSON.stringify(details);
    const id = signature === retry?.signature ? retry.id : crypto.randomUUID();
    const parsed = academySupportRequest.safeParse({
      p_action: "grant",
      p_payload: { ...details, id },
    });
    setInvalid(!parsed.success);
    if (parsed.success) {
      setRetry({ signature, id });
      void issue(parsed.data).then(
        () => {
          form.reset();
          setScope("installation");
          setRetry(undefined);
        },
        () => undefined,
      );
    }
  }
  return (
    <section className="panel">
      <h2>{word("Diagnosezugriff freigeben", "Grant diagnostic access")}</h2>
      <p>
        {word(
          "Wähle ein bestätigtes lokales Supportkonto ohne Akademie-Rolle. Die Freigabe erlaubt ausgewählte Diagnosedaten für die angegebene Dauer.",
          "Choose a confirmed local support account without an academy role. The grant allows access to the selected diagnostics for the chosen duration.",
        )}
      </p>
      <form onSubmit={submit}>
        <fieldset className="academy-support-fields" disabled={busy}>
          <legend>{word("Umfang der Freigabe", "Grant details")}</legend>
          <label>
            {word("E-Mail des Supportkontos", "Support account email")}
            <input name="recipient" type="email" maxLength={254} required />
          </label>
          <label>
            {word("Diagnoseumfang", "Diagnostic scope")}
            <select
              value={scope}
              onChange={(event) =>
                setScope(
                  event.target.value === "course" ? "course" : "installation",
                )
              }
            >
              <option value="installation">
                {word("Installationsdiagnose", "Installation diagnostics")}
              </option>
              <option value="course">
                {word("Diagnose für einen Kurs", "Diagnostics for one course")}
              </option>
            </select>
          </label>
          {scope === "course" && (
            <label>
              {word(
                "Kurs-ID aus der Kursraum-Adresse",
                "Course ID from the workspace URL",
              )}
              <input name="course" required />
            </label>
          )}
          <label>
            {word("Zweck der Freigabe", "Purpose of the grant")}
            <input name="purpose" minLength={8} maxLength={240} required />
          </label>
          <label>
            {word("Dauer", "Duration")}
            <select name="duration" defaultValue="30">
              {[15, 30, 60, 240, 1440].map((minutes) => (
                <option value={minutes} key={minutes}>
                  {minutes} {word("Minuten", "minutes")}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label academy-support-confirm">
            <input type="checkbox" required />
            {word(
              "Ich erteile diesem Konto den oben gewählten Diagnosezugriff.",
              "I grant this account the diagnostic scope selected above.",
            )}
          </label>
          <Button type="submit">
            {word("Befristet freigeben", "Grant temporary access")}
          </Button>
        </fieldset>
      </form>
      {invalid && (
        <Notice kind="error">
          {word("Prüfe die eingegebenen Daten.", "Check the entered details.")}
        </Notice>
      )}
    </section>
  );
}

function SupportGrantItem({
  grant,
  administrator,
  canRead,
  word,
  busy,
  select,
}: {
  grant: List["grants"][number];
  administrator: boolean;
  canRead: boolean;
  word: Localize;
  busy: boolean;
  select: (verb: "audit" | "read" | "revoke") => void;
}) {
  const status = {
    active: word("Aktiv", "Active"),
    revoked: word("Widerrufen", "Revoked"),
    expired: word("Abgelaufen", "Expired"),
  };
  return (
    <li>
      <h3>{grant.purpose}</h3>
      <p>
        {grant.grantee_email} ·{" "}
        {grant.scope === "installation"
          ? word("Installation", "Installation")
          : word("Kurs", "Course")}{" "}
        {grant.course_id}
      </p>
      <p>
        {status[grant.status]} · {word("Ende", "Expires")}{" "}
        <LocalTime value={grant.expires_at} />
      </p>
      <div className="form-actions">
        {grant.status === "active" &&
          (administrator ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => select("revoke")}
            >
              {word("Zugriff widerrufen", "Revoke access")}
            </Button>
          ) : (
            canRead && (
              <Button disabled={busy} onClick={() => select("read")}>
                {word("Diagnose abrufen", "Read diagnostics")}
              </Button>
            )
          ))}
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => select("audit")}
        >
          {word("Protokoll anzeigen", "Show audit history")}
        </Button>
      </div>
    </li>
  );
}

function LocalTime({ value }: { value: string }) {
  const { i18n } = useTranslation();
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "long",
      }).format(new Date(value))}
    </time>
  );
}

function SupportResult({
  data,
  result,
  word,
}: {
  data: List;
  result: AcademySupportReply;
  word: Localize;
}) {
  if (result.action === "grant")
    return <Notice>{word("Freigabe gespeichert.", "Grant saved.")}</Notice>;
  if (result.action === "revoke")
    return <Notice>{word("Zugriff widerrufen.", "Access revoked.")}</Notice>;
  if (result.action === "audit") {
    const kinds = {
      granted: word("Erteilt", "Granted"),
      revoked: word("Widerrufen", "Revoked"),
      expired: word("Abgelaufen", "Expired"),
      read: word("Diagnose abgerufen", "Diagnostics read"),
    };
    return (
      <section
        className="panel"
        aria-label={word("Supportprotokoll", "Support audit history")}
      >
        <h2>{word("Supportprotokoll", "Support audit history")}</h2>
        <ol>
          {result.events.map((event, index) => (
            <li key={index}>
              {kinds[event.kind]} · <LocalTime value={event.at} />{" "}
              {event.actor_id}
            </li>
          ))}
        </ol>
      </section>
    );
  }
  if (
    result.action !== "read" ||
    !data.can_read ||
    !data.grants.some(
      ({ id, status }) => id === result.id && status === "active",
    )
  )
    return null;
  const diagnostic = result.diagnostic;
  return (
    <section
      className="panel"
      aria-label={word("Diagnosedaten", "Diagnostics")}
    >
      <h2>{word("Diagnosedaten", "Diagnostics")}</h2>
      <dl>
        {diagnostic.scope === "installation" ? (
          <>
            <dt>{word("Edition", "Edition")}</dt>
            <dd>{diagnostic.edition}</dd>
            <dt>{word("Release", "Release")}</dt>
            <dd>{diagnostic.release}</dd>
            <dt>{word("Lizenz", "Licence")}</dt>
            <dd>{word("Aktiv", "Active")}</dd>
          </>
        ) : (
          <>
            <dt>{word("Kurs-ID", "Course ID")}</dt>
            <dd>{diagnostic.course_id}</dd>
            <dt>{word("Veröffentlicht", "Published")}</dt>
            <dd>
              {diagnostic.published ? word("Ja", "Yes") : word("Nein", "No")}
            </dd>
            <dt>{word("Termine", "Sessions")}</dt>
            <dd>{diagnostic.session_count}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
