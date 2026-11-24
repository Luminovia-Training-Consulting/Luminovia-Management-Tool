/**
 * Administrative activity with explicitly applied filters and a server-authorized log clear.
 * Keep filter drafts separate from the active query.
 */
import { type FormEvent, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Trash2 } from "lucide-react";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { permissionsQuery, profileQuery } from "../../lib/queries";
import { dateTime, validZone } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import {
  type AuditCursor,
  auditEventsKey,
  auditEventsQuery,
  type AuditFilter,
  auditRange,
  clearAdministrationActivity,
} from "./api";
import "./i18n";
import "./audit.css";

function auditDraft(zone: string) {
  const now = DateTime.now().setZone(zone);
  return {
    from: now.minus({ days: 30 }).toISODate()!,
    to: now.toISODate()!,
    zone,
    action: "",
    search: "",
  };
}

function actionLabel(t: TFunction<"adminAudit">, action: string) {
  const [group, subject, operation] = action.split(".");
  if (group === "activity" && subject && operation) {
    const resource = t(`kinds.${subject}`, {
      defaultValue: subject.replaceAll("_", " "),
    });
    return t(`operations.${operation}`, { resource, defaultValue: resource });
  }
  const category = t(`groups.${group}`, { defaultValue: action });
  return t(`actions.${action.replaceAll(".", "_")}`, {
    defaultValue: category,
  });
}

