import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, type ImgHTMLAttributes } from "react";
import { installationBrand } from "../../lib/installation-brand";
import { useOnline } from "../../lib/online";
import { isConfigured } from "../../lib/supabase";
import { useAcademyLogoQuery } from "./academy-logo";

type LogoImageProps = Pick<
  ImgHTMLAttributes<HTMLImageElement>,
  "className" | "alt"
> & { fallback?: string };

export function AcademyLogoImage({
  blob,
  fallback,
  ...props
}: LogoImageProps & { blob?: Blob }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!blob || !element) return;
    const url = URL.createObjectURL(blob);
    element.src = url;
    return () => {
      if (fallback) element.src = fallback;
      else element.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [blob, fallback]);
  return (
    <img
      ref={ref}
      src={fallback}
      {...props}
      onError={(event) => {
        if (fallback && event.currentTarget.src.startsWith("blob:"))
          event.currentTarget.src = fallback;
      }}
    />
  );
}

export function AcademyBrandImage(props: LogoImageProps) {
  const online = useOnline();
  const query = useQuery({
    ...useAcademyLogoQuery(),
    enabled:
      online && isConfigured && Boolean(installationBrand.installationId),
  });
  const encoded = online && !query.isError ? query.data?.png_base64 : null;
  const blob = useMemo(() => {
    if (!encoded) return undefined;
    try {
      const bytes = Uint8Array.from(atob(encoded), (byte) =>
        byte.charCodeAt(0),
      );
      return new Blob([bytes], { type: "image/png" });
    } catch {
      return undefined;
    }
  }, [encoded]);
  return <AcademyLogoImage {...props} blob={blob} />;
}
