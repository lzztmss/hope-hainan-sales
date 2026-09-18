import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedUser } from "../auth/authorization.js";
import {
  createSubscriptionPlanService,
  type SubscriptionPlanRecord,
  type SubscriptionPlanRepository,
} from "./planService.js";

const admin: AuthenticatedUser = {
  id: "admin-1",
  displayName: "管理员",
  role: "admin",
  storeId: null,
  storeName: null,
  mustChangePassword: false,
};

describe("月付套餐服务", () => {
  it("允许 A、B 这类单字符套餐编码并保存启用状态", async () => {
    const create = vi.fn<SubscriptionPlanRepository["create"]>(async (input) => ({
      ...input,
      id: "plan-a",
      version: 1,
    } satisfies SubscriptionPlanRecord));
    const repository: SubscriptionPlanRepository = {
      list: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      findByCode: vi.fn().mockResolvedValue(null),
      create,
      update: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(true),
      writeAudit: vi.fn().mockResolvedValue(undefined),
    };
    const service = createSubscriptionPlanService({
      repository,
      now: () => new Date("2026-09-14T00:00:00.000Z"),
    });

    const saved = await service.create(admin, {
      code: "a",
      name: "套餐 A",
      monthlyFen: 11_100,
      active: true,
      items: [{ sku: "WATCH", quantity: 1 }],
      reason: "1",
    });

    expect(saved).toMatchObject({ code: "A", active: true });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      code: "A",
      active: true,
    }));
  });
});
