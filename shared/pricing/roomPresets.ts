import type { QuoteSelection, RoomType } from "./types.js";

const elderLocations = (
  elderCount: 1 | 2 | 3 | 4,
  kind: "watch" | "mattress",
): string[] =>
  Array.from({ length: elderCount }, (_, index) =>
    kind === "watch"
      ? `第 ${index + 1} 位长者随身佩戴`
      : `第 ${index + 1} 位长者睡眠床位`,
  );

export const buildRoomPreset = (
  roomType: RoomType,
  elderCount: 1 | 2 | 3 | 4,
): QuoteSelection => {
  const personalized = {
    watch: elderLocations(elderCount, "watch"),
    mattress: elderLocations(elderCount, "mattress"),
  };

  if (roomType === "one_bedroom") {
    return {
      homeDual: 1,
      watch: elderCount,
      mattress: elderCount,
      motion: 2,
      locations: {
        ...personalized,
        motion: ["长者卧室", "卫生间", "客厅"],
      },
    };
  }

  if (roomType === "two_bedroom") {
    const motionLocations =
      elderCount === 1
        ? ["长者卧室", "卫生间", "客厅"]
        : ["卧室 A", "卧室 B", "卫生间", "客厅"];

    return {
      standardBundle: 1,
      watch: elderCount,
      mattress: elderCount,
      motion: elderCount === 1 ? 0 : 1,
      locations: {
        ...personalized,
        motion: motionLocations,
      },
    };
  }

  const motionLocations =
    elderCount === 1
      ? ["长者卧室", "卫生间", "客厅", "次卧/走廊"]
      : elderCount === 2
        ? ["卧室 A", "卧室 B", "卫生间", "客厅"]
        : ["卧室 A", "卧室 B", "卧室 C", "卫生间", "客厅"];

  return {
    standardBundle: 1,
    watch: elderCount,
    mattress: elderCount,
    motion: elderCount >= 3 ? 2 : 1,
    locations: {
      ...personalized,
      motion: motionLocations,
    },
  };
};
