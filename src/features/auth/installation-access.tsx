/** Open a customer app only after its own backend confirms edition and readiness. */
import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading, Notice } from "../../components/common";
import { db } from "../../lib/supabase";
import { installationBrand } from "../../lib/installation-brand";
import { useOnline } from "../../lib/online";
import { Password } from "./password";
import { SignOutButton } from "./sign-out-button";
import { AuthenticatorGate, authenticatorRequired } from "./authenticator";
import { sessionCacheBoundary } from "./session-cache-boundary";
import { useAuth } from "./auth-context";

type CourseAccess = "active" | "grace";

/** Re-enter through a fresh caller proof after an offline period or actor change. */
export function AcademyCourseAccess({
  actor,
  children,
}: {
  actor: string;
  children: (access: CourseAccess) => ReactNode;
}) {
  const online = useOnline();
  const { i18n } = useTranslation();
  if (!online)
    return (
      <Notice>
        {i18n.language.startsWith("de")
          ? "Verbinde dich mit dem Internet, um diese Akademie zu öffnen."
          : "Connect to the internet to open this academy."}
      </Notice>
    );
  return (
    <OnlineAcademyCourseAccess key={actor} actor={actor}>
      {children}
    </OnlineAcademyCourseAccess>
  );
}

function OnlineAcademyCourseAccess({
  actor,
  children,
}: {
  actor: string;
  children: (access: CourseAccess) => ReactNode;
}) {
  const { i18n } = useTranslation();
  const { session } = useAuth();
  const boundary = sessionCacheBoundary(session?.access_token);
  const de = i18n.language.startsWith("de");
  const query = useQuery({
    queryKey: [
      "academy-course-access",
      installationBrand.installationId,
      actor,
      ...(boundary ? [boundary] : []),
    ],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchInterval: 10_000,
    retry: false,
    queryFn: async ({
      signal,
    }): Promise<CourseAccess | "password-setup" | "authenticator" | null> => {
      const { data, error } = await db()
        .rpc("installation_capabilities")
        .abortSignal(signal);
      if (error?.code === "PT428") return "password-setup";
      if (error?.code === authenticatorRequired) return "authenticator";
      if (error) throw error;
      if (
        !data ||
        !installationBrand.installationId ||
        data.installation_id !== installationBrand.installationId ||
        data.edition !== installationBrand.edition ||
        (data.edition !== "customer-managed" &&
          data.edition !== "customer-self-hosted") ||
        (data.licence_status !== "active" && data.licence_status !== "grace") ||
        data.marketplace_available !== false ||
        data.company_premium_switch_available !== false
      )
        return null;
      // Dedicated PostgREST evaluates the caller and exact operator-selected
      // course release before this RPC can return true.
      const access = await db().rpc("portal_access").abortSignal(signal);
      if (access.error?.code === "PT428") return "password-setup";
      if (access.error?.code === authenticatorRequired) return "authenticator";
      if (access.error?.code === "42501") return null;
      if (access.error) throw access.error;
      return access.data === true ? data.licence_status : null;
    },
  });
  if (query.isPending || (query.isFetching && !query.isFetchedAfterMount))
    return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (query.data === "password-setup")
    return <Password onSetupComplete={query.refetch} />;
  if (query.data === "authenticator")
    return <AuthenticatorGate actor={actor} onVerified={query.refetch} />;
  if (!query.data)
    return (
      <main className="auth-page">
        <Notice kind="error">
          {de
            ? "Der Kursbereich dieser Akademie ist nicht freigegeben. Wende dich an die Administration deiner Akademie."
            : "This academy’s course area is unavailable. Contact your academy administrator."}
        </Notice>
        <SignOutButton />
      </main>
    );
  return children(query.data);
}
