/** Open the commercial contract workflow for the person selected outside the contract UI. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  commercialAccessQuery,
  commercialPersonEligibleQuery,
} from "../commercial/api";
import { LecturerContracts } from "../commercial/contracts";
import "./i18n";

type PersonContractTarget = { actor: string; id: string; name: string };

/** Require current commercial management and a target from its existing eligible-person list. */
export function PersonContractAction({
  actor,
  id,
  name,
}: PersonContractTarget) {
  const access = useQuery(commercialAccessQuery(actor));
  const permitted = access.isSuccess && access.data.can_manage_contracts;
  const target = useQuery({
    ...commercialPersonEligibleQuery(actor, id),
    enabled: permitted,
  });
  if (!permitted || !target.isSuccess || !target.data) return null;

  // A change of person discards any open dialog and its registration draft.
  return (
    <PersonContractDialog
      key={`${actor}:${id}`}
      actor={actor}
      id={id}
      name={name}
    />
  );
}

/** Keep the labelled, focus-restoring dialog tied to the authoritatively eligible person. */
function PersonContractDialog({ actor, id, name }: PersonContractTarget) {
  const { t } = useTranslation("accounts");
  const [open, setOpen] = useState(false);
  const title = t("manageContracts");
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        aria-haspopup="dialog"
        aria-label={`${title}: ${name}`}
        onClick={() => setOpen(true)}
      >
        {title}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={name}
      >
        {open && <LecturerContracts actor={actor} lecturer={id} />}
      </Dialog>
    </>
  );
}
