/**
 * Account directory and controlled role/activation changes. Load current permissions before
 * using the accounts API; a visible role selector or submitted user ID grants no authority.
 */
import { Link, useSearchParams } from "react-router-dom";
import { type ReactNode, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { PermanentDeleteAction } from "../deletions/deletions";
import { CreateAccountForm } from "./create-account";
import { ParticipantPlacementFields } from "../operations/participant-placement-fields";
import { emptyParticipantPlacement } from "../operations/company-participant-schema";
import { LecturerCompensation } from "../commercial/lecturer-compensation";
import { ManagedExpertise } from "../admin/people";
import { InviteForm } from "../admin/invite";
import { commissionAccessQuery } from "../commercial/commission-api";
import { db } from "../../lib/supabase";
import { permissionsQuery } from "../../lib/queries";
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
  accountMemberships,
  type AccountPerson,
  accountRequest,
  type AccountRole,
  accountOrganisationsQuery,
  accountRoleCatalogQuery,
} from "./api";
import { ManagedProfileEditor } from "./managed-profile-editor";
import "./i18n";
import "./accounts.css";

const ownEditableRoles: readonly AccountRole[] = [
  "admin",
  "management",
  "lecturer",
  "participant",
  "client",
];

/** Keep the profile editor and expertise review within the selected account. */
function AccountProfileDialog({
  person,
  actorId,
  canVerify,
  companySettings,
  close,
}: {
  person: AccountPerson;
  actorId: string;
  canVerify: boolean;
  companySettings?: ReactNode;
  close: () => void;
}) {
  const { t } = useTranslation("accounts");
  const [view, setView] = useState<"profile" | "expertise">("profile");
  const [openedExpertise, setOpenedExpertise] = useState(false);
  const own = person.id === actorId;
  const showExpertise = canVerify && view === "expertise";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t("accountDetails")}
      description={
        person.display_name
          ? `${person.display_name} · ${person.email}`
          : person.email
      }
    >
      {canVerify && (
        <div
          className="page-actions"
          role="group"
          aria-label={t("accountDetails")}
        >
          <Button
            type="button"
            variant={showExpertise ? "secondary" : "default"}
            aria-pressed={!showExpertise}
            onClick={() => setView("profile")}
          >
            {t("profileTab")}
          </Button>
          <Button
            type="button"
            variant={showExpertise ? "default" : "secondary"}
            aria-pressed={showExpertise}
            onClick={() => {
              setOpenedExpertise(true);
              setView("expertise");
            }}
          >
            {t("expertiseTab")}
          </Button>
        </div>
      )}
      <div hidden={showExpertise}>
        {!own && person.can_change_active ? (
          <ManagedProfileEditor actor={actorId} id={person.id} close={close} />
        ) : (
          <Button asChild variant="secondary">
            <Link to={own ? "/profile" : `/people/${person.id}`}>
              {t(own ? "ownProfileExpertise" : "viewProfile")}
            </Link>
          </Button>
        )}
      </div>
      {companySettings}
      {canVerify && openedExpertise && (
        <div hidden={!showExpertise}>
          {!own && <LecturerCompensation userId={person.id} />}
          <ManagedExpertise actorId={actorId} accountId={person.id} />
        </div>
      )}
    </Dialog>
  );
}

