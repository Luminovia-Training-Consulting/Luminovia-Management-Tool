/**
 * Eigene zusätzliche Profildaten wie Land, Sprachen, Erfahrung und Labels. Formulare halten Entwürfe lokal und übernehmen Erfolg erst nach bestätigter Speicherung; veröffentlichte Projektionen folgen dem Backendvertrag.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { useOnline, requireOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Field, Loading, ErrorState, Notice } from "../../components/common";
import { labelText, peopleRpc, type ProfileDetails } from "./api";
import "./i18n";
import "./people.css";
/** Speichert zusätzliche eigene Profildaten aus lokal gehaltenen Entwürfen und invalidiert die betroffenen Projektionen. */
function DetailsForm({ details }: { details: ProfileDetails }) {
  const { t } = useTranslation("people");
  const online = useOnline();
  const client = useQueryClient();
  const [country, setCountry] = useState(details.country);
  const [languages, setLanguages] = useState(details.languages.join(", "));
  const [labels, setLabels] = useState(details.labels.join(", "));
  const [experience, setExperience] = useState(details.teaching_experience);
  const [invalid, setInvalid] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      requireOnline();
      const payload = {
        country,
        languages: labelText(languages, 15, 50),
        labels: labelText(labels),
        teaching_experience: experience,
      };
      await peopleRpc("save_profile_details", { p_payload: payload });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["own-profile-details"] });
      await client.invalidateQueries({ queryKey: ["people-directory"] });
      await client.invalidateQueries({ queryKey: ["person"] });
    },
  });
  return (
    <form
      className="panel profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        setInvalid(false);
        try {
          labelText(labels);
          labelText(languages, 15, 50);
          mutation.mutate();
        } catch {
          setInvalid(true);
        }
      }}
    >
      <h2>{t("details")}</h2>
      <p>{t("detailsHelp")}</p>
      <Field id="profile-country" label={t("country")}>
        <input
          id="profile-country"
          autoComplete="country-name"
          maxLength={100}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        />
      </Field>
      <Field id="profile-languages" label={t("languages")}>
        <input
          id="profile-languages"
          maxLength={780}
          value={languages}
          onChange={(e) => setLanguages(e.target.value)}
        />
      </Field>
      <Field id="profile-labels" label={t("labels")} error={invalid}>
        <input
          id="profile-labels"
          maxLength={850}
          value={labels}
          onChange={(e) => setLabels(e.target.value)}
        />
      </Field>
      <Field id="profile-experience" label={t("experience")}>
        <textarea
          id="profile-experience"
          maxLength={4000}
          rows={5}
          value={experience}
          onChange={(e) => setExperience(e.target.value)}
        />
      </Field>
      <Button disabled={!online || mutation.isPending}>
        {t(mutation.isPending ? "pending" : "save")}
      </Button>
      {mutation.isSuccess && <Notice>{t("saved")}</Notice>}
      {(mutation.isError || invalid) && (
        <Notice kind="error">{t("error")}</Notice>
      )}
    </form>
  );
}
/** Lädt die eigene private Detailprojektion vor dem Formular für Erfahrung, Land, Sprachen und Labels. */
export function OwnProfileDetails() {
  const { session } = useAuth();
  const { t } = useTranslation("people");
  const query = useQuery({
    queryKey: ["own-profile-details", session!.user.id],
    queryFn: () => peopleRpc<ProfileDetails>("own_profile_details"),
  });
  return (
    <div className="people-profile-extra">
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <DetailsForm details={query.data} />
      )}
      <Button asChild variant="secondary">
        <Link to={`/people/${session!.user.id}`}>{t("open")}</Link>
      </Button>
    </div>
  );
}