/** Apply filters deliberately and follow server-provided tuple cursors instead of loading all audit events. */
function AuditReader({ actor, zone }: { actor: string; zone: string }) {
  const { t, i18n } = useTranslation("adminAudit"),
    online = useOnline(),
    id = useId();
  const cache = useQueryClient();
  const [draft, setDraft] = useState(() => auditDraft(zone));
  const [filter, setFilter] = useState<AuditFilter>(() => ({
      ...draft,
      ...auditRange(draft.from, draft.to, zone)!,
    })),
    [cursors, setCursors] = useState<(AuditCursor | null)[]>([null]),
    [pageIndex, setPageIndex] = useState(0),
    [invalid, setInvalid] = useState(false);
  const page = useQuery({
    ...auditEventsQuery(actor, filter, cursors[pageIndex]),
    enabled: online,
  });
  const [actions, setActions] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const mayClear = !page.isError && page.data?.can_clear === true;
  const clear = useMutation({
    mutationFn: clearAdministrationActivity,
    retry: false,
    onSuccess: () => {
      const next = auditDraft(zone);
      setDraft(next);
      setFilter({ ...next, ...auditRange(next.from, next.to, zone)! });
      setCursors([null]);
      setPageIndex(0);
      setInvalid(false);
      setConfirmClear(false);
      void cache.resetQueries({ queryKey: auditEventsKey(actor) });
    },
  });
  // The reviewed action vocabulary comes from the server, never from a wider
  // raw audit query. Deriving options avoids effects or background refetches.
  const options = page.data?.actions ?? actions;

  function apply(event: FormEvent) {
    event.preventDefault();
    const range = auditRange(draft.from, draft.to, draft.zone);
    if (!range) {
      setInvalid(true);
      return;
    }
    if (page.data?.actions) setActions(page.data.actions);
    setInvalid(false);
    setCursors([null]);
    setPageIndex(0);
    setFilter({ ...draft, ...range, search: draft.search.trim() });
  }

  return (
    <>
      <div className="audit-toolbar">
        <p>{t("privacy")}</p>
        {mayClear && (
          <Button
            type="button"
            variant="danger"
            disabled={!online || clear.isPending}
            onClick={() => {
              clear.reset();
              setConfirmClear(true);
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            {t("clear")}
          </Button>
        )}
      </div>
      {clear.isSuccess && (
        <Notice kind="success">
          {t("cleared", { count: clear.data.removed })}
        </Notice>
      )}
      <Dialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        closeDisabled={clear.isPending}
        title={t("clearTitle")}
        description={t("clearDescription")}
      >
        {clear.isError && <Notice kind="error">{t("clearError")}</Notice>}
        <div className="audit-dialog-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={clear.isPending}
            onClick={() => setConfirmClear(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!online || !mayClear || clear.isPending}
            onClick={() => clear.mutate()}
          >
            {t(clear.isPending ? "clearing" : "clearConfirm")}
          </Button>
        </div>
      </Dialog>
      {!online && <Notice kind="error">{t("offline")}</Notice>}
      <form className="panel audit-filters" onSubmit={apply}>
        <Field id={`${id}-from`} label={t("from")}>
          <input
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            required
          />
        </Field>
        <Field id={`${id}-to`} label={t("to")}>
          <input
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            required
          />
        </Field>
        <Field id={`${id}-zone`} label={t("zone")}>
          <input
            value={draft.zone}
            onChange={(e) => setDraft({ ...draft, zone: e.target.value })}
            required
          />
        </Field>
        <Field id={`${id}-action`} label={t("action")}>
          <select
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
          >
            <option value="">{t("all")}</option>
            {options.map((action) => (
              <option key={action} value={action}>
                {actionLabel(t, action)} · {action}
              </option>
            ))}
          </select>
        </Field>
        <div className="audit-search">
          <Field id={`${id}-search`} label={t("search")} hint={t("searchHint")}>
            <input
              type="search"
              maxLength={160}
              value={draft.search}
              onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            />
          </Field>
        </div>
        <div className="audit-filter-actions">
          <Button disabled={!online}>{t("apply")}</Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!online || page.isFetching}
            onClick={() => void page.refetch()}
          >
            {t("refresh")}
          </Button>
        </div>
      </form>
      {invalid && <Notice kind="error">{t("rangeError")}</Notice>}
      <p className="audit-window">{t("window", { zone: filter.zone })}</p>
      {page.isError ? (
        <ErrorState retry={() => void page.refetch()} />
      ) : page.isPending ? (
        <Loading />
      ) : (
        <>
          {!page.data.items.length ? (
            <p className="empty">{t("empty")}</p>
          ) : (
            <ol className="audit-list">
              {page.data.items.map((entry) => (
                <li key={entry.id}>
                  <article className="panel audit-entry">
                    <div>
                      <h2>{actionLabel(t, entry.action)}</h2>
                      <code>{entry.action}</code>
                      <p>
                        <time dateTime={entry.created_at}>
                          {dateTime(
                            entry.created_at,
                            i18n.language,
                            filter.zone,
                          )}
                        </time>
                      </p>
                    </div>
                    <dl>
                      <dt>{t("actor")}</dt>
                      <dd>{entry.actor_name || t("unknownActor")}</dd>
                      <dt>{t("resource")}</dt>
                      <dd>
                        <code>{entry.resource_id || t("noResource")}</code>
                        {entry.resource_kind && (
                          <>
                            {" "}
                            ·{" "}
                            {t(`kinds.${entry.resource_kind}`, {
                              defaultValue: entry.resource_kind,
                            })}
                          </>
                        )}
                      </dd>
                      {entry.changed_fields?.length ? (
                        <>
                          <dt>{t("changedFields")}</dt>
                          <dd>
                            {entry.changed_fields
                              .map((field) =>
                                t(`fields.${field}`, { defaultValue: field }),
                              )
                              .join(", ")}
                          </dd>
                        </>
                      ) : null}
                      {entry.payment && (
                        <>
                          <dt>{t("paymentAmount")}</dt>
                          <dd>
                            {entry.payment.amount} {entry.payment.currency}
                          </dd>
                        </>
                      )}
                    </dl>
                  </article>
                </li>
              ))}
            </ol>
          )}
          <div className="audit-pages">
            <Button
              variant="secondary"
              disabled={!online || pageIndex === 0 || page.isFetching}
              onClick={() => setPageIndex((value) => value - 1)}
            >
              {t("previous")}
            </Button>
            <span aria-live="polite">
              {t("page", {
                page: pageIndex + 1,
                count: page.data.items.length,
              })}
            </span>
            <Button
              variant="secondary"
              disabled={
                !online ||
                !page.data.has_more ||
                !page.data.next_cursor ||
                page.isFetching
              }
              onClick={() => {
                const cursor = page.data.next_cursor;
                if (!cursor) return;
                // Reuse the server's exact bounds; the tuple cursor avoids
                // offset-based skips when newer events arrive between pages.
                if (pageIndex === 0)
                  setFilter({
                    ...filter,
                    from: page.data.from,
                    to: page.data.to,
                  });
                setCursors([...cursors.slice(0, pageIndex + 1), cursor]);
                setPageIndex((value) => value + 1);
              }}
            >
              {t("next")}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

/** The dedicated reader checks capability and licence on its own scoped RPC. */
export function AcademyAuditPage() {
  const { t } = useTranslation("adminAudit");
  const { session } = useAuth();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <>
      <PageHeading title={t("title")} description={t("description")} />
      <AuditReader
        actor={session!.user.id}
        zone={validZone(zone) ? zone : "UTC"}
      />
    </>
  );
}

/** Load the audit capability and display zone before requesting permitted administrative events. */
export function AdminAuditPage() {
  const { t } = useTranslation("adminAudit"),
    { session } = useAuth(),
    actor = session!.user.id;
  const permissions = useQuery(permissionsQuery(actor)),
    profile = useQuery(profileQuery(actor));
  return (
    <>
      <PageHeading title={t("title")} description={t("description")} />
      {permissions.isPending || profile.isPending ? (
        <Loading />
      ) : permissions.isError || profile.isError || !profile.data ? (
        <ErrorState
          retry={() => {
            void permissions.refetch();
            void profile.refetch();
          }}
        />
      ) : !permissions.data.some((permission) =>
          ["audit.read", "audit.activity.read"].includes(permission),
        ) ? (
        <Notice kind="error">{t("denied")}</Notice>
      ) : (
        <AuditReader key={actor} actor={actor} zone={profile.data.time_zone} />
      )}
    </>
  );
}
