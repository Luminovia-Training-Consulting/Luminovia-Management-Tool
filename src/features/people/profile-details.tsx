/**
 * Own country, language, experience and label fields. Keep drafts local, confirm saves only
 * after server success and retain the backend's publication projections.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { labelText, peopleRpc, type ProfileDetails } from "./api";
import "./i18n";
import "./people.css";

/** Save own additional profile drafts and invalidate the affected projections. */
function DetailsForm({ details }: { details: ProfileDetails }) {
  const { t } = useTranslation("people");
  const online = useOnline();
  const client = useQueryClient();
  const [country, setCountry] = useState(details.country);
  const [languages, setLanguages] = useState(details.languages.join(", "));
  const numericExperience = /^\d{1,2}$/.test(
    details.teaching_experience.trim(),
  );
  const [experience, setExperience] = useState(
    numericExperience ? details.teaching_experience.trim() : "",
  );
  const [invalid, setInvalid] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      requireOnline();
      const payload = {
        country,
        languages: labelText(languages, 15, 50),
        labels: details.labels,
        teaching_experience: experience || details.teaching_experience,
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
      <Field id="profile-experience" label={t("experience")}>
        <input
          id="profile-experience"
          type="number"
          min={0}
          max={99}
          step={1}
          value={experience}
          onChange={(e) => setExperience(e.target.value)}
        />
      </Field>
      {!numericExperience && details.teaching_experience && (
        <p className="muted">
          {t("previousExperience")}: {details.teaching_experience}
        </p>
      )}
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

/** Read own private details before opening the experience/country/language/label form. */
export function OwnProfileDetails() {
  const { session } = useAuth();
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
    </div>
  );
}
