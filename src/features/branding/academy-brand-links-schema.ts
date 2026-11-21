import { z } from "zod";

export const academyBrandLinkMaxLength = 500;
const url = z
  .string()
  .max(academyBrandLinkMaxLength)
  .regex(
    /^https:\/\/([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?([/?#][A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]*)?$/,
  )
  .nullable();
const version = z.number().int().nonnegative().max(2_147_483_647);

export const academyBrandLinksSchema = z.strictObject({
  support_url: url,
  privacy_url: url,
  legal_url: url,
  terms_url: url,
});

export const academyBrandLinkSettings = academyBrandLinksSchema.extend({
  installation_id: z.uuid(),
  version,
});

export const academyBrandLinkRequest = z.strictObject({
  p_expected_version: version,
  p_support_url: url,
  p_privacy_url: url,
  p_legal_url: url,
  p_terms_url: url,
});

export type AcademyBrandLinks = z.infer<typeof academyBrandLinksSchema>;
