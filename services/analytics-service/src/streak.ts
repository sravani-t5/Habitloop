const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** days = set of YYYY-MM-DD with >=1 completed log. Current streak may end today or yesterday. */
export function computeStreaks(days: Set<string>, today: string) {
  let current = 0;
  let cursor = days.has(today) ? today : addDays(today, -1);
  while (days.has(cursor)) { current++; cursor = addDays(cursor, -1); }
  let longest = 0, run = 0, prev = "";
  for (const d of [...days].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run); prev = d;
  }
  return { current, longest };
}
