interface RangeQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}

// Callers must order by a unique key (or add one as a tie-breaker) before paging.
export async function fetchAllRows<T>(query: RangeQuery<T>): Promise<T[]> {
  const pageSize = 1000;
  const items: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    items.push(...(data ?? []));
    if (!data || data.length < pageSize) return items;
  }
}
