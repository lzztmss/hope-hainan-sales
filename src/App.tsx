import { AppHeader } from "./components/AppHeader";
import { DeviceList } from "./components/DeviceList";
import { EntitlementCard } from "./components/EntitlementCard";
import { FttrInput } from "./components/FttrInput";
import { GuardianComboSelector } from "./components/GuardianComboSelector";
import { HomePresetSelector } from "./components/HomePresetSelector";
import { ModeSelector } from "./components/ModeSelector";
import { PricingStructureCard } from "./components/PricingStructureCard";
import { PublicPriceCatalog } from "./components/PublicPriceCatalog";
import { QuoteActions } from "./components/QuoteActions";
import { QuoteSummary } from "./components/QuoteSummary";
import quoteConfigJson from "./data/quote-config.json";
import {
  buildPricingStructure,
  buildPublicPriceReferences,
} from "./domain/quoteEngine";
import { formatQuoteText } from "./domain/quoteText";
import type { ProductId, QuoteConfig, RoomType } from "./domain/types";
import { useQuoteBuilder } from "./hooks/useQuoteBuilder";

type AppQuoteConfig = QuoteConfig & {
  company: {
    name: string;
  };
  guardian_combo_order: readonly string[];
  free_services: readonly {
    label: string;
    display: string;
  }[];
};

const quoteConfig: AppQuoteConfig = quoteConfigJson;
const priceReferences = buildPublicPriceReferences(quoteConfig);
const PRODUCT_IDS = [
  "watch",
  "mattress",
  "gateway",
  "motion",
  "door",
  "portable_button",
  "wall_button",
] as const satisfies readonly ProductId[];
const ROOM_TYPES = [
  "one_bedroom",
  "two_bedroom",
  "three_bedroom",
] as const satisfies readonly RoomType[];

const pageLoadDate = new Date();
const quoteDate = `${pageLoadDate.getFullYear()}年${
  pageLoadDate.getMonth() + 1
}月${pageLoadDate.getDate()}日`;
const quoteDateTime = `${pageLoadDate.getFullYear()}-${String(
  pageLoadDate.getMonth() + 1,
).padStart(2, "0")}-${String(pageLoadDate.getDate()).padStart(2, "0")}`;

const formatMoney = (amount: number): string =>
  amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });

export const App = () => {
  const quote = useQuoteBuilder();
  const roomLabel =
    quote.mode === "home"
      ? quoteConfig.room_types[quote.roomType].label
      : undefined;
  const planName =
    quote.mode === "guardian"
      ? (quoteConfig.guardian_combos[quote.comboId]?.name ?? quote.comboId)
      : `${quoteConfig.room_types[quote.roomType].label}推荐方案`;
  const pricingStructure = buildPricingStructure(
    quoteConfig,
    quote.quantities,
  );
  const fttrDisplay = quote.fttr.error
    ? `未计入（${quote.fttr.error}）`
    : quote.fttr.raw.trim() === ""
      ? "待联通填写"
      : `¥${formatMoney(quote.totals.fttrTotal)}`;
  const quoteText = formatQuoteText({
    companyName: quoteConfig.company.name,
    quoteDate,
    planName,
    roomLabel,
    elderCount: quote.mode === "home" ? quote.elderCount : undefined,
    priceReferences,
    pricingStructure: pricingStructure.lines,
    lines: quote.lines,
    deviceTotal: quote.totals.deviceTotal,
    fttrDisplay,
    finalTotal: quote.totals.finalTotal,
    entitlements: quoteConfig.free_services,
  });

  return (
    <>
      <AppHeader
        companyName={quoteConfig.company.name}
        quoteDate={quoteDate}
        quoteDateTime={quoteDateTime}
      />
      <main className="quote-layout">
        <div className="quote-builder">
          <PublicPriceCatalog
            config={quoteConfig}
            references={priceReferences}
          />
          <ModeSelector mode={quote.mode} onChange={quote.setMode} />

          {quote.mode === "guardian" ? (
            <GuardianComboSelector
              config={quoteConfig}
              comboIds={quoteConfig.guardian_combo_order}
              selectedId={quote.comboId}
              onSelect={quote.selectCombo}
            />
          ) : (
            <HomePresetSelector
              config={quoteConfig}
              roomTypes={ROOM_TYPES}
              roomType={quote.roomType}
              elderCount={quote.elderCount}
              onSelectRoom={quote.selectRoom}
              onSelectElderCount={quote.selectElderCount}
            />
          )}

          <PricingStructureCard
            planName={planName}
            roomLabel={roomLabel}
            elderCount={quote.mode === "home" ? quote.elderCount : undefined}
            structure={pricingStructure}
          />

          <DeviceList
            config={quoteConfig}
            productIds={PRODUCT_IDS}
            lines={quote.lines}
            quantities={quote.quantities}
            mode={quote.mode}
            onAdjust={quote.adjustQuantity}
          />
          <FttrInput fttr={quote.fttr} onChange={quote.setFttrRaw} />
          <EntitlementCard entitlements={quoteConfig.free_services} />
        </div>
        <div className="quote-sidebar">
          <QuoteSummary fttr={quote.fttr} totals={quote.totals} />
          <QuoteActions quoteText={quoteText} onReset={quote.reset} />
        </div>
      </main>
    </>
  );
};
