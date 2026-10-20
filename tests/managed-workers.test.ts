import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setting: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  conversion: { groupBy: vi.fn() },
  enrollment: { count: vi.fn() },
  audit: { create: vi.fn() },
  transaction: vi.fn(),
  tick: vi.fn(),
  processConversions: vi.fn(),
}));

vi.mock("../server/db", () => ({
  db: {
    setting: mocks.setting,
    advertiserConversion: mocks.conversion,
    enrollment: mocks.enrollment,
    auditLog: mocks.audit,
    $transaction: mocks.transaction,
  },
}));
vi.mock("../server/services/engine", () => ({ tick: mocks.tick }));
vi.mock("../server/services/advertiser-conversions", () => ({
  processAdvertiserConversions: mocks.processConversions,
}));
vi.mock("../server/runtime-config", () => ({
  withRuntimeConfiguration: (run: () => Promise<unknown>) => run(),
}));

import {
  controlManagedWorker,
  managedWorkerStatuses,
  runManagedWorkerIfEnabled,
} from "../server/services/managed-workers";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setting.findUnique.mockResolvedValue(null);
  mocks.setting.findMany.mockResolvedValue([]);
  mocks.setting.upsert.mockResolvedValue({});
  mocks.conversion.groupBy.mockResolvedValue([]);
  mocks.enrollment.count.mockResolvedValue(0);
  mocks.audit.create.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (operations: Promise<unknown>[]) =>
    Promise.all(operations),
  );
  mocks.tick.mockResolvedValue({ sent: 0 });
  mocks.processConversions.mockResolvedValue({
    advertiserConversionsSent: 0,
    advertiserConversionsPending: 0,
  });
});

it("runs enabled workers and records their heartbeat", async () => {
  await runManagedWorkerIfEnabled("advertiser-conversions");
  expect(mocks.processConversions).toHaveBeenCalledOnce();
  expect(mocks.setting.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { key: "advertiserConversionHeartbeat" },
    }),
  );
});

it("reports stopped workers and their queue counts", async () => {
  mocks.setting.findMany.mockResolvedValue([
    {
      key: "workerControl:automation",
      value: { enabled: false, updatedAt: new Date().toISOString() },
    },
  ]);
  mocks.conversion.groupBy.mockResolvedValue([
    { status: "PENDING", _count: 3 },
  ]);
  mocks.enrollment.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
  const status = await managedWorkerStatuses();
  expect(status.workers[0]).toMatchObject({
    id: "automation",
    state: "STOPPED",
    queue: { active: 5, due: 2 },
  });
  expect(status.workers[1].queue).toEqual({ pending: 3 });
});

it("persists a stop request", async () => {
  await controlManagedWorker("automation", "stop", "owner");
  expect(mocks.setting.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { key: "workerControl:automation" },
      update: { value: expect.objectContaining({ enabled: false }) },
    }),
  );
  expect(mocks.tick).not.toHaveBeenCalled();
});
