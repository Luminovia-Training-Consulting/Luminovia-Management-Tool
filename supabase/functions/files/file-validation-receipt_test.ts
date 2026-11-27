import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.15';
import { academyFormatReceipt, fileVerification } from './file-validation-receipt.ts';

Deno.test('only an identified Academy using format-only records the non-malware receipt', async () => {
    const bytes = new Uint8Array([1]);
    let reads = 0;
    let scans = 0;
    for (const edition of ['customer-managed', 'customer-self-hosted']) {
        const verify = fileVerification('format-only', async () => {
            reads++;
            return edition;
        }, async () => {
            scans++;
            return {clean: true, version: 'ClamAV fixture'};
        });
        assertEquals(await verify(bytes), {clean: true, version: academyFormatReceipt});
        await verify(bytes);
    }
    assertEquals(reads, 2);
    assertEquals(scans, 0);
});

Deno.test('internal and unconfigured installations still use the malware scanner', async () => {
    const result = {clean: false, version: 'ClamAV fixture'};
    const scan = async () => result;
    const bytes = new Uint8Array([1]);
    assertEquals(await fileVerification('format-only', async () => 'internal', scan)(bytes), result);
    assertEquals(await fileVerification(undefined, async () => { throw new Error('unexpected edition lookup'); }, scan)(bytes), result);
    await assertRejects(() => fileVerification('format-only', async () => undefined, scan)(bytes), Error, 'installation_unavailable');
});
