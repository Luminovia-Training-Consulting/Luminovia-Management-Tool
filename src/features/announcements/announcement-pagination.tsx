/** Cursor controls shared by the published and administrative announcement lists. */
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import type { AnnouncementCursor } from "./api";
import type { useAnnouncementPagination } from "./pagination-state";

/** Disable paging while the list refreshes and advance only with a server-supplied cursor. */
export function AnnouncementPagination({
  label,
  pagination,
  nextCursor,
  busy,
}: {
  label: string;
  pagination: ReturnType<typeof useAnnouncementPagination>;
  nextCursor: AnnouncementCursor | null;
  busy: boolean;
}) {
  const { t } = useTranslation("announcements");
  return (
    <nav className="announcement-pagination" aria-label={label}>
      <Button
        variant="secondary"
        disabled={!pagination.cursor || busy}
        onClick={pagination.previous}
      >
        {t("previous")}
      </Button>
      <Button
        variant="secondary"
        disabled={!nextCursor || busy}
        onClick={() => nextCursor && pagination.next(nextCursor)}
      >
        {t("next")}
      </Button>
    </nav>
  );
}
