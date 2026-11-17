/** Runs independent acceptance cases with bounded concurrency and orderly failure handling. */
export async function runBounded(items, limit, run) {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("A positive integer concurrency limit is required.");
  const queue = [...items];
  let next = 0;
  let failure;
  const worker = async () => {
    while (!failure) {
      const index = next++;
      if (index >= queue.length) return;
      try {
        await run(queue[index], index);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, () => worker()),
  );
  if (failure) throw failure;
}
