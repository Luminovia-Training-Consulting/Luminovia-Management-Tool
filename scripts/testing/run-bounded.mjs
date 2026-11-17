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
    Array.from({ length: Math.min(limit, queue.length) }, () => worker()),
  );
  if (failed) throw failure;
}
