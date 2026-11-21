/** Own archived material recovery; the RPC rechecks ownership, clean version and current fences. */
import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Loading, Notice } from "../../components/common";
import "./archived-personal-i18n";

import {
  archivedPersonalMaterialPageSchema,
  type ArchivedMaterial,
} from "./schema";

type Cursor = { at: string; id: string } | null;

/** Own server-confirmed archive list, including a bounded keyset cursor. */
export function ArchivedPersonalMaterials({ actor }: { actor: string }) {
  const { t } = useTranslation("archivedMaterials");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ArchivedMaterial | null>(null);
  const [done, setDone] = useState(false);
  const key = ["archived-personal-materials", actor] as const;
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as Cursor,
    enabled: open && online,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ pageParam }) => {
      requireOnline();
      const { data, error } = await db().rpc("archived_personal_materials", {
        p_before_at: pageParam?.at ?? null,
        p_before_id: pageParam?.id ?? null,
        p_limit: 30,
      });
      if (error) throw error;
      return archivedPersonalMaterialPageSchema.parse(data ?? []);
    },
    getNextPageParam: (last) =>
      last.length === 30
        ? { at: last[29].archived_at, id: last[29].id }
        : undefined,
  });
  const restore = useMutation({
    mutationFn: async (id: string) => {
      requireOnline();
      const { error } = await db().rpc("restore_personal_material", {
        p_id: id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setSelected(null);
      setDone(true);
      await Promise.all([
        client.cancelQueries({ queryKey: key }),
        client.cancelQueries({ queryKey: ["documents"] }),
      ]);
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({ queryKey: ["documents"] }),
      ]);
    },
  });
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={!online}
        onClick={() => {
          setDone(false);
          setOpen(true);
        }}
      >
        {t("open")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!restore.isPending) {
            setOpen(next);
            if (!next) {
              setSelected(null);
              client.removeQueries({ queryKey: key });
            }
          }
        }}
        title={t("open")}
        description={t("description")}
      >
        {done && <p role="status">{t("done")}</p>}
        {!online ? (
          <Notice>{t("offline")}</Notice>
        ) : query.isError ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : query.isPending ||
          (query.isFetching && !query.isFetchingNextPage) ? (
          <Loading />
        ) : (
          <>
            {query.data.pages.every((page) => page.length === 0) ? (
              <p>{t("empty")}</p>
            ) : (
              <ul>
                {query.data.pages.flat().map((item) => (
                  <li key={item.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        restore.reset();
                        setSelected(item);
                      }}
                    >
                      {t("restore", { name: item.original_name })}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {query.hasNextPage && (
              <Button
                type="button"
                variant="secondary"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {t("more")}
              </Button>
            )}
          </>
        )}
        <Dialog
          open={selected !== null}
          onOpenChange={(next) => {
            if (!next && !restore.isPending) setSelected(null);
          }}
          title={t("confirm")}
          description={t("confirmHint")}
        >
          <p>{selected?.original_name}</p>
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={restore.isPending}
              onClick={() => setSelected(null)}
            >
              {common("cancel")}
            </Button>
            <Button
              type="button"
              disabled={!online || restore.isPending || !selected}
              onClick={() => {
                if (selected) restore.mutate(selected.id);
              }}
            >
              {selected
                ? t("restore", { name: selected.original_name })
                : t("confirm")}
            </Button>
          </div>
          {restore.isError && <Notice kind="error">{t("failed")}</Notice>}
        </Dialog>
      </Dialog>
    </>
  );
}
