/** Role-scoped course welcome editor, local preview and published content. */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import type { CourseResource } from "./api";
import "./i18n";
import { DownloadButton } from "./resources";
import {
  type CourseWelcomePayload,
  type CourseWelcomeRevision,
  courseWelcomePayloadSchema,
  courseWelcomeRevisionSchema,
  welcomeAttachmentLimit,
  welcomeHeadingLimit,
  welcomeTextLimit,
} from "./welcome-content-schema";

const welcomeFields = [
  ["welcome_message", "welcomeCourseMessage"],
  ["description", "welcomeCourseDescription"],
  ["objectives", "welcomeCourseObjectives"],
  ["schedule_information", "welcomeScheduleInformation"],
  ["contact_instructions", "welcomeContactInstructions"],
  ["joining_instructions", "welcomeJoiningInstructions"],
] as const;
type WelcomeTextField = (typeof welcomeFields)[number][0];

/** The course file gateway retains resource authority and the exact file version. */
function WelcomeContents({
  content,
  resources,
  preview = false,
}: {
  content: CourseWelcomePayload;
  resources: CourseResource[];
  preview?: boolean;
}) {
  const { t } = useTranslation("learning");
  const attachments = content.attachment_ids
    .map((id) => resources.find((resource) => resource.id === id))
    .filter((resource) => resource !== undefined);
  const Heading = preview ? "h4" : "h3";
  const FieldHeading = content.heading ? (preview ? "h5" : "h4") : Heading;
  if (
    !content.heading &&
    !welcomeFields.some(([key]) => content[key]) &&
    !attachments.length
  )
    return <p>{t("welcomeNoContent")}</p>;
  return (
    <div className="course-welcome-content">
      {content.heading && <Heading>{content.heading}</Heading>}
      {welcomeFields.map(
        ([key, label]) =>
          content[key] && (
            <div key={key}>
              <FieldHeading>{t(label)}</FieldHeading>
              <p className="course-welcome-text">{content[key]}</p>
            </div>
          ),
      )}
      {attachments.length > 0 && (
        <div>
          <FieldHeading>{t("welcomeAttachments")}</FieldHeading>
          <ul className="course-welcome-files">
            {attachments.map((resource) => (
              <li key={resource.id}>
                <span>{resource.name}</span>
                {!preview && (
                  <DownloadButton
                    kind="resource"
                    id={resource.id}
                    name={resource.name}
                    label={t("welcomeDownload", { name: resource.name })}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Edit the current published revision without making the draft visible to learners. */
export function CourseWelcomeContent({
  actor,
  courseId,
  zone,
  canEdit,
  canProtect = false,
  resources = [],
}: {
  actor: string;
  courseId: string;
  zone: string;
  canEdit: boolean;
  canProtect?: boolean;
  resources?: CourseResource[];
}) {
  const { t, i18n } = useTranslation("learning");
  const id = useId();
  const online = useOnline();
  const cache = useQueryClient();
  const [draft, setDraft] = useState<CourseWelcomeRevision | null>(null);
  const [preview, setPreview] = useState(false);
  const queryKey = ["course-welcome", actor, courseId] as const;
  const query = useQuery({
    queryKey,
    enabled: online,
    retry: false,
    refetchInterval: 15_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_welcome_content", { p_run_id: courseId })
        .abortSignal(signal);
      if (error) throw error;
      return courseWelcomeRevisionSchema.parse(data);
    },
  });
  const publish = useMutation({
    mutationFn: async (revision: CourseWelcomeRevision) => {
      requireOnline();
      const { version, published_at, ...content } = revision;
      // Published time and revision number are server-owned.
      void published_at;
      const payload = courseWelcomePayloadSchema.parse(content);
      const { data, error } = await db().rpc("publish_course_welcome_content", {
        p_run_id: courseId,
        p_payload: payload,
        p_expected_version: version,
      });
      if (error) throw error;
      return courseWelcomeRevisionSchema.parse(data);
    },
    onSuccess: (revision) => {
      cache.setQueryData(queryKey, revision);
      setDraft(null);
      setPreview(false);
      void query.refetch();
    },
    onError: () => void query.refetch(),
  });
  if (!online) return null;
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  const current = query.data;
  const stale = draft !== null && draft.version !== current.version;
  const protectedFields = current.protect_instructions && !canProtect;
  const eligibleResources = resources.filter(
    (resource) =>
      resource.category === "material" &&
      (resource.audience === "all" || resource.audience === "participants"),
  );

  function editText(key: WelcomeTextField | "heading", value: string) {
    setDraft((previous) => previous && { ...previous, [key]: value });
  }

  function selectAttachment(resourceId: string, selected: boolean) {
    setDraft((previous) => {
      if (!previous) return previous;
      const ids = previous.attachment_ids.filter((id) => id !== resourceId);
      if (selected && ids.length < welcomeAttachmentLimit) ids.push(resourceId);
      return { ...previous, attachment_ids: ids };
    });
  }

  return (
    <section
      className="panel learning-panel"
      aria-label={t("welcomeCourseTitle")}
    >
      <h2>{t("welcomeCourseTitle")}</h2>
      {current.published_at && (
        <p className="muted">
          {t("welcomePublished", {
            date: dateTime(current.published_at, i18n.language, zone),
            revision: current.version,
          })}
        </p>
      )}
      {(!draft || !canEdit) && (
        <WelcomeContents content={current} resources={eligibleResources} />
      )}
      {canEdit && !draft && (
        <Button
          variant="secondary"
          onClick={() => {
            publish.reset();
            setDraft(current);
          }}
        >
          {t("welcomeEdit")}
        </Button>
      )}
      {canEdit && draft && (
        <form
          className="course-welcome-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!stale && preview && !publish.isPending) publish.mutate(draft);
          }}
        >
          {preview ? (
            <section
              className="course-welcome-preview"
              aria-label={t("welcomePreview")}
            >
              <h3>{t("welcomePreview")}</h3>
              <p className="muted">{t("welcomePreviewHint")}</p>
              <WelcomeContents
                content={draft}
                resources={eligibleResources}
                preview
              />
            </section>
          ) : (
            <>
              <Field id={id + "-heading"} label={t("welcomeHeading")}>
                <input
                  value={draft.heading}
                  maxLength={welcomeHeadingLimit}
                  onChange={(event) =>
                    editText("heading", event.currentTarget.value)
                  }
                />
              </Field>
              {welcomeFields.map(([key, label]) => (
                <Field key={key} id={id + "-" + key} label={t(label)}>
                  <textarea
                    value={draft[key]}
                    maxLength={welcomeTextLimit}
                    readOnly={
                      protectedFields &&
                      (key === "schedule_information" ||
                        key === "contact_instructions" ||
                        key === "joining_instructions")
                    }
                    onChange={(event) =>
                      editText(key, event.currentTarget.value)
                    }
                  />
                </Field>
              ))}
              {canProtect && (
                <label className="course-welcome-check">
                  <input
                    type="checkbox"
                    checked={draft.protect_instructions}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setDraft(
                        (previous) =>
                          previous && {
                            ...previous,
                            protect_instructions: checked,
                          },
                      );
                    }}
                  />
                  {t("welcomeProtectInstructions")}
                </label>
              )}
              {protectedFields && (
                <p className="muted">{t("welcomeInstructionsProtected")}</p>
              )}
              <fieldset className="course-welcome-attachments">
                <legend>{t("welcomeAttachments")}</legend>
                <p className="muted">
                  {t("welcomeAttachmentHint", {
                    limit: welcomeAttachmentLimit,
                  })}
                </p>
                {eligibleResources.map((resource) => {
                  const checked = draft.attachment_ids.includes(resource.id);
                  return (
                    <label key={resource.id} className="course-welcome-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={
                          !checked &&
                          draft.attachment_ids.length >= welcomeAttachmentLimit
                        }
                        onChange={(event) =>
                          selectAttachment(
                            resource.id,
                            event.currentTarget.checked,
                          )
                        }
                      />
                      {resource.name}
                    </label>
                  );
                })}
              </fieldset>
            </>
          )}
          {stale && <Notice kind="error">{t("welcomeVersionChanged")}</Notice>}
          {!stale && publish.isError && (
            <Notice kind="error">{t("welcomePublishError")}</Notice>
          )}
          <div className="form-actions">
            {preview ? (
              <>
                <Button type="submit" disabled={stale || publish.isPending}>
                  {t("welcomePublish")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={publish.isPending}
                  onClick={() => setPreview(false)}
                >
                  {t("welcomeBackToDraft")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                disabled={stale}
                onClick={() => setPreview(true)}
              >
                {t("welcomePreview")}
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={publish.isPending}
              onClick={() => {
                setDraft(null);
                setPreview(false);
                publish.reset();
              }}
            >
              {t("welcomeCancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
