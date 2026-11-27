import { useTranslation } from "react-i18next";
import { Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { dateTime } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import type { useCourseBulkArchive } from "./use-course-bulk-archive";
import type { CourseBulkArchiveItem } from "./course-bulk-archive-schema";
import "./i18n";

type ArchiveControls = ReturnType<typeof useCourseBulkArchive>;

export function CourseBulkArchiveSelection({
  item,
  controls,
}: {
  item: CourseBulkArchiveItem;
  controls: ArchiveControls;
}) {
  const { t } = useTranslation("operations");
  const checked = controls.selected.has(item.id);
  return (
    <label className="checkbox-label">
      <input
        type="checkbox"
        checked={checked}
        disabled={!checked && controls.selected.size >= 50}
        aria-label={t("bulkSelectCourse", {
          title: item.title,
          company: item.organisation_name,
        })}
        onChange={(event) =>
          controls.setSelected(item, event.currentTarget.checked)
        }
      />
      {t("bulkSelect")}
    </label>
  );
}

export function CourseBulkArchiveActions({
  controls,
}: {
  controls: ArchiveControls;
}) {
  const { t, i18n } = useTranslation("operations");
  const online = useOnline();
  const { selection, preview, save } = controls;
  if (!selection.length) return null;
  return (
    <>
      <div className="page-actions">
        <span aria-live="polite">
          {t("bulkCoursesSelected", { count: selection.length })}
        </span>
        {[true, false].map((archive) => (
          <Button
            key={String(archive)}
            type="button"
            variant="secondary"
            disabled={
              !online ||
              selection.length < 2 ||
              selection.some((item) => Boolean(item.archived_at) === archive)
            }
            onClick={() => controls.review(archive)}
          >
            {t(archive ? "bulkArchiveReview" : "bulkRestoreReview")}
          </Button>
        ))}
        <Button variant="ghost" type="button" onClick={controls.clear}>
          {t("bulkClearSelection")}
        </Button>
      </div>
      <Dialog
        open={Boolean(preview)}
        title={t(preview?.archive ? "bulkArchiveReview" : "bulkRestoreReview")}
        description={t("bulkReviewHelp")}
        closeDisabled={save.isPending}
        onOpenChange={(open) => {
          if (!open && !save.isPending) controls.close();
        }}
      >
        {preview && (
          <>
            <ul>
              {preview.items.map((item) => (
                <li key={item.id}>
                  {item.title} · {item.organisation_name}
                  {item.starts_at && (
                    <>
                      {" "}
                      ·{" "}
                      {dateTime(item.starts_at, i18n.language, item.time_zone)}
                    </>
                  )}
                </li>
              ))}
            </ul>
            {save.isError && (
              <Notice kind="error">{t("bulkArchiveFailed")}</Notice>
            )}
            <Button
              disabled={!online || save.isPending || save.isError}
              onClick={() => save.mutate(preview)}
            >
              {t("bulkArchiveConfirm")}
            </Button>
          </>
        )}
      </Dialog>
    </>
  );
}
