import { type FormEvent, useId, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import { inviteAcademyLearner } from "../accounts/academy-api";

export function AcademyCompanyInvitation({ courseId }: { courseId: string }) {
  const { t } = useTranslation("learning");
  const field = useId();
  const online = useOnline();
  const request = useRef<{ email: string; name: string; id: string }>(null);
  const send = useMutation({ mutationFn: inviteAcademyLearner });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online || send.isPending) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const name = String(values.get("name") ?? "").trim();
    const email = String(values.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!name || !email) return;
    if (request.current?.email !== email || request.current.name !== name) {
      request.current = { email, name, id: crypto.randomUUID() };
    }
    send.mutate(
      {
        course_id: courseId,
        display_name: name,
        email,
        idempotency_key: request.current.id,
      },
      {
        onSuccess: () => {
          form.reset();
          request.current = null;
        },
      },
    );
  }

  return (
    <section className="panel" aria-labelledby={`${field}-heading`}>
      <h2 id={`${field}-heading`}>{t("academyInviteLearner")}</h2>
      <form className="form" onSubmit={submit}>
        <fieldset className="form" disabled={!online || send.isPending}>
          <Field id={`${field}-name`} label={t("academyInvitationName")}>
            <input name="name" autoComplete="off" required maxLength={120} />
          </Field>
          <Field id={`${field}-email`} label={t("academyInvitationEmail")}>
            <input
              name="email"
              type="email"
              autoComplete="off"
              required
              maxLength={254}
            />
          </Field>
          <Button type="submit">{t("academyInviteLearner")}</Button>
        </fieldset>
      </form>
      {send.isSuccess && <Notice>{t("academyInvitationRequested")}</Notice>}
      {send.isError && (
        <Notice kind="error">{t("academyInvitationUnavailable")}</Notice>
      )}
    </section>
  );
}
