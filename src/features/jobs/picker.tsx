import { useEffect, useId, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import {
  jobPickerQuery,
  type JobPickerOption,
  type JobPickerPurpose,
} from "./picker-api";
import "./picker-i18n";
import "./picker.css";
const forbidden = (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "42501",
  );
export function JobPicker({
  actor,
  purpose,
  value,
  onChange,
  children,
}: {
  actor: string;
  purpose: JobPickerPurpose;
  value: string;
  onChange: (id: string) => void;
  children?: (selected: JobPickerOption | null) => ReactNode;
}) {
  const { t, i18n } = useTranslation("jobPicker");
  const id = useId();
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [denied, setDenied] = useState(false);
  const query = useInfiniteQuery(jobPickerQuery(actor, purpose, search, value));
  const accessDenied = forbidden(query.error) || forbidden(query.failureReason);
  if (!denied && accessDenied) setDenied(true);
  useEffect(() => {
    // An authoritative denial also refreshes the caller's surrounding controls;
    // closing and reopening must not revive a cached administrative capability.
    if (accessDenied)
      void client.invalidateQueries({ queryKey: ["permissions", actor] });
  }, [accessDenied, actor, client]);
  const selected = !query.isPlaceholderData
    ? (query.data?.pages[0]?.selected ?? null)
    : null;
  const items = [
    ...new Map(
      (query.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  // Keep an authorized selection visible when it is outside a later search page.
  const sameChoice = (item: JobPickerOption) =>
    selected &&
    (purpose === "participant_course"
      ? item.course_run_id === selected.course_run_id
      : item.id === selected.id);
  const pinned = selected && !items.some(sameChoice);
  const choices = selected
    ? [selected, ...items.filter((item) => !sameChoice(item))]
    : items;
  const choiceLabel = (item: JobPickerOption) =>
    [
      item.title,
      item.customer_name,
      `${item.starts_at ? dateTime(item.starts_at, i18n.language, item.time_zone) : t("unscheduled")} (${item.time_zone})`,
      item.course_run_id &&
        t("runReference", { id: item.course_run_id.slice(-8) }),
    ]
      .filter(Boolean)
      .join(" · ");
  const summaryID = selected ? `${id}-selection` : undefined;
  const refresh = async () => {
    const result = await query.refetch();
    if (result.isSuccess) setDenied(false);
  };
  if (denied || accessDenied)
    return (
      <section className="job-picker">
        <Notice kind="error">{t("denied")}</Notice>
        <ErrorState retry={() => void refresh()} />
      </section>
    );
  return (
    <section className="job-picker">
      <div className="job-picker-search">
        <Field id={`${id}-search`} label={t("search")}>
          <input
            type="search"
            value={draft}
            maxLength={160}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                setSearch(draft);
              }
            }}
          />
        </Field>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setSearch(draft)}
        >
          {t("apply")}
        </Button>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.isError && !query.data ? (
        <ErrorState retry={() => void refresh()} />
      ) : (
        <>
          {query.isError && <ErrorState retry={() => void refresh()} />}
          {query.isPlaceholderData && <Loading />}
          <Field
            id={`${id}-choice`}
            label={t(
              purpose === "participant_course" ? "chooseCourse" : "chooseJob",
            )}
          >
            <select
              value={choices.some((item) => item.id === value) ? value : ""}
              onChange={(event) => onChange(event.target.value)}
              aria-describedby={summaryID}
            >
              <option value="">{t("choose")}</option>
              {choices.map((item) => (
                <option key={item.id} value={item.id}>
                  {choiceLabel(item)}
                </option>
              ))}
            </select>
          </Field>
          {selected && (
            <p id={summaryID} className="job-picker-selection muted">
              {choiceLabel(selected)}
            </p>
          )}
          {pinned && <p className="muted">{t("selectionHint")}</p>}
          {!items.length && <p>{t("none")}</p>}
          <p className="muted">{t("loaded", { count: items.length })}</p>
          {query.hasNextPage ? (
            <Button
              type="button"
              variant="secondary"
              disabled={query.isFetching || query.isPlaceholderData}
              onClick={() => void query.fetchNextPage()}
            >
              {t("more")}
            </Button>
          ) : (
            <p className="muted">{t("complete")}</p>
          )}
          {children?.(selected)}
        </>
      )}
    </section>
  );
}
