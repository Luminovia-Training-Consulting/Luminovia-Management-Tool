import { queryOptions } from "@tanstack/react-query";
import { installationBrand } from "../../lib/installation-brand";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import { sessionCacheBoundary } from "../auth/session-cache-boundary";
import {
  academyLogoVersionRequest,
  academyPublicLogo,
} from "./academy-logo-schema";

function verifyLogo(value: unknown) {
  const result = academyPublicLogo.parse(value);
  if (result.installation_id !== installationBrand.installationId) {
    throw new Error("academy_logo_unavailable");
  }
  return result;
}

export function useAcademyLogoQuery() {
  const { session } = useAuth();
  return queryOptions({
    queryKey: [
      "academy-public-logo",
      installationBrand.installationId,
      session?.user.id,
      sessionCacheBoundary(session?.access_token),
    ],
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_public_logo", {}, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return verifyLogo(data);
    },
  });
}

export async function saveAcademyLogo(version: number, file: File | null) {
  requireOnline();
  const request = academyLogoVersionRequest.parse({
    p_expected_version: version,
  });
  if (!file) {
    const { data, error } = await db().rpc(
      "clear_academy_public_logo",
      request,
    );
    if (error) throw error;
    return verifyLogo(data);
  }
  const { data, error } = await db().auth.getSession();
  if (error || !data.session) throw new Error("access_denied");
  const endpoint = new URL(
    `${import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, "")}/functions/v1/files`,
    window.location.origin,
  );
  endpoint.searchParams.set("mode", "academy-logo");
  endpoint.searchParams.set(
    "expected_version",
    String(request.p_expected_version),
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "image/png",
    },
    cache: "no-store",
    body: file,
  });
  if (!response.ok) {
    if (response.status === 409)
      throw Object.assign(new Error("logo_changed"), { code: "PT409" });
    const payload: unknown = await response.json().catch(() => null);
    const code = (payload as { error?: unknown } | null)?.error;
    throw new Error(typeof code === "string" ? code : "logo_upload_failed");
  }
  return verifyLogo(await response.json());
}
