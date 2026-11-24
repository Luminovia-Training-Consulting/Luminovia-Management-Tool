import { useMutation, useQueryClient } from "@tanstack/react-query";
import { profileQuery } from "./queries";
import { saveUiPreferences } from "./ui-preferences-api";

/** Use the same account record for the profile and the header language picker. */
export function useSaveUiPreferences(actor: string) {
  const cache = useQueryClient();
  const profile = profileQuery(actor).queryKey;
  return useMutation({
    scope: { id: `account-ui:${actor}` },
    mutationFn: (patch: Parameters<typeof saveUiPreferences>[0]) =>
      saveUiPreferences(patch),
    async onSuccess(saved, patch) {
      if (!patch.language) return;
      await cache.cancelQueries({ queryKey: profile, exact: true });
      cache.setQueryData(profile, (current) =>
        current ? { ...current, locale: saved.language } : current,
      );
    },
  });
}
