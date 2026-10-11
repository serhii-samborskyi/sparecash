import { expect, it } from "vitest";
import {
  orderStatistics,
  statisticsCsv,
  type StatisticsRow,
} from "../client/statistics";

it("sorts rates with missing data last in both directions without changing the report", () => {
  const rows = [
    { key: "missing", ctr: null },
    { key: "low", ctr: 0.01 },
    { key: "high", ctr: 0.2 },
  ] as StatisticsRow[];
  expect(orderStatistics(rows, "ctr", "desc").map((r) => r.key)).toEqual([
    "high",
    "low",
    "missing",
  ]);
  expect(orderStatistics(rows, "ctr", "asc").map((r) => r.key)).toEqual([
    "low",
    "high",
    "missing",
  ]);
  expect(rows[0].key).toBe("missing");
});
it("exports absent values as blanks and escapes spreadsheet formulas and commas", () => {
  const csv = statisticsCsv([
    {
      key: "key",
      label: '=HYPERLINK("bad")',
      detail: "Chicago, IL",
      visits: 2,
      adSpend: null,
      revenue: 0,
      filters: {},
    },
  ] as StatisticsRow[]);
  expect(csv).toContain(`"'=HYPERLINK(""bad"")"`);
  expect(csv).toContain('"Chicago, IL","2","","0"');
  expect(csv).not.toContain("filters");
});
