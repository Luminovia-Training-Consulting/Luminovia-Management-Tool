/** Share the save and version-conflict controls for actor-owned notification settings. */
import { useTranslation } from "react-i18next";
import { Notice } from "../../components/common";
import { Button } from "../../components/ui/button";

/** Keep a user's edits on conflict until they explicitly reload a confirmed server value. */
export function PreferenceSaveControls<T>({
  namespace,
  online,
  dirty,
  invalid = false,
  save,
  reload,
  reset,
}: {
  namespace: "attention" | "delivery" | "inbox";
  online: boolean;
  dirty: boolean;
  invalid?: boolean;
  save: {
    error: unknown;
    isError: boolean;
    isPending: boolean;
    isSuccess: boolean;
    reset: () => void;
  };
  reload: () => Promise<T | undefined>;
  reset: (data: T) => void;
}) {
  const { t } = useTranslation(namespace);
  const { error } = save;
  const conflict =
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "PT409" || error.code === "40001");

  return (
    <>
      {save.isError && (
        <Notice kind="error">
          {t(invalid ? "validation" : conflict ? "conflict" : "error")}
        </Notice>
      )}
      {Boolean(conflict) && (
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void reload().then((data) => {
              if (data !== undefined) {
                reset(data);
                save.reset();
              }
            })
          }
        >
          {t("reload")}
        </Button>
      )}
      {save.isSuccess && !dirty && <Notice>{t("saved")}</Notice>}
      <Button type="submit" disabled={!online || save.isPending || !dirty}>
        {t("save")}
      </Button>
    </>
  );
}
