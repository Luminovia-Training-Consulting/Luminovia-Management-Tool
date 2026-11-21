import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { courseChatProtectionSchema } from "./course-chat-protection-schema";
import "./course-chat-i18n";

export function CourseChatProtection({
  run,
  actor,
}: {
  run: string;
  actor: string;
}) {
  const { t } = useTranslation("courseChat");
  const online = useOnline();
  const client = useQueryClient();
  const title = useId();
  const key = ["course-chat-protection", actor, run];
  const protection = useQuery({
    queryKey: key,
    enabled: online,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await db().rpc("course_chat_protection", {
        p_run_id: run,
      });
      if (error) throw error;
      return courseChatProtectionSchema.parse(data);
    },
  });
  const save = useMutation({
    mutationFn: async ({
      global,
      enabled,
      version,
    }: {
      global: boolean;
      enabled: boolean;
      version: number;
    }) => {
      requireOnline();
      const { data, error } = await db().rpc("set_course_chat_protection", {
        p_run_id: run,
        p_global: global,
        p_enabled: enabled,
        p_expected_version: version,
      });
      if (error) throw error;
      return courseChatProtectionSchema.parse(data);
    },
    onSuccess: (result) => client.setQueryData(key, result),
    onError: () => client.invalidateQueries({ queryKey: key }),
  });

  if (
    !online ||
    protection.isError ||
    !protection.isFetchedAfterMount ||
    !protection.data
  )
    return null;

  const state = protection.data;
  return (
    <section aria-labelledby={title}>
      <h3 id={title}>{t("protectionTitle")}</h3>
      <p>{t("protectionHint")}</p>
      {state.global_enforced && <p>{t("protectionGlobalEnforced")}</p>}
      <div className="form-actions">
        {(["global", "company"] as const).map((scope) => {
          const setting = state[scope];
          const label = t(
            scope === "global" ? "protectionGlobal" : "protectionCompany",
          );
          return (
            setting && (
              <Button
                key={scope}
                type="button"
                variant={setting.enabled ? "default" : "secondary"}
                role="switch"
                aria-label={label}
                aria-checked={setting.enabled}
                disabled={!state.can_write || save.isPending}
                onClick={() =>
                  save.mutate({
                    global: scope === "global",
                    enabled: !setting.enabled,
                    version: setting.version,
                  })
                }
              >
                {label}
                <span aria-hidden="true">
                  · {t(setting.enabled ? "protectionOn" : "protectionOff")}
                </span>
              </Button>
            )
          );
        })}
      </div>
      {save.isSuccess && <p role="status">{t("protectionSaved")}</p>}
      {save.isError && <Notice kind="error">{t("protectionFailed")}</Notice>}
    </section>
  );
}
