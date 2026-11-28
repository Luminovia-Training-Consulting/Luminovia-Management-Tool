/**
 * Manage qualification verification, evidence and expiry plus account suspension.
 * Changes require confirmed server responses and invalidate related queries;
 * private profile fields retain their resource-specific database access controls.
 */
import { commercialPersonEligibleQuery } from "../commercial/api";
import { qualificationKey } from "../qualifications/api";
import { QualificationEvidenceReview } from "../qualifications/evidence";
import { ProfileEvidence } from "../files/profile-evidence";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { DateTime } from "luxon";
import { permissionsQuery, topicsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import { dateTime, zonedInstant } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import type { Expertise, Profile, Topic } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";

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
  const label = i18n.language.startsWith("de")
    ? topic.label_de
    : topic.label_en;
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
        client.invalidateQueries({ queryKey: ["person", actorId, profile.id] }),
        client.invalidateQueries({ queryKey: ["people-directory", actorId] }),
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

function ExpertiseSelection({
  actor,
  lecturer,
  topics,
  current,
}: {
  actor: string;
  lecturer: string;
  topics: Topic[];
  current: Expertise[];
}) {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const cache = useQueryClient();
  const [topicId, setTopicId] = useState("");
  const currentTopic = current.find((item) => item.topic_id === topicId);
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("set_lecturer_expertise", {
        p_user_id: lecturer,
        p_topic_id: topicId,
        p_selected: !currentTopic,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["admin-expertise", actor] }),
        cache.invalidateQueries({ queryKey: ["expertise", lecturer] }),
        cache.invalidateQueries({ queryKey: ["person", actor, lecturer] }),
        cache.invalidateQueries({ queryKey: ["people-directory", actor] }),
      ]);
      setTopicId("");
    },
  });
  return (
    <form
      className="form-row"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Field id="managed-expertise-topic" label={t("peopleExpertiseTopic")}>
        <select
          id="managed-expertise-topic"
          value={topicId}
          disabled={save.isPending}
          onChange={(event) => {
            setTopicId(event.target.value);
            save.reset();
          }}
        >
          <option value="">—</option>
          {topics
            .filter(
              (topic) =>
                !topic.archived_at ||
                current.some((item) => item.topic_id === topic.id),
            )
            .map((topic) => (
              <option key={topic.id} value={topic.id}>
                {i18n.language.startsWith("de")
                  ? topic.label_de
                  : topic.label_en}
              </option>
            ))}
        </select>
      </Field>
      <div>
        <Button
          disabled={
            !online ||
            !topicId ||
            Boolean(currentTopic?.verified) ||
            save.isPending
          }
        >
          {t(currentTopic ? "peopleExpertiseRemove" : "peopleExpertiseAdd")}
        </Button>
        {currentTopic?.verified && (
          <p className="muted">{t("peopleExpertiseRevokeFirst")}</p>
        )}
        {save.isError && (
          <Notice kind="error">{t("peopleExpertiseSaveFailed")}</Notice>
        )}
        {save.isSuccess && (
          <Notice kind="success">{t("peopleExpertiseSaved")}</Notice>
        )}
      </div>
    </form>
  );
}

/** Manage evidence and expertise for one explicitly selected account. */
export function ManagedExpertise({
  actorId,
  accountId,
  showAccountDetails = true,
}: {
  actorId: string;
  accountId: string;
  showAccountDetails?: boolean;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const client = useQueryClient();
  const permissions = useQuery(permissionsQuery(actorId));
  const allowed =
    !permissions.isError &&
    permissions.data?.includes("users.manage") === true &&
    permissions.data.includes("qualifications.verify");
  const [confirmation, setConfirmation] = useState<AccountChange | null>(null);
  const [updated, setUpdated] = useState<AccountChange | null>(null);
  const profiles = useQuery({
    queryKey: ["admin-people", actorId, accountId],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await db()
        .from("profiles")
        .select("*")
        .eq("id", accountId);
      if (error) throw error;
      return data as Profile[];
    },
  });
  const expertise = useQuery({
    queryKey: ["admin-expertise", actorId, accountId],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await db()
        .from("lecturer_topics")
        .select("*")
        .eq("user_id", accountId);
      if (error) throw error;
      return data as Expertise[];
    },
  });
  const topics = useQuery({ ...topicsQuery, enabled: allowed });
  const lecturer = useQuery({
    ...commercialPersonEligibleQuery(actorId, accountId),
    enabled: allowed && accountId !== actorId,
  });
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
  if (permissions.isPending) return <Loading />;
  if (permissions.isError)
    return <ErrorState retry={() => void permissions.refetch()} />;
  if (!allowed) return <Notice kind="error">{t("noAccess")}</Notice>;
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
  const selected = profiles.data[0];
  if (!selected) return <Notice kind="error">{t("peopleNoResults")}</Notice>;
  const name = selected.display_name || t("peopleUnnamed");
  const selectedExpertise = expertise.data;
  const canEditEvidence =
    selected.active &&
    selected.id !== actorId &&
    lecturer.isSuccess &&
    lecturer.data;
  return (
    <>
      {updated && (
        <Notice>
          {t(updated.active ? "peopleActivated" : "peopleDeactivated", {
            name: updated.name,
          })}
        </Notice>
      )}
      <section
        className="panel people-profile"
        aria-labelledby="people-profile-title"
      >
        {showAccountDetails ? (
          <>
            <div className="section-heading">
              <h2 id="people-profile-title">{name}</h2>
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
                    name,
                    active: !selected.active,
                  });
                }}
                disabled={!online || activation.isPending}
              >
                {t(selected.active ? "peopleDeactivate" : "peopleActivate")}
              </Button>
            )}
            <hr />
          </>
        ) : (
          <h2 id="people-profile-title">{t("peopleExpertiseTitle")}</h2>
        )}
        {canEditEvidence && (
          <p className="muted">{t("peopleDelegatedEvidence")}</p>
        )}
        <ProfileEvidence
          ownerId={selected.id}
          onBehalf
          readOnly={!canEditEvidence}
        />
        {lecturer.isError && (
          <ErrorState retry={() => void lecturer.refetch()} />
        )}
        {showAccountDetails && <h3>{t("peopleExpertiseTitle")}</h3>}
        <p>{t("intro", { ns: "qualifications" })}</p>
        {canEditEvidence && (
          <ExpertiseSelection
            key={selected.id}
            actor={actorId}
            lecturer={selected.id}
            topics={topics.data}
            current={selectedExpertise}
          />
        )}
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
