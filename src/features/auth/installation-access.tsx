/** Open a customer app only after its own backend confirms edition and readiness. */
import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { db } from "../../lib/supabase";
import { installationBrand } from "../../lib/installation-brand";
import { useOnline } from "../../lib/online";

export function CustomerInstallationAccess({
  actor,
  children,
}: {
  actor: string;
  children: ReactNode;
}) {
  const online = useOnline();
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const configuration = useQuery({
    queryKey: [
      "customer-installation-capabilities",
      installationBrand.installationId,
      actor,
    ],
    enabled: online,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db().rpc("installation_capabilities");
      if (error) throw error;
      // Unknown or retired capability fields cannot accidentally enable a
      // closed installation; require explicit server values for every check.
      return Boolean(
        data &&
        data.installation_id === installationBrand.installationId &&
        data.edition === installationBrand.edition &&
        (data.licence_status === "active" || data.licence_status === "grace") &&
        data.customer_ready === true &&
        data.lms_available === true &&
        data.marketplace_available === false &&
        data.company_premium_switch_available === false,
      );
    },
  });
  if (!online)
    return (
      <Notice>
        {de
          ? "Verbinde dich mit dem Internet, um diese Akademie zu öffnen."
          : "Connect to the internet to open this academy."}
      </Notice>
    );
  if (
    configuration.isPending ||
    (configuration.isFetching && !configuration.isFetchedAfterMount)
  )
    return <Loading />;
  if (configuration.isError)
    return <ErrorState retry={() => void configuration.refetch()} />;
  if (!configuration.data)
    return (
      <main className="auth-page">
        <Notice kind="error">
          {de
            ? "Diese Akademie ist noch nicht freigegeben. Wende dich an die Administration deiner Akademie."
            : "This academy is unavailable. Contact your academy administrator."}
        </Notice>
        <Button onClick={() => void db().auth.signOut()}>
          {de ? "Abmelden" : "Sign out"}
        </Button>
      </main>
    );
  return children;
}