/** Keep search/page drafts and confirmed account changes scoped to the current actor. */
function AccountsDirectory({
  actorId,
  canAssign,
  canVerify,
  canManageContracts,
  canManageCompanies,
}: {
  actorId: string;
  canAssign: boolean;
  canVerify: boolean;
  canManageContracts: boolean;
  canManageCompanies: boolean;
}) {
  const { t } = useTranslation("accounts");
  const common = useTranslation().t;
  const online = useOnline();
  const cache = useQueryClient();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [openAccount, setOpenAccount] = useState<AccountPerson | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AccountPerson | null>(null);
  const [roles, setRoles] = useState<AccountRole[]>([]);
  const [organisation, setOrganisation] = useState("");
  const [organisationSearch, setOrganisationSearch] = useState("");
  const [placement, setPlacement] = useState(emptyParticipantPlacement);
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
    catalog.data?.filter(
      (entry) => entry.assignable && entry.role !== "owner",
    ) ?? [];
  const ownRoles = selected?.id === actorId;
  const editingCompany = roles.includes("client");
  const addingCompanyRole =
    editingCompany && !selected?.roles.includes("client");
  const relinquishingAdmin =
    ownRoles &&
    selected.roles.includes("admin") &&
    !selected.roles.includes("owner") &&
    !roles.includes("admin");
  const companyChange =
    editingCompany && organisation ? { organisation_id: organisation } : {};
  const profileCompany =
    openAccount?.active &&
    openAccount.roles.includes("client") &&
    (openAccount.can_assign_roles || openAccount.id === actorId)
      ? openAccount
      : null;
  const membershipTarget = profileCompany ?? (editingCompany ? selected : null);
  const organisations = useQuery({
    ...accountOrganisationsQuery(actorId),
    enabled: canLinkOrganisations && membershipTarget !== null,
  });
  const membership = useQuery({
    queryKey: ["account-memberships", actorId, membershipTarget?.id],
    enabled: canLinkOrganisations && membershipTarget !== null,
    queryFn: () => accountMemberships(membershipTarget!.id),
  });
  const change = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!selected) throw new Error("account_required");
      if (ownRoles) {
        const payload = { p_user_id: actorId, p_roles: roles };
        const { data, error } = companyChange.organisation_id
          ? await db().rpc("set_account_roles_with_organisation", {
              ...payload,
              p_organisation_id: companyChange.organisation_id,
            })
          : await db().rpc("set_account_roles", payload);
        if (error) throw error;
        return data;
      }
      return await accountRequest(`users/${selected.id}/roles`, "PUT", {
        roles,
        ...companyChange,
        ...(roles.includes("participant") && placement.organisation
          ? {
              participant_placement: {
                organisation_id: placement.organisation,
                class_id: placement.classId || null,
              },
            }
          : {}),
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
      if (!membershipTarget || !canLinkOrganisations)
        throw new Error("permission_required");
      return await accountRequest(
        `users/${membershipTarget.id}/organisations/${orgId}`,
        remove ? "DELETE" : "PUT",
      );
    },
    onSuccess: async (_receipt, { remove }) => {
      if (!remove && profileCompany) setOrganisation("");
      await cache.invalidateQueries({
        queryKey: ["account-memberships", actorId],
      });
    },
  });
  const ownChangeError =
    ownRoles &&
    change.error &&
    typeof change.error === "object" &&
    "message" in change.error
      ? change.error.message
      : undefined;
  const changeErrorLabel =
    ownChangeError === "Last active administrator protected"
      ? "lastAdminProtected"
      : ownChangeError ===
          "Complete or transfer active teaching assignments first"
        ? "activeTeachingProtected"
        : "error";

  const companyMembershipSettings = canLinkOrganisations &&
    membershipTarget && (
      <section>
        <h3>{t("organisation")}</h3>
        <p>{t("organisationHint")}</p>
        {!profileCompany && addingCompanyRole && (
          <Notice>{t("conversionOrganisation")}</Notice>
        )}
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
            {membership.data.length === 0 && (
              <p>{t("noOrganisationMemberships")}</p>
            )}
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
            {profileCompany && (
              <Field
                id="account-organisation-search"
                label={t("searchOrganisations")}
              >
                <input
                  type="search"
                  id="account-organisation-search"
                  value={organisationSearch}
                  onChange={(event) =>
                    setOrganisationSearch(event.target.value)
                  }
                />
              </Field>
            )}
            <Field id="account-organisation" label={t("organisation")}>
              <select
                id="account-organisation"
                value={organisation}
                onChange={(event) => setOrganisation(event.target.value)}
              >
                <option value="">{t("choose")}</option>
                {organisations.data
                  .filter(
                    (org) =>
                      !profileCompany ||
                      org.id === organisation ||
                      org.name
                        .toLocaleLowerCase()
                        .includes(
                          organisationSearch.trim().toLocaleLowerCase(),
                        ),
                  )
                  .map((org) => (
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
                !membershipTarget.roles.includes("client") ||
                membership.data.some(
                  (member) => member.organisation_id === organisation,
                )
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
    );

  if (accounts.isPending) return <Loading />;
  if (accounts.isError)
    return <ErrorState retry={() => void accounts.refetch()} />;
  return (
    <div className="section-stack">
      <section className="panel">
        <div className="account-directory-toolbar">
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
          {canAssign && (
            <Button
              disabled={!online || !catalog.isSuccess}
              onClick={() => setCreateOpen(true)}
            >
              {t("createTitle")}
            </Button>
          )}
        </div>
        <p>{t("count", { count: accounts.data.total })}</p>
        <ul className="account-list">
          {accounts.data.items.map((person) => (
            <li key={person.id}>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="account-name-button"
                  onClick={() => {
                    setOrganisation("");
                    setOrganisationSearch("");
                    link.reset();
                    setOpenAccount(person);
                  }}
                >
                  <strong>{person.display_name || person.email}</strong>
                </Button>
                <small>{person.email}</small>
                <small className="public-user-id">
                  {t("userId")}: <code>{person.luminovia_user_id}</code>
                </small>
                <span className="badge">
                  {t(person.active ? "active" : "inactive")}
                </span>
                <p>{person.roles.map((role) => t(role)).join(" · ")}</p>
              </div>
              <div className="account-list-actions">
                {person.id === actorId && (
                  <>
                    <Button asChild variant="secondary">
                      <Link
                        to={
                          canManageContracts
                            ? `/contracts?user=${actorId}`
                            : "/contracts"
                        }
                      >
                        {t("ownContracts")}
                      </Link>
                    </Button>
                  </>
                )}
                {canManageContracts &&
                  person.roles.some(
                    (role) => role === "lecturer" || role === "senior_lecturer",
                  ) && (
                    <Button asChild variant="secondary">
                      <Link to={`/contracts?user=${person.id}`}>
                        {t("manageContracts")}
                      </Link>
                    </Button>
                  )}
                {canManageCompanies && person.roles.includes("client") && (
                  <Button asChild variant="secondary">
                    <Link to="/clients">{t("manageCompany")}</Link>
                  </Button>
                )}
                {person.id !== actorId && (
                  <PermanentDeleteAction
                    kind="account"
                    id={person.id}
                    label={person.display_name || person.email}
                  />
                )}
                {canAssign &&
                  (person.id === actorId
                    ? person.roles.some(
                        (role) => role === "admin" || role === "owner",
                      )
                    : person.can_assign_roles) && (
                    <Button
                      variant="secondary"
                      disabled={catalog.isPending || catalog.isError || !online}
                      onClick={() => {
                        setSelected(person);
                        setRoles(person.roles);
                        setOrganisation("");
                        setPlacement(emptyParticipantPlacement);
                        change.reset();
                        link.reset();
                      }}
                    >
                      {t(person.id === actorId ? "ownRoles" : "roles")}
                    </Button>
                  )}
              </div>
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
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("createTitle")}
        description={t("createHint")}
      >
        {createOpen && canAssign && catalog.isSuccess && (
          <CreateAccountForm
            actor={actorId}
            roles={catalog.data}
            canLinkOrganisations={canLinkOrganisations}
          />
        )}
      </Dialog>
      {openAccount && (
        <AccountProfileDialog
          key={openAccount.id}
          person={openAccount}
          actorId={actorId}
          canVerify={
            canVerify &&
            openAccount.roles.some(
              (role) => role === "lecturer" || role === "senior_lecturer",
            )
          }
          companySettings={
            profileCompany ? companyMembershipSettings : undefined
          }
          close={() => {
            if (!link.isPending) setOpenAccount(null);
          }}
        />
      )}
      <InviteForm allRoles canAssignRoles={canAssign} />
      <Dialog
        open={selected !== null}
        onOpenChange={(value) => {
          if (!value && !change.isPending && !link.isPending) setSelected(null);
        }}
        title={t(ownRoles ? "ownRoles" : "roles")}
        description={selected?.display_name || selected?.email || ""}
      >
        <p>{t(ownRoles ? "ownRoleHint" : "roleHint")}</p>
        {!ownRoles &&
          selected?.roles.some((role) =>
            ["lecturer", "senior_lecturer"].includes(role),
          ) && <LecturerCompensation userId={selected.id} />}
        <fieldset className="account-roles">
          <legend>{t("role")}</legend>
          {(ownRoles
            ? assignableRoles.filter(({ role }) =>
                ownEditableRoles.includes(role),
              )
            : assignableRoles
          ).map(({ role }) => (
            <label key={role}>
              <input
                type="checkbox"
                checked={roles.includes(role)}
                disabled={change.isPending || link.isPending}
                onChange={(event) => {
                  if (role === "participant" && !event.target.checked)
                    setPlacement(emptyParticipantPlacement);
                  setRoles((current) =>
                    event.target.checked
                      ? [...current, role]
                      : current.filter((item) => item !== role),
                  );
                }}
              />
              {t(role)}
            </label>
          ))}
        </fieldset>
        {roles.length > 0 && (
          <dl>
            {roles.map((role) => (
              <div key={role}>
                <dt>{t(role)}</dt>
                <dd>{t(`roleScope.${role}`)}</dd>
              </div>
            ))}
          </dl>
        )}
        {!ownRoles && roles.includes("participant") && (
          <div className="profile-form">
            <ParticipantPlacementFields
              actor={actorId}
              value={placement}
              disabled={
                !online || confirm || change.isPending || link.isPending
              }
              change={setPlacement}
            />
          </div>
        )}
        <Button
          disabled={
            !online ||
            !roles.length ||
            change.isPending ||
            link.isPending ||
            (addingCompanyRole && (!canLinkOrganisations || !organisation))
          }
          onClick={() => setConfirm(true)}
        >
          {t("save")}
        </Button>
        {change.isError && !confirm && (
          <Notice kind="error">{t(changeErrorLabel)}</Notice>
        )}
        {editingCompany && !canLinkOrganisations && (
          <Notice>{t("organisationAdmin")}</Notice>
        )}
        {editingCompany && companyMembershipSettings}
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
        {relinquishingAdmin && <Notice>{t("relinquishAdmin")}</Notice>}
        {companyChange.organisation_id && (
          <p>
            {t("organisation")} ·{" "}
            {organisations.data?.find(
              (item) => item.id === companyChange.organisation_id,
            )?.name ?? companyChange.organisation_id}
          </p>
        )}
        {change.isError && <Notice kind="error">{t(changeErrorLabel)}</Notice>}
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
    </div>
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
          canVerify={permissions.data.includes("qualifications.verify")}
          canManageContracts={permissions.data.includes("contracts.manage")}
          canManageCompanies={permissions.data.includes("organisations.manage")}
        />
      )}
    </>
  );
}
