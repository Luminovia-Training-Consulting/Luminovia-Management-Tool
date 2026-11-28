/** Server-filtered offers and own saved views; observed roles scope quote-bearing pages. */
import { mergeCursorItems } from "../../lib/cursor-rows";
import { LoadMore } from "../../components/load-more";
import { canRetryNextPage } from "../../lib/paged-read";
import { currencyCodes } from "../../lib/currencies.ts";
import { isDatabasePermissionDenied } from "../../lib/database-errors";
import { MyJobWaitlist } from "./lifecycle-extra";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import {
  hasJobStaffRole,
  hasTeachingRole,
} from "../auth/internal-capabilities";
import { topicsQuery, userRolesQuery } from "../../lib/queries";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { TimeZoneOptions } from "../../components/time-zone-options";
import {
  ErrorState,
  Field,
  Loading,
  NextPageError,
  Notice,
  PageHeading,
} from "../../components/common";
import { selectableTopics } from "../taxonomy/selection";
import { JobCard } from "./card";
import {
  defaultJobFilters,
  filterDraftFromParams,
  filterParams,
  filtersFromParams,
  jobDiscoveryQuery,
  type JobFilters,
  jobFiltersSchema,
  removeJobView,
  type SavedJobView,
  savedJobViewsQuery,
  saveJobView,
} from "./discovery-api";
import "./discovery-i18n";
import "./discovery.css";

