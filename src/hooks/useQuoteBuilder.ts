import { useState } from "react";

import quoteConfigJson from "../data/quote-config.json";
import {
  buildQuoteLines,
  calculateTotals,
  enforceGateway,
  guardianQuantities,
  parseFttrAmount,
  presetQuantities,
} from "../domain/quoteEngine";
import type {
  ProductId,
  QuantityMap,
  QuoteConfig,
  QuoteContext,
  QuoteMode,
  RoomType,
} from "../domain/types";

const quoteConfig: QuoteConfig = quoteConfigJson;

const DEFAULT_COMBO_ID = "travel_guard";
const DEFAULT_ROOM_TYPE: RoomType = "one_bedroom";
const DEFAULT_ELDER_COUNT = 1;

export type BuilderState = {
  mode: QuoteMode;
  comboId: string;
  roomType: RoomType;
  elderCount: 1 | 2 | 3 | 4;
  quantities: QuantityMap;
  fttrRaw: string;
};

const initialState = (): BuilderState => ({
  mode: "guardian",
  comboId: DEFAULT_COMBO_ID,
  roomType: DEFAULT_ROOM_TYPE,
  elderCount: DEFAULT_ELDER_COUNT,
  quantities: guardianQuantities(quoteConfig, DEFAULT_COMBO_ID),
  fttrRaw: "",
});

export const useQuoteBuilder = () => {
  const [state, setState] = useState<BuilderState>(initialState);

  const setMode = (mode: QuoteMode): void => {
    setState((current) => ({
      ...current,
      mode,
      quantities:
        mode === "guardian"
          ? guardianQuantities(quoteConfig, current.comboId)
          : presetQuantities(
              quoteConfig,
              current.roomType,
              current.elderCount,
            ),
    }));
  };

  const selectCombo = (comboId: string): void => {
    setState((current) => ({
      ...current,
      comboId,
      quantities: guardianQuantities(quoteConfig, comboId),
    }));
  };

  const selectRoom = (roomType: RoomType): void => {
    setState((current) => ({
      ...current,
      roomType,
      quantities: presetQuantities(
        quoteConfig,
        roomType,
        current.elderCount,
      ),
    }));
  };

  const selectElderCount = (elderCount: 1 | 2 | 3 | 4): void => {
    setState((current) => ({
      ...current,
      elderCount,
      quantities: presetQuantities(
        quoteConfig,
        current.roomType,
        elderCount,
      ),
    }));
  };

  const adjustQuantity = (productId: ProductId, change: number): void => {
    setState((current) => ({
      ...current,
      quantities: enforceGateway(current.mode, {
        ...current.quantities,
        [productId]: current.quantities[productId] + change,
      }),
    }));
  };

  const setFttrRaw = (fttrRaw: string): void => {
    setState((current) => ({ ...current, fttrRaw }));
  };

  const reset = (): void => {
    setState(initialState());
  };

  const context: QuoteContext =
    state.mode === "guardian"
      ? { mode: state.mode, comboId: state.comboId }
      : {
          mode: state.mode,
          roomType: state.roomType,
          elderCount: state.elderCount,
        };
  const lines = buildQuoteLines(quoteConfig, state.quantities, context);
  const fttr = parseFttrAmount(state.fttrRaw);
  const totals = calculateTotals(lines, fttr);

  return {
    ...state,
    lines,
    fttr,
    totals,
    setMode,
    selectCombo,
    selectRoom,
    selectElderCount,
    adjustQuantity,
    setFttrRaw,
    reset,
  };
};
