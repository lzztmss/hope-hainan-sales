import type { QuoteConfig, RoomType } from "../domain/types";

type HomePresetSelectorProps = {
  config: QuoteConfig;
  roomTypes: readonly RoomType[];
  roomType: RoomType;
  elderCount: 1 | 2 | 3 | 4;
  onSelectRoom: (roomType: RoomType) => void;
  onSelectElderCount: (elderCount: 1 | 2 | 3 | 4) => void;
};

const ELDER_COUNTS = [1, 2, 3, 4] as const;

export const HomePresetSelector = ({
  config,
  roomTypes,
  roomType,
  elderCount,
  onSelectRoom,
  onSelectElderCount,
}: HomePresetSelectorProps) => (
  <section aria-labelledby="home-preset-title" className="home-preset-selector">
    <h2 id="home-preset-title">选择户型与长者人数</h2>
    <fieldset>
      <legend>户型</legend>
      <div className="room-options">
        {roomTypes.map((candidate) => (
          <button
            type="button"
            key={candidate}
            aria-pressed={candidate === roomType}
            onClick={() => onSelectRoom(candidate)}
          >
            {config.room_types[candidate].label}
          </button>
        ))}
      </div>
    </fieldset>
    <fieldset>
      <legend>长者人数</legend>
      <div className="elder-options">
        {ELDER_COUNTS.map((count) => (
          <button
            type="button"
            key={count}
            aria-pressed={count === elderCount}
            onClick={() => onSelectElderCount(count)}
          >
            {count} 位长者
          </button>
        ))}
      </div>
    </fieldset>
  </section>
);
