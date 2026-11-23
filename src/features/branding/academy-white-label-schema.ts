import { z } from "zod";
import {
  academyBrandingRequest,
  academyBrandingSettings,
} from "./academy-branding-schema.ts";
import {
  academyBrandLinkRequest,
  academyBrandLinkSettings,
} from "./academy-brand-links-schema.ts";

const versions = {
  p_expected_brand_version: academyBrandingSettings.shape.version,
  p_expected_links_version: academyBrandLinkSettings.shape.version,
};
const links = academyBrandLinkRequest.omit({ p_expected_version: true }).shape;

export const academyWhiteLabelRequest = z.union([
  academyBrandingRequest.options[0]
    .omit({ p_expected_version: true })
    .extend({ ...versions, ...links }),
  academyBrandingRequest.options[1]
    .omit({ p_expected_version: true })
    .extend({ ...versions, ...links }),
]);

export const academyWhiteLabelReceipt = z.strictObject({
  branding: academyBrandingSettings,
  links: academyBrandLinkSettings,
});
