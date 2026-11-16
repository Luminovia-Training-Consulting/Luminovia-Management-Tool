/**
 * Password change after an authenticated invitation/recovery flow. Validate input locally and
 * confirm saving only after a successful Auth response.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { Button } from "../../components/ui/button";
import { Field, Notice, PageHeading } from "../../components/common";
import { useOnline } from "../../lib/online";
/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const schema = z.object({
  password: z.string().min(12).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/),
});
/** Change the current session's password and confirm only the successful SDK response. */
export function Password() {
  const { t } = useTranslation();
  const online = useOnline();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <div className="narrow">
      <PageHeading title={t("setPassword")} description={t("passwordHint")} />
      <form
        className="panel"
        onSubmit={handleSubmit(async (values) => {
          if (!online) return;
          setMessage("");
          setFailed(false);
          try {
            const { error } = await db().auth.updateUser(values);
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
            autoComplete="new-password"
            {...register("password")}
          />
        </Field>
        <Button disabled={!online || isSubmitting}>{t("setPassword")}</Button>
        {message && (
          <Notice kind={failed ? "error" : "success"}>{t(message)}</Notice>
        )}
      </form>
    </div>
  );
}
