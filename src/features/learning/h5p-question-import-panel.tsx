/** Preview and explicitly import a text H5P question through the normal bank authority. */
import { useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { questionBankKey } from "./question-bank-api";
import { H5pAttribution } from "./h5p-attribution";
import type { H5pQuestionImport } from "./h5p-import-schema";
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
      (await import("./h5p-import")).readH5pQuestion(file),
  });
  const save = useMutation({
    mutationFn: async (pkg: H5pQuestionImport) => {
      requireOnline();
      const { data, error } = await db().rpc("course_h5p_question_import", {
        p_run_id: courseId,
        p_package: pkg,
      });
      if (error) throw error;
      return data as BankQuestion;
    },
    onSuccess: () =>
      cache.invalidateQueries({ queryKey: questionBankKey(actor, courseId) }),
  });
  const reason =
    parse.error && "reason" in parse.error ? parse.error.reason : "archive";
  const preview = parse.data;
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
      {preview && !save.data && (
        <>
          <p className="preserve-text">{preview.question.prompt}</p>
          <ol className="list-decimal ps-6">
            {preview.question.options.map((option, index) => (
              <li key={index}>
                {index === preview.question.correct ? (
                  <strong>{option}</strong>
                ) : (
                  option
                )}
              </li>
            ))}
          </ol>
          <p>
            {t("correctAnswer")}:{" "}
            {preview.question.options[preview.question.correct]}
          </p>
          <H5pAttribution credits={preview.attribution} />
          <Button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate(preview)}
          >
            {t("h5pImportSave")}
          </Button>
        </>
      )}
      {save.isError && <Notice kind="error">{t("saveError")}</Notice>}
      {save.data && (
        <>
          <Notice>
            {t(save.data.archived ? "h5pImportArchived" : "h5pImportSaved")}
          </Notice>
          {!save.data.archived && (
            <Button
              type="button"
              variant="secondary"
              disabled={!canSelect || selected.has(save.data.id)}
              onClick={() => {
                if (save.data) onSelect(save.data);
              }}
            >
              {t("questionBankUse")}
            </Button>
          )}
        </>
      )}
    </details>
  );
}
