import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { dateTime } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { companyParticipantHistorySchema } from "./company-participant-schema";

type HistoryCursor = { id: string; occurred_at: string } | null;

export function CompanyParticipantHistory({
  actor,
  organisationId,
  onClose,
}: {
  actor: string;
  organisationId: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("operations");
  const online = useOnline();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const history = useInfiniteQuery({
    queryKey: ["company-participant-history", actor, organisationId],
    initialPageParam: null as HistoryCursor,
    enabled: online,
    retry: false,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await db()
        .rpc("company_participant_history", {
          p_organisation_id: organisationId,
          p_before_at: pageParam?.occurred_at ?? null,
          p_before_id: pageParam?.id ?? null,
        })
        .abortSignal(signal);
      if (error) throw error;
      return companyParticipantHistorySchema.parse(data);
    },
    getNextPageParam: (last): HistoryCursor =>
      last.has_more ? (last.items.at(-1) ?? null) : null,
  });
  if (!online) return null;

  const entries = history.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("participantHistory")}
      description={t("participantHistoryDescription")}
    >
      {history.isPending && <Loading />}
      {history.isError && (
        <ErrorState
          retry={() => {
            void (history.isFetchNextPageError
              ? history.fetchNextPage()
              : history.refetch());
          }}
        />
      )}
      {history.isSuccess && (
        <>
          {entries.length > 0 ? (
            <ol className="company-participant-history">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <strong>{t(`participantHistoryEntry.${entry.kind}`)}</strong>
                  <time className="muted" dateTime={entry.occurred_at}>
                    {dateTime(entry.occurred_at, i18n.language, zone)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p>{t("participantHistoryEmpty")}</p>
          )}
          {history.hasNextPage && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
            >
              {t("participantHistoryOlder")}
            </Button>
          )}
        </>
      )}
    </Dialog>
  );
}
