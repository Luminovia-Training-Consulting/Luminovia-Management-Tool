/** Standalone sign-out action for Academy and account access screens. */
import { useTranslation } from "react-i18next";
import { Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { useSignOut } from "./sign-out-state";

/** AuthProvider and the enclosing route handle the confirmed native session transition. */
export function SignOutButton({ variant }: { variant?: "secondary" }) {
  const { t } = useTranslation();
  const { pending, failed, signOut } = useSignOut();
  return (
    <>
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        onClick={() => void signOut()}
      >
        {t("logout")}
      </Button>
      {failed && <Notice kind="error">{t("signOutFailed")}</Notice>}
    </>
  );
}
