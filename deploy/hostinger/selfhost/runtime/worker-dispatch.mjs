/**
 * @param {Request} request
 * @param {object} options
 * @param {() => Promise<{fetch(request: Request): Promise<Response>}>} options.createWorker
 * @param {(request: Request) => Request} options.prepareRequest
 * @param {(error: unknown) => boolean} options.isRetired
 * @param {(retriesLeft: number) => void} options.onRetry
 * @param {number} options.maxRetries
 */
export async function dispatchToWorker(request, options) {
    let retriesLeft = options.maxRetries;
    const bodyless = request.body === null;

    for (;;) {
        let canRetry = true;
        try {
            const worker = await options.createWorker();
            // Forward a live stream only once. Cloning here creates an unread
            // tee branch that buffers the entire upload in the main isolate.
            canRetry = bodyless;
            return await worker.fetch(options.prepareRequest(request));
        } catch (error) {
            if (!canRetry || retriesLeft === 0 || !options.isRetired(error)) {
                throw error;
            }
            options.onRetry(retriesLeft);
            retriesLeft -= 1;
        }
    }
}
