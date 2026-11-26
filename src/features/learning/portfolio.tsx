/** Private authoring and instructor views for version-pinned portfolios. */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { saveBlob } from "../../lib/blob-download";
import { useOnline } from "../../lib/online";
import {
  changePortfolio,
  coursePortfolioQuery,
  exportPortfolio,
  personalPortfolioQuery,
  portfolioKey,
  portfolioPageSize,
} from "./portfolio-api";
import {
  portfolioCommand,
  type PortfolioEntry,
  type PortfolioShareTarget,
} from "./portfolio-schema";

/** Invalidate only this actor's permission-scoped snapshots after a write. */
function usePortfolioCommand(actor: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: changePortfolio,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: portfolioKey(actor) }),
  });
}

/** Convert typed conflicts into an explicit prompt to reopen the latest revision. */
function PortfolioMutationError({ error }: { error: unknown }) {
  const { t } = useTranslation("learning");
  if (!error) return null;
  const stale =
    typeof error === "object" && "code" in error && error.code === "PT409";
  return (
    <Notice kind="error">
      {t(stale ? "portfolioConflict" : "portfolioSaveError")}
    </Notice>
  );
}

/** Bind an edit draft to the exact revision that was opened, including zero for creation. */
function EntryEditor({
  actor,
  entry,
  close,
}: {
  actor: string;
  entry: PortfolioEntry | null;
  close: () => void;
}) {
  const { t } = useTranslation("learning");
  const titleId = useId();
  const bodyId = useId();
  const [initial] = useState(() => ({
    entry: entry?.id ?? crypto.randomUUID(),
    revision: entry?.current.revision ?? 0,
  }));
  const [title, setTitle] = useState(entry?.current.title ?? "");
  const [body, setBody] = useState(entry?.current.body ?? "");
  const save = usePortfolioCommand(actor);
  const command = portfolioCommand.safeParse({
    p_entry_id: initial.entry,
    p_action: "save",
    p_payload: { title, body },
    p_expected_revision: initial.revision,
  });
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (command.success && !save.isPending)
          save.mutate(command.data, { onSuccess: close });
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend>{t(entry ? "portfolioEdit" : "portfolioCreate")}</legend>
        <label htmlFor={titleId}>{t("portfolioTitle")}</label>
        <input
          id={titleId}
          value={title}
          required
          maxLength={140}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <label htmlFor={bodyId}>{t("portfolioBody")}</label>
        <textarea
          id={bodyId}
          value={body}
          required
          maxLength={4000}
          onChange={(event) => setBody(event.currentTarget.value)}
        />
        <div className="form-actions">
          <Button type="submit" disabled={!command.success}>
            {t("portfolioSave")}
          </Button>
          <Button type="button" variant="secondary" onClick={close}>
            {t("portfolioCancel")}
          </Button>
        </div>
      </fieldset>
      <PortfolioMutationError error={save.error} />
    </form>
  );
}

/** Fetch other versions only when the owner opens history on this entry. */
function EntryHistory({ actor, entry }: { actor: string; entry: string }) {
  const { t } = useTranslation("learning");
  const query = useQuery(personalPortfolioQuery(actor, entry));
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  return (
    <ol className="space-y-2">
      {query.data.entries[0]?.history?.map((revision) => (
        <li key={revision.revision}>
          <strong>
            {t("portfolioRevision", { revision: revision.revision })} ·{" "}
            {revision.title}
          </strong>
          <p className="preserve-text">{revision.body}</p>
        </li>
      ))}
    </ol>
  );
}