function FilterForm({
  initial,
  revision,
  apply,
}: {
  initial: JobFilters;
  revision: number;
  apply: (values: JobFilters) => void;
}) {
  const { t, i18n } = useTranslation("jobDiscovery"),
    common = useTranslation().t;
  const topics = useQuery(topicsQuery);
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<z.input<typeof jobFiltersSchema>, unknown, JobFilters>({
    resolver: zodResolver(jobFiltersSchema),
    defaultValues: initial,
  });
  const selected = useWatch({ control, name: "topic_ids" });
  // Replace the draft on navigation or saved-view selection without replacing
  // the focused control in the DOM.
  useEffect(() => reset(initial), [initial, reset, revision]);
  return (
    <form
      className="panel discovery-filters"
      onSubmit={handleSubmit(apply)}
      noValidate
    >
      <div className="discovery-filter-grid">
        <Field id="discovery-q" label={t("text")}>
          <input type="search" {...register("q")} maxLength={160} />
        </Field>
        <Field id="discovery-customer" label={t("customer")}>
          <input {...register("customer")} maxLength={120} />
        </Field>
        <Field id="discovery-delivery" label={common("delivery")}>
          <select {...register("delivery")}>
            <option value="">{common("all")}</option>
            {["online", "onsite", "hybrid", "mixed"].map((s) => (
              <option key={s} value={s}>
                {common(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="discovery-status" label={t("status")}>
          <select {...register("status")}>
            <option value="">{common("all")}</option>
            {["draft", "published", "filled", "archived"].map((s) => (
              <option key={s} value={s}>
                {common(s)}
              </option>
            ))}
          </select>
        </Field>
        <div className="discovery-history-filter">
          <label className="checkbox-label">
            <input type="checkbox" {...register("include_history")} />
            {t("includeHistory")}
          </label>
          <p className="muted">{t("historyHint")}</p>
        </div>
        <fieldset className="discovery-topic-filter">
          <legend>{t("topics")}</legend>
          <div className="discovery-topic-options">
            {selectableTopics(topics.data ?? [], selected ?? []).map(
              (topic) => (
                <label key={topic.id} className="discovery-topic-option">
                  <input
                    type="checkbox"
                    value={topic.id}
                    {...register("topic_ids")}
                  />
                  <span>
                    {i18n.language.startsWith("de")
                      ? topic.label_de
                      : topic.label_en}
                    {topic.archived_at ? ` (${common("archived")})` : ""}
                  </span>
                </label>
              ),
            )}
          </div>
        </fieldset>
        <Field
          id="discovery-from"
          label={common("dateFrom")}
          error={Boolean(errors.from)}
        >
          <input type="date" {...register("from")} />
        </Field>
        <Field
          id="discovery-to"
          label={common("dateTo")}
          error={Boolean(errors.to)}
        >
          <input type="date" {...register("to")} />
        </Field>
        <Field
          id="discovery-zone"
          label={t("zone")}
          error={Boolean(errors.zone)}
        >
          <select {...register("zone")}>
            <TimeZoneOptions current={initial.zone} />
          </select>
        </Field>
        <Field
          id="discovery-currency"
          label={common("currency")}
          error={Boolean(errors.currency)}
        >
          <select {...register("currency")}>
            <option value="">{common("all")}</option>
            {currencyCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="discovery-unit"
          label={t("unit")}
          error={Boolean(errors.unit)}
        >
          <select {...register("unit")}>
            <option value="">{common("all")}</option>
            {["per_day", "per_hour", "per_teaching_unit", "fixed_total"].map(
              (u) => (
                <option key={u} value={u}>
                  {common(u)}
                </option>
              ),
            )}
          </select>
        </Field>
        {(
          [
            ["min_total", "minTotal"],
            ["max_total", "maxTotal"],
            ["min_rate", "minRate"],
            ["max_rate", "maxRate"],
            ["min_hours", "minHours"],
            ["max_hours", "maxHours"],
          ] as const
        ).map(([key, label]) => (
          <Field
            key={key}
            id={`discovery-${key}`}
            label={t(label)}
            error={Boolean(errors[key])}
          >
            <input
              type="number"
              min="0"
              step="0.01"
              {...register(key, {
                setValueAs: (value) =>
                  value === "" || value === null ? null : Number(value),
              })}
            />
          </Field>
        ))}
        <Field id="discovery-sort" label={t("sort")}>
          <select {...register("sort")}>
            {[
              "newest",
              "oldest",
              "soonest",
              "total_asc",
              "total_desc",
              "rate_asc",
              "rate_desc",
              "duration_asc",
              "title",
              "customer_asc",
              "topic_de_asc",
              "topic_en_asc",
            ].map((s) => (
              <option key={s} value={s}>
                {t(s === "title" ? "titleSort" : s)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="muted">{t("dateHint")}</p>
      <p className="muted">{t("hoursHint")}</p>
      <label className="checkbox-label">
        <input type="checkbox" {...register("available_only")} />
        {t("available")}
      </label>
      <p className="muted">{t("availableHint")}</p>
      {Object.keys(errors).length > 0 && (
        <Notice kind="error">
          {t(
            errors.currency
              ? "currencyRequired"
              : errors.unit
                ? "unitRequired"
                : "invalid",
          )}
        </Notice>
      )}
      <div className="discovery-actions">
        <Button type="submit">{t("apply")}</Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            reset(defaultJobFilters);
            apply(defaultJobFilters);
          }}
        >
          {t("reset")}
        </Button>
      </div>
    </form>
  );
}

function SavedViews({
  actor,
  editorRevision,
  filters,
  search,
  select,
}: {
  actor: string;
  editorRevision: number;
  filters: JobFilters | null;
  search: string;
  select: (params: URLSearchParams) => void;
}) {
  const { t } = useTranslation("jobDiscovery"),
    client = useQueryClient();
  const views = useQuery(savedJobViewsQuery(actor));
  const [denied, setDenied] = useState(false);
  const accessDenied =
    isDatabasePermissionDenied(views.error) ||
    isDatabasePermissionDenied(views.failureReason);
  // Keep a denial latched through later network failures; only a successful
  // authorized refresh may restore the editor. This guarded adjustment runs
  // once per denial and renders no captured private state in the meantime.
  if (!denied && accessDenied) setDenied(true);
  const refresh = async () => {
    const result = await views.refetch();
    if (result.isSuccess) setDenied(false);
  };
  // Unmount the editor on an authoritative denial, discarding captured private
  // names/filters even while the separate role query still has cached data.
  if (denied || accessDenied)
    return (
      <section className="discovery-views" aria-label={t("saved")}>
        <Notice kind="error">{t("noAccess")}</Notice>
        <ErrorState retry={() => void refresh()} />
      </section>
    );
  if (!views.data)
    return (
      <section className="discovery-views" aria-label={t("saved")}>
        {views.isPending ? (
          <Loading />
        ) : (
          <ErrorState retry={() => void refresh()} />
        )}
      </section>
    );
  return (
    <SavedViewEditor
      key={editorRevision}
      actor={actor}
      filters={filters}
      search={search}
      select={select}
      views={views.data}
      refreshing={views.isFetching}
      refreshError={views.isError}
      refresh={refresh}
      onDenied={() => {
        setDenied(true);
        void client.invalidateQueries({ queryKey: ["user-roles", actor] });
      }}
    />
  );
}

function SavedViewEditor({
  actor,
  filters,
  search,
  select,
  views,
  refreshing,
  refreshError,
  refresh,
  onDenied,
}: {
  actor: string;
  filters: JobFilters | null;
  search: string;
  select: (params: URLSearchParams) => void;
  views: SavedJobView[];
  refreshing: boolean;
  refreshError: boolean;
  refresh: () => Promise<void>;
  onDenied: () => void;
}) {
  const { t } = useTranslation("jobDiscovery"),
    online = useOnline(),
    client = useQueryClient();
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState<{
    mode: "create" | "rename" | "remove";
    view?: SavedJobView;
  } | null>(null);
  const [name, setName] = useState("");
  const newID = useRef(crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw Error("invalid");
      return editing.mode === "remove"
        ? removeJobView(editing.view!)
        : saveJobView(
            editing.view?.id ?? newID.current,
            name.trim(),
            editing.view?.filters ?? filters!,
            editing.view?.version ?? 0,
          );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["saved-job-views", actor] });
      setEditing(null);
    },
    onError: (error) => {
      if (isDatabasePermissionDenied(error)) onDenied();
    },
  });
  const selectedView = views.find(
    (view) =>
      view.id === selected && filterParams(view.filters).toString() === search,
  );
  const open = (mode: "create" | "rename" | "remove") => {
    mutation.reset();
    // Each genuinely new dialog is a new operation. Retries inside that dialog
    // retain this ID, including a server commit whose acknowledgement was lost.
    if (mode === "create") newID.current = crypto.randomUUID();
    setName(mode === "create" ? "" : (selectedView?.name ?? ""));
    setEditing({ mode, view: mode === "create" ? undefined : selectedView });
  };
  return (
    <section className="discovery-views" aria-label={t("saved")}>
      {refreshError && <ErrorState retry={() => void refresh()} />}
      <div className="discovery-view-controls">
        <Field id="discovery-view" label={t("choose")}>
          <select
            value={selectedView?.id ?? ""}
            onChange={(e) => {
              const view = views.find((v) => v.id === e.target.value);
              setSelected(view?.id ?? "");
              if (view) select(filterParams(view.filters));
            }}
          >
            <option value="">{t("choose")}</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="discovery-actions">
          <Button
            variant="secondary"
            disabled={!online || !filters || views.length >= 20}
            onClick={() => open("create")}
          >
            {t("saveNew")}
          </Button>
          {selectedView && (
            <>
              <Button
                variant="ghost"
                disabled={!online}
                onClick={() => open("rename")}
              >
                {t("rename")}
              </Button>
              <Button
                variant="ghost"
                disabled={!online}
                onClick={() => open("remove")}
              >
                {t("remove")}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            disabled={!online || refreshing}
            onClick={() => void refresh()}
          >
            {t("reload")}
          </Button>
        </div>
      </div>
      {mutation.isSuccess && !editing && <Notice>{t("viewDone")}</Notice>}
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setEditing(null);
        }}
        title={t(
          editing?.mode === "remove"
            ? "remove"
            : editing?.mode === "rename"
              ? "rename"
              : "saveNew",
        )}
        description={editing?.mode === "remove" ? t("removeHelp") : t("saved")}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          {editing?.mode !== "remove" && (
            <Field id="job-view-name" label={t("name")}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
              />
            </Field>
          )}
          {mutation.isError && <Notice kind="error">{t("viewError")}</Notice>}
          <div className="discovery-actions">
            <Button
              disabled={
                !online ||
                mutation.isPending ||
                (editing?.mode !== "remove" && !name.trim())
              }
            >
              {t(editing?.mode === "remove" ? "remove" : "save")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => setEditing(null)}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

export function JobDiscovery() {
  const { t } = useTranslation("jobDiscovery"),
    common = useTranslation().t,
    actor = useAuth().session!.user.id;
  const roles = useQuery(userRolesQuery(actor));
  const staff = roles.isSuccess && hasJobStaffRole(roles.data);
  const teaching = roles.isSuccess && hasTeachingRole(roles.data);
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const [editorRevision, resetViewEditor] = useState(0);
  const [draftRevision, resetDraft] = useState(0);
  const [openedFilters, setOpenedFilters] = useState(false);
  const client = useQueryClient();
  const sickDayReleased = useLocation().state?.sickDayReleased === true;
  const parsed = useMemo(() => filtersFromParams(params), [params]),
    filters = parsed.success ? parsed.data : null;
  const initial = useMemo(
    () => filters ?? filterDraftFromParams(params),
    [filters, params],
  );
  const searchOptions = jobDiscoveryQuery(
    actor,
    filters ?? defaultJobFilters,
    [...(roles.data ?? [])].sort().join(","),
  );
  const query = useInfiniteQuery({
    ...searchOptions,
    enabled: staff && Boolean(filters),
  });
  const applyFilters = (next: JobFilters) => {
    resetViewEditor((revision) => revision + 1);
    const nextParams = filterParams(next);
    if (nextParams.toString() === search) {
      // Refresh from the first cursor without replaying previously loaded pages.
      void client.resetQueries({
        queryKey: searchOptions.queryKey,
        exact: true,
      });
    } else {
      setParams(nextParams, { replace: true, preventScrollReset: true });
    }
  };
  const selectView = (nextParams: URLSearchParams) => {
    // Reload the draft even if the selected view matches the current URL.
    if (nextParams.toString() === search)
      resetDraft((revision) => revision + 1);
    else setParams(nextParams, { preventScrollReset: true });
  };
  const retryNextPage = canRetryNextPage(query);
  const loadNextPage = () => {
    if (!query.isFetching) void query.fetchNextPage({ cancelRefetch: false });
  };
  const pages = query.data?.pages;
  const items = useMemo(
    () => mergeCursorItems(pages, { preferLast: true }),
    [pages],
  );
  if (roles.isPending) return <Loading />;
  if (roles.isError) return <ErrorState retry={() => void roles.refetch()} />;
  if (!staff)
    return (
      <>
        <PageHeading title={t("title")} />
        <Notice kind="error">{t("noAccess")}</Notice>
        <Link to="/">{common("goHome")}</Link>
      </>
    );
  return (
    <>
      <PageHeading title={t("title")} description={t("help")} />
      {sickDayReleased && <Notice>{common("sickDay:released")}</Notice>}
      {teaching && <MyJobWaitlist />}
      <details
        className="panel discovery-filter-disclosure"
        open={!filters}
        onToggle={(event) => {
          if (event.target === event.currentTarget && event.currentTarget.open)
            setOpenedFilters(true);
        }}
      >
        <summary>{t("filterOptions")}</summary>
        {(openedFilters || !filters) && (
          <div className="discovery-filter-content">
            <FilterForm
              initial={initial}
              revision={draftRevision}
              apply={applyFilters}
            />
            <SavedViews
              key={actor}
              actor={actor}
              filters={filters}
              editorRevision={editorRevision}
              search={search}
              select={selectView}
            />
            <p className="muted">{t("feeHelp")}</p>
          </div>
        )}
      </details>
      {!filters ? (
        <Notice kind="error">
          {t(
            parsed.error?.issues.some((i) => i.message === "currencyRequired")
              ? "currencyRequired"
              : parsed.error?.issues.some((i) => i.message === "unitRequired")
                ? "unitRequired"
                : "invalid",
          )}
        </Notice>
      ) : query.isPending ? (
        <Loading />
      ) : query.isError && !retryNextPage ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <>
          <p role="status">{t("loaded", { count: items.length })}</p>
          {items.length ? (
            <div className="jobs-grid">
              {items.map((job, index) => (
                <JobCard key={job.id} job={job} index={index} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h2>{common("noJobs")}</h2>
              <p>{common("noJobsHint")}</p>
            </div>
          )}
          {retryNextPage ? (
            <NextPageError retry={loadNextPage} disabled={query.isFetching} />
          ) : query.hasNextPage ? (
            <LoadMore
              disabled={query.isFetching}
              onLoad={loadNextPage}
              pageKey={search}
            >
              {t("more")}
            </LoadMore>
          ) : (
            items.length > 0 && <p>{t("complete")}</p>
          )}
        </>
      )}
    </>
  );
}
