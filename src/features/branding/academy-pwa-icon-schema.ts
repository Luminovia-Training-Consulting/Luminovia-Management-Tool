import { z } from "zod";
import { academyLogoVersion } from "./academy-logo-schema.ts";

export const academyPwaIcon = z.strictObject({
  installation_id: z.uuid(),
  version: academyLogoVersion,
  custom: z.boolean(),
});
