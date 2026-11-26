/** Browse authorised published lessons and pass an independent copy to the current draft. */
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  copyCourseLesson,
  normalizeCourseLesson,
  type CourseLesson,
} from "./course-authoring-schema";

const cataloguePage = z.strictObject({
  items: z
    .array(
      z.strictObject({
        source_run_id: z.uuid(),
        source_version: z.number().int().positive(),
        course_title: z.string(),
        module_title: z.string(),
        title: z.string(),
        lesson_id: z.uuid(),
      }),
    )
    .max(20),
  next_offset: z.number().int().positive().nullable(),
});
type CatalogueItem = z.infer<typeof cataloguePage>["items"][number];

/** Read metadata on demand and resolve lesson content only after an explicit selection. */
export function CourseCurriculumCatalogue({
  actor,
  course,
  unavailable,
  onClose,
  onCopy,
}: {
  actor: string;
  course: string;
  unavailable: boolean;
  onClose: () => void;
  onCopy: (lesson: CourseLesson) => boolean;
}) {
  const { t } = useTranslation("learning");
  const searchId = useId();
  const online = useOnline();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [invalidDraft, setInvalidDraft] = useState(false);
  const page = useQuery({
    queryKey: ["course-curriculum-catalogue", actor, course, search, offset],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc(
          "course_curriculum_catalogue",
          {
            p_run_id: course,
            p_search: search,
            p_offset: offset,
          },
          { get: true },
        )
        .abortSignal(signal);
      if (error) throw error;
      return cataloguePage.parse(data);
    },
    enabled: online,
    gcTime: 0,
    retry: false,
  });
  const transfer = useMutation({
    mutationFn: async (item: CatalogueItem) => {
      requireOnline();
      const { data, error } = await db().rpc(
        "course_curriculum_catalogue",
        {
          p_run_id: course,
          p_source_run_id: item.source_run_id,
          p_source_version: item.source_version,
          p_lesson_id: item.lesson_id,
        },
        { get: true },
      );
      if (error) throw error;
      const { lesson } = z.strictObject({ lesson: z.unknown() }).parse(data);
      return copyCourseLesson(normalizeCourseLesson(lesson));
    },
    onSuccess: (lesson) => {
      if (!unavailable && !onCopy(lesson)) setInvalidDraft(true);
    },
    onError: async () => {
      await page.refetch();
    },
  });

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    transfer.reset();
    setSearch(input.trim());
    setOffset(0);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("curriculumCatalogue")}
      description={t("curriculumCatalogueHelp")}
      closeDisabled={transfer.isPending}
    >
      {!online ? (
        <p role="status">{t("curriculumCatalogueOffline")}</p>
      ) : (
        <>
          <form className="space-y-2" onSubmit={applySearch}>
            <Field id={searchId} label={t("curriculumCatalogueSearch")}>
              <input
                type="search"
                maxLength={150}
                value={input}
                onChange={(event) => setInput(event.currentTarget.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="secondary"
              disabled={transfer.isPending}
            >
              {t("curriculumCatalogueFind")}
            </Button>
          </form>
          {unavailable && (
            <Notice kind="error">{t("curriculumCatalogueDraftChanged")}</Notice>
          )}
          {invalidDraft && (
            <Notice kind="error">{t("curriculumCatalogueInvalidDraft")}</Notice>
          )}
          {transfer.isError && (
            <Notice kind="error">
              {t("curriculumCatalogueSourceChanged")}
            </Notice>
          )}
          {page.isError ? (
            <ErrorState retry={() => void page.refetch()} />
          ) : !page.data ? (
            <Loading />
          ) : (
            <>
              {page.data.items.length === 0 ? (
                <p role="status">{t("curriculumCatalogueEmpty")}</p>
              ) : (
                <ul className="space-y-3">
                  {page.data.items.map((item) => (
                    <li
                      key={`${item.source_run_id}:${item.lesson_id}`}
                      className="space-y-1"
                    >
                      <strong>{item.title}</strong>
                      <p>
                        {t("curriculumCatalogueOrigin", {
                          course: item.course_title,
                          module: item.module_title,
                          version: item.source_version,
                        })}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={unavailable || transfer.isPending}
                        aria-label={t("curriculumCatalogueCopyNamed", {
                          title: item.title,
                          course: item.course_title,
                        })}
                        onClick={() => {
                          setInvalidDraft(false);
                          transfer.mutate(item);
                        }}
                      >
                        {t("curriculumCatalogueCopy")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="form-actions">
                {offset > 0 && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={transfer.isPending}
                    onClick={() => {
                      transfer.reset();
                      setOffset(offset - 20);
                    }}
                  >
                    {t("curriculumCatalogueBack")}
                  </Button>
                )}
                {page.data.next_offset !== null && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={transfer.isPending}
                    onClick={() => {
                      transfer.reset();
                      setOffset(page.data?.next_offset ?? offset);
                    }}
                  >
                    {t("curriculumCatalogueNext")}
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
