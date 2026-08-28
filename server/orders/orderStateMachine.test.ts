import { describe, expect, it } from "vitest";

import { canTransition, nextStatusForCommand } from "./orderStateMachine.js";

describe("订单状态职责分离", () => {
  it("营业厅经理、大区经理和管理员可以激活已受理订单", () => {
    expect(canTransition("accepted", "activated", "sales")).toBe(false);
    expect(canTransition("accepted", "activated", "store_manager")).toBe(true);
    expect(canTransition("accepted", "activated", "regional_manager")).toBe(true);
    expect(canTransition("accepted", "activated", "admin")).toBe(true);
  });

  it("大区经理、人力资源和财务不能代替销售受理或取消订单", () => {
    for (const role of ["regional_manager", "hr", "finance"] as const) {
      expect(canTransition("pending", "accepted", role)).toBe(false);
      expect(canTransition("accepted", "cancelled", role)).toBe(false);
    }
  });

  it("签收、对账和收款按职责逐级流转", () => {
    expect(canTransition("activated", "signed", "sales")).toBe(true);
    expect(canTransition("activated", "signed", "finance")).toBe(true);
    expect(nextStatusForCommand("activated", "SIGN", "sales")).toBe("signed");
    expect(canTransition("signed", "reconciled", "hr")).toBe(true);
    expect(canTransition("signed", "reconciled", "admin")).toBe(true);
    expect(canTransition("signed", "reconciled", "finance")).toBe(false);
    expect(canTransition("reconciled", "paid", "finance")).toBe(true);
    expect(canTransition("reconciled", "paid", "admin")).toBe(true);
    expect(canTransition("reconciled", "paid", "hr")).toBe(false);
  });
});
