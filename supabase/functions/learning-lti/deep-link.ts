/** Signed Deep Linking tool responses stage course content for authenticated review. */
import { boundedBytes, RequestBodyTooLarge } from "../_shared/bounded-body.ts";
import {
  bounded,
  ltiClaim,
  toolJwt,
  type ToolRegistration,
  uuid,
} from "./tool-jwt.ts";

const decoder = new TextDecoder("utf-8", { fatal: true });
const dataClaim = "https://purl.imsglobal.org/spec/lti-dl/claim/";
type Item = { title: string; url: string; custom: Record<string, string> };

type Backend = {
  registration: (
    client: string,
    deployment: string | null,
  ) => Promise<ToolRegistration | null>;
  receive: (
    registration: ToolRegistration,
    data: string,
    item: Item | null,
  ) => Promise<{ id: string; origin: string } | null>;
};

/** Accept a single LTI Resource Link with no HTML, file, media or line-item import. */
function selectedItem(input: unknown): Item | null {
  if (!Array.isArray(input) || input.length > 1) {
    throw new Error("selection_count");
  }
  if (input.length === 0) return null;
  const item = input[0];
  if (
    !item || typeof item !== "object" || item.type !== "ltiResourceLink" ||
    !bounded(item.title, 160) || !bounded(item.url, 1500)
  ) throw new Error("selection_shape");
  const destination = new URL(item.url);
  if (
    destination.protocol !== "https:" || destination.username ||
    destination.password ||
    destination.hash || /[\s\\]/.test(item.url)
  ) throw new Error("selection_destination");
  const custom = item.custom === undefined ? {} : item.custom;
  if (
    !custom || typeof custom !== "object" || Array.isArray(custom) ||
    JSON.stringify(custom).length > 4096 ||
    Object.entries(custom).some(([key, value]) =>
      !/^[A-Za-z0-9_]{1,80}$/.test(key) ||
      (value !== "" && !bounded(value, 512))
    )
  ) throw new Error("selection_parameters");
  return { title: item.title, url: item.url, custom };
}

export function createLtiDeepLink(
  base: string,
  issuer: string,
  origins: string[],
  backend: Backend,
) {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  return {
    settings(data: string) {
      return {
        [dataClaim + "deep_linking_settings"]: {
          deep_link_return_url: base + "/deep-link-return",
          accept_types: ["ltiResourceLink"],
          accept_presentation_document_targets: ["window"],
          accept_multiple: false,
          accept_lineitem: false,
          auto_create: false,
          data,
        },
      };
    },
    async receive(request: Request) {
      const invalid = (status: number) =>
        Response.json({ error: "lti_deep_link" }, { status, headers });
      if (
        request.headers.get("content-type")?.split(";", 1)[0].trim()
          .toLowerCase() !== "application/x-www-form-urlencoded"
      ) {
        return invalid(400);
      }
      try {
        const form = new URLSearchParams(
          decoder.decode(await boundedBytes(request, 16_384)),
        );
        const credential = form.get("JWT");
        if (form.getAll("JWT").length !== 1 || !bounded(credential, 12_288)) {
          return invalid(400);
        }
        const verified = await toolJwt(
          credential,
          issuer,
          backend.registration,
        );
        if (!verified) return invalid(403);
        const { claims, registration } = verified;
        const data = claims[dataClaim + "data"];
        if (
          claims[ltiClaim + "message_type"] !== "LtiDeepLinkingResponse" ||
          claims[ltiClaim + "version"] !== "1.3.0" ||
          claims[ltiClaim + "deployment_id"] !== registration.id ||
          typeof data !== "string" || !/^[0-9a-f]{64}$/.test(data)
        ) return invalid(403);

        const item = selectedItem(claims[dataClaim + "content_items"]);
        const received = await backend.receive(registration, data, item);
        if (
          !received || !uuid.test(received.id) ||
          !origins.includes(received.origin)
        ) {
          return invalid(403);
        }
        const origin = new URL(received.origin);
        if (origin.protocol !== "https:" || origin.origin !== received.origin) {
          return invalid(403);
        }
        const location = new URL("/lti/selection", origin);
        location.hash = received.id;
        return new Response(null, {
          status: 303,
          headers: { ...headers, Location: location.href },
        });
      } catch (error) {
        return invalid(error instanceof RequestBodyTooLarge ? 413 : 400);
      }
    },
  };
}
