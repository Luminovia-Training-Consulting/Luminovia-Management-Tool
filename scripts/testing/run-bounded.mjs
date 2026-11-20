/** Runs independent acceptance cases with bounded concurrency and orderly failure handling. */
export async function runBounded(items, limit, run) {
    if (!Number.isInteger(limit) || limit < 1)
        throw new Error("A positive integer concurrency limit is required.");
    const queue = [...items];
    let next = 0;
    let failed = false;
    let failure;
    const worker = async () => {
        while (!failed) {
            const index = next++;
            if (index >= queue.length) return;
            try {
                await run(queue[index], index);
            } catch (error) {
                if (!failed) {
                    failed = true;
                    failure = error;
                }
            }
        }
    };
    await Promise.all(
        Array.from({length: Math.min(limit, queue.length)}, () => worker()),
    );
    if (failed) throw failure;
}

/** Runs every item with bounded concurrency and returns ordered all-settled results. */
export async function mapBoundedSettled(items, limit, run) {
    if (!Number.isInteger(limit) || limit < 1)
        throw new Error("A positive integer concurrency limit is required.");
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            try {
                results[index] = {
                    status: "fulfilled",
                    value: await run(items[index], index),
                };
            } catch (reason) {
                results[index] = {status: "rejected", reason};
            }
        }
    };
    await Promise.all(
        Array.from({length: Math.min(limit, items.length)}, () => worker()),
    );
    return results;
}