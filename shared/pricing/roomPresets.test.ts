import { describe, expect, it } from "vitest";

import { calculateQuote } from "./quoteEngine.js";
import { buildRoomPreset } from "./roomPresets.js";
import type { RoomType } from "./types.js";

const roomTypes: readonly RoomType[] = ["one_bedroom", "two_bedroom", "three_bedroom"];

describe("按户型推荐的 12 组业务矩阵", () => {
  for (const roomType of roomTypes) {
    for (const elderCount of [1, 2, 3, 4] as const) {
      it(`${roomType} / ${elderCount} 位长者金额与设备数量一致`, () => {
        const calculation = calculateQuote({
          mode: "one_time",
          subscriptionPlanId: null,
          selection: buildRoomPreset(roomType, elderCount),
        });
        expect(calculation.oneTimeFen).toBeGreaterThan(0);
        expect(calculation.monthlyTotalFen).toBe(0);
        expect(calculation.contract36Fen).toBe(0);
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
