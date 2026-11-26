import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loading } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { useOnline } from "../../lib/online";
import "./i18n";

const ContractFiles = lazy(() =>
  import("./company-contracts").then((module) => ({
    default: module.ContractFiles,
  })),
);

/** Company contracts are an online-only tool, loaded only when opened. */
export function CompanyContracts({
  actor,
  organisationId,
  organisationName,
  archived,
  showOrganisationName = false,
}: {
  actor: string;
  organisationId: string;
  organisationName: string;
  archived: boolean;
  showOrganisationName?: boolean;
}) {
  const { t } = useTranslation("operations");
  const [open, setOpen] = useState(false);
  const online = useOnline();
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        aria-haspopup="dialog"
        disabled={!online}
        onClick={() => setOpen(true)}
      >
        {t("companyContracts")}
        {showOrganisationName && <span>· {organisationName}</span>}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("companyContracts")}
        description={organisationName}
      >
        {open && (
          <Suspense fallback={<Loading />}>
            <ContractFiles
              key={`${actor}:${organisationId}`}
              actor={actor}
              organisationId={organisationId}
              archived={archived}
            />
          </Suspense>
        )}
      </Dialog>
    </>
  );
}
