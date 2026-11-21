/** Server-enforced directory/profile expertise visibility, separate from eligibility. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "../../components/ui/button";
import { ErrorState, Loading, Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import "./topic-visibility-i18n";

const schema = z.object({
  visible: z.boolean(),
  version: z.number().int().nonnegative(),
  can_share: z.boolean(),
});
type Preference = z.infer<typeof schema>;

function Form({
  actor,
  initial,
  reload,
}: {
  actor: string;
  initial: Preference;
  reload: () => Promise<Preference | undefined>;
}) {
  const { t } = useTranslation("topicVisibility"),
    client = useQueryClient(),
    online = useOnline();
  const [draft, setDraft] = useState({
    visible: initial.visible,
    version: initial.version,
  });
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { data, error } = await db().rpc("save_profile_topic_preferences", {
        p_visible: draft.visible,
        p_expected_version: draft.version,
      });
      if (error) throw error;
      return schema.parse(data);
    },
    onSuccess: async (data) => {
      client.setQueryData(["profile-topic-visibility", actor], data);
      setDraft({ visible: data.visible, version: data.version });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["people-directory"] }),
        client.invalidateQueries({ queryKey: ["person"] }),
      ]);
    },
  });
  const conflict = Boolean(
    save.error &&
    typeof save.error === "object" &&
    "code" in save.error &&
    save.error.code === "40001",
  );
  return (
    <form
      className="panel profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2>{t("title")}</h2>
      <p>{t("help")}</p>
      <label>
        <input
          type="checkbox"
          checked={draft.visible}
          disabled={
            !online || save.isPending || (!initial.can_share && !draft.visible)
          }
          onChange={(event) =>
            setDraft((previous) => ({
              ...previous,
              visible: event.target.checked,
            }))
          }
        />{" "}
        {t("visible")}
      </label>
      {save.isError && (
        <Notice kind="error">{t(conflict ? "conflict" : "error")}</Notice>
      )}
      {conflict && (
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void reload().then((data) => {
              if (data) {
                setDraft({ visible: data.visible, version: data.version });
                save.reset();
              }
            })
          }
        >
          {t("reload")}
        </Button>
      )}
      {save.isSuccess && draft.visible === initial.visible && (
        <Notice>{t("saved")}</Notice>
      )}
      <div>
        <Button
          type="submit"
          disabled={
            !online || save.isPending || draft.visible === initial.visible
          }
        >
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

export function OwnTopicVisibility({ actor }: { actor: string }) {
  const { t } = useTranslation("topicVisibility");
  const query = useQuery({
    queryKey: ["profile-topic-visibility", actor],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("profile_topic_preferences")
        .abortSignal(signal);
      if (error) throw error;
      return schema.parse(data);
    },
    retry: false,
  });
  return query.isPending ? (
    <Loading />
  ) : query.isError ? (
    <section aria-label={t("title")}>
      <ErrorState retry={() => void query.refetch()} />
    </section>
  ) : (
    <Form
      key={actor}
      actor={actor}
      initial={query.data}
      reload={async () => {
        const result = await query.refetch();
        return result.isSuccess ? result.data : undefined;
      }}
    />
  );
}