/** Disclose the exact revision and recipient before explicitly recording a share. */
function EntryShare({
  actor,
  entry,
  targets,
}: {
  actor: string;
  entry: PortfolioEntry;
  targets: PortfolioShareTarget[];
}) {
  const { t } = useTranslation("learning");
  const [choice, setChoice] = useState("");
  const [reviewedRevision] = useState(entry.current.revision);
  const selected = targets.find(
    ({ course_id, teacher_id }) => choice === course_id + ":" + teacher_id,
  );
  const save = usePortfolioCommand(actor);
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!selected || save.isPending) return;
        save.mutate(
          {
            p_entry_id: entry.id,
            p_action: "share",
            p_expected_revision: reviewedRevision,
            p_payload: {
              course_id: selected.course_id,
              teacher_id: selected.teacher_id,
            },
          },
          { onSuccess: () => setChoice("") },
        );
      }}
    >
      <label>
        {t("portfolioRecipient")}
        <select
          value={choice}
          onChange={(event) => setChoice(event.currentTarget.value)}
        >
          <option value="">{t("portfolioSelectRecipient")}</option>
          {targets.map(({ course_id, course, teacher_id, teacher }) => (
            <option
              key={course_id + ":" + teacher_id}
              value={course_id + ":" + teacher_id}
            >
              {course} · {teacher}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={!selected || save.isPending}>
        {t("portfolioReleaseRevision", { revision: reviewedRevision })}
      </Button>
      <PortfolioMutationError error={save.error} />
    </form>
  );
}

function EntryRow({
  actor,
  entry,
  targets,
  readOnly,
  edit,
}: {
  actor: string;
  entry: PortfolioEntry;
  targets: PortfolioShareTarget[];
  readOnly: boolean;
  edit: () => void;
}) {
  const { t } = useTranslation("learning");
  const [history, setHistory] = useState(false);
  const [sharing, setSharing] = useState(false);
  const revoke = usePortfolioCommand(actor);
  return (
    <li className="panel learning-panel space-y-2">
      <h3>{entry.current.title}</h3>
      <p className="preserve-text">{entry.current.body}</p>
      <details onToggle={(event) => setHistory(event.currentTarget.open)}>
        <summary>{t("portfolioHistory")}</summary>
        {history && <EntryHistory actor={actor} entry={entry.id} />}
      </details>
      {!readOnly && (
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={edit}>
            {t("portfolioEdit")}
          </Button>
          {targets.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              aria-expanded={sharing}
              onClick={() => setSharing((previous) => !previous)}
            >
              {t("portfolioShare")}
            </Button>
          )}
        </div>
      )}
      {sharing && !readOnly && (
        <EntryShare
          key={entry.current.revision}
          actor={actor}
          entry={entry}
          targets={targets}
        />
      )}
      {entry.shares.length > 0 && (
        <ul className="space-y-2" aria-label={t("portfolioShares")}>
          {entry.shares.map((share) => (
            <li key={share.id} className="form-actions">
              <span>
                {t("portfolioRevision", share)} ·{" "}
                {share.course ?? t("portfolioUnavailable")} ·{" "}
                {share.teacher ?? t("portfolioUnavailable")}
              </span>
              {share.revoked_at ? (
                <span>{t("portfolioRevoked")}</span>
              ) : (
                !readOnly && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={revoke.isPending}
                    onClick={() =>
                      revoke.mutate({
                        p_entry_id: entry.id,
                        p_action: "revoke",
                        p_expected_revision: 0,
                        p_payload: { share_id: share.id },
                      })
                    }
                  >
                    {t("portfolioRevoke")}
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      <PortfolioMutationError error={revoke.error} />
    </li>
  );
}

/** Display only the current actor's personal entries and export them as JSON on request. */
export function PersonalPortfolio({
  actor,
  readOnly,
}: {
  actor: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation("learning");
  const query = useQuery(personalPortfolioQuery(actor));
  const [editor, setEditor] = useState<PortfolioEntry | null | undefined>();
  const exportData = useMutation({ mutationFn: exportPortfolio, gcTime: 0 });
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  const { entries, targets } = query.data;

  return (
    <section className="learning-panel space-y-4" aria-label={t("portfolio")}>
      <h2>{t("portfolio")}</h2>
      <p>{t("portfolioPrivate")}</p>
      <div className="form-actions">
        {!readOnly && (
          <Button
            type="button"
            disabled={entries.length >= 40}
            onClick={() => setEditor(null)}
          >
            {t("portfolioCreate")}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          disabled={exportData.isPending}
          onClick={() =>
            exportData.mutate(undefined, {
              onSuccess: (items) => {
                saveBlob(
                  new Blob([JSON.stringify(items, null, 2)], {
                    type: "application/json",
                  }),
                  "learning-portfolio.json",
                );
                exportData.reset();
              },
            })
          }
        >
          {t("portfolioExport")}
        </Button>
      </div>
      <PortfolioMutationError error={exportData.error} />
      {editor !== undefined && !readOnly && (
        <EntryEditor
          key={editor?.id ?? "new"}
          actor={actor}
          entry={editor}
          close={() => setEditor(undefined)}
        />
      )}
      {entries.length === 0 && <p>{t("portfolioEmpty")}</p>}
      <ul className="learning-resources">
        {entries.map((entry) => (
          <EntryRow
            key={entry.id}
            actor={actor}
            entry={entry}
            targets={targets}
            readOnly={readOnly}
            edit={() => setEditor(entry)}
          />
        ))}
      </ul>
    </section>
  );
}

/** Mount the named teacher's shared snapshots only while on the active online section. */
export function CoursePortfolio({
  actor,
  course,
}: {
  actor: string;
  course: string;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  return (
    <section className="panel learning-panel" aria-label={t("portfolioShared")}>
      <h2>{t("portfolioShared")}</h2>
      {online ? (
        <CoursePortfolioPage actor={actor} course={course} />
      ) : (
        <p>{t("workspaceOffline")}</p>
      )}
    </section>
  );
}

function CoursePortfolioPage({
  actor,
  course,
}: {
  actor: string;
  course: string;
}) {
  const { t } = useTranslation("learning");
  const [offset, setOffset] = useState(0);
  const query = useQuery(coursePortfolioQuery(actor, course, offset));
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  return (
    <>
      {!query.data.shares.length && <p>{t("portfolioSharedEmpty")}</p>}
      <ul className="learning-resources">
        {query.data.shares.map((share) => (
          <li key={share.id}>
            <h3>{share.title}</h3>
            <p>
              {share.learner} · {t("portfolioRevision", share)}
            </p>
            <p className="preserve-text">{share.body}</p>
          </li>
        ))}
      </ul>
      <div className="form-actions">
        {offset > 0 && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOffset(offset - portfolioPageSize)}
          >
            {t("gradebookPrevious")}
          </Button>
        )}
        {query.data.has_more && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOffset(offset + portfolioPageSize)}
          >
            {t("gradebookNext")}
          </Button>
        )}
      </div>
    </>
  );
}
