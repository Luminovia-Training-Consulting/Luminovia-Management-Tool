/** A blocked person's public profile is unavailable; authorized managers retain basic account actions. */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { ErrorState, Loading, PageHeading } from "../../components/common";
import { PersonManagementActions } from "./person-actions";
import "./i18n";

export function UnavailablePerson({
  id,
  retry,
}: {
  id: string;
  retry: () => void;
}) {
  const { session } = useAuth();
  const { t } = useTranslation("accounts");
  const managed = useQuery({
    queryKey: ["unavailable-managed-person", session!.user.id, id],
    queryFn: async () => {
      const result = await db().rpc("managed_profile", { p_user_id: id });
      if (result.error || !result.data) throw new Error("profile_unavailable");
      return result.data as { display_name: string };
    },
    retry: false,
  });
  if (managed.isPending) return <Loading />;
  if (managed.isError) return <ErrorState retry={retry} />;
  return (
    <>
      <PageHeading
        title={managed.data.display_name}
        description={t("publicProfileUnavailable")}
      />
      <div className="page-actions people-profile-actions">
        <PersonManagementActions id={id} name={managed.data.display_name} />
      </div>
    </>
  );
}
