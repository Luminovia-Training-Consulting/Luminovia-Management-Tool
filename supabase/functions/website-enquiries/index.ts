/** Deploy the reviewed integration-only handler using private worker environment configuration. */
import { websiteEnquiryRuntime } from "./runtime.ts";
Deno.serve(websiteEnquiryRuntime((name) => Deno.env.get(name)));
