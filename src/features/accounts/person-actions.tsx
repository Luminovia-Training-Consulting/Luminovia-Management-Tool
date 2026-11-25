/** Contextual account actions use current capabilities and the existing server contracts. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Notice } from "../../components/common";
import { PermanentDeleteAction } from "../deletions/deletions";
import { ManagedProfileEditor } from "./managed-profile-editor";
import { PersonContractAction } from "./person-contract-action";
import { PersonExpertise } from "./person-expertise";
import "./i18n";

export function PersonManagementActions({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const { session } = useAuth();
  const actor = session!.user.id;
  const { t } = useTranslation("accounts");
  const common = useTranslation().t;
  const online = useOnline();
  const cache = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const permissions = useQuery(permissionsQuery(actor));
  const canManage = permissions.data?.includes("users.manage") === true;
  const status = useQuery({
    queryKey: ["person-account-status", actor, id],
    enabled: canManage && id !== actor,
    queryFn: async () => {
      const { data, error } = await db()
        .from("profiles")
        .select("active")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as { active: boolean };
    },
  });
  const mutation = useMutation({
    mutationFn: async (active: boolean) => {
      requireOnline();
      const { error } = await db().rpc("set_user_active", {
        p_user_id: id,
        p_active: active,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setConfirm(false);
      await cache.invalidateQueries();
    },
  });
  return (
    <>
      {id === actor && (
        <Button asChild variant="secondary">
          <Link to="/profile">{t("editProfile")}</Link>
        </Button>
      )}
      {canManage && id !== actor && (
        <Button variant="secondary" onClick={() => setEditProfile(true)}>
          {t("editProfile")}
        </Button>
      )}
      <Dialog
        open={editProfile}
        onOpenChange={setEditProfile}
        title={t("editProfile")}
        description={name}
      >
        {editProfile && (
          <ManagedProfileEditor
            actor={actor}
            id={id}
            close={() => setEditProfile(false)}
          />
        )}
      </Dialog>
      {canManage && id !== actor && <PersonExpertise id={id} />}
      <PersonContractAction actor={actor} id={id} name={name} />
      {canManage && id !== actor && (
        <Button asChild variant="secondary">
          <Link
            to={`/admin/accounts?q=${encodeURIComponent(name)}&user=${encodeURIComponent(id)}`}
          >
            {t("editAccess")}
          </Link>
        </Button>
      )}
      {status.data && (
        <Button
          variant={status.data.active ? "danger" : "secondary"}
          disabled={!online || mutation.isPending}
          onClick={() => {
            mutation.reset();
            setConfirm(true);
          }}
        >
          {common(status.data.active ? "peopleDeactivate" : "peopleActivate")}
        </Button>
      )}
      {id !== actor && (
        <PermanentDeleteAction kind="account" id={id} label={name} />
      )}
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!mutation.isPending) setConfirm(open);
        }}
        title={common(
          status.data?.active ? "peopleDeactivate" : "peopleActivate",
        )}
        description={name}
      >
        <p>{t("statusHint")}</p>
        <Button
          disabled={!online || mutation.isPending || !status.data}
          variant={status.data?.active ? "danger" : "secondary"}
          onClick={() => status.data && mutation.mutate(!status.data.active)}
        >
          {t("confirmStatus")}
        </Button>
        {mutation.isError && <Notice kind="error">{t("error")}</Notice>}
      </Dialog>
    </>
  );
}
