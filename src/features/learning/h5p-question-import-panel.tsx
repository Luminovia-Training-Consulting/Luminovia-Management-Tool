/** Review and atomically import normalized H5P questions through course-scoped bank authority. */
import { useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { questionBankKey } from "./question-bank-api";
import { H5pAttribution } from "./h5p-attribution";
import type { H5pImport } from "./h5p-import-schema";
import type { BankQuestion } from "./question-bank-schema";

export function H5pQuestionImportPanel({
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
  const fileId = useId();
  const cache = useQueryClient();
  const parse = useMutation({
    mutationFn: async (file: File) =>
      (await import("./h5p-import")).readH5pPackage(file),
  });
  const save = useMutation({
    mutationFn: async (pkg: H5pImport) => {
      requireOnline();
      const isCollection = "questions" in pkg;
      const { data, error } = await db().rpc(
        isCollection
          ? "course_h5p_collection_import"
          : "course_h5p_question_import",
        { p_run_id: courseId, p_package: pkg },
      );
      if (error) throw error;
      return (isCollection ? data.questions : [data]) as BankQuestion[];
    },
    onSuccess: () =>
      cache.invalidateQueries({ queryKey: questionBankKey(actor, courseId) }),
  });
  const reason =
    parse.error && "reason" in parse.error ? parse.error.reason : "archive";
  const preview = parse.data;
  const collection = Boolean(preview && "questions" in preview);
  const items =
    preview &&
    ("questions" in preview
      ? preview.questions
      : [{ question: preview.question, subcontent: null }]);
  return (
    <details className="space-y-2">
      <summary>{t("h5pImportTitle")}</summary>
      <p>{t("h5pImportHelp")}</p>
      <Field id={fileId} label={t("h5pImportFile")}>
        <input
          type="file"
          accept=".h5p"
          disabled={parse.isPending || save.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            save.reset();
            parse.reset();
            if (file) parse.mutate(file);
          }}
        />
      </Field>
      {parse.isPending && <p role="status">{t("h5pImportReading")}</p>}
      {parse.isError && (
        <Notice kind="error">
          {t(
            reason === "question"
              ? "h5pImportUnsupportedQuestion"
              : reason === "license"
                ? "h5pImportUnknownLicence"
                : "h5pImportInvalidArchive",
          )}
        </Notice>
      )}
      {preview && items && !save.data && (
        <>
          {collection && <p>{t("h5pCollectionConversion")}</p>}
          <ol className="space-y-2">
            {items.map(({ question, subcontent }, itemIndex) => (
              <li key={itemIndex} className="space-y-2">
                <p className="preserve-text font-medium">{question.prompt}</p>
                <ol className="list-decimal ps-6">
                  {question.options.map((option, index) => (
                    <li key={option}>
                      {index === question.correct ? (
                        <strong>{option}</strong>
                      ) : (
                        option
                      )}
                    </li>
                  ))}
                </ol>
                <p>
                  {t("correctAnswer")}: {question.options[question.correct]}
                </p>
                {subcontent && (
                  <H5pAttribution credits={subcontent} questionSource />
                )}
              </li>
            ))}
          </ol>
          <H5pAttribution credits={preview.attribution} />
          <Button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate(preview)}
          >
            {t(collection ? "h5pImportCollectionSave" : "h5pImportSave")}
          </Button>
        </>
      )}
      {save.isError && <Notice kind="error">{t("saveError")}</Notice>}
      {save.data && (
        <>
          <Notice>
            {collection
              ? t("h5pImportCollectionSaved", { count: save.data.length })
              : t(
                  save.data[0].archived
                    ? "h5pImportArchived"
                    : "h5pImportSaved",
                )}
          </Notice>
          <ul className="space-y-2">
            {save.data.map((question) => (
              <li
                key={question.id}
                className="flex flex-wrap items-center gap-2"
              >
                {collection && <span>{question.content.prompt}</span>}
                {question.archived ? (
                  collection && <p>{t("h5pImportArchived")}</p>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canSelect || selected.has(question.id)}
                    onClick={() => onSelect(question)}
                  >
                    {t("questionBankUse")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
