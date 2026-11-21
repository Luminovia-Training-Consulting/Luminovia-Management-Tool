/**
 * Password change after an authenticated invitation/recovery flow. Validate input locally and
 * confirm saving only after a successful Auth response.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../../lib/supabase";
import { Button } from "../../components/ui/button";
import { Preferences } from "../../components/preferences";
import { Field, Notice, PageHeading } from "../../components/common";
import { useOnline } from "../../lib/online";

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const schema = z.object({
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(/[A-Z]/)
    .regex(/[a-z]/)
    .regex(/[0-9]/)
    .regex(/[!@#$%^&*()_+\-=[\]{}|;:,.<>?/]/),
});

/** Change the current session's password and confirm only the successful SDK response. */
export function Password({
  onSetupComplete,
}: {
  onSetupComplete?: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const form = (
    <div className="narrow">
      <PageHeading
        title={t("setPassword")}
        description={t(
          onSetupComplete ? "initialPasswordHint" : "passwordHint",
        )}
      />
      <form
        className="panel"
        onSubmit={handleSubmit(async (values) => {
          if (!online) return;
          setMessage("");
          setFailed(false);
          try {
            const { error } = await db().auth.updateUser(values);
            if (!error && onSetupComplete) {
              await onSetupComplete();
              navigate("/", { replace: true });
              return;
            }
            setFailed(Boolean(error));
            setMessage(error ? "error" : "passwordSaved");
          } catch {
            setFailed(true);
            setMessage("error");
          }
        })}
      >
        <Field
          id="new-password"
          label={t("newPassword")}
          error={Boolean(errors.password)}
        >
          <input
            id="new-password"
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            aria-describedby={
              errors.password ? "password-validation" : undefined
            }
            {...register("password")}
          />
        </Field>
        {errors.password && (
          <p id="password-validation" role="alert">
            {t("passwordHint")}
          </p>
        )}
        <Button disabled={!online || isSubmitting}>{t("setPassword")}</Button>
        {message && (
          <Notice kind={failed ? "error" : "success"}>{t(message)}</Notice>
        )}
        {message === "passwordSaved" && (
          <Button asChild variant="secondary">
            <Link to="/">{t("goHome")}</Link>
          </Button>
        )}
      </form>
    </div>
  );
  if (!onSetupComplete) return form;
  return (
    <main className="password-setup">
      <div className="password-setup-actions">
        <Preferences />
        <Button variant="secondary" onClick={() => void db().auth.signOut()}>
          {t("logout")}
        </Button>
      </div>
      {form}
    </main>
  );
}
