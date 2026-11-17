/**
 * Account directory and controlled role/activation changes. Load current permissions before
 * using the accounts API; a visible role selector or submitted user ID grants no authority.
 */
import { Link } from "react-router-dom";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { PermanentDeleteAction } from "../deletions/deletions";
import { InviteForm } from "../admin/invite";
import { commissionAccessQuery } from "../commercial/commission-api";
import { permissionsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import {
  accountListQuery,
  accountRequest,
  accountRoleCatalogQuery,
  type AccountPerson,
  type AccountRole,
} from "./api";
import "./i18n";
/** Keep search/page drafts and confirmed account changes scoped to the current actor. */
function AccountsDirectory({
  actorId,
  canAssign,
}: {
  actorId: string;
  canAssign: boolean;
}) {
  const { t } = useTranslation("accounts");
  const common = useTranslation().t;
  const online = useOnline();
  const cache = useQueryClient();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AccountPerson | null>(null);
  const [roles, setRoles] = useState<AccountRole[]>([]);
  const [organisation, setOrganisation] = useState("");
  const [confirm, setConfirm] = useState(false);
  const accounts = useQuery(accountListQuery(actorId, search, offset));
  const clientAccess = useQuery({
    ...commissionAccessQuery(actorId),
    enabled: canAssign,
  });
  const canLinkOrganisations = Boolean(
    clientAccess.data?.can_manage_client_memberships,
  );
  const catalog = useQuery({
    ...accountRoleCatalogQuery(actorId),
    enabled: canAssign,
  });
  const assignableRoles =
    catalog.data?.filter((entry) => entry.assignable) ?? [];
  const organisations = useQuery({
    queryKey: ["account-organisations", actorId],
    enabled: canLinkOrganisations && selected !== null,
    queryFn: async () => {
      const result = await db()
        .from("organisations")
        .select("id,name")
        .is("archived_at", null)
        .order("name");
      if (result.error) throw result.error;
      return result.data as { id: string; name: string }[];
    },
  });
  const membership = useQuery({
    queryKey: ["account-memberships", actorId, selected?.id],
    enabled: canLinkOrganisations && selected !== null,
    queryFn: async () => {
      const result = await db()
        .from("client_organisation_memberships")
        .select("organisation_id")
        .eq("user_id", selected!.id)
        .is("removed_at", null);
      if (result.error) throw result.error;
      return result.data as { organisation_id: string }[];
    },
  });
  const change = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!selected) throw new Error("account_required");
      return await accountRequest(`users/${selected.id}/roles`, "PUT", {
        roles,
      });
    },
    onSuccess: async () => {
      await cache.invalidateQueries();
      setConfirm(false);
      setSelected(null);
    },
  });
  const link = useMutation({
    mutationFn: async ({
      orgId,
      remove,
    }: {
      orgId: string;
      remove: boolean;
    }) => {
      requireOnline();
      return await accountRequest(
        `users/${selected!.id}/organisations/${orgId}`,
        remove ? "DELETE" : "PUT",
      );
    },
    onSuccess: () =>
      cache.invalidateQueries({ queryKey: ["account-memberships", actorId] }),
  });
  if (accounts.isPending) return <Loading />;
  if (accounts.isError)
    return <ErrorState retry={() => void accounts.refetch()} />;
  return (
    <>
      <section className="panel">
        <Field id="account-search" label={t("search")}>
          <input
            id="account-search"
            type="search"
            maxLength={120}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
          />
        </Field>
        <p>{t("count", { count: accounts.data.total })}</p>
        <ul className="account-list">
          {accounts.data.items.map((person) => (
            <li key={person.id}>
              <div>
                <strong>{person.display_name || person.email}</strong>
                <small>{person.email}</small>
                <span className="badge">
                  {t(person.active ? "active" : "inactive")}
                </span>
                <p>{person.roles.map((role) => t(role)).join(" · ")}</p>
                <Link to={`/admin/people?user=${person.id}`}>
                  {t("manageProfile")}
                </Link>
              </div>
              <PermanentDeleteAction
                kind="account"
                id={person.id}
                label={person.display_name || person.email}
              />
              {canAssign && person.can_assign_roles && (
                <Button
                  variant="secondary"
                  disabled={catalog.isPending || catalog.isError || !online}
                  onClick={() => {
                    setSelected(person);
                    setRoles(person.roles);
                    change.reset();
                    link.reset();
                  }}
                >
                  {t("roles")}: {person.display_name || person.email}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="form-actions">
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 25))}
          >
            {t("previous")}
          </Button>
          <Button
            variant="secondary"
            disabled={offset + 25 >= accounts.data.total}
            onClick={() => setOffset(offset + 25)}
          >
            {t("next")}
          </Button>
        </div>
        {change.isSuccess && <Notice>{t("saved")}</Notice>}
      </section>
      {catalog.isError && canAssign && (
        <ErrorState retry={() => void catalog.refetch()} />
      )}
      <InviteForm allRoles canAssignRoles={canAssign} />
      <Dialog
        open={selected !== null}
        onOpenChange={(value) => {
          if (!value && !change.isPending && !link.isPending) setSelected(null);
        }}
        title={t("roles")}
        description={selected?.display_name || selected?.email || ""}
      >
        <p>{t("roleHint")}</p>
        <fieldset className="account-roles">
          <legend>{t("role")}</legend>
          {assignableRoles.map(({ role }) => (
            <label key={role}>
              <input
                type="checkbox"
                checked={roles.includes(role)}
                disabled={change.isPending || link.isPending}
                onChange={(event) =>
                  setRoles((current) =>
                    event.target.checked
                      ? [...current, role]
                      : current.filter((item) => item !== role),
                  )
                }
              />
              {t(role)}
            </label>
          ))}
        </fieldset>
        <Button
          disabled={
            !online || !roles.length || change.isPending || link.isPending
          }
          onClick={() => setConfirm(true)}
        >
          {t("save")}
        </Button>
        {change.isError && !confirm && (
          <Notice kind="error">{t("error")}</Notice>
        )}
        {roles.includes("client") && canLinkOrganisations && (
          <section>
            <h3>{t("organisation")}</h3>
            <p>{t("organisationHint")}</p>
            {organisations.isPending || membership.isPending ? (
              <Loading />
            ) : organisations.isError || membership.isError ? (
              <ErrorState
                retry={() => {
                  void organisations.refetch();
                  void membership.refetch();
                }}
              />
            ) : (
              <>
                <ul>
                  {membership.data.map((member) => (
                    <li key={member.organisation_id}>
                      {organisations.data.find(
                        (org) => org.id === member.organisation_id,
                      )?.name ?? member.organisation_id}{" "}
                      <Button
                        variant="ghost"
                        disabled={!online || link.isPending}
                        onClick={() =>
                          link.mutate({
                            orgId: member.organisation_id,
                            remove: true,
                          })
                        }
                      >
                        {t("clientUnlink")}
                      </Button>
                    </li>
                  ))}
                </ul>
                <Field id="account-organisation" label={t("organisation")}>
                  <select
                    id="account-organisation"
                    value={organisation}
                    onChange={(event) => setOrganisation(event.target.value)}
                  >
                    <option value="">{t("choose")}</option>
                    {organisations.data.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  variant="secondary"
                  disabled={
                    !online ||
                    !organisation ||
                    link.isPending ||
                    !selected?.roles.includes("client")
                  }
                  onClick={() =>
                    link.mutate({ orgId: organisation, remove: false })
                  }
                >
                  {t("clientLink")}
                </Button>
              </>
            )}
            {link.isSuccess && <Notice>{t("clientLinked")}</Notice>}
            {link.isError && <Notice kind="error">{t("error")}</Notice>}
          </section>
        )}
      </Dialog>
      <Dialog
        open={confirm && selected !== null}
        onOpenChange={setConfirm}
        title={t("confirm", {
          name: selected?.display_name || selected?.email,
        })}
        description={t("confirmHint")}
      >
        <p>{roles.map((role) => t(role)).join(" · ")}</p>
        {change.isError && <Notice kind="error">{t("error")}</Notice>}
        <div className="form-actions">
          <Button
            variant="secondary"
            disabled={change.isPending}
            onClick={() => setConfirm(false)}
          >
            {common("cancel")}
          </Button>
          <Button
            disabled={!online || change.isPending}
            onClick={() => change.mutate()}
          >
            {t("save")}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
/** Load current account capabilities before the directory and distinguish failed checks from missing permission. */
export function AccountsPage() {
  const { session } = useAuth();
  const { t } = useTranslation("accounts");
  const permissions = useQuery(permissionsQuery(session!.user.id));
  return (
    <>
      <PageHeading title={t("title")} description={t("hint")} />
      {permissions.isPending ? (
        <Loading />
      ) : permissions.isError ? (
        <ErrorState retry={() => void permissions.refetch()} />
      ) : !permissions.data.includes("users.manage") ? (
        <Notice>{t("denied")}</Notice>
      ) : (
        <AccountsDirectory
          actorId={session!.user.id}
          canAssign={permissions.data.includes("users.roles.manage")}
        />
      )}
    </>
  );
}
