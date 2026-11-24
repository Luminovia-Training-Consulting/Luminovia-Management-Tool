import { lazy, Suspense, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { permissionsQuery } from "../../lib/queries";
import { Loading } from "../../components/common";
import { useAuth } from "../auth/auth-context";
import "./i18n";

const ManagedExpertise = lazy(() =>
  import("../admin/people").then(({ ManagedExpertise }) => ({
    default: ManagedExpertise,
  })),
);

/** Open the existing evidence editor in the selected person's profile. */
export function PersonExpertise({ id }: { id: string }) {
  const actor = useAuth().session!.user.id;
  const { t } = useTranslation("accounts");
  const permissions = useQuery(permissionsQuery(actor));
  const [params, setParams] = useSearchParams();
  const panelId = useId();
  if (
    permissions.isError ||
    !permissions.data?.includes("users.manage") ||
    !permissions.data.includes("qualifications.verify")
  )
    return null;

  const open = params.get("expertise") === "1";
  return (
    <section aria-label={t("manageEvidence")} className="panel">
      <Button
        type="button"
        variant="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              if (open) next.delete("expertise");
              else next.set("expertise", "1");
              return next;
            },
            { preventScrollReset: true },
          );
        }}
      >
        {t("manageEvidence")}
      </Button>
      <div id={panelId} className="person-managed-expertise">
        {open && (
          <Suspense fallback={<Loading />}>
            <ManagedExpertise
              key={id}
              actorId={actor}
              accountId={id}
              showAccountDetails={false}
            />
          </Suspense>
        )}
      </div>
    </section>
  );
}
