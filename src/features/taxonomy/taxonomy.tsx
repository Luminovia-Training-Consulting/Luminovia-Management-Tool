/**
 * Shared catalogue search, detail and versioned maintenance. Conflicts require explicit
 * reloading instead of silently overwriting drafts or historical references.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Archive, FolderTree, Pencil, Plus, RotateCcw } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery } from "../../lib/queries";
import { useOnline } from "../../lib/online";
import { TableImport } from "../../components/table-import";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import {
  saveTaxonomyTopic,
  setTaxonomyArchived,
  taxonomyFormSchema,
  taxonomyPayload,
  type TaxonomyFormValues,
  taxonomyQuery,
  type TaxonomyTopic,
} from "./api";
import "./i18n";
import "./taxonomy.css";

/** Recognize SQLSTATE 40001 as a version conflict requiring deliberate reload. */
function isConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "40001"
  );
}

/** Retain local metadata/hierarchy drafts and accept only confirmed changes against the reviewed version. */
function TopicEditor({
  topic,
  parents,
  onSave,
  onRefresh,
  onClose,
}: {
  topic: TaxonomyTopic | null;
  parents: TaxonomyTopic[];
  onSave: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("taxonomy");
  const online = useOnline();
  const [invalid, setInvalid] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TaxonomyFormValues>({
    resolver: zodResolver(taxonomyFormSchema),
    defaultValues: {
      label_de: topic?.label_de ?? "",
      label_en: topic?.label_en ?? "",
      kind: topic?.kind ?? "topic",
      parent_id: topic?.parent_id ?? "",
      aliases: topic?.aliases.join(", ") ?? "",
      description_de: topic?.description_de ?? "",
      description_en: topic?.description_en ?? "",
    },
  });
  const edit = useMutation({
    mutationFn: (values: TaxonomyFormValues) =>
      saveTaxonomyTopic(topic, values),
    onSuccess: async () => {
      await onSave();
      onClose();
    },
  });
  return (
    <form
      className="taxonomy-editor"
      onSubmit={handleSubmit(
        (values) => {
          setInvalid(false);
          edit.mutate(values);
        },
        () => setInvalid(true),
      )}
    >
      <div className="taxonomy-editor-pair">
        <Field
          id="taxonomy-label-de"
          label={t("labelDe")}
          error={Boolean(errors.label_de)}
        >
          <input {...register("label_de")} maxLength={120} required />
        </Field>
        <Field
          id="taxonomy-label-en"
          label={t("labelEn")}
          error={Boolean(errors.label_en)}
        >
          <input {...register("label_en")} maxLength={120} required />
        </Field>
        <Field id="taxonomy-kind" label={t("kind")}>
          <select {...register("kind")}>
            <option value="topic">{t("topic")}</option>
            <option value="tool">{t("tool")}</option>
            <option value="language">{t("language")}</option>
          </select>
        </Field>
        <Field id="taxonomy-parent" label={t("parent")}>
          <select {...register("parent_id")}>
            <option value="">{t("noParent")}</option>
            {parents
              .filter((parent) => parent.id !== topic?.id)
              .map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {i18n.language === "de" ? parent.label_de : parent.label_en}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field
        id="taxonomy-aliases"
        label={t("aliases")}
        hint={t("aliasesHelp")}
        error={Boolean(errors.aliases)}
      >
        <input {...register("aliases")} maxLength={2500} />
      </Field>
      <div className="taxonomy-editor-pair">
        <Field
          id="taxonomy-description-de"
          label={t("descriptionDe")}
          error={Boolean(errors.description_de)}
        >
          <textarea {...register("description_de")} maxLength={4000} />
        </Field>
        <Field
          id="taxonomy-description-en"
          label={t("descriptionEn")}
          error={Boolean(errors.description_en)}
        >
          <textarea {...register("description_en")} maxLength={4000} />
        </Field>
      </div>
      {invalid && <Notice kind="error">{t("invalid")}</Notice>}
      {edit.isError && (
        <Notice kind="error">
          {t(isConflict(edit.error) ? "conflict" : "error")}
        </Notice>
      )}
      {edit.isError && isConflict(edit.error) && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void onRefresh().then(onClose);
          }}
        >
          {t("reload")}
        </Button>
      )}
      {!online && <Notice>{t("offline")}</Notice>}
      <div className="taxonomy-actions">
        <Button type="submit" disabled={!online || edit.isPending}>
          {t(edit.isPending ? "saving" : "save")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          disabled={edit.isPending}
        >
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

/** Combine explicit search, current capabilities and a version-conflict-aware catalogue editor. */
export function TaxonomyPage() {
  const { t, i18n } = useTranslation("taxonomy");
  const { session } = useAuth();
  const actor = session!.user.id;
  const online = useOnline();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  const [kind, setKind] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editor, setEditor] = useState<TaxonomyTopic | null | undefined>();
  const [archive, setArchive] = useState<TaxonomyTopic>();
  const [saved, setSaved] = useState(false);
  // Cancel superseded reads and avoid a request for every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuerySearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const permissions = useQuery(permissionsQuery(actor));
  const canEdit = permissions.data?.includes("taxonomy.manage") ?? false;
  const catalogue = useQuery(
    taxonomyQuery(actor, querySearch, kind, canEdit && includeArchived),
  );
  const parents = useQuery(taxonomyQuery(actor));
  const refreshQueries = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["taxonomy"] }),
      client.invalidateQueries({ queryKey: ["topics"] }),
    ]);
  };
  const refresh = async () => {
    await refreshQueries();
    setSaved(true);
  };
  const changeArchive = useMutation({
    mutationFn: ({
      topic,
      archived,
    }: {
      topic: TaxonomyTopic;
      archived: boolean;
    }) => setTaxonomyArchived(topic, archived),
    onSuccess: async () => {
      await refresh();
      setArchive(undefined);
    },
  });
  if (permissions.isPending || catalogue.isPending || parents.isPending)
    return <Loading />;
  if (permissions.isError || catalogue.isError || parents.isError)
    return (
      <ErrorState
        retry={() => {
          void permissions.refetch();
          void catalogue.refetch();
          void parents.refetch();
        }}
      />
    );
  return (
    <>
      <PageHeading title={t("title")} description={t("help")} />
      {canEdit && (
        <TableImport
          label={
            i18n.language.startsWith("de")
              ? "Themen, Tools und Sprachen importieren"
              : "Import topics, tools and languages"
          }
          filename="taxonomy"
          columns={[
            "label_de",
            "label_en",
            "kind",
            "aliases",
            "description_de",
            "description_en",
          ]}
          example={["Tabellenkalkulation", "Spreadsheets", "topic", "", "", ""]}
          parse={(row) => {
            const values = taxonomyFormSchema.parse({ ...row, parent_id: "" });
            taxonomyPayload(values);
            return values;
          }}
          save={(row) => saveTaxonomyTopic(null, row)}
          refresh={refreshQueries}
        />
      )}
      <div className="taxonomy-toolbar">
        {canEdit ? (
          <Button
            disabled={!online}
            onClick={() => {
              setSaved(false);
              setEditor(null);
            }}
          >
            <Plus size={18} />
            {t("new")}
          </Button>
        ) : (
          <p className="taxonomy-meta">{t("readOnly")}</p>
        )}
        {canEdit && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            {t("includeArchived")}
          </label>
        )}
      </div>
      <div className="panel taxonomy-filters">
        <Field id="taxonomy-search" label={t("search")}>
          <input
            type="search"
            value={search}
            maxLength={120}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <Field id="taxonomy-kind-filter" label={t("kind")}>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t("all")}</option>
            <option value="topic">{t("topic")}</option>
            <option value="tool">{t("tool")}</option>
            <option value="language">{t("language")}</option>
          </select>
        </Field>
      </div>
      {catalogue.isFetching && (
        <p role="status" className="taxonomy-meta">
          {t("loading")}
        </p>
      )}
      {saved && <Notice>{t("saved")}</Notice>}
      <p className="taxonomy-meta">{t("limit")}</p>
      {!catalogue.data.length ? (
        <Notice>{t("empty")}</Notice>
      ) : (
        <div className="taxonomy-grid">
          {catalogue.data.map((topic) => {
            const parent = parents.data.find(
              (item) => item.id === topic.parent_id,
            );
            return (
              <article className="panel taxonomy-card" key={topic.id}>
                <div className="taxonomy-actions">
                  <FolderTree size={19} />
                  <span className="badge">{t(topic.kind)}</span>
                  {topic.archived_at && (
                    <span className="badge">{t("archived")}</span>
                  )}
                </div>
                <h2>
                  {i18n.language === "de" ? topic.label_de : topic.label_en}
                </h2>
                {parent && (
                  <p className="taxonomy-meta">
                    {t("currentParent", {
                      name:
                        i18n.language === "de"
                          ? parent.label_de
                          : parent.label_en,
                    })}
                  </p>
                )}
                <p>
                  {i18n.language === "de"
                    ? topic.description_de
                    : topic.description_en}
                </p>
                <div className="taxonomy-aliases">
                  {topic.aliases.map((alias) => (
                    <span key={alias}>{alias}</span>
                  ))}
                </div>
                <strong>{t("related")}</strong>
                {topic.related_courses.length ? (
                  <ul>
                    {topic.related_courses.map((course) => (
                      <li key={course.id}>
                        <Link
                          to={`/courses?template=${encodeURIComponent(course.id)}`}
                        >
                          {course.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="taxonomy-meta">{t("noRelated")}</p>
                )}
                {canEdit && (
                  <div className="taxonomy-actions">
                    {!topic.archived_at && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!online}
                        onClick={() => {
                          setSaved(false);
                          setEditor(topic);
                        }}
                      >
                        <Pencil size={16} />
                        {t("edit")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!online}
                      onClick={() => {
                        changeArchive.reset();
                        setArchive(topic);
                      }}
                    >
                      {topic.archived_at ? (
                        <RotateCcw size={16} />
                      ) : (
                        <Archive size={16} />
                      )}
                      {t(topic.archived_at ? "restore" : "archive")}
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {editor !== undefined && canEdit && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditor(undefined);
          }}
          title={t(editor ? "editTitle" : "createTitle")}
          description={t("help")}
        >
          <TopicEditor
            key={editor ? `${editor.id}:${editor.version}` : "new"}
            topic={editor}
            parents={parents.data}
            onSave={refresh}
            onRefresh={refreshQueries}
            onClose={() => setEditor(undefined)}
          />
        </Dialog>
      )}
      {archive && canEdit && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !changeArchive.isPending) setArchive(undefined);
          }}
          title={t(archive.archived_at ? "confirmRestore" : "confirmArchive")}
          description={t("archiveHelp")}
        >
          <p>
            <strong>
              {i18n.language === "de" ? archive.label_de : archive.label_en}
            </strong>
          </p>
          {changeArchive.isError && (
            <Notice kind="error">
              {t(isConflict(changeArchive.error) ? "conflict" : "error")}
            </Notice>
          )}
          <div className="taxonomy-actions">
            <Button
              disabled={!online || changeArchive.isPending}
              onClick={() =>
                changeArchive.mutate({
                  topic: archive,
                  archived: !archive.archived_at,
                })
              }
            >
              {t(
                changeArchive.isPending
                  ? "saving"
                  : archive.archived_at
                    ? "restore"
                    : "archive",
              )}
            </Button>
            <Button
              variant="secondary"
              disabled={changeArchive.isPending}
              onClick={() => setArchive(undefined)}
            >
              {t("cancel")}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
