import type {
  CatalogCharge,
  ChargeSku,
  ComponentDefinition,
  ComponentId,
  PricingCatalog,
} from "./types.js";

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
    Object.freeze(value);
  }

  return value;
};

const charge = (
  sku: ChargeSku,
  label: string,
  unit: string,
  oneTimeFen: number,
  monthlyFen: number,
  components: CatalogCharge["components"],
): CatalogCharge => ({
  sku,
  label,
  unit,
  oneTimeFen,
  monthlyFen,
  components,
});

const component = (
  componentId: ComponentId,
  label: string,
  unit: string,
  defaultLocation: string,
  reason: string,
): ComponentDefinition => ({
  componentId,
  label,
  unit,
  defaultLocation,
  reason,
});

export const ACTIVE_CATALOG: PricingCatalog = deepFreeze({
  version: "2026-08-02",
  fttrPlans: [129, 159, 199, 239, 299, 399],
  charges: {
    FULL_FAMILY: charge(
      "FULL_FAMILY",
      "心连心·全家安心",
      "套",
      369_900,
      12_000,
      {
        watch: 1,
        mattress: 1,
        gateway: 1,
        motion: 3,
        door: 1,
        portableButton: 1,
        wallButton: 1,
      },
    ),
    WATCH_MATTRESS: charge(
      "WATCH_MATTRESS",
      "心连心·随行安睡",
      "套",
      189_900,
      6_000,
      { watch: 1, mattress: 1 },
    ),
    WATCH_STANDARD: charge(
      "WATCH_STANDARD",
      "心连心·智慧全屋",
      "套",
      239_900,
      8_000,
      {
        watch: 1,
        gateway: 1,
        motion: 3,
        door: 1,
        portableButton: 1,
        wallButton: 1,
      },
    ),
    MATTRESS_STANDARD: charge(
      "MATTRESS_STANDARD",
      "心连心·安睡全屋",
      "套",
      309_900,
      10_000,
      {
        mattress: 1,
        gateway: 1,
        motion: 3,
        door: 1,
        portableButton: 1,
        wallButton: 1,
      },
    ),
    WATCH: charge("WATCH", "AI 健康智能手表", "块", 59_900, 2_000, {
      watch: 1,
    }),
    MATTRESS: charge(
      "MATTRESS",
      "睡眠监测床垫",
      "张",
      139_900,
      4_000,
      { mattress: 1 },
    ),
    STANDARD_BUNDLE: charge(
      "STANDARD_BUNDLE",
      "标准居家养老套装",
      "套",
      189_900,
      6_000,
      {
        gateway: 1,
        motion: 3,
        door: 1,
        portableButton: 1,
        wallButton: 1,
      },
    ),
    ONE_KEY: charge(
      "ONE_KEY",
      "心连心·一键守护",
      "套",
      59_900,
      2_000,
      { gateway: 1, wallButton: 1 },
    ),
    HOME_DUAL: charge(
      "HOME_DUAL",
      "心连心·居家双护",
      "套",
      89_900,
      3_000,
      { gateway: 1, motion: 1, wallButton: 1 },
    ),
    GATEWAY: charge("GATEWAY", "迷你网关", "个", 39_900, 0, {
      gateway: 1,
    }),
    MOTION: charge("MOTION", "人体传感器", "个", 29_900, 1_000, {
      motion: 1,
    }),
    DOOR: charge("DOOR", "门磁", "个", 19_900, 0, { door: 1 }),
    PORTABLE_BUTTON: charge(
      "PORTABLE_BUTTON",
      "随身报警按钮",
      "个",
      19_900,
      0,
      { portableButton: 1 },
    ),
    WALL_BUTTON: charge(
      "WALL_BUTTON",
      "壁挂报警按钮",
      "个",
      25_900,
      0,
      { wallButton: 1 },
    ),
  },
  components: {
    watch: component(
      "watch",
      "AI 健康智能手表",
      "块",
      "长者随身佩戴",
      "提供定位、通话、SOS 与日常健康辅助管理。",
    ),
    mattress: component(
      "mattress",
      "睡眠监测床垫",
      "张",
      "长者睡眠床位",
      "辅助监测在床、离床及夜间睡眠趋势。",
    ),
    gateway: component(
      "gateway",
      "迷你网关",
      "个",
      "客厅路由器附近",
      "连接人体传感器、门磁和报警按钮并上传告警数据。",
    ),
    motion: component(
      "motion",
      "人体传感器",
      "个",
      "按房型布点",
      "覆盖主要活动空间，辅助识别长时间无活动等异常。",
    ),
    door: component(
      "door",
      "门磁",
      "个",
      "入户门",
      "识别开关门和异常外出场景。",
    ),
    portableButton: component(
      "portableButton",
      "随身报警按钮",
      "个",
      "长者随身携带",
      "身体不适或发生意外时可主动求助。",
    ),
    wallButton: component(
      "wallButton",
      "壁挂报警按钮",
      "个",
      "卫生间墙面",
      "覆盖如厕、洗浴等高风险场景的固定求助。",
    ),
  },
  entitlements: [
    { label: "手机端应用", display: "大客户专属免运维费使用" },
    { label: "AI大屏端集中管理系统", display: "大客户专属免运维费使用" },
  ],
});
