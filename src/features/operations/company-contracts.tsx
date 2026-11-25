/** Actor-scoped, on-demand list and upload for a single company dossier. */
import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  saveOrganisationContract,
  uploadOrganisationContract,
} from "../files/api";
import "./i18n";

const contractPage = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      file_name: z.string(),
      created_at: z.string(),
    }),
  ),
  has_more: z.boolean(),
});

type Contract = z.infer<typeof contractPage>["items"][number];
type Cursor = Pick<Contract, "created_at" | "id">;

/** Fetch document summaries only; the separate gateway authorizes the bytes. */
async function listContracts(
  organisationId: string,
  cursor: Cursor | null,
  signal: AbortSignal,
) {
  const { data, error } = await db()
    .rpc("organisation_contracts", {
      p_organisation_id: organisationId,
      ...(cursor && { p_before_at: cursor.created_at, p_before_id: cursor.id }),
    })
    .abortSignal(signal);
  if (error) throw error;
  return contractPage.parse(data);
}

/** Keep the retry ID with the exact selected File until a clean response succeeds. */
export function ContractFiles({
  actor,
  organisationId,
  archived,
}: {
  actor: string;
  organisationId: string;
  archived: boolean;
}) {
  const { t } = useTranslation("operations");
  const online = useOnline();
  const cache = useQueryClient();
  const queryKey = ["organisation-contracts", actor, organisationId];
  const field = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<{ file: File; requestId: string }>();
  const [invalid, setInvalid] = useState(false);
  const contracts = useInfiniteQuery({
    queryKey,
    initialPageParam: null as Cursor | null,
    queryFn: ({ pageParam, signal }) =>
      listContracts(organisationId, pageParam, signal),
    getNextPageParam: (last) => (last.has_more ? last.items.at(-1) : undefined),
    gcTime: 0,
    retry: false,
  });
  const upload = useMutation({
    mutationFn: ({ file, requestId }: NonNullable<typeof selected>) =>
      uploadOrganisationContract(file, organisationId, requestId),
    onSuccess: async () => {
      if (field.current) field.current.value = "";
      setSelected(undefined);
      await cache.resetQueries({ queryKey, exact: true });
    },
  });
  const download = useMutation({
    mutationFn: ({ id, file_name }: Contract) =>
      saveOrganisationContract(organisationId, id, file_name),
  });
  const items = contracts.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="section-stack">
      <p>{t("companyContractsIntro")}</p>
      {archived ? (
        <Notice>{t("companyContractsArchived")}</Notice>
      ) : (
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (online && selected && !upload.isPending)
              upload.mutate(selected);
          }}
        >
          <Field
            id="company-contract-file"
            label={t("companyContractsChoose")}
            error={invalid}
          >
            <input
              id="company-contract-file"
              ref={field}
              type="file"
              accept=".pdf,application/pdf"
              disabled={!online || upload.isPending}
              onChange={(event) => {
                upload.reset();
                const file = event.currentTarget.files?.[0];
                const pdf =
                  file &&
                  (file.type === "application/pdf" ||
                    /\.pdf$/i.test(file.name));
                setInvalid(Boolean(file && !pdf));
                setSelected(
                  pdf ? { file, requestId: crypto.randomUUID() } : undefined,
                );
              }}
            />
          </Field>
          <Button disabled={!online || !selected || upload.isPending}>
            {t("companyContractsUpload")}
          </Button>
          {invalid && (
            <Notice kind="error">{t("companyContractsInvalid")}</Notice>
          )}
          {upload.isPending && (
            <p role="status">{t("companyContractsScanning")}</p>
          )}
          {upload.isSuccess && <Notice>{t("companyContractsSaved")}</Notice>}
          {upload.isError && (
            <Notice kind="error">{t("companyContractsFailed")}</Notice>
          )}
        </form>
      )}
      {contracts.isPending ? (
        <Loading />
      ) : contracts.isError && !contracts.data ? (
        <ErrorState retry={() => void contracts.refetch()} />
      ) : items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <Button
                variant="secondary"
                disabled={!online || download.isPending}
                onClick={() => download.mutate(item)}
              >
                {t("companyContractsDownload", { name: item.file_name })}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("companyContractsEmpty")}</p>
      )}
      {contracts.isFetchNextPageError && (
        <ErrorState retry={() => void contracts.fetchNextPage()} />
      )}
      {contracts.hasNextPage && !contracts.isFetchNextPageError && (
        <Button
          variant="secondary"
          disabled={!online || contracts.isFetching}
          onClick={() => void contracts.fetchNextPage()}
        >
          {t("companyContractsMore")}
        </Button>
      )}
      {download.isError && (
        <Notice kind="error">{t("companyContractsDownloadFailed")}</Notice>
      )}
    </div>
  );
}
