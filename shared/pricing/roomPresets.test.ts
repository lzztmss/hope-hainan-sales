import { describe, expect, it } from "vitest";

import { calculateQuote } from "./quoteEngine.js";
import { buildRoomPreset } from "./roomPresets.js";
import type { RoomType } from "./types.js";

const expectations: Record<RoomType, readonly number[]> = {
  one_bedroom: [11_000, 17_000, 23_000, 29_000],
  two_bedroom: [12_000, 19_000, 25_000, 31_000],
  three_bedroom: [13_000, 19_000, 26_000, 32_000],
};

describe("按户型推荐的 12 组业务矩阵", () => {
  for (const [roomType, monthlyValues] of Object.entries(expectations) as Array<
    [RoomType, readonly number[]]
  >) {
    for (const elderCount of [1, 2, 3, 4] as const) {
      it(`${roomType} / ${elderCount} 位长者金额与设备数量一致`, () => {
        const calculation = calculateQuote({
          mode: "contract_36",
          fttrPlan: 159,
          selection: buildRoomPreset(roomType, elderCount),
        });
        expect(calculation.heartMonthlyFen).toBe(monthlyValues[elderCount - 1]);
        expect(calculation.monthlyTotalFen).toBe(15_900 + monthlyValues[elderCount - 1]!);
        expect(calculation.contract36Fen).toBe(calculation.monthlyTotalFen * 36);
        const components = Object.fromEntries(
          calculation.componentLines.map((line) => [line.componentId, line.quantity]),
        );
        expect(components.watch).toBe(elderCount);
        expect(components.mattress).toBe(elderCount);
        expect(calculation.componentLines.every((line) => line.locations.length === line.quantity)).toBe(true);
      });
    }
  }
});
