/** Direct account creation uses the privileged Edge facade after current role reservation. */
import { useState } from "react";
import { useRequestKey } from "../../lib/request-key";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Notice } from "../../components/common";
import { ParticipantPlacementFields } from "../operations/participant-placement-fields";
import { emptyParticipantPlacement } from "../operations/company-participant-schema";
import {
  accountOrganisationsQuery,
  accountRequest,
  type AccountRoleCapability,
} from "./api";
import "./i18n";

/** Explain actionable server responses without exposing internal failure details. */
function creationErrorKey(error: unknown) {
  switch (error instanceof Error ? error.message : null) {
    case "creation_in_progress":
      return "creationInProgress";
    case "permission_required":
      return "creationPermissionRequired";
    case "invalid_request":
      return "creationInvalid";
    case "creation_disabled":
    case "service_unavailable":
      return "creationUnavailable";
    default:
      return "createError";
  }
}

/** Create one account through the caller-authorized facade; password input is transient and never retained after confirmation. */
export function CreateAccountForm({
  actor,
  roles,
  canLinkOrganisations,
}: {
  actor: string;
  roles: AccountRoleCapability[];
  canLinkOrganisations: boolean;
}) {
  const { t } = useTranslation("accounts");
  const common = useTranslation().t;
  const online = useOnline();
  const cache = useQueryClient();
  const available = roles.filter(
    (entry) =>
      entry.assignable &&
      entry.role !== "owner" &&
      (entry.role !== "client" || canLinkOrganisations),
  );
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const validInitialPassword =
    password.length >= 8 &&
    password.length <= 128 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[!@#$%^&*()_+\-=[\]{}|;:,.<>?/]/.test(password);
  const [role, setRole] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [placement, setPlacement] = useState(emptyParticipantPlacement);
  const request = useRequestKey();
  const organisations = useQuery({
    ...accountOrganisationsQuery(actor),
    enabled: role === "client" && canLinkOrganisations,
  });
  const create = useMutation({
    mutationFn: async () => {
      requireOnline();
      const values = {
        email: email.trim(),
        display_name: name.trim(),
        password,
        role,
        organisation_id:
          role === "client"
            ? organisation
            : role === "participant"
              ? placement.organisation || null
              : null,
        ...(role === "participant" && placement.classId
          ? { class_id: placement.classId }
          : {}),
      };
      return accountRequest<{
        status: string;
        user_id?: string;
        access_email?: "requested" | "failed";
      }>("users", "POST", {
        ...values,
        idempotency_key: request.forInput(JSON.stringify(values)),
      });
    },
    onError: (error) => {
      if (error instanceof Error && error.message === "creation_failed")
        request.clear();
    },
    onSuccess: async (result) => {
      if (result.status === "created") {
        setPassword("");
        request.clear();
        await cache.invalidateQueries({ queryKey: ["accounts", actor] });
        if (placement.organisation)
          void cache.invalidateQueries({
            queryKey: ["company-participants", actor, placement.organisation],
          });
      }
    },
  });
  if (!available.length) return null;
  return (
    <form
      className="panel profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        // Prevent a forged submit event from sending an invalid credential to the Edge handler.
        if (
          !online ||
          create.isPending ||
          !validInitialPassword ||
          !available.some((entry) => entry.role === role) ||
          (role === "client" && !organisation)
        )
          return;
        create.mutate();
      }}
    >
      <h2>{t("createTitle")}</h2>
      <p>{t("createHint")}</p>
      <Field id="create-account-name" label={common("displayName")}>
        <input
          id="create-account-name"
          required
          disabled={create.isPending}
          maxLength={120}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            create.reset();
          }}
        />
      </Field>
      <Field id="create-account-email" label={common("email")}>
        <input
          id="create-account-email"
          type="email"
          required
          disabled={create.isPending}
          maxLength={254}
          autoComplete="off"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            create.reset();
          }}
        />
      </Field>
      <Field id="create-account-role" label={t("role")}>
        <select
          id="create-account-role"
          required
          disabled={create.isPending}
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            setOrganisation("");
            setPlacement(emptyParticipantPlacement);
            create.reset();
          }}
        >
          <option value="" disabled>
            {t("chooseRole")}
          </option>
          {available.map((entry) => (
            <option key={entry.role} value={entry.role}>
              {t(entry.role)}
            </option>
          ))}
        </select>
      </Field>
      {role === "client" && (
        <Field id="create-account-organisation" label={t("organisation")}>
          <select
            id="create-account-organisation"
            required
            value={organisation}
            disabled={
              create.isPending ||
              organisations.isPending ||
              organisations.isError
            }
            onChange={(event) => {
              setOrganisation(event.target.value);
              create.reset();
            }}
          >
            <option value="">{t("choose")}</option>
            {organisations.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {organisations.isError && (
            <ErrorState retry={() => void organisations.refetch()} />
          )}
        </Field>
      )}
      {role === "participant" && (
        <ParticipantPlacementFields
          actor={actor}
          value={placement}
          disabled={!online || create.isPending}
          change={(value) => {
            setPlacement(value);
            create.reset();
          }}
        />
      )}
      <Field id="create-account-password" label={t("initialPassword")}>
        <input
          id="create-account-password"
          type="password"
          required
          disabled={create.isPending}
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            create.reset();
          }}
        />
      </Field>
      <Button
        disabled={
          !online ||
          create.isPending ||
          !validInitialPassword ||
          !available.some((entry) => entry.role === role) ||
          (role === "client" && !organisation)
        }
      >
        {t(create.isPending ? "creating" : "createTitle")}
      </Button>
      {create.isError && (
        <Notice kind="error">{t(creationErrorKey(create.error))}</Notice>
      )}
      {create.data?.access_email === "failed" && (
        <Notice kind="error">{t("accessEmailFailed")}</Notice>
      )}
      {create.data?.access_email === "requested" && (
        <Notice>{t("accessEmailRequested")}</Notice>
      )}
      {create.data?.status === "created" && (
        <Notice>
          {t("created")}{" "}
          {create.data.user_id && (
            <Link to={`/people/${create.data.user_id}`}>
              {t("openCreated")}
            </Link>
          )}
        </Notice>
      )}
    </form>
  );
}
