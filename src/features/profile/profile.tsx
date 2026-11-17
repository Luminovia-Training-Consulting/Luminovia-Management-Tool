/**
 * Own profile fields, time zone and expertise with evidence/avatar controls.
 * Self-declared expertise is separate from management verification; the own
 * qualification card follows the current role gate and server permissions.
 */
import { OwnQualificationEvidence } from "../qualifications/evidence";
import { selectableTopics } from "../taxonomy/selection";
import "../taxonomy/i18n";
import { AvatarEditor } from "./avatar";
import { OwnContactVisibility } from "./contact-visibility";
import { OwnTopicVisibility } from "./topic-visibility";
import { OwnQualificationPassport } from "../qualifications/passport";
import { OwnProfileDetails } from "../people/profile-details";
import { AccountSettings } from "./account-settings";
import { ProfileEvidence } from "../files/profile-evidence";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import {
  expertiseQuery,
  profileQuery,
  topicsQuery,
  permissionsQuery,
} from "../../lib/queries";
import type { Profile } from "../../lib/types";
import { validZone } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const schema = z.object({
  display_name: z.string().trim().min(1).max(120),
  bio_de: z.string().max(4000),
  phone: z.string().max(50),
  time_zone: z.string().refine(validZone),
});
/** Validate own profile fields and IANA zone; confirm only a successful update. */
function ProfileForm({ profile }: { profile: Profile }) {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const client = useQueryClient();
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...profile,
      bio_de: profile.bio_de || profile.bio_en || "",
      phone: profile.phone ?? "",
    },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      requireOnline();
      const { data, error } = await db()
        .from("profiles")
        .update({ ...values, bio_en: values.bio_de, locale: i18n.language })
        .eq("id", profile.id)
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("not_saved");
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["profile", profile.id] });
      await client.invalidateQueries({
        queryKey: ["contact-visibility", profile.id],
      });
      setDone(true);
    },
  });
  return (
    <form
      className="panel profile-form"
      noValidate
      onSubmit={handleSubmit((values) => {
        setDone(false);
        mutation.mutate(values);
      })}
    >
      <h2>{t("profile")}</h2>
      <Field
        id="display-name"
        label={t("displayName")}
        error={Boolean(errors.display_name)}
      >
        <input
          id="display-name"
          autoComplete="name"
          {...register("display_name")}
          aria-invalid={Boolean(errors.display_name)}
        />
      </Field>
      <Field id="phone" label={t("phone")} error={Boolean(errors.phone)}>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          {...register("phone")}
        />
      </Field>
      <Field
        id="profile-zone"
        label={t("timezone")}
        error={Boolean(errors.time_zone)}
      >
        <input id="profile-zone" list="time-zones" {...register("time_zone")} />
      </Field>
      <Field id="bio-de" label={t("aboutMe")} error={Boolean(errors.bio_de)}>
        <textarea id="bio-de" rows={5} {...register("bio_de")} />
      </Field>
      <Button disabled={!online || mutation.isPending}>
        {t(mutation.isPending ? "saving" : "saveProfile")}
      </Button>
      {done && <Notice>{t("saved")}</Notice>}
      {mutation.isError && <Notice kind="error">{t("error")}</Notice>}
    </form>
  );
}
/** Combine own profile, expertise, evidence and avatar under the current session. */
export function ProfilePage() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const online = useOnline();
  const client = useQueryClient();
  const profile = useQuery(profileQuery(session!.user.id));
  const topics = useQuery(topicsQuery);
  const expertise = useQuery(expertiseQuery(session!.user.id));
  const permissions = useQuery(permissionsQuery(session!.user.id));
  const edit = useMutation({
    mutationFn: async ({ topic, add }: { topic: string; add: boolean }) => {
      requireOnline();
      const result = add
        ? await db()
            .from("lecturer_topics")
            .insert({ user_id: session!.user.id, topic_id: topic })
        : await db()
            .from("lecturer_topics")
            .delete()
            .eq("user_id", session!.user.id)
            .eq("topic_id", topic);
      if (result.error) throw result.error;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["expertise", session!.user.id] }),
  });
  if (profile.isPending || topics.isPending || expertise.isPending)
    return <Loading />;
  if (profile.isError || topics.isError || expertise.isError)
    return (
      <ErrorState
        retry={() => {
          void profile.refetch();
          void topics.refetch();
          void expertise.refetch();
        }}
      />
    );
  if (!profile.data) return <Notice kind="error">{t("profileMissing")}</Notice>;
  return (
    <>
      <PageHeading title={t("profile")} description={session!.user.email} />
      <AvatarEditor name={profile.data.display_name} />
      <AccountSettings email={session!.user.email ?? ""} />
      <div className="profile-layout">
        <ProfileForm profile={profile.data} />
        <section className="panel">
          <h2>{t("expertise")}</h2>
          <p>{t("expertiseHelp")}</p>
          {permissions.data?.includes("taxonomy.manage") && (
            <Button asChild variant="secondary">
              <Link to="/topics">{t("manageExpertise")}</Link>
            </Button>
          )}
          <div className="expertise-list">
            {selectableTopics(
              topics.data,
              expertise.data.map((entry) => entry.topic_id),
            ).map((topic) => {
              const selected = expertise.data.find(
                (e) => e.topic_id === topic.id,
              );
              const verified =
                selected?.verified &&
                (!selected.valid_until ||
                  new Date(selected.valid_until) > new Date());
              return (
                <label className="expertise-option" key={topic.id}>
                  <input
                    type="checkbox"
                    checked={Boolean(selected)}
                    disabled={!online || edit.isPending}
                    onChange={(e) =>
                      edit.mutate({ topic: topic.id, add: e.target.checked })
                    }
                  />
                  <span>
                    <strong>
                      {i18n.language === "de" ? topic.label_de : topic.label_en}
                      {topic.archived_at && <> ({t("taxonomy:archived")})</>}
                    </strong>
                    {selected && (
                      <small>
                        {verified ? (
                          <>
                            <CheckCircle2 size={13} />
                            {t("verified")}
                          </>
                        ) : (
                          t("unverified")
                        )}
                      </small>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          {edit.isError && <Notice kind="error">{t("error")}</Notice>}
        </section>
      </div>
      <OwnProfileDetails />
      <OwnContactVisibility actor={session!.user.id} />
      <OwnTopicVisibility actor={session!.user.id} />
      <OwnQualificationPassport
        key={session!.user.id}
        actor={session!.user.id}
      />
      <ProfileEvidence ownerId={session!.user.id} />
      <OwnQualificationEvidence
        topics={topics.data.filter((topic) =>
          expertise.data.some((value) => value.topic_id === topic.id),
        )}
      />
      <datalist id="time-zones">
        <option>Europe/Berlin</option>
        <option>Australia/Brisbane</option>
        <option>UTC</option>
      </datalist>
    </>
  );
}
