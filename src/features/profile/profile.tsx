import { isGuestOnly, isParticipantOnly } from "../auth/guest-navigation";
/**
 * Own profile fields, time zone and expertise with evidence/avatar controls.
 * Self-declared expertise is separate from management verification; the own
 * qualification card follows the current role gate and server permissions.
 */
import "./profile-layout.css";
import { OwnQualificationEvidence } from "../qualifications/evidence";
import { selectableTopics } from "../taxonomy/selection";
import "../taxonomy/i18n";
import { AvatarEditor } from "./avatar";
import { OwnContactVisibility } from "./contact-visibility";
import { OwnTopicVisibility } from "./topic-visibility";
import { OwnQualificationPassport } from "../qualifications/passport";
import { OwnProfileDetails } from "../people/profile-details";
import { DisplayNameEditor } from "./display-name-editor";
import { AccountSettings } from "./account-settings";
import { ProfileLanguage } from "./profile-language";
import { ProfileEvidence } from "../files/profile-evidence";
import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import {
  expertiseQuery,
  permissionsQuery,
  profileQuery,
  topicsQuery,
  userRolesQuery,
} from "../../lib/queries";
import type { Profile } from "../../lib/types";
import { validZone } from "../../lib/dates";
import { TimeZoneOptions } from "../../components/time-zone-options";
import { requireOnline, useOnline } from "../../lib/online";
import { hasTeachingRole } from "../auth/internal-capabilities";
import { portalInternalEdition } from "../../lib/installation-brand";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";

const ProfileOutlook = lazy(() =>
  import("../analytics/profile-outlook").then(({ ProfileOutlook }) => ({
    default: ProfileOutlook,
  })),
);

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const schema = z.object({
  display_name: z.string().trim().min(1).max(120),
  bio_de: z.string().max(4000),
  phone: z.string().max(50),
  time_zone: z.string().refine(validZone),
});

