/** Structured plain-text teaching blocks share the current lesson draft and preview. */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "../../components/common";
import { Button } from "../../components/ui/button";
import {
  lessonBlockKinds,
  maxLessonBlocks,
  newCourseContentId,
  type CourseLessonBlock,
} from "./course-authoring-schema";

export function CourseLessonBlockEditor({
  blocks,
  onChange,
  pending,
  move,
}: {
  blocks: CourseLessonBlock[];
  onChange: (blocks: CourseLessonBlock[]) => void;
  pending: boolean;
  move: (
    items: CourseLessonBlock[],
    index: number,
    direction: -1 | 1,
  ) => CourseLessonBlock[];
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const revise = (index: number, patch: Partial<CourseLessonBlock>) =>
    onChange(
      blocks.map((block, position) =>
        position === index ? { ...block, ...patch } : block,
      ),
    );
  return (
    <details>
      <summary>{t("lessonBlocks")}</summary>
      {blocks.map((block, index) => {
        const field = id + "-" + block.id;
        return (
          <fieldset key={block.id} disabled={pending}>
            <legend>
              {block.title.trim() || t("lessonBlock_" + block.kind)}
            </legend>
            <Field id={field + "-kind"} label={t("lessonBlockType")}>
              <select
                value={block.kind}
                onChange={(event) => {
                  const kind = lessonBlockKinds.find(
                    (option) => option === event.currentTarget.value,
                  );
                  if (!kind) return;
                  revise(index, {
                    kind,
                    ...(kind !== "practice" && { answer: undefined }),
                  });
                }}
              >
                {lessonBlockKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {t("lessonBlock_" + kind)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={field + "-title"} label={t("lessonBlockTitle")}>
              <input
                value={block.title}
                maxLength={120}
                onChange={(event) =>
                  revise(index, { title: event.currentTarget.value })
                }
              />
            </Field>
            <Field id={field + "-text"} label={t("lessonBlockText")}>
              <textarea
                value={block.text}
                maxLength={4000}
                rows={3}
                onChange={(event) =>
                  revise(index, { text: event.currentTarget.value })
                }
              />
            </Field>
            {block.kind === "practice" && (
              <Field id={field + "-answer"} label={t("lessonBlockAnswer")}>
                <textarea
                  value={block.answer ?? ""}
                  maxLength={4000}
                  rows={3}
                  onChange={(event) =>
                    revise(index, { answer: event.currentTarget.value })
                  }
                />
              </Field>
            )}
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={index === 0}
                onClick={() => onChange(move(blocks, index, -1))}
              >
                {t("lessonBlockUp")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={index === blocks.length - 1}
                onClick={() => onChange(move(blocks, index, 1))}
              >
                {t("lessonBlockDown")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  onChange(blocks.filter(({ id }) => id !== block.id))
                }
              >
                {t("lessonBlockRemove")}
              </Button>
            </div>
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="secondary"
        disabled={pending || blocks.length >= maxLessonBlocks}
        onClick={() =>
          onChange([
            ...blocks,
            { id: newCourseContentId(), kind: "note", title: "", text: "" },
          ])
        }
      >
        {t("lessonBlockAdd")}
      </Button>
    </details>
  );
}

export function CourseLessonBlockContent({
  block,
}: {
  block: CourseLessonBlock;
}) {
  const { t } = useTranslation("learning");
  if (!block.text.trim()) return null;
  return (
    <section>
      <h5>{block.title.trim() || t("lessonBlock_" + block.kind)}</h5>
      {block.kind === "checklist" ? (
        <ul>
          {block.text
            .split("\n")
            .map(
              (line, index) =>
                line.trim() && <li key={index}>{line.trim()}</li>,
            )}
        </ul>
      ) : (
        <p className="preserve-text">{block.text}</p>
      )}
      {block.kind === "practice" && block.answer?.trim() && (
        <details>
          <summary>{t("lessonBlockAnswer")}</summary>
          <p className="preserve-text">{block.answer}</p>
        </details>
      )}
    </section>
  );
}
