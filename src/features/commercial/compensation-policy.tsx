import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { commissionAccessQuery, type CommissionAccess } from "./commission-api";
import "./platform-i18n";

function PolicyEditor({ access }: { access: CommissionAccess }) {
  const { t } = useTranslation("platform");
  const client = useQueryClient();
  const online = useOnline();
  const [regular, setRegular] = useState(
    String(access.regular_lecturer_percent ?? ""),
  );
  const [senior, setSenior] = useState(
    String(access.senior_lecturer_percent ?? ""),
  );
  const [version, setVersion] = useState(access.policy_version ?? 0);
  const valid =
    regular !== "" &&
    senior !== "" &&
    Number.isFinite(Number(regular)) &&
    Number.isFinite(Number(senior)) &&
    Number(regular) >= 0 &&
    Number(senior) <= 100 &&
    Number(regular) < Number(senior) &&
    Number(regular) === Math.round(Number(regular) * 100) / 100 &&
    Number(senior) === Math.round(Number(senior) * 100) / 100;
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!valid) throw new Error("invalid_policy");
      const { data, error } = await db().rpc("configure_compensation_policy", {
        p_regular_percent: Number(regular),
        p_senior_percent: Number(senior),
        p_expected_version: version,
      });
      if (error) throw error;
      if (
        !data?.policy_configured ||
        !Number.isSafeInteger(data.policy_version)
      )
        throw new Error("unconfirmed_policy");
      return data as CommissionAccess;
    },
    onSuccess: async (policy) => {
      setVersion(policy.policy_version!);
      await client.invalidateQueries();
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      {!access.policy_configured && <Notice>{t("policyMissing")}</Notice>}
      <div className="form-row">
        <Field id="compensation-regular" label={t("regularPercent")}>
          <input
            id="compensation-regular"
            type="number"
            min="0"
            max="100"
            step="0.01"
            required
            value={regular}
            onChange={(event) => setRegular(event.target.value)}
            disabled={save.isPending}
          />
        </Field>
        <Field id="compensation-senior" label={t("seniorPercent")}>
          <input
            id="compensation-senior"
            type="number"
            min="0"
            max="100"
            step="0.01"
            required
            value={senior}
            onChange={(event) => setSenior(event.target.value)}
            disabled={save.isPending}
          />
        </Field>
      </div>
      <Button disabled={!online || !valid || save.isPending}>
        {t("savePolicy")}
      </Button>
      {save.isSuccess && <Notice>{t("policySaved")}</Notice>}
      {save.isError && (
        <Notice kind="error">
          {t("policyError")}{" "}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setVersion(access.policy_version ?? 0);
              setRegular(String(access.regular_lecturer_percent ?? ""));
              setSenior(String(access.senior_lecturer_percent ?? ""));
              save.reset();
            }}
          >
            {t("reloadPolicy")}
          </Button>
        </Notice>
      )}
    </form>
  );
}

export function CompensationPolicyPanel() {
  const { session } = useAuth();
  const { t } = useTranslation("platform");
  const access = useQuery(commissionAccessQuery(session!.user.id));
  if (access.isPending) return <Loading />;
  if (access.isError) return <ErrorState retry={() => void access.refetch()} />;
  if (!access.data.can_manage_gross) return null;
  return (
    <section className="panel" aria-label={t("compensationPolicy")}>
      <h2>{t("compensationPolicy")}</h2>
      <p>{t("compensationPolicyHint")}</p>
      <PolicyEditor access={access.data} />
    </section>
  );
}
