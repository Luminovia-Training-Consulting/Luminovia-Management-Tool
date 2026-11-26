/** Organization-scoped reusable objective questions, embedded beside the quiz form. */
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import {
  questionBankAction,
  questionBankKey,
  questionBankQuery,
} from "./question-bank-api";
import {
  bankQuestionContentSchema,
  questionBankPageSize,
  questionDifficulties,
  type BankQuestion,
  type BankQuestionContent,
} from "./question-bank-schema";
import "./question-bank-i18n";

const difficultyLabels = {
  introductory: "questionBankIntroductory",
  intermediate: "questionBankIntermediate",
  advanced: "questionBankAdvanced",
} as const;

type QuestionDraft = BankQuestionContent & { id: string; revision: number };

const makeDraft = (question?: BankQuestion): QuestionDraft =>
  question
    ? {
        id: question.id,
        revision: question.revision,
        topic: question.topic,
        difficulty: question.difficulty,
        content: question.content,
      }
    : {
        id: crypto.randomUUID(),
        revision: 0,
        topic: "",
        difficulty: "introductory",
        content: { prompt: "", options: ["", ""], correct: 0 },
      };

export function QuestionBank({
  actor,
  courseId,
  selected,
  canSelect,
  onSelect,
}: {
  actor: string;
  courseId: string;
  selected: ReadonlySet<string>;
  canSelect: boolean;
  onSelect: (question: BankQuestion) => void;
}) {
  const { t } = useTranslation("learning");
  const [open, setOpen] = useState(false);
  const online = useOnline();
  return (
    <details
      className="space-y-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("questionBank")}</summary>
      {open &&
        (online ? (
          <OpenQuestionBank
            actor={actor}
            courseId={courseId}
            selected={selected}
            canSelect={canSelect}
            onSelect={onSelect}
          />
        ) : (
          <p role="status">{t("questionBankUnavailable")}</p>
        ))}
    </details>
  );
}

