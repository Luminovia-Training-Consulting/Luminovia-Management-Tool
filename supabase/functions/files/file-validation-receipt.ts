/** Select the verification receipt after the file gateway validates the bytes.
 * Only the server's installation identity can enable Academy format-only checks.
 */
type VerificationReceipt = { clean: boolean; version: string };

export const academyFormatReceipt = 'Academy file validation v1 (no malware scan)';

export function fileVerification(
    mode: string | undefined,
    readEdition: () => Promise<unknown>,
    malwareScan: (bytes: Uint8Array) => Promise<VerificationReceipt>,
) {
    // Cache only within the authenticated request, including its PWA icon variants.
    let edition: Promise<unknown> | undefined;
    return async (bytes: Uint8Array): Promise<VerificationReceipt> => {
        if (mode !== 'format-only') return await malwareScan(bytes);
        const current = await (edition ??= readEdition());
        if (current === 'customer-managed' || current === 'customer-self-hosted') {
            return {clean: true, version: academyFormatReceipt};
        }
        if (current === 'internal') return await malwareScan(bytes);
        throw new Error('installation_unavailable');
    };
}
