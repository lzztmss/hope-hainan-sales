import { describe, expect, it } from "vitest";

import { canTransition, nextStatusForCommand } from "./orderStateMachine.js";

describe("订单状态职责分离", () => {
  it("只有营业厅经理和管理员可以激活已受理订单", () => {
    expect(canTransition("accepted", "activated", "sales")).toBe(false);
    expect(canTransition("accepted", "activated", "store_manager")).toBe(true);
    expect(canTransition("accepted", "activated", "admin")).toBe(true);
  });

  it("只有销售员可以把已激活订单提交为完成", () => {
    expect(canTransition("activated", "completed", "sales")).toBe(true);
    expect(canTransition("activated", "completed", "store_manager")).toBe(false);
    expect(canTransition("activated", "completed", "admin")).toBe(false);
    expect(nextStatusForCommand("activated", "COMPLETE", "sales")).toBe("completed");
  });
});