/** The sensitive query runs only while the actor is online and the bank is open. */
function OpenQuestionBank({
  actor,
  courseId,
  selected,
  canSelect,
  onSelect,
}: {
  actor: string;
  courseId: string;
  selected: ReadonlySet<string>;
  canSelect: boolean;
  onSelect: (question: BankQuestion) => void;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const cache = useQueryClient();
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState<QuestionDraft | null>(null);
  const [invalid, setInvalid] = useState(false);
  const bank = useQuery(
    questionBankQuery(actor, courseId, search.trim(), archived, offset),
  );
  const save = useMutation({
    mutationFn: ({
      action,
      payload,
      revision,
    }: {
      action: "save" | "set_archived";
      payload: Record<string, unknown>;
      revision: number;
    }) => questionBankAction(courseId, action, payload, revision),
    onSuccess: async () => {
      setDraft(null);
      setOffset(0);
      await cache.invalidateQueries({
        queryKey: questionBankKey(actor, courseId),
      });
    },
  });
  const conflict =
    typeof save.error === "object" &&
    save.error !== null &&
    "code" in save.error &&
    save.error.code === "PT409";

  function edit(question?: BankQuestion) {
    save.reset();
    setInvalid(false);
    setDraft(makeDraft(question));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || save.isPending || conflict) return;
    const { id: questionId, revision, ...candidate } = draft;
    const parsed = bankQuestionContentSchema.safeParse(candidate);
    setInvalid(!parsed.success);
    if (parsed.success)
      save.mutate({
        action: "save",
        revision,
        payload: { id: questionId, ...parsed.data },
      });
  }

  return (
    <>
      <Field id={id + "-search"} label={t("questionBankSearch")}>
        <input
          type="search"
          value={search}
          maxLength={120}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
      </Field>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={archived}
          onChange={(event) => {
            setArchived(event.target.checked);
            setOffset(0);
          }}
        />
        {t("questionBankIncludeArchived")}
      </label>
      <Button
        type="button"
        variant="secondary"
        onClick={() => edit()}
        disabled={save.isPending}
      >
        {t("questionBankAdd")}
      </Button>
      {draft && (
        <form className="learning-quiz-editor" onSubmit={submit}>
          <fieldset disabled={save.isPending || conflict}>
            <legend>
              {t(draft.revision ? "questionBankEdit" : "questionBankAdd")}
            </legend>
            <label>
              {t("questionBankTopic")}
              <input
                required
                value={draft.topic}
                maxLength={120}
                onChange={(event) =>
                  setDraft({ ...draft, topic: event.target.value })
                }
              />
            </label>
            <label>
              {t("questionBankDifficulty")}
              <select
                value={draft.difficulty}
                onChange={(event) => {
                  const difficulty = questionDifficulties.find(
                    (value) => value === event.target.value,
                  );
                  if (difficulty) setDraft({ ...draft, difficulty });
                }}
              >
                {questionDifficulties.map((value) => (
                  <option key={value} value={value}>
                    {t(difficultyLabels[value])}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("prompt")}
              <input
                required
                value={draft.content.prompt}
                maxLength={500}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    content: { ...draft.content, prompt: event.target.value },
                  })
                }
              />
            </label>
            <label>
              {t("options")}
              <textarea
                required
                value={draft.content.options.join("\n")}
                maxLength={1805}
                onChange={(event) => {
                  const options = event.target.value.split("\n");
                  setDraft({
                    ...draft,
                    content: {
                      ...draft.content,
                      options,
                      correct: Math.min(
                        draft.content.correct,
                        options.length - 1,
                      ),
                    },
                  });
                }}
              />
            </label>
            <label>
              {t("correctAnswer")}
              <select
                value={draft.content.correct}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    content: {
                      ...draft.content,
                      correct: Number(event.target.value),
                    },
                  })
                }
              >
                {draft.content.options.map((option, position) => (
                  <option key={position} value={position}>
                    {position + 1}. {option}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">{t("questionBankSave")}</Button>
          </fieldset>
          <Button
            type="button"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => {
              save.reset();
              setDraft(null);
            }}
          >
            {t("questionBankCancel")}
          </Button>
        </form>
      )}
      {invalid && draft && (
        <Notice kind="error">{t("questionBankInvalid")}</Notice>
      )}
      {save.isError && (
        <Notice kind="error">
          {t(conflict ? "questionBankConflict" : "saveError")}
          {conflict && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                save.reset();
                setDraft(null);
                void bank.refetch();
              }}
            >
              {t("questionBankReload")}
            </Button>
          )}
        </Notice>
      )}
      {save.isSuccess && <Notice>{t("saved")}</Notice>}
      {bank.isPending ? (
        <Loading />
      ) : bank.isError ? (
        <ErrorState retry={() => void bank.refetch()} />
      ) : (
        <>
          {!bank.data.items.length && <p>{t("questionBankEmpty")}</p>}
          <ul className="learning-resources">
            {bank.data.items.map((question) => (
              <li key={question.id} className="space-y-2">
                <strong>{question.content.prompt}</strong>
                <p>
                  {question.topic} · {t(difficultyLabels[question.difficulty])}{" "}
                  · {t("questionBankRevision", { revision: question.revision })}
                </p>
                {question.archived && <p>{t("questionBankArchived")}</p>}
                <div className="flex flex-wrap gap-2">
                  {!question.archived && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onSelect(question)}
                      disabled={!canSelect || selected.has(question.id)}
                    >
                      {t("questionBankUse")}
                    </Button>
                  )}
                  {question.can_edit && !question.archived && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => edit(question)}
                      disabled={save.isPending}
                    >
                      {t("questionBankEdit")}
                    </Button>
                  )}
                  {question.can_edit && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={save.isPending}
                      onClick={() =>
                        save.mutate({
                          action: "set_archived",
                          revision: question.revision,
                          payload: {
                            id: question.id,
                            archived: !question.archived,
                          },
                        })
                      }
                    >
                      {t(
                        question.archived
                          ? "questionBankRestore"
                          : "questionBankArchive",
                      )}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {offset > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOffset(offset - questionBankPageSize)}
              >
                {t("questionBankPrevious")}
              </Button>
            )}
            {bank.data.has_more && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOffset(offset + questionBankPageSize)}
              >
                {t("questionBankNext")}
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}
