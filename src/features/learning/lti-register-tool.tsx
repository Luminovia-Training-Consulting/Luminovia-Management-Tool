/** Start provider registration using an exact metadata URL and a reviewed public key. */
import { useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";

export function DynamicToolRegistration({
  course,
  refresh,
}: {
  course: string;
  refresh: () => void;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const registration = useMutation({
    gcTime: 0,
    mutationFn: async (form: FormData) => {
      requireOnline();
      const initiation = new URL(String(form.get("initiation")));
      const { data, error } = await db().functions.invoke<{ redirect: string }>(
        "learning-lti",
        {
          body: {
            action: "register",
            course,
            initiation: initiation.href,
            jwks: form.get("jwks"),
            key: JSON.parse(String(form.get("key"))),
            roster: form.has("roster"),
            grades: form.has("grades"),
          },
        },
      );
      if (
        error ||
        !data ||
        new URL(data.redirect).origin !== initiation.origin
      ) {
        throw new Error("lti_registration");
      }
      return data.redirect;
    },
  });
  return (
    <details>
      <summary>{t("ltiDynamicTitle")}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!registration.isPending)
            registration.mutate(new FormData(event.currentTarget));
        }}
      >
        <fieldset disabled={registration.isPending}>
          <legend>{t("ltiDynamicTitle")}</legend>
          <Field id={id + "-provider"} label={t("ltiDynamicProvider")}>
            <input
              id={id + "-provider"}
              name="initiation"
              type="url"
              required
              maxLength={1500}
            />
          </Field>
          <Field id={id + "-jwks"} label={t("ltiDynamicJwks")}>
            <input
              id={id + "-jwks"}
              name="jwks"
              type="url"
              required
              maxLength={1500}
            />
          </Field>
          <Field id={id + "-key"} label={t("ltiPublicKey")}>
            <textarea
              id={id + "-key"}
              name="key"
              rows={4}
              required
              spellCheck={false}
              maxLength={4096}
            />
          </Field>
          <label className="checkbox-row">
            <input type="checkbox" name="roster" />
            {t("ltiRoster")}
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="grades" />
            {t("ltiGradesEnable")}
          </label>
          <div className="form-actions">
            <Button type="submit">{t("ltiPrepareRegistration")}</Button>
          </div>
        </fieldset>
      </form>
      {registration.isError && (
        <Notice kind="error">{t("ltiAdvantageError")}</Notice>
      )}
      {registration.isSuccess && (
        <>
          <p>{t("ltiDynamicReviewHelp")}</p>
          <div className="form-actions">
            <a
              href={registration.data}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("ltiOpenProviderRegistration")}
            </a>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                registration.reset();
                refresh();
              }}
            >
              {t("ltiReloadConfigurations")}
            </Button>
          </div>
        </>
      )}
    </details>
  );
}