/** Validate own profile fields and IANA zone; confirm only a successful update. */
function ProfileForm({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const online = useOnline();
  const client = useQueryClient();
  const [done, setDone] = useState(false);
  const biography = profile.bio_de || profile.bio_en || "";
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...profile,
      bio_de: biography,
      phone: profile.phone ?? "",
    },
  });
  const mutation = useMutation({
    mutationFn: async ({ bio_de, ...values }: z.infer<typeof schema>) => {
      requireOnline();
      const biographyUpdate =
        bio_de === biography ? {} : { bio_de, bio_en: bio_de };
      const { data, error } = await db()
        .from("profiles")
        .update({ ...values, ...biographyUpdate })
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
        hint={t("profileTimeZoneHint")}
        error={Boolean(errors.time_zone)}
      >
        <select {...register("time_zone")}>
          <option value="" disabled>
            {t("chooseTimeZone")}
          </option>
          <TimeZoneOptions current={profile.time_zone} />
        </select>
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

// Stable IDs seeded by the teaching subject areas migration.
const teachingSubjects = new Set([
  "fbb0c720-bcdf-4c96-aac4-16931325ba01",
  "fbb0c720-bcdf-4c96-aac4-16931325ba02",
  "fbb0c720-bcdf-4c96-aac4-16931325ba03",
]);
const isTeachingSubject = (id: string) => teachingSubjects.has(id);

/** Combine own profile, expertise, evidence and avatar under the current session. */
export function ProfilePage() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const online = useOnline();
  const client = useQueryClient();
  const profile = useQuery(profileQuery(session!.user.id));
  const roles = useQuery(userRolesQuery(session!.user.id));
  const guestOnly = isGuestOnly(roles.data);
  const participantOnly = isParticipantOnly(roles.data);
  const operational = roles.isSuccess && !guestOnly && !participantOnly;
  const topics = useQuery({ ...topicsQuery, enabled: operational });
  const expertise = useQuery({
    ...expertiseQuery(session!.user.id),
    enabled: operational,
  });
  const permissions = useQuery({
    ...permissionsQuery(session!.user.id),
    enabled: operational,
  });
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
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["expertise", session!.user.id] }),
        client.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
    },
  });
  if (
    profile.isPending ||
    roles.isPending ||
    (operational && (topics.isPending || expertise.isPending))
  )
    return <Loading />;
  if (
    profile.isError ||
    roles.isError ||
    (operational && (topics.isError || expertise.isError))
  )
    return (
      <ErrorState
        retry={() => {
          void profile.refetch();
          void roles.refetch();
          if (operational) {
            void topics.refetch();
            void expertise.refetch();
          }
        }}
      />
    );
  if (!profile.data) return <Notice kind="error">{t("profileMissing")}</Notice>;
  if (guestOnly || participantOnly)
    return (
      <>
        <PageHeading title={t("profile")} description={session!.user.email} />
        <p className="public-user-id">
          <strong>{t("luminoviaUserId")}:</strong>{" "}
          <code>{profile.data.luminovia_user_id}</code>
        </p>
        <div className="section-stack profile-sections">
          {guestOnly && <ProfileForm profile={profile.data} />}
          {participantOnly && (
            <DisplayNameEditor
              key={`name:${session!.user.id}`}
              initial={profile.data.display_name}
              save={async (display_name) => {
                const { error } = await db().rpc("save_profile_display_name", {
                  p_display_name: display_name,
                });
                if (error) throw error;
                await client.invalidateQueries({
                  queryKey: ["profile", session!.user.id],
                });
              }}
            />
          )}
          <div className="profile-account-grid">
            <ProfileLanguage
              key={session!.user.id}
              actor={session!.user.id}
              locale={profile.data.locale}
            />
            <AccountSettings email={session!.user.email ?? ""} />
          </div>
        </div>
        {participantOnly && (
          <Link className="text-link" to="/api/docs">
            {t("apiDocumentation")}
          </Link>
        )}
      </>
    );
  const selectedTopicIds = new Set(
    expertise.data?.map(({ topic_id }) => topic_id),
  );
  return (
    <>
      <PageHeading
        title={t("profile")}
        description={session!.user.email}
        action={
          <Button asChild variant="secondary">
            <Link to={`/people/${session!.user.id}`}>{t("people:open")}</Link>
          </Button>
        }
      />
      <p className="public-user-id">
        <strong>{t("luminoviaUserId")}:</strong>{" "}
        <code>{profile.data.luminovia_user_id}</code>
      </p>
      <div className="section-stack profile-sections">
        <AvatarEditor name={profile.data.display_name} />
        {portalInternalEdition && online && hasTeachingRole(roles.data) && (
          <Suspense fallback={<Loading />}>
            <ProfileOutlook
              key={session!.user.id}
              actor={session!.user.id}
              zone={profile.data.time_zone}
            />
          </Suspense>
        )}
        <div className="profile-account-grid">
          <ProfileLanguage
            key={session!.user.id}
            actor={session!.user.id}
            locale={profile.data.locale}
          />
          <AccountSettings email={session!.user.email ?? ""} />
        </div>
        <div className="profile-layout">
          <ProfileForm profile={profile.data} />
          <section className="panel profile-expertise">
            <h2 id="profile-expertise-heading">{t("expertise")}</h2>
            <p>{t("expertiseHelp")}</p>
            {permissions.data?.includes("taxonomy.manage") && (
              <Button asChild variant="secondary">
                <Link to="/topics">{t("manageExpertise")}</Link>
              </Button>
            )}
            <div
              className="expertise-list"
              role="region"
              aria-labelledby="profile-expertise-heading"
              tabIndex={0}
            >
              {selectableTopics(topics.data ?? [], [...selectedTopicIds])
                .sort(
                  (a, b) =>
                    Number(isTeachingSubject(b.id)) -
                    Number(isTeachingSubject(a.id)),
                )
                .map((topic) => {
                  const selected = selectedTopicIds.has(topic.id);
                  return (
                    <label className="expertise-option" key={topic.id}>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!online || edit.isPending}
                        onChange={(e) =>
                          edit.mutate({
                            topic: topic.id,
                            add: e.target.checked,
                          })
                        }
                      />
                      <span>
                        <strong>
                          {i18n.language.startsWith("de")
                            ? topic.label_de
                            : topic.label_en}
                          {topic.archived_at && (
                            <> ({t("taxonomy:archived")})</>
                          )}
                        </strong>
                        {selected && (
                          <small>{t("selfDeclaredExpertise")}</small>
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
        <div className="profile-privacy-grid">
          <OwnContactVisibility actor={session!.user.id} />
          <OwnTopicVisibility actor={session!.user.id} />
        </div>
        <OwnQualificationPassport
          key={session!.user.id}
          actor={session!.user.id}
        />
        <ProfileEvidence ownerId={session!.user.id} />
        <OwnQualificationEvidence
          topics={(topics.data ?? []).filter(({ id }) =>
            selectedTopicIds.has(id),
          )}
        />
      </div>
    </>
  );
}
