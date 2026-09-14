//-----------------------------------------------------------------------
// Semantic Directory — bounded-concurrency async map.
//
// Runs `task` over `items` with at most `limit` in flight at once, preserving
// input order in the results. Like `Promise.allSettled(items.map(task))` but it
// never fires every request simultaneously — used to stage the live dimension
// -value batches so we don't stampede the model with dozens of parallel DAX
// queries. Deterministic ordering; never throws (per-item failures are captured).
//-----------------------------------------------------------------------

export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    task: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    const bound = Math.max(1, Math.min(limit, items.length));
    let cursor = 0;

    const worker = async (): Promise<void> => {
        for (;;) {
            const index = cursor++;
            if (index >= items.length) return;
            try {
                results[index] = { status: "fulfilled", value: await task(items[index], index) };
            } catch (reason) {
                results[index] = { status: "rejected", reason };
            }
        }
    };

    await Promise.all(Array.from({ length: bound }, worker));
    return results;
}
