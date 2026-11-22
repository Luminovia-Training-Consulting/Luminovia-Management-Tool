import { useEffect, useMemo, useRef, type ImgHTMLAttributes } from "react";
import { useAcademyLogoPng } from "./academy-logo";

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
  const encoded = useAcademyLogoPng();
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
