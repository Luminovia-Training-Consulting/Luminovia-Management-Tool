/** Server-filtered offers and own saved views; observed roles scope quote-bearing pages. */
import { MyJobWaitlist, SubstitutionOffers } from "./lifecycle-extra";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import { topicsQuery, userRolesQuery } from "../../lib/queries";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { selectableTopics } from "../taxonomy/selection";
import { JobCard } from "./card";
import {
  defaultJobFilters,
  filtersFromParams,
  filterDraftFromParams,
  filterParams,
  jobFiltersSchema,
  jobDiscoveryQuery,
  savedJobViewsQuery,
  saveJobView,
  removeJobView,
  type JobFilters,
  type SavedJobView,
} from "./discovery-api";
import "./discovery-i18n";
import "./discovery.css";
function FilterForm({
  initial,
  apply,
}: {
  initial: JobFilters;
  apply: (values: JobFilters) => void;
}) {
  const { t, i18n } = useTranslation("jobDiscovery"),
    common = useTranslation().t;
  const topics = useQuery(topicsQuery);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<z.input<typeof jobFiltersSchema>, unknown, JobFilters>({
    resolver: zodResolver(jobFiltersSchema),
    defaultValues: initial,
  });
  const selected = useWatch({ control, name: "topic_ids" });
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
            {["online", "onsite"].map((s) => (
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
        <Field id="discovery-topics" label={t("topics")}>
          <select multiple size={4} {...register("topic_ids")}>
            {selectableTopics(topics.data ?? [], selected ?? []).map(
              (topic) => (
                <option key={topic.id} value={topic.id}>
                  {i18n.language === "de" ? topic.label_de : topic.label_en}
                  {topic.archived_at ? ` (${common("archived")})` : ""}
                </option>
              ),
            )}
          </select>
        </Field>
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
          <input {...register("zone")} />
        </Field>
        <Field
          id="discovery-currency"
          label={common("currency")}
          error={Boolean(errors.currency)}
        >
          <select {...register("currency")}>
            <option value="">{common("all")}</option>
            <option>EUR</option>
            <option>AUD</option>
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
      </div>
    </form>
  );
}
const permissionDenied = (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "42501",
  );
function SavedViews({
  actor,
  filters,
  select,
}: {
  actor: string;
  filters: JobFilters | null;
  select: (f: JobFilters) => void;
}) {
  const { t } = useTranslation("jobDiscovery"),
    client = useQueryClient();
  const views = useQuery(savedJobViewsQuery(actor));
  const [denied, setDenied] = useState(false);
  const accessDenied =
    permissionDenied(views.error) || permissionDenied(views.failureReason);
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
      actor={actor}
      filters={filters}
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
  select,
  views,
  refreshing,
  refreshError,
  refresh,
  onDenied,
}: {
  actor: string;
  filters: JobFilters | null;
  select: (f: JobFilters) => void;
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
      if (permissionDenied(error)) onDenied();
    },
  });
  const selectedView = views.find((v) => v.id === selected);
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
      <div className="discovery-actions">
        <Field id="discovery-view" label={t("choose")}>
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              const view = views.find((v) => v.id === e.target.value);
              if (view) select(view.filters);
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
  const staff =
    roles.data?.some((role) =>
      ["owner", "admin", "management", "senior_lecturer", "lecturer"].includes(
        role,
      ),
    ) ?? false;
  const [params, setParams] = useSearchParams();
  const parsed = filtersFromParams(params),
    filters = parsed.success ? parsed.data : null;
  const query = useInfiniteQuery({
    ...jobDiscoveryQuery(
      actor,
      filters ?? defaultJobFilters,
      [...(roles.data ?? [])].sort().join(","),
    ),
    enabled: staff && Boolean(filters),
  });
  const items = [
    ...new Map(
      (query.data?.pages ?? [])
        .flatMap((p) => p.items)
        .map((item) => [item.id, item]),
    ).values(),
  ];
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
      <SubstitutionOffers />
      <MyJobWaitlist />
      <details className="panel discovery-filter-disclosure" open={!filters}>
        <summary>{t("filterOptions")}</summary>
        <div className="discovery-filter-content">
          <FilterForm
            key={params.toString()}
            initial={filters ?? filterDraftFromParams(params)}
            apply={(f) => setParams(filterParams(f), { replace: true })}
          />
          <SavedViews
            key={actor}
            actor={actor}
            filters={filters}
            select={(f) => setParams(filterParams(f))}
          />
          <div className="discovery-actions">
            <Button variant="ghost" onClick={() => setParams({})}>
              {t("reset")}
            </Button>
          </div>
          <p className="muted">{t("feeHelp")}</p>
        </div>
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
      ) : query.isError ? (
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
          {query.hasNextPage ? (
            <Button
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("more")}
            </Button>
          ) : (
            items.length > 0 && <p>{t("complete")}</p>
          )}
        </>
      )}
    </>
  );
}
