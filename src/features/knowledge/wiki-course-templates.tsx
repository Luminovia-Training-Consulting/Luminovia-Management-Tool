/**
 * Render only the current actor's authorized course-template references for the visible wiki
 * revision. Each draft mutation is explicit and revision-checked by PostgreSQL; this component
 * never grants course access or replaces a set that could contain hidden references.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { readDirectoryPages } from "../../lib/paged-read";
import { userRolesQuery } from "../../lib/queries";
import { clientOrganisationsQuery } from "../commercial/commission-api";
import { wikiPageQuery } from "./api";
import type { WikiPageRecord } from "./types";
import "./wiki-course-templates-i18n";

/** The read RPC deliberately returns only references the caller can still open. */
interface WikiCourseTemplateReference {
  template_id: string;
  title: string;
  archived: boolean;
}

type WikiCourseTemplatesProps = {
  actor: string;
  page: WikiPageRecord;
  canEdit: boolean;
};

/** Global wiki editing stays available; a company context is an explicit, separate projection. */
export function WikiCourseTemplates(props: WikiCourseTemplatesProps) {
  const { t } = useTranslation("wikiCourseTemplates");
  const roles = useQuery(userRolesQuery(props.actor));
  const isClient = roles.data?.includes("client") ?? false;
  const companies = useQuery({
    ...clientOrganisationsQuery(props.actor),
    enabled: isClient,
  });
  const [selectedCompany, setSelectedCompany] = useState("");
  const company =
    isClient && companies.data?.some(({ id }) => id === selectedCompany)
      ? selectedCompany
      : "";
  return (
    <section
      className="knowledge-course-templates"
      aria-labelledby="wiki-course-templates-title"
    >
      <h3 id="wiki-course-templates-title">{t("title")}</h3>
      <p>{t("hint")}</p>
      {isClient && companies.isError && (
        <ErrorState retry={() => void companies.refetch()} />
      )}
      {isClient && Boolean(companies.data?.length) && (
        <Field id="wiki-template-company" label={t("companyContext")}>
          <select
            id="wiki-template-company"
            value={company}
            onChange={(event) => setSelectedCompany(event.target.value)}
          >
            <option value="">{t("globalContext")}</option>
            {companies.data?.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <WikiCourseTemplateReferences
        key={company}
        {...props}
        company={company}
      />
    </section>
  );
}

/** The selected scope travels with every read and mutation of the current revision. */
function WikiCourseTemplateReferences({
  actor,
  page,
  canEdit,
  company,
}: WikiCourseTemplatesProps & { company: string }) {
  const { t } = useTranslation("wikiCourseTemplates");
  const client = useQueryClient();
  const online = useOnline();
  const [selected, setSelected] = useState("");
  const referenceKey = [
    "wiki-course-templates",
    actor,
    page.id,
    page.version,
    company,
  ] as const;
  const editable =
    canEdit &&
    page.status !== "archived" &&
    page.version !== page.published_version;
  const references = useQuery({
    queryKey: referenceKey,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("wiki_course_templates", {
          p_page_id: page.id,
          p_organisation_id: company || null,
        })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as WikiCourseTemplateReference[];
    },
  });
  const canMutate = editable && references.isSuccess;
  const templates = useQuery({
    queryKey: [...referenceKey, "choices"],
    enabled: canMutate,
    queryFn: ({ signal }) =>
      readDirectoryPages<{ id: string; title: string }>((from, to) =>
        db()
          .rpc("wiki_course_template_choices", {
            p_page_id: page.id,
            p_organisation_id: company || null,
          })
          .order("title")
          .order("id")
          .range(from, to)
          .abortSignal(signal),
      ),
  });
  const change = useMutation({
    mutationFn: async ({
      templateId,
      remove,
    }: {
      templateId: string;
      remove: boolean;
    }) => {
      requireOnline();
      const { error } = await db().rpc("manage_wiki_course_template", {
        p_page_id: page.id,
        p_revision: page.version,
        p_template_id: templateId,
        p_remove: remove,
        p_organisation_id: company || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setSelected("");
      await client.invalidateQueries({ queryKey: referenceKey });
      await client.invalidateQueries({
        queryKey: wikiPageQuery(actor, page.id).queryKey,
      });
    },
    onError: async () => {
      // A stale-version rejection must not leave the form offering a mutation against old state.
      await Promise.all([
        client.invalidateQueries({ queryKey: referenceKey }),
        client.invalidateQueries({
          queryKey: wikiPageQuery(actor, page.id).queryKey,
        }),
      ]);
    },
  });
  const linked = references.data ?? [];
  const linkedIds = new Set(linked.map((item) => item.template_id));
  const available = (templates.data ?? []).filter(
    (item) => !linkedIds.has(item.id),
  );
  const busy = change.isPending || templates.isFetching;
  const atLimit = linked.length >= 20;
  const errorCode =
    change.error && typeof change.error === "object" && "code" in change.error
      ? change.error.code
      : null;
  return (
    <>
      {references.isPending ? (
        <Loading />
      ) : references.isError ? (
        <ErrorState retry={() => void references.refetch()} />
      ) : linked.length ? (
        <ul>
          {linked.map((item) => (
            <li key={item.template_id}>
              <Link
                className="knowledge-course-template-link"
                to={`/courses?${new URLSearchParams({ template: item.template_id, ...(company ? { company, tab: "templates" } : {}) })}`}
              >
                {item.title}
              </Link>
              {item.archived && <span className="badge">{t("archived")}</span>}
              {canMutate && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!online || busy}
                  aria-label={t("remove", { name: item.title })}
                  onClick={() =>
                    change.mutate({
                      templateId: item.template_id,
                      remove: true,
                    })
                  }
                >
                  {t("remove", { name: item.title })}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("empty")}</p>
      )}
      {canMutate && (
        <div className="knowledge-course-template-add">
          {templates.isPending ? (
            <p role="status">{t("loading")}</p>
          ) : templates.isError ? (
            <ErrorState retry={() => void templates.refetch()} />
          ) : atLimit ? (
            <p>{t("limit")}</p>
          ) : available.length ? (
            <>
              <Field id="wiki-course-template-choice" label={t("choose")}>
                <select
                  id="wiki-course-template-choice"
                  value={selected}
                  disabled={!online || busy}
                  onChange={(event) => setSelected(event.target.value)}
                >
                  <option value="">{t("choose")}</option>
                  {available.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                type="button"
                variant="secondary"
                disabled={!online || busy || !selected}
                onClick={() =>
                  change.mutate({ templateId: selected, remove: false })
                }
              >
                {t("add")}
              </Button>
            </>
          ) : (
            <p>{t("none")}</p>
          )}
        </div>
      )}
      {canEdit && !editable && <p>{t("draftFirst")}</p>}
      {change.isPending && <p role="status">{t("loading")}</p>}
      {change.isError && (
        <Notice kind="error">
          {errorCode === "40001"
            ? t("stale")
            : errorCode === "54000"
              ? t("full")
              : t("error")}
        </Notice>
      )}
    </>
  );
}
