import { describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "../auth/authorization.js";
import {
  createCommissionRuleService,
  type CommissionPolicyVersion,
  type CommissionRuleAuditContext,
  type CommissionRuleRepository,
} from "./ruleService.js";

class MemoryRepository implements CommissionRuleRepository {
  versions = new Map<string, CommissionPolicyVersion>();
  async allocateVersionNumber() { return this.versions.size + 1; }
  async insertVersion(version: CommissionPolicyVersion) { this.versions.set(version.id, version); }
  async findVersionById(id: string) { return this.versions.get(id) ?? null; }
  async listVersions() { return [...this.versions.values()]; }
  async replaceVersion(version: CommissionPolicyVersion) { this.versions.set(version.id, version); return true; }
  async publishVersion(published: { version: CommissionPolicyVersion }, predecessor?: { version: CommissionPolicyVersion }) {
    if (predecessor) this.versions.set(predecessor.version.id, predecessor.version);
    this.versions.set(published.version.id, published.version);
    return true;
  }
  async isVersionUsed() { return false; }
}

const admin: AuthenticatedUser = {
  id: "admin",
  displayName: "管理员",
  role: "admin",
  storeId: null,
  mustChangePassword: false,
};

describe("提成版本发布", () => {
  it("历史版本已结束时允许草稿从当前时间发布", async () => {
    const repository = new MemoryRepository();
    const rule = {
      id: "rule-old",
      sku: "WATCH",
      amountFen: 2000,
      paymentMode: "all" as const,
      scope: { kind: "global" as const },
      enabled: true,
    };
    repository.versions.set("old", {
      id: "old", version: 1, name: "旧版本", status: "stopped",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveTo: "2026-08-12T12:00:00.000Z",
      rules: [rule], sourceVersionId: null, createdBy: "admin",
      createdAt: "2026-08-01T00:00:00.000Z", publishedBy: "admin",
      publishedAt: "2026-08-01T00:00:00.000Z", stoppedBy: "admin",
      stoppedAt: "2026-08-12T12:00:00.000Z", changeNote: "停用", revision: 2,
    });
    repository.versions.set("draft", {
      id: "draft", version: 2, name: "新版本", status: "draft",
      effectiveFrom: "2026-08-11T16:00:00.000Z", effectiveTo: null,
      rules: [{ ...rule, id: "rule-new" }], sourceVersionId: null,
      createdBy: "admin", createdAt: "2026-08-12T10:00:00.000Z",
      publishedBy: null, publishedAt: null, stoppedBy: null, stoppedAt: null,
      changeNote: "创建", revision: 1,
    });
    const service = createCommissionRuleService({
      repository,
      now: () => new Date("2026-08-12T13:00:00.000Z"),
    });

    const published = await service.publish(admin, "draft", "正式启用");
    expect(published.status).toBe("published");
    expect(published.effectiveFrom).toBe("2026-08-12T13:00:00.000Z");
  });
});
