/**
 * Scope the untyped web-push package to the one API used by browser fixtures.
 * Its locked implementation exports `generateVAPIDKeys()` with string public
 * and private keys; keeping the declaration narrow makes future untyped uses
 * fail until their actual package contract is documented.
 */
declare module "web-push" {
  /** URL-safe base64 VAPID key strings returned by the package implementation. */
  export interface GeneratedVapidKeys {
    publicKey: string;
    privateKey: string;
  }

  /** Generates a fresh P-256 VAPID public/private key pair for a fictional fixture. */
  export function generateVAPIDKeys(): GeneratedVapidKeys;
}
