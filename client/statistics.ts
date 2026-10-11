import type { StatisticsReport } from "../server/services/statistics";
export type StatisticsRow = StatisticsReport["rows"][number];
export type NumericMetric = {
  [K in keyof StatisticsRow]: StatisticsRow[K] extends number | null
    ? K
    : never;
}[keyof StatisticsRow];
export function orderStatistics(
  rows: StatisticsRow[],
  key: NumericMetric,
  direction: "asc" | "desc",
) {
  return [...rows].sort((a, b) => {
    const x = a[key],
      y = b[key];
    if (x === null) return y === null ? a.key.localeCompare(b.key) : 1;
    if (y === null) return -1;
    return (direction === "asc" ? x - y : y - x) || a.key.localeCompare(b.key);
  });
}
export function statisticsCsv(rows: StatisticsRow[]) {
  const keys = rows.length
    ? Object.keys(rows[0]).filter((k) => !["key", "filters"].includes(k))
    : ["label", "detail", "visits"];
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : String(value);
    // Prevent spreadsheet formulas from provider names or geographic labels.
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text))
      text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    keys.map(cell).join(","),
    ...rows.map((row) =>
      keys.map((k) => cell(row[k as keyof StatisticsRow])).join(","),
    ),
  ].join("\r\n");
}
