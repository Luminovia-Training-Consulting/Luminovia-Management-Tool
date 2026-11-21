/**
 * Profile images and own avatar editor with local fallback. Bind object URLs to actor, target
 * and selection; dispose them on replacement, offline transitions or unmount.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { uploadDocument } from "../files/api";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import {
  avatarQuery,
  prepareAvatar,
  readAvatar,
  selectAvatar,
} from "./avatar-api";
import "./avatar-i18n";
import "./avatar.css";

/** Show only bytes matching the active actor/selection; fall back to initials when no permitted image is available. */
export function Avatar({
  userId,
  name,
  size = "small",
  decorative = false,
}: {
  userId: string;
  name: string;
  size?: "small" | "large";
  decorative?: boolean;
}) {
  const { session } = useAuth();
  const { t } = useTranslation("avatar");
  const online = useOnline();
  const actor = session?.user.id ?? "";
  const selection = useQuery({
    ...avatarQuery(actor, userId),
    enabled: Boolean(actor && userId) && online,
  });
  const version = !selection.isError ? selection.data?.version_id : undefined;
  const image = useQuery({
    queryKey: ["avatar-image", actor, userId, version],
    queryFn: ({ signal }) => readAvatar(userId, signal),
    enabled: Boolean(actor && version) && online,
    retry: false,
    gcTime: 0,
    // Bytes are immutable for this exact actor/target/version key. The separate
    // selection query revalidates access/version on focus and reconnect; avoid
    // fetching the same image again merely because the window regained focus.
    staleTime: Infinity,
  });
  const blob = online && !image.isError && version ? image.data : undefined;
  const imageElement = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = imageElement.current;
    if (!blob || !element) return;
    const url = URL.createObjectURL(blob);
    element.src = url;
    // Hidden is derived during render, so an old actor/version is concealed
    // before this external browser resource is revoked during effect cleanup.
    return () => {
      element.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  return (
    <span
      className={`profile-avatar profile-avatar-${size}`}
      aria-hidden={decorative || undefined}
    >
      <img
        ref={imageElement}
        hidden={!blob}
        alt={decorative ? "" : t("image", { name })}
      />
      <span
        hidden={Boolean(blob)}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : t("image", { name })}
      >
        {(name.trim() || "L").slice(0, 1).toLocaleUpperCase()}
      </span>
    </span>
  );
}

/** Combine local image preparation, actual scanned upload and version-bound own-avatar selection. */
export function AvatarEditor({ name }: { name: string }) {
  const { session } = useAuth();
  const { t } = useTranslation("avatar");
  const online = useOnline();
  const cache = useQueryClient();
  const actor = session!.user.id;
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = useQuery({ ...avatarQuery(actor, actor), enabled: online });
  const [progress, setProgress] = useState(0);
  const [removed, setRemoved] = useState(false);
  const mutation = useMutation({
    mutationFn: async (file: File | null) => {
      setRemoved(file === null);
      setProgress(0);
      if (file) {
        const prepared = await prepareAvatar(file);
        const document = await uploadDocument(
          prepared,
          { scope: "personal", kind: "avatar" },
          setProgress,
        );
        await selectAvatar(document.current_version_id);
      } else await selectAvatar(null);
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["avatar", actor] });
      cache.removeQueries({ queryKey: ["avatar-image", actor] });
    },
  });
  return (
    <section className="panel avatar-editor">
      <Avatar userId={actor} name={name} size="large" />
      <div>
        <h2>{t("title")}</h2>
        <p>{t("help")}</p>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) mutation.mutate(file);
          }}
        />
        <div className="form-actions">
          <Button
            variant="secondary"
            disabled={!online || mutation.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {t("choose")}
          </Button>
          <Button
            variant="ghost"
            disabled={!online || mutation.isPending || !selected.data}
            onClick={() => mutation.mutate(null)}
          >
            {t("remove")}
          </Button>
        </div>
        {mutation.isPending && (
          <p role="status">
            {t("busy")} {progress > 0 && `${progress} %`}
          </p>
        )}
        {mutation.isError && (
          <Notice kind="error">
            {t(
              mutation.error instanceof Error &&
                mutation.error.message === "avatar_file_too_large"
                ? "tooLarge"
                : "error",
            )}
          </Notice>
        )}
        {mutation.isSuccess && (
          <Notice>{t(removed ? "removed" : "saved")}</Notice>
        )}
      </div>
    </section>
  );
}
