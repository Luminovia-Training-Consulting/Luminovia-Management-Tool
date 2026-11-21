import { z } from "zod";

const brandName = (length: number) =>
  z
    .string()
    .min(1)
    .max(length)
    .regex(
      // eslint-disable-next-line no-control-regex -- Public text must exclude control characters.
      /^[^\u0000-\u001f\u007f-\u009f<>\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+$/u,
    );

export const academyBrandName = brandName(72);
export const academyBrandShortName = brandName(20);
export const academyBrandColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const version = z.number().int().nonnegative().max(2_147_483_647);

export const academyBrandingSettings = z.strictObject({
  installation_id: z.uuid(),
  version,
  name: academyBrandName.nullable(),
  short_name: academyBrandShortName.nullable(),
  theme_color: academyBrandColor.nullable(),
});

export const academyBrandingRequest = z.union([
  z.strictObject({
    p_expected_version: version,
    p_name: academyBrandName,
    p_short_name: academyBrandShortName,
    p_theme_color: academyBrandColor,
  }),
  z.strictObject({
    p_expected_version: version,
    p_name: z.null(),
    p_short_name: z.null(),
    p_theme_color: z.null(),
  }),
]);

export type AcademyBrandingSettings = z.infer<typeof academyBrandingSettings>;
export type AcademyBrandingValues = Pick<
  AcademyBrandingSettings,
  "name" | "short_name" | "theme_color"
>;
