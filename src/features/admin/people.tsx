/**
 * Manage qualification verification, expiry and account suspension. Changes require confirmed
 * server responses and invalidate related queries; private profile fields retain database access
 * controls.
 */
import { qualificationKey } from "../qualifications/api";
import { QualificationEvidenceReview } from "../qualifications/evidence";
import { ProfileEvidence } from "../files/profile-evidence";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, ShieldCheck, UserRound } from "lucide-react";
import { DateTime } from "luxon";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery, topicsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import { dateTime, zonedInstant } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import type { Expertise, Profile, Topic } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const expirySchema = z.object({ valid_until: z.string() });
/** Derive form values from the validation schema so runtime input checks and TypeScript agree. */
type ExpiryValues = z.infer<typeof expirySchema>;
/** Reviewed target name and intended activation state for the confirmation dialog. */
type AccountChange = { id: string; name: string; active: boolean };

/** Save verified qualification state and expiry through the administrative server contract. */
function ExpertiseReview({
  profile,
  expertise,
  topic,
  actorId,
}: {
  profile: Profile;
  expertise: Expertise;
  topic: Topic;
  actorId: string;
}) {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const client = useQueryClient();
  const [invalidExpiry, setInvalidExpiry] = useState(false);
  const [saved, setSaved] = useState(false);
  const label = i18n.language === "de" ? topic.label_de : topic.label_en;
  const { register, handleSubmit } = useForm<ExpiryValues>({
    resolver: zodResolver(expirySchema),
    defaultValues: {
      valid_until: expertise.valid_until
        ? DateTime.fromISO(expertise.valid_until)
            .toUTC()
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : "",
    },
  });
  const review = useMutation({
    mutationFn: async ({
      verified,
      value,
    }: {
      verified: boolean;
      value: string;
    }) => {
      requireOnline();
      setSaved(false);
      setInvalidExpiry(false);
      const shown = expertise.valid_until
        ? DateTime.fromISO(expertise.valid_until)
            .toUTC()
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : "";
      const until =
        verified && value
          ? value === shown
            ? expertise.valid_until
            : zonedInstant(value, "UTC")
          : null;
      if (verified && value && (!until || new Date(until) <= new Date())) {
        setInvalidExpiry(true);
        throw new Error("invalid_expiry");
      }
      const { error } = await db().rpc("verify_lecturer_topic", {
        p_user_id: profile.id,
        p_topic_id: topic.id,
        p_verified: verified,
        p_valid_until: until,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin-expertise", actorId] }),
        client.invalidateQueries({ queryKey: ["expertise", profile.id] }),
        client.invalidateQueries({
          queryKey: qualificationKey(actorId, profile.id, topic.id),
        }),
      ]);
      setSaved(true);
    },
  });
  const expired =
    expertise.verified &&
    expertise.valid_until !== null &&
    new Date(expertise.valid_until) <= new Date();
  const status = expired
    ? "peopleExpired"
    : expertise.verified
      ? "verified"
      : "unverified";
  const fieldId = `review-${profile.id}-${topic.id}-expiry`;
  return (
    <div className="people-expertise-card">
      <form
        aria-label={t("peopleReviewTopic", { topic: label })}
        onSubmit={handleSubmit((values) =>
          review.mutate({ verified: true, value: values.valid_until }),
        )}
        noValidate
      >
        <div className="section-heading">
          <h3>{label}</h3>
          <span className="badge">
            {expertise.verified && !expired && <CheckCircle2 size={14} />}
            {t(status)}
          </span>
        </div>
        {expertise.valid_until && (
          <p className="muted">
            {t("peopleCurrentExpiry")}:{" "}
            {dateTime(expertise.valid_until, i18n.language, "UTC")} UTC
          </p>
        )}
        <Field
          id={fieldId}
          label={t("peopleValidUntil")}
          hint={t("peopleExpiryHint")}
          error={invalidExpiry}
        >
          <input
            id={fieldId}
            type="datetime-local"
            {...register("valid_until", {
              onChange: () => {
                setSaved(false);
                setInvalidExpiry(false);
              },
            })}
            disabled={!profile.active || review.isPending}
          />
        </Field>
        <div className="form-actions">
          <Button
            type="submit"
            disabled={!online || !profile.active || review.isPending}
          >
            <ShieldCheck size={16} />
            {t(
              review.isPending
                ? "saving"
                : expertise.verified
                  ? "peopleUpdateVerification"
                  : "peopleVerify",
            )}
          </Button>
          {expertise.verified && (
            <Button
              type="button"
              variant="secondary"
              disabled={!online || !profile.active || review.isPending}
              onClick={() => review.mutate({ verified: false, value: "" })}
            >
              {t("peopleRevokeVerification")}
            </Button>
          )}
        </div>
        {!profile.active && (
          <p className="muted">{t("peopleActivateBeforeReview")}</p>
        )}
        {saved && <Notice>{t("peopleVerificationSaved")}</Notice>}
        {review.isError && (
          <Notice kind="error">
            {t(
              invalidExpiry
                ? "peopleExpiryInvalid"
                : "peopleVerificationFailed",
            )}
          </Notice>
        )}
      </form>
      <QualificationEvidenceReview
        userId={profile.id}
        topicId={topic.id}
        disabled={!profile.active}
      />
    </div>
  );
}

