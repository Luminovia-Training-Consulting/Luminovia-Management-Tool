import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading } from "../../components/common";
import { accountOrganisationsQuery } from "../accounts/api";
import { companyClassDirectoryQuery } from "./company-class-directory-api";
import type { ParticipantPlacement } from "./company-participant-schema";
import "./i18n";

type Choice = { id: string; name: string };

function SearchChoice({
  label,
  searchLabel,
  emptyLabel,
  options,
  value,
  disabled,
  change,
}: {
  label: string;
  searchLabel: string;
  emptyLabel: string;
  options: Choice[];
  value: string;
  disabled: boolean;
  change: (id: string) => void;
}) {
  const id = useId();
  const { i18n, t } = useTranslation("operations");
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase(i18n.language);
  const filtered = options.filter((option) =>
    option.name.toLocaleLowerCase(i18n.language).includes(query),
  );
  const selected = options.find((option) => option.id === value);
  const visible =
    selected && !filtered.includes(selected)
      ? [selected, ...filtered]
      : filtered;
  return (
    <>
      <Field id={id + "-search"} label={searchLabel}>
        <input
          id={id + "-search"}
          type="search"
          maxLength={120}
          value={search}
          disabled={disabled}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </Field>
      <Field id={id} label={label}>
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => change(event.currentTarget.value)}
        >
          <option value="">{emptyLabel}</option>
          {visible.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </Field>
      {!disabled && !filtered.length && (
        <p className="muted">{t("placementNoResults")}</p>
      )}
    </>
  );
}

export function ParticipantClassPicker({
  actor,
  organisationId,
  value,
  disabled,
  change,
}: {
  actor: string;
  organisationId: string;
  value: string;
  disabled: boolean;
  change: (id: string) => void;
}) {
  const { t } = useTranslation("operations");
  const classes = useQuery({
    ...companyClassDirectoryQuery(actor, organisationId),
    enabled: Boolean(organisationId) && !disabled,
  });
  if (classes.isPending && !disabled) return <Loading />;
  if (classes.isError)
    return <ErrorState retry={() => void classes.refetch()} />;
  return (
    <SearchChoice
      label={t("participantClass")}
      searchLabel={t("participantClassSearch")}
      emptyLabel={t("participantClassNone")}
      options={classes.data?.classes ?? []}
      disabled={disabled}
      value={value}
      change={change}
    />
  );
}

export function ParticipantPlacementFields({
  actor,
  value,
  disabled,
  change,
}: {
  actor: string;
  value: ParticipantPlacement;
  disabled: boolean;
  change: (value: ParticipantPlacement) => void;
}) {
  const { t } = useTranslation("operations");
  const companies = useQuery({
    ...accountOrganisationsQuery(actor),
    enabled: !disabled,
  });
  return (
    <>
      <p className="muted">{t("participantPlacementHelp")}</p>
      {companies.isPending && !disabled && <Loading />}
      {companies.isError && (
        <ErrorState retry={() => void companies.refetch()} />
      )}
      <SearchChoice
        label={t("participantCompany")}
        searchLabel={t("participantCompanySearch")}
        emptyLabel={t("participantCompanyNone")}
        options={companies.data ?? []}
        value={value.organisation}
        disabled={disabled || !companies.isSuccess}
        change={(organisation) => change({ organisation, classId: "" })}
      />
      {value.organisation && (
        <ParticipantClassPicker
          key={value.organisation}
          actor={actor}
          organisationId={value.organisation}
          value={value.classId}
          disabled={disabled}
          change={(classId) => change({ ...value, classId })}
        />
      )}
    </>
  );
}
