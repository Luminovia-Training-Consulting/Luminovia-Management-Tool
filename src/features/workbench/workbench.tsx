// Personal tasks, delegated operations, workflows and favorites share this view.
// Every mutation waits for authoritative online confirmation and version checks.
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DateTime } from "luxon";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { useAuth } from "../auth/auth-context";
import { profileQuery, topicsQuery } from "../../lib/queries";
import { dateTime, zonedInstant } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import {
  applyTemplate,
  bulkTaskState,
  favouritesQuery,
  recommendationsQuery,
  saveTask,
  saveTemplate,
  setFavourite,
  taskHistoryQuery,
  tasksQuery,
  workKeys,
  workTaskDetailQuery,
  type WorkTask,
  type WorkTemplate,
} from "./api";
import "./i18n";
import "./workbench.css";
const states = ["open", "doing", "done", "cancelled"] as const;
function conflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "40001"
  );
}
function TaskEditor({
  actor,
  task: inputTask,
  source,
  zone,
  canManage,
  assignees,
  saved,
}: {
  actor: string;
  task: WorkTask | null;
  source: string | null;
  zone: string;
  canManage: boolean;
  assignees: { id: string; name: string }[];
  saved: () => void;
}) {
  const { t } = useTranslation("workbench");
  // Freeze the opening revision: background refetches must not silently replace
  // the expected CAS version underneath an unchanged editing draft.
  const [task] = useState(inputTask);
  const online = useOnline();
  const [requestId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [state, setState] = useState<WorkTask["state"]>(task?.state ?? "open");
  const [scope, setScope] = useState(task?.scope ?? "private");
  const [assignee, setAssignee] = useState(task?.assignee_id ?? actor);
  const [timeZone, setTimeZone] = useState(task?.time_zone ?? zone);
  const [due, setDue] = useState(
    task?.due_at
      ? DateTime.fromISO(task.due_at)
          .setZone(task.time_zone)
          .toFormat("yyyy-MM-dd'T'HH:mm")
      : "",
  );
  const editable = !task || task.creator_id === actor || canManage;
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      const dueAt = due ? zonedInstant(due, timeZone) : null;
      if (due && !dueAt) throw new Error("invalid_due_time");
      const payload = {
        title: title.trim(),
        description,
        state,
        scope,
        assignee_id: scope === "private" ? actor : assignee,
        due_at: dueAt,
        time_zone: timeZone,
        source_message_id: task?.source_message_id ?? source,
      };
      if (!payload.title) throw new Error("invalid_title");
      return saveTask(
        task?.id ?? null,
        payload,
        task?.version ?? 0,
        task ? null : requestId,
      );
    },
    onSuccess: saved,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      className="form-stack"
    >
      {(source || task?.source_message_id) && <p>{t("sourceHint")}</p>}
      <fieldset disabled={save.isPending}>
        <legend className="sr-only">{t(task ? "editTask" : "newTask")}</legend>
        <Field id="work-task-title" label={t("titleField")}>
          <input
            id="work-task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            disabled={!editable}
          />
        </Field>
        <Field id="work-task-description" label={t("description")}>
          <textarea
            id="work-task-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={8000}
            rows={3}
            disabled={!editable}
          />
        </Field>
        <Field id="work-task-state" label={t("state")}>
          <select
            id="work-task-state"
            value={state}
            onChange={(e) => setState(e.target.value as WorkTask["state"])}
          >
            {states.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-row">
          <Field id="work-task-due" label={t("due")}>
            <input
              id="work-task-due"
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              disabled={!editable}
            />
          </Field>
          <Field id="work-task-zone" label={t("zone")}>
            <input
              id="work-task-zone"
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
              disabled={!editable}
            />
          </Field>
        </div>
        {canManage && !source && !task?.source_message_id && (
          <>
            <Field id="work-task-scope" label={t("scope")}>
              <select
                id="work-task-scope"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as WorkTask["scope"]);
                  if (e.target.value === "private") setAssignee(actor);
                }}
              >
                <option value="private">{t("private")}</option>
                {task?.scope !== "private" && (
                  <option value="operations">{t("operations")}</option>
                )}
              </select>
            </Field>
            {scope === "operations" && (
              <Field id="work-task-assignee" label={t("assignee")}>
                <select
                  id="work-task-assignee"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  {assignees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </>
        )}
      </fieldset>
      {save.isError && (
        <Notice kind="error">
          {t(conflict(save.error) ? "conflict" : "error")}
        </Notice>
      )}
      <Button disabled={!online || save.isPending}>{t("save")}</Button>
    </form>
  );
}
function TemplateEditor({
  template,
  canManage,
  saved,
}: {
  template: WorkTemplate | null;
  canManage: boolean;
  saved: () => void;
}) {
  const { t } = useTranslation("workbench");
  const online = useOnline();
  const [title, setTitle] = useState(template?.title ?? "");
  const [shared, setShared] = useState(template?.shared ?? false);
  const [archived, setArchived] = useState(template?.archived ?? false);
  const [items, setItems] = useState(() =>
    (template?.items ?? [{ title: "", days: 0 }]).map((item) => ({
      ...item,
      key: crypto.randomUUID(),
    })),
  );
  const save = useMutation({
    mutationFn: () =>
      saveTemplate(
        template?.id ?? null,
        {
          title,
          shared,
          archived,
          items: items.map(({ title, days }) => ({ title, days })),
        },
        template?.version ?? 0,
      ),
    onSuccess: saved,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      className="form-stack"
    >
      <fieldset disabled={save.isPending}>
        <legend className="sr-only">{t("templates")}</legend>
        <Field id="workflow-title" label={t("templateTitle")}>
          <input
            id="workflow-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
          />
        </Field>
        {canManage && (
          <label>
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
            />
            {t("shared")}
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          {t("archived")}
        </label>
        <h3>{t("steps")}</h3>
        {items.map((item, index) => (
          <div className="panel" key={item.key}>
            <Field
              id={`workflow-step-${item.key}`}
              label={`${t("step")} ${index + 1}`}
            >
              <input
                id={`workflow-step-${item.key}`}
                value={item.title}
                maxLength={200}
                required
                onChange={(e) =>
                  setItems((old) =>
                    old.map((row) =>
                      row.key === item.key
                        ? { ...row, title: e.target.value }
                        : row,
                    ),
                  )
                }
              />
            </Field>
            <Field id={`workflow-days-${item.key}`} label={t("days")}>
              <input
                id={`workflow-days-${item.key}`}
                type="number"
                min={0}
                max={365}
                value={item.days}
                onChange={(e) =>
                  setItems((old) =>
                    old.map((row) =>
                      row.key === item.key
                        ? { ...row, days: Number(e.target.value) }
                        : row,
                    ),
                  )
                }
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              disabled={items.length === 1}
              onClick={() =>
                setItems((old) => old.filter((row) => row.key !== item.key))
              }
            >
              {t("removeStep")}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={items.length >= 30}
          onClick={() =>
            setItems((old) => [
              ...old,
              { key: crypto.randomUUID(), title: "", days: 0 },
            ])
          }
        >
          {t("addStep")}
        </Button>
      </fieldset>
      {save.isError && (
        <Notice kind="error">
          {t(conflict(save.error) ? "conflict" : "error")}
        </Notice>
      )}
      <Button disabled={!online || save.isPending}>{t("saveTemplate")}</Button>
    </form>
  );
}
function Favourites({ actor }: { actor: string }) {
  const { t, i18n } = useTranslation("workbench");
  const client = useQueryClient();
  const online = useOnline();
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [favouriteKind, setFavouriteKind] = useState<"topic" | "organisation">(
    "topic",
  );
  const [choice, setChoice] = useState("");
  const query = useQuery(favouritesQuery(actor, appliedSearch));
  const topics = useQuery(topicsQuery);
  const recommendations = useQuery(recommendationsQuery(actor));
  const save = useMutation({
    mutationFn: ({
      kind,
      id,
      enabled,
    }: {
      kind: "topic" | "organisation";
      id: string;
      enabled: boolean;
    }) => setFavourite(kind, id, enabled),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["favourites", actor] }),
        client.invalidateQueries({ queryKey: ["job-recommendations", actor] }),
      ]),
  });
  return (
    <>
      <section className="panel">
        <h2>{t("favourites")}</h2>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : (
          <>
            <div className="form-row">
              <Field id="favourite-kind" label={t("favourites")}>
                <select
                  id="favourite-kind"
                  value={favouriteKind}
                  onChange={(e) => {
                    setFavouriteKind(
                      e.target.value as "topic" | "organisation",
                    );
                    setChoice("");
                  }}
                >
                  <option value="topic">{t("topics")}</option>
                  <option value="organisation">{t("organisations")}</option>
                </select>
              </Field>
              <Field
                id="favourite-resource"
                label={t(
                  favouriteKind === "topic" ? "searchTopics" : "organisations",
                )}
              >
                <select
                  id="favourite-resource"
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  <option value="">{t("pick")}</option>
                  {(favouriteKind === "topic"
                    ? (topics.data ?? [])
                        .filter((topic) => !topic.archived_at)
                        .map((topic) => ({
                          id: topic.id,
                          label:
                            i18n.language === "en"
                              ? topic.label_en
                              : topic.label_de,
                        }))
                    : query.data.organisations
                  ).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                disabled={!online || !choice || save.isPending}
                onClick={() =>
                  save.mutate({
                    kind: favouriteKind,
                    id: choice,
                    enabled: true,
                  })
                }
              >
                {t("addFavourite")}
              </Button>
            </div>
            {favouriteKind === "organisation" && (
              <form
                className="form-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  setAppliedSearch(search);
                }}
              >
                <Field id="favourite-search" label={t("searchCustomers")}>
                  <input
                    id="favourite-search"
                    value={search}
                    maxLength={100}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </Field>
                <Button variant="secondary">{t("refresh")}</Button>
              </form>
            )}
            {!query.data.items.length ? (
              <p>{t("emptyFavourites")}</p>
            ) : (
              <ul>
                {query.data.items.map((item) => (
                  <li key={`${item.kind}-${item.id}`}>
                    <span>{item.label}</span>{" "}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!online || save.isPending}
                      onClick={() =>
                        save.mutate({
                          kind: item.kind,
                          id: item.id,
                          enabled: false,
                        })
                      }
                    >
                      {t("removeFavourite")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {save.isError && <Notice kind="error">{t("error")}</Notice>}
      </section>
      <section className="panel">
        <h2>{t("recommendations")}</h2>
        <p>{t("recommendationHint")}</p>
        {recommendations.isPending ? (
          <Loading />
        ) : recommendations.isError ? (
          <ErrorState retry={() => void recommendations.refetch()} />
        ) : !recommendations.data.length ? (
          <p>{t("noRecommendations")}</p>
        ) : (
          <ul>
            {recommendations.data.map((job) => (
              <li key={job.id}>
                <Link to={`/jobs/${job.id}`}>{job.title}</Link>
                <p>
                  {job.customer} ·{" "}
                  {dateTime(job.starts_at, i18n.language, job.time_zone)}
                </p>
                <p>
                  {t("matches", { count: job.topic_matches })}
                  {job.favourite_topic ? ` · ${t("favTopic")}` : ""}
                  {job.favourite_customer ? ` · ${t("favCustomer")}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
export function WorkbenchPage() {
  const { t, i18n } = useTranslation("workbench");
  const actor = useAuth().session!.user.id;
  const client = useQueryClient();
  const online = useOnline();
  const [state, setState] = useState("");
  const query = useInfiniteQuery(tasksQuery(actor, state));
  const profile = useQuery(profileQuery(actor));
  const [params, setParams] = useSearchParams();
  const rawSource = params.get("message");
  const rawTask = params.get("task");
  const taskId = z.string().uuid().safeParse(rawTask).success ? rawTask : null;
  const detail = useQuery(workTaskDetailQuery(actor, taskId));
  const source = z.string().uuid().safeParse(rawSource).success
    ? taskId
      ? null
      : rawSource
    : null;
  const [editor, setEditor] = useState<WorkTask | null | undefined>(undefined);
  const editingTask =
    editor !== undefined
      ? editor
      : !detail.isError && taskId
        ? (detail.data ?? undefined)
        : undefined;
  const [template, setTemplate] = useState<WorkTemplate | null | undefined>(
    undefined,
  );
  const [history, setHistory] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const historyQuery = useQuery(taskHistoryQuery(actor, history));
  const requestIds = useRef(new Map<string, string>());
  const page = query.isError ? undefined : query.data?.pages[0];
  const tasks = [
    ...new Map(
      (query.data?.pages ?? [])
        .flatMap((part) => part.items)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: workKeys(actor) }),
      client.invalidateQueries({ queryKey: ["work-task-history", actor] }),
      client.invalidateQueries({ queryKey: ["work-task-detail", actor] }),
    ]);
  const bulk = useMutation({
    mutationFn: (state: WorkTask["state"]) =>
      bulkTaskState(
        Object.entries(selected).map(([id, version]) => ({ id, version })),
        state,
      ),
    onSuccess: async () => {
      setSelected({});
      await refresh();
    },
  });
  const apply = useMutation({
    mutationFn: (value: WorkTemplate) => {
      const key = `${value.id}-${value.version}`;
      let request = requestIds.current.get(key);
      if (!request) {
        request = crypto.randomUUID();
        requestIds.current.set(key, request);
      }
      return applyTemplate(value.id, value.version, request);
    },
    onSuccess: async (_data, value) => {
      requestIds.current.delete(`${value.id}-${value.version}`);
      await refresh();
    },
  });
  const closeEditor = () => {
    setEditor(undefined);
    if (rawSource || rawTask) {
      const next = new URLSearchParams(params);
      next.delete("message");
      next.delete("task");
      setParams(next, { replace: true });
    }
  };
  return (
    <>
      <PageHeading title={t("title")} description={t("intro")} />
      {taskId && detail.isPending && <Loading />}
      {taskId && detail.isError && (
        <ErrorState retry={() => void detail.refetch()} />
      )}
      {rawTask && (!taskId || (detail.isSuccess && !detail.data)) && (
        <Notice kind="error">{t("taskUnavailable")}</Notice>
      )}
      <section className="panel">
        <h2>{t("tasks")}</h2>
        <div className="form-actions">
          <Button onClick={() => setEditor(null)} disabled={!online}>
            {t("newTask")}
          </Button>
          <Field id="work-task-filter" label={t("state")}>
            <select
              id="work-task-filter"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setSelected({});
              }}
            >
              <option value="">{t("all")}</option>
              {states.map((item) => (
                <option value={item} key={item}>
                  {t(item)}
                </option>
              ))}
            </select>
          </Field>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t("refresh")}
          </Button>
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : !tasks.length ? (
          <p>{t("empty")}</p>
        ) : (
          <ul className="work-task-list">
            {tasks.map((task) => (
              <li key={task.id} className="panel">
                <label>
                  <input
                    type="checkbox"
                    checked={task.id in selected}
                    onChange={(e) =>
                      setSelected((old) => {
                        const next = { ...old };
                        if (e.target.checked) next[task.id] = task.version;
                        else delete next[task.id];
                        return next;
                      })
                    }
                    disabled={
                      bulk.isPending ||
                      (!(task.id in selected) &&
                        Object.keys(selected).length >= 50)
                    }
                    aria-label={t("select", { title: task.title })}
                  />
                  <strong>{task.title}</strong>
                </label>
                <p>
                  {t(task.state)} · {task.assignee_name} · {t(task.scope)}
                </p>
                {task.due_at && (
                  <p>
                    {t("due")}:{" "}
                    {dateTime(task.due_at, i18n.language, task.time_zone)}
                  </p>
                )}
                {task.description && (
                  <p className="preserve-whitespace">{task.description}</p>
                )}
                <div className="form-actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditor(task)}
                    disabled={!online}
                  >
                    {t("editTask")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setHistory(task.id)}
                  >
                    {t("history")}
                  </Button>
                  {task.source_room_id && (
                    <Link to={`/chats?room=${task.source_room_id}`}>
                      {t("source")}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {query.hasNextPage && (
          <Button
            variant="secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t("more")}
          </Button>
        )}
        {Object.keys(selected).length > 0 && (
          <section aria-label={t("bulk")}>
            <p>{t("bulkHint")}</p>
            <Button
              disabled={!online || bulk.isPending}
              onClick={() => bulk.mutate("done")}
            >
              {t("bulkDone")}
            </Button>{" "}
            <Button
              variant="secondary"
              disabled={!online || bulk.isPending}
              onClick={() => bulk.mutate("open")}
            >
              {t("bulkOpen")}
            </Button>
          </section>
        )}
        {bulk.isError && (
          <Notice kind="error">
            {t(conflict(bulk.error) ? "conflict" : "error")}
          </Notice>
        )}
        {bulk.isSuccess && <Notice>{t("saved")}</Notice>}
      </section>
      <section className="panel">
        <h2>{t("templates")}</h2>
        <p>{t("templateHint")}</p>
        <Button disabled={!online} onClick={() => setTemplate(null)}>
          {t("newTemplate")}
        </Button>
        {page?.templates.length ? (
          <ul>
            {page.templates.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                {item.archived ? ` · ${t("archived")}` : ""}
                <p>
                  {item.items.length} · {t(item.shared ? "shared" : "private")}
                </p>
                <div className="form-actions">
                  {item.can_edit && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!online}
                      onClick={() => setTemplate(item)}
                    >
                      {t("editTemplate")}
                    </Button>
                  )}
                  {!item.archived && (
                    <Button
                      size="sm"
                      disabled={!online || apply.isPending}
                      onClick={() => apply.mutate(item)}
                    >
                      {t("apply")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("noneTemplates")}</p>
        )}
        {apply.isError && (
          <Notice kind="error">
            {t(conflict(apply.error) ? "conflict" : "error")}
          </Notice>
        )}
        {apply.isSuccess && <Notice>{t("templateApplied")}</Notice>}
      </section>
      <Favourites actor={actor} />
      <Dialog
        open={editingTask !== undefined || Boolean(source)}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        title={t(
          source ? "newFromMessage" : editingTask ? "editTask" : "newTask",
        )}
        description={t("intro")}
      >
        {(editingTask !== undefined || source) && (
          <TaskEditor
            key={editingTask?.id ?? source ?? "new"}
            actor={actor}
            task={editingTask ?? null}
            source={source}
            zone={profile.data?.time_zone ?? "Europe/Berlin"}
            canManage={page?.can_manage ?? false}
            assignees={page?.assignees ?? []}
            saved={() => {
              closeEditor();
              void refresh();
            }}
          />
        )}
        {editingTask && (
          <Button
            variant="ghost"
            onClick={() => {
              const id = editingTask.id;
              closeEditor();
              setHistory(id);
            }}
          >
            {t("history")}
          </Button>
        )}
      </Dialog>
      <Dialog
        open={template !== undefined}
        onOpenChange={(open) => {
          if (!open) setTemplate(undefined);
        }}
        title={t(template ? "editTemplate" : "newTemplate")}
        description={t("templateHint")}
      >
        {template !== undefined && (
          <TemplateEditor
            key={template?.id ?? "new"}
            template={template}
            canManage={page?.can_manage ?? false}
            saved={() => {
              setTemplate(undefined);
              void refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={history !== null}
        onOpenChange={(open) => {
          if (!open) setHistory(null);
        }}
        title={t("history")}
        description={t("historyHint")}
      >
        {historyQuery.isPending ? (
          <Loading />
        ) : historyQuery.isError ? (
          <ErrorState retry={() => void historyQuery.refetch()} />
        ) : (
          <ol>
            {historyQuery.data.map((item) => (
              <li key={item.id}>
                <time>
                  {dateTime(
                    item.at,
                    i18n.language,
                    profile.data?.time_zone ?? "Europe/Berlin",
                  )}
                </time>
                <p>
                  {t("historyBefore")}:{" "}
                  {item.before
                    ? `${item.before.title} · ${t(item.before.state)}`
                    : "—"}
                </p>
                <p>
                  {t("historyAfter")}: {item.after.title} ·{" "}
                  {t(item.after.state)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Dialog>
    </>
  );
}