/** Load administrative profiles, expertise and account state; require explicit confirmation for the selected suspension target. */
function PeopleDirectory({ actorId }: { actorId: string }) {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("user");
  const [confirmation, setConfirmation] = useState<AccountChange | null>(null);
  const [updated, setUpdated] = useState<AccountChange | null>(null);
  const profiles = useQuery({
    queryKey: ["admin-people", actorId],
    queryFn: async () => {
      const { data, error } = await db()
        .from("profiles")
        .select("*")
        .order("display_name");
      if (error) throw error;
      return data as Profile[];
    },
  });
  const expertise = useQuery({
    queryKey: ["admin-expertise", actorId],
    queryFn: async () => {
      const { data, error } = await db()
        .from("lecturer_topics")
        .select("*")
        .order("user_id");
      if (error) throw error;
      return data as Expertise[];
    },
  });
  const topics = useQuery(topicsQuery);
  const activation = useMutation({
    mutationFn: async (change: AccountChange) => {
      requireOnline();
      if (change.id === actorId) throw new Error("self_change_denied");
      const { error } = await db().rpc("set_user_active", {
        p_user_id: change.id,
        p_active: change.active,
      });
      if (error) throw error;
    },
    onSuccess: async (_data, change) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin-people", actorId] }),
        client.invalidateQueries({ queryKey: ["profile", change.id] }),
      ]);
      setUpdated(change);
      setConfirmation(null);
    },
  });
  if (profiles.isPending || expertise.isPending || topics.isPending)
    return <Loading />;
  if (profiles.isError || expertise.isError || topics.isError)
    return (
      <ErrorState
        retry={() => {
          void profiles.refetch();
          void expertise.refetch();
          void topics.refetch();
        }}
      />
    );
  const needle = search.trim().toLocaleLowerCase(i18n.language);
  const filtered = profiles.data.filter((profile) =>
    [
      profile.display_name,
      profile.phone ?? "",
      profile.bio_de,
      profile.bio_en,
      profile.time_zone,
    ].some((value) => value.toLocaleLowerCase(i18n.language).includes(needle)),
  );
  const selected =
    (selectedId
      ? profiles.data.find((profile) => profile.id === selectedId)
      : filtered[0]) ?? null;
  const name = (profile: Profile) => profile.display_name || t("peopleUnnamed");
  const selectedExpertise = selected
    ? expertise.data.filter((item) => item.user_id === selected.id)
    : [];
  return (
    <>
      {updated && (
        <Notice>
          {t(updated.active ? "peopleActivated" : "peopleDeactivated", {
            name: updated.name,
          })}
        </Notice>
      )}
      <div className="people-admin-layout">
        <section
          className="panel people-directory"
          aria-labelledby="people-directory-title"
        >
          <h2 id="people-directory-title">{t("peopleDirectory")}</h2>
          <Field id="people-search" label={t("peopleSearch")}>
            <input
              id="people-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          <p className="muted">
            {t("peopleCount", { count: filtered.length })}
          </p>
          {filtered.length ? (
            <ul className="people-results">
              {filtered.map((profile) => (
                <li key={profile.id}>
                  <Button
                    type="button"
                    variant={selected?.id === profile.id ? "default" : "ghost"}
                    className="people-person-button"
                    aria-pressed={selected?.id === profile.id}
                    onClick={() => {
                      setParams({ user: profile.id });
                      setUpdated(null);
                    }}
                  >
                    <UserRound size={18} />
                    <span>
                      {name(profile)}{" "}
                      <small>
                        {t(profile.active ? "peopleActive" : "peopleInactive")}
                      </small>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("peopleNoResults")}</p>
          )}
        </section>
        {selected && (
          <section
            className="panel people-profile"
            aria-labelledby="people-profile-title"
          >
            <div className="section-heading">
              <h2 id="people-profile-title">{name(selected)}</h2>
              <span className="badge">
                {t(selected.active ? "peopleActive" : "peopleInactive")}
              </span>
            </div>
            <dl className="people-profile-facts">
              <dt>{t("timezone")}</dt>
              <dd>{selected.time_zone}</dd>
              {selected.phone && (
                <>
                  <dt>{t("phone")}</dt>
                  <dd>{selected.phone}</dd>
                </>
              )}
            </dl>
            {selected.bio_de && (
              <>
                <h3>{t("bioDe")}</h3>
                <p className="preserve-text">{selected.bio_de}</p>
              </>
            )}
            {selected.bio_en && (
              <>
                <h3>{t("bioEn")}</h3>
                <p className="preserve-text">{selected.bio_en}</p>
              </>
            )}
            {selected.id === actorId ? (
              <p className="muted">{t("peopleSelfProtected")}</p>
            ) : (
              <Button
                type="button"
                variant={selected.active ? "danger" : "secondary"}
                onClick={() => {
                  activation.reset();
                  setConfirmation({
                    id: selected.id,
                    name: name(selected),
                    active: !selected.active,
                  });
                }}
                disabled={!online || activation.isPending}
              >
                {t(selected.active ? "peopleDeactivate" : "peopleActivate")}
              </Button>
            )}
            <hr />
            <ProfileEvidence ownerId={selected.id} readOnly kinds={["cv"]} />
            <h3>{t("peopleExpertiseTitle")}</h3>
            <p>{t("intro", { ns: "qualifications" })}</p>
            <div className="people-expertise-list">
              {selectedExpertise.length ? (
                selectedExpertise.map((item) => {
                  const topic = topics.data.find(
                    (topic) => topic.id === item.topic_id,
                  );
                  return topic ? (
                    <ExpertiseReview
                      key={`${selected.id}:${item.topic_id}`}
                      actorId={actorId}
                      profile={selected}
                      expertise={item}
                      topic={topic}
                    />
                  ) : null;
                })
              ) : (
                <p className="muted">{t("peopleNoExpertise")}</p>
              )}
            </div>
          </section>
        )}
      </div>
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !activation.isPending) setConfirmation(null);
        }}
        title={t(
          confirmation?.active
            ? "peopleActivateConfirm"
            : "peopleDeactivateConfirm",
        )}
        description={t(
          confirmation?.active
            ? "peopleActivateDescription"
            : "peopleDeactivateDescription",
          { name: confirmation?.name ?? "" },
        )}
      >
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={activation.isPending}
            onClick={() => setConfirmation(null)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant={confirmation?.active ? "default" : "danger"}
            disabled={!online || activation.isPending}
            onClick={() => {
              if (confirmation) activation.mutate(confirmation);
            }}
          >
            {t(
              activation.isPending
                ? "saving"
                : confirmation?.active
                  ? "peopleActivate"
                  : "peopleDeactivate",
            )}
          </Button>
        </div>
        {activation.isError && (
          <Notice kind="error">{t("peopleStatusFailed")}</Notice>
        )}
      </Dialog>
    </>
  );
}

/** Open the administrative directory only after permission loading succeeds. */
export function PeopleAdminPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const actorId = session!.user.id;
  const permissions = useQuery(permissionsQuery(actorId));
  if (permissions.isPending) return <Loading />;
  if (permissions.isError)
    return <ErrorState retry={() => void permissions.refetch()} />;
  if (
    !permissions.data.includes("users.manage") ||
    !permissions.data.includes("qualifications.verify")
  )
    return (
      <>
        <PageHeading title={t("people")} />
        <Notice kind="error">{t("noAccess")}</Notice>
        <Button asChild>
          <Link to="/security">{t("security")}</Link>
        </Button>
      </>
    );
  return (
    <>
      <PageHeading title={t("people")} description={t("peopleIntro")} />
      <PeopleDirectory actorId={actorId} />
    </>
  );
}
