import { z } from "zod";

export const academyLogoMaxBytes = 256 * 1024;
export const academyLogoVersion = z
  .number()
  .int()
  .nonnegative()
  .max(2_147_483_647);
export const academyLogoVersionRequest = z.strictObject({
  p_expected_version: academyLogoVersion,
});

export const academyPublicLogo = z.strictObject({
  installation_id: z.uuid(),
  version: academyLogoVersion,
  png_base64: z
    .string()
    .min(76)
    .max(4 * Math.ceil(academyLogoMaxBytes / 3))
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .nullable(),
});
