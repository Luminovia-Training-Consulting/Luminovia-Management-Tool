import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { Button } from "../../components/ui/button";
import { Field, Notice, PageHeading } from "../../components/common";
import { useOnline } from "../../lib/online";
const schema = z.object({
  password: z.string().min(12).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/),
});
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
          const { error } = await db().auth.updateUser(values);
          setFailed(Boolean(error));
          setMessage(t(error ? "error" : "passwordSaved"));
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
          <Notice kind={failed ? "error" : "success"}>{message}</Notice>
        )}
      </form>
    </div>
  );
}
