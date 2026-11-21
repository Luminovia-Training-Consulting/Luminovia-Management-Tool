/** Gate operational routes using current database membership, never editable Auth metadata. */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { db } from "../../lib/supabase";
import { useAuth } from "./auth-context";
import { portalInternalEdition } from "../../lib/installation-brand";
import type { ReactNode } from "react";

export function PortalAccess({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { i18n } = useTranslation();
  const access = useQuery({
    queryKey: ["portal-access", session!.user.id],
    queryFn: async () => {
      const { data, error } = await db().rpc("portal_access");
      // The REST pre-request gate deliberately returns 42501 for retired roles.
      if (error?.code === "42501") return false;
      if (error) throw error;
      return data === true;
    },
    refetchInterval: 30000,
  });
  if (access.isPending) return <Loading />;
  if (access.isError) return <ErrorState retry={() => void access.refetch()} />;
  if (!access.data) {
    const de = i18n.language.startsWith("de");
    return (
      <main className="auth-page">
        <Notice kind="error">
          {portalInternalEdition
            ? de
              ? "Dieses Portal ist für Unternehmen, Dozent:innen und das Luminovia-Team bestimmt. Dein Konto hat keinen Portalzugriff."
              : "This portal is for companies, lecturers and the Luminovia team. Your account does not have portal access."
            : de
              ? "Dein Konto hat keinen Zugang zu dieser Akademie."
              : "Your account does not have access to this academy."}
        </Notice>
        <Button onClick={() => void db().auth.signOut()}>
          {de ? "Abmelden" : "Sign out"}
        </Button>
      </main>
    );
  }
  return children;
}
