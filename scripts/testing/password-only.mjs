import assert from "node:assert/strict";

/** Assert the portal's only supported authentication state: password-only AAL1 with no factors. */
export async function assertPasswordOnly(client) {
    const {data: assurance, error: assuranceError} =
        await client.auth.mfa.getAuthenticatorAssuranceLevel();
    assert.equal(assuranceError, null, assuranceError?.message);
    assert.equal(assurance.currentLevel, "aal1");
    const {data: factors, error: factorsError} =
        await client.auth.mfa.listFactors();
    assert.equal(factorsError, null, factorsError?.message);
    assert.deepEqual(factors, {
        all: [],
        totp: [],
        phone: [],
        webauthn: [],
        recovery_code: [],
    });
}