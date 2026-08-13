import { useMemo, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";

import { ACTIVE_CATALOG } from "../../shared/pricing/catalog";
import { calculateQuote } from "../../shared/pricing/quoteEngine";
import { buildRoomPreset } from "../../shared/pricing/roomPresets";
import type {
  CatalogCharge,
  ChargeSku,
  PaymentMode,
  QuoteCalculation,
  QuoteInput,
  QuoteSelection,
  RoomType,
} from "../../shared/pricing/types";
import type {
  ApiClient,
  ConfirmedQuoteSummary,
  ConfirmQuoteInput,
  OrderMutationDto,
  QuoteDetailDto,
} from "../api/client";
import { PageLayout } from "../components/layout";
import { QuotePrintDocument } from "./QuotePrintDocument";
import { OrderCompositionDialog } from "./OrderCompositionDialog";
import "./quoteWorkflow.css";

export type QuoteWorkflowClient = Pick<
  ApiClient,
  "confirmQuote" | "createOrderFromQuote" | "recordQuotePrint" | "updateQuote"
>;

export interface QuoteWorkflowPageProps {
  client: QuoteWorkflowClient;
  createIdempotencyKey?: () => string;
  createOrderIdempotencyKey?: () => string;
  initialQuote?: QuoteDetailDto;
}

type QuantityKey = Exclude<keyof QuoteSelection, "locations">;
type Scenario = "custom" | "one_key" | "home_dual" | "room";
type FttrChoice = "none" | "custom" | `${number}`;

const ROOM_LABELS: Record<RoomType, string> = {
  one_bedroom: "一室一厅",
  two_bedroom: "两室一厅",
  three_bedroom: "三室一厅",
};

const PRODUCT_CONTROLS: readonly {
  key: QuantityKey;
  sku: ChargeSku;
}[] = [
  { key: "watch", sku: "WATCH" },
  { key: "mattress", sku: "MATTRESS" },
  { key: "standardBundle", sku: "STANDARD_BUNDLE" },
  { key: "oneKey", sku: "ONE_KEY" },
  { key: "homeDual", sku: "HOME_DUAL" },
  { key: "gateway", sku: "GATEWAY" },
  { key: "motion", sku: "MOTION" },
  { key: "door", sku: "DOOR" },
  { key: "portableButton", sku: "PORTABLE_BUTTON" },
  { key: "wallButton", sku: "WALL_BUTTON" },
];

const newIdempotencyKey = (): string => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `quote-submit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const newOrderIdempotencyKey = (): string =>
  `order-create-${newIdempotencyKey()}`;

const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : "保存失败，请重试";

const formatMoney = (amountFen: number): string =>
  (amountFen / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const CatalogPrice = ({
  definition,
  mode,
}: {
  definition: CatalogCharge;
  mode: PaymentMode;
}) => {
  const usesMonthlyPrice = mode === "contract_36" && definition.monthlyFen > 0;
  const isContractAddOn = mode === "contract_36" && !usesMonthlyPrice;

  return (
    <div className="quote-workflow__catalog-price">
      <p>
        {usesMonthlyPrice
          ? `当前月增费 ¥${formatMoney(definition.monthlyFen)}/月 / ${definition.unit}`
          : `当前${isContractAddOn ? "一次性增配费" : "一次性设备费"} ¥${formatMoney(definition.oneTimeFen)} / ${definition.unit}`}
      </p>
      <small>
        {usesMonthlyPrice
          ? `按月收取，连续 36 个月；一次性购买价参考 ¥${formatMoney(definition.oneTimeFen)} / ${definition.unit}`
          : isContractAddOn
            ? "一次性收取，不计入心连心月增费"
            : "按所选数量逐项计价"}
      </small>
    </div>
  );
};

const QuoteTotalsBreakdown = ({
  calculation,
  estimate,
}: {
  calculation: QuoteCalculation;
  estimate: boolean;
}) => {
  const suffix = estimate ? "估算" : "";
  const isContract = calculation.mode === "contract_36";
  const fullContractFen = calculation.contract36Fen + calculation.oneTimeFen;

  return (
    <div className="quote-workflow__totals">
      <div>
        <span>FTTR 月费底座{suffix}</span>
        <strong>
          {calculation.fttrKind === "none"
            ? "未选择"
            : `¥${formatMoney(calculation.fttrMonthlyFen)}`}
        </strong>
      </div>
      <div>
        <span>心连心月增费{suffix}</span>
        <strong>¥{formatMoney(calculation.heartMonthlyFen)}</strong>
      </div>
      <div>
        <span>{isContract ? "一次性增配费" : "一次性设备费"}{suffix}</span>
        <strong>¥{formatMoney(calculation.oneTimeFen)}</strong>
      </div>
      <div>
        <span>每月合计{suffix}</span>
        <strong>¥{formatMoney(calculation.monthlyTotalFen)}</strong>
      </div>
      {isContract ? (
        <>
          <div>
            <span>36 个月月费合计（不含一次性增配）{suffix}</span>
            <strong>¥{formatMoney(calculation.contract36Fen)}</strong>
            <small>每月合计 × 36</small>
          </div>
          <div>
            <span>合同期预计总支出（含一次性增配）{suffix}</span>
            <strong>¥{formatMoney(fullContractFen)}</strong>
            <small>36 个月月费合计 + 一次性增配费</small>
          </div>
        </>
      ) : null}
    </div>
  );
};

const DraftChargeBreakdown = ({
  calculation,
  selection,
}: {
  calculation: QuoteCalculation;
  selection: QuoteSelection;
}) => {
  const hasAutomaticGateway =
    (selection.gateway ?? 0) === 0 &&
    calculation.chargeLines.some((line) => line.sku === "GATEWAY");

  return (
    <section
      className="quote-workflow__draft-breakdown"
      aria-labelledby="draft-charge-lines-title"
    >
      <h3 id="draft-charge-lines-title">逐项计价明细</h3>
      {calculation.chargeLines.length === 0 ? (
        <p>当前未选择心连心计价商品。</p>
      ) : (
        <ul>
          {calculation.chargeLines.map((line) => {
            const isMonthly = line.monthlyUnitFen > 0;
            return (
              <li key={line.sku}>
                <span>
                  <strong>{line.label}</strong>
                  {hasAutomaticGateway && line.sku === "GATEWAY" ? (
                    <em>系统自动补充 {line.quantity} 个必需网关</em>
                  ) : null}
                  <small>
                    {isMonthly
                      ? `月增费单价 ¥${formatMoney(line.monthlyUnitFen)}/月 × ${line.quantity} ${line.unit}`
                      : `一次性单价 ¥${formatMoney(line.oneTimeUnitFen)} × ${line.quantity} ${line.unit}`}
                  </small>
                </span>
                <strong>
                  {isMonthly
                    ? `月增费小计 ¥${formatMoney(line.monthlySubtotalFen)}/月`
                    : `小计 ¥${formatMoney(line.oneTimeSubtotalFen)}`}
                </strong>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

const maskPhone = (value: string): string => {
  const normalized = value.trim();
  return /^\d{11}$/.test(normalized)
    ? `${normalized.slice(0, 3)}****${normalized.slice(7)}`
    : "确认后生成";
};

const quantityOf = (selection: QuoteSelection, key: QuantityKey): number =>
  selection[key] ?? 0;

const initialSelection = (): QuoteSelection => ({ watch: 1 });

const scenarioSelection = (
  scenario: Scenario,
  roomType: RoomType,
  elderCount: 1 | 2 | 3 | 4,
  current: QuoteSelection,
): QuoteSelection => {
  if (scenario === "one_key") return { oneKey: 1 };
  if (scenario === "home_dual") return { homeDual: 1 };
  if (scenario === "room") return buildRoomPreset(roomType, elderCount);
  return current;
};

const buildPricing = (
  mode: PaymentMode,
  fttrChoice: FttrChoice,
  customFttr: string,
  customFttrNote: string,
  selection: QuoteSelection,
): QuoteInput => {
  const fttrPlan =
    fttrChoice === "none"
      ? null
      : fttrChoice === "custom"
        ? Number(customFttr)
        : Number(fttrChoice);

  return {
    mode,
    fttrPlan,
    ...(fttrChoice === "custom"
      ? { customFttrNote: customFttrNote.trim() }
      : {}),
    selection,
  };
};

export const QuoteWorkflowPage = ({
  client,
  createIdempotencyKey = newIdempotencyKey,
  createOrderIdempotencyKey = newOrderIdempotencyKey,
  initialQuote,
}: QuoteWorkflowPageProps) => {
  const navigate = useNavigate();
  const originalPricing = initialQuote?.pricing;
  const originalFttrPlan = originalPricing?.fttrPlan;
  const originalFttrIsStandard = originalFttrPlan != null && ACTIVE_CATALOG.fttrPlans.some((plan) => plan === originalFttrPlan);
  const [name, setName] = useState(initialQuote?.customer.name ?? "");
  const [phone, setPhone] = useState(initialQuote?.customer.phone ?? "");
  const [roomType, setRoomType] = useState<RoomType>(initialQuote?.customer.roomType ?? "one_bedroom");
  const [elderCount, setElderCount] = useState<1 | 2 | 3 | 4>((initialQuote?.customer.elderCount ?? 1) as 1 | 2 | 3 | 4);
  const [mode, setMode] = useState<PaymentMode>(originalPricing?.mode ?? "contract_36");
  const [fttrChoice, setFttrChoice] = useState<FttrChoice>(
    originalFttrPlan === null ? "none" : originalFttrIsStandard ? String(originalFttrPlan) as FttrChoice : originalFttrPlan !== undefined ? "custom" : "159",
  );
  const [customFttr, setCustomFttr] = useState(originalFttrPlan != null && !originalFttrIsStandard ? String(originalFttrPlan) : "");
  const [customFttrNote, setCustomFttrNote] = useState(originalPricing?.customFttrNote ?? "");
  const [scenario, setScenario] = useState<Scenario>("custom");
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [selection, setSelection] = useState<QuoteSelection>(originalPricing?.selection ?? initialSelection());
  const [savedQuote, setSavedQuote] = useState<ConfirmedQuoteSummary | null>(null);
  const [createdOrder, setCreatedOrder] = useState<OrderMutationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [orderCompositionOpen, setOrderCompositionOpen] = useState(false);
  const inFlight = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const orderIdempotencyKey = useRef<string | null>(null);
  const locked = busy || Boolean(savedQuote);

  const pricing = useMemo(
    () =>
      buildPricing(
        mode,
        fttrChoice,
        customFttr,
        customFttrNote,
        selection,
      ),
    [customFttr, customFttrNote, fttrChoice, mode, selection],
  );

  const preview = useMemo(() => {
    try {
      return { calculation: calculateQuote(pricing), error: null };
    } catch (calculationError) {
      return { calculation: null, error: messageFor(calculationError) };
    }
  }, [pricing]);

  const chooseMode = (nextMode: PaymentMode) => {
    setMode(nextMode);
    if (nextMode === "one_time") {
      setFttrChoice("none");
    } else if (fttrChoice === "none") {
      setFttrChoice("159");
    }
  };

  const chooseScenario = (nextScenario: Scenario) => {
    setScenario(nextScenario);
    setSelectionNotice(nextScenario === "room" ? "已按当前户型和长者人数重新生成推荐配置。" : null);
    setSelection((current) =>
      scenarioSelection(nextScenario, roomType, elderCount, current),
    );
  };

  const changeRoom = (nextRoom: RoomType) => {
    setRoomType(nextRoom);
    if (scenario === "room") {
      setSelection(buildRoomPreset(nextRoom, elderCount));
      setSelectionNotice(`已切换为${ROOM_LABELS[nextRoom]}推荐配置。`);
    }
  };

  const changeElderCount = (nextCount: 1 | 2 | 3 | 4) => {
    setElderCount(nextCount);
    if (scenario === "room") {
      setSelection(buildRoomPreset(roomType, nextCount));
      setSelectionNotice(`已按 ${nextCount} 位长者重新生成推荐配置。`);
    }
  };

  const changeQuantity = (key: QuantityKey, value: string) => {
    const parsed = Number(value);
    const quantity = Number.isInteger(parsed)
      ? Math.min(20, Math.max(0, parsed))
      : 0;
    if (scenario !== "custom") {
      setSelectionNotice("你已手动修改数量，报价场景已切换为“自选产品”。");
    }
    setScenario("custom");
    setSelection((current) => ({ ...current, [key]: quantity }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;

    if (!name.trim()) {
      setError("请输入客户姓名或称呼");
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      setError("请输入正确的 11 位中国大陆手机号");
      return;
    }
    if (!preview.calculation) {
      setError(preview.error ?? "报价参数不完整");
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setError(null);
    let quoteConfirmed = Boolean(savedQuote);
    try {
      let quote = savedQuote;
      if (!quote) {
        const input: ConfirmQuoteInput = {
          customer: {
            name: name.trim(),
            phone: phone.trim(),
            roomType,
            elderCount,
          },
          pricing,
        };
        if (initialQuote) {
          const updated = await client.updateQuote(initialQuote.id, input, initialQuote.version);
          quote = {
            id: updated.id,
            quoteNo: updated.quoteNo,
            status: updated.status,
            confirmedAt: updated.confirmedAt,
            oneTimeFen: updated.calculation.oneTimeFen,
            monthlyTotalFen: updated.calculation.monthlyTotalFen,
            contract36Fen: updated.calculation.contract36Fen,
            calculation: updated.calculation,
          };
        } else {
          idempotencyKey.current ??= createIdempotencyKey();
          quote = await client.confirmQuote(input, idempotencyKey.current);
        }
        quoteConfirmed = true;
        flushSync(() => setSavedQuote(quote));
      }

      setPrintPreviewOpen(true);
    } catch (submitError) {
      setError(
        quoteConfirmed
          ? `报价已保存，打印未完成：${messageFor(submitError)}`
          : messageFor(submitError),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const printSavedQuote = async (): Promise<void> => {
    if (!savedQuote || busy) return;
    navigate(`/quotes/${savedQuote.id}/print?autoprint=1`);
  };

  const documentVersion = initialQuote ? initialQuote.version + 1 : 1;

  const convertToOrder = async (): Promise<void> => {
    if (!savedQuote || createdOrder || orderBusy) return;
    setOrderBusy(true);
    setOrderError(null);
    try {
      orderIdempotencyKey.current ??= createOrderIdempotencyKey();
      setCreatedOrder(
        await client.createOrderFromQuote(
          savedQuote.id,
          orderIdempotencyKey.current,
        ),
      );
      setOrderCompositionOpen(false);
    } catch (conversionError) {
      setOrderError(
        conversionError instanceof Error
          ? conversionError.message
          : "订单创建失败，请重试",
      );
    } finally {
      setOrderBusy(false);
    }
  };

  return (
    <PageLayout
      description={initialQuote ? `正在修改报价 ${initialQuote.quoteNo}；保存时服务端会重新核价并生成新版本。` : "页面只展示大客户特优价；确认时服务端会用当前有效价格版本重新核价。"}
      eyebrow="销售报价"
      title={initialQuote ? "修改报价" : "新建报价"}
    >
      <section className="quote-workflow__customer" aria-labelledby="customer-title">
        <h2 id="customer-title">客户信息</h2>
        <form id="quote-confirmation-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="quote-customer-name">客户姓名或称呼</label>
          <input
            id="quote-customer-name"
            value={name}
            autoComplete="name"
            disabled={locked}
            onChange={(event) => setName(event.currentTarget.value)}
          />

          <label htmlFor="quote-customer-phone">客户手机号</label>
          <input
            id="quote-customer-phone"
            value={phone}
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            disabled={locked}
            onChange={(event) => setPhone(event.currentTarget.value)}
          />

          <label htmlFor="quote-customer-room">客户户型</label>
          <select
            id="quote-customer-room"
            value={roomType}
            disabled={locked}
            onChange={(event) => changeRoom(event.currentTarget.value as RoomType)}
          >
            <option value="one_bedroom">一室一厅</option>
            <option value="two_bedroom">两室一厅</option>
            <option value="three_bedroom">三室一厅</option>
          </select>

          <label htmlFor="quote-customer-elder-count">长者人数</label>
          <select
            id="quote-customer-elder-count"
            value={elderCount}
            disabled={locked}
            onChange={(event) =>
              changeElderCount(Number(event.currentTarget.value) as 1 | 2 | 3 | 4)
            }
          >
            {[1, 2, 3, 4].map((count) => (
              <option key={count} value={count}>
                {count} 位
              </option>
            ))}
          </select>
        </form>
      </section>

      <section className="quote-workflow__builder" aria-labelledby="pricing-title">
        <h2 id="pricing-title">报价配置</h2>

        <fieldset className="quote-workflow__choice-group">
          <legend>支付方式</legend>
          <label>
            <input
              type="radio"
              name="payment-mode"
              value="contract_36"
              checked={mode === "contract_36"}
              disabled={locked}
              onChange={() => chooseMode("contract_36")}
            />
            36 个月月付
          </label>
          <label>
            <input
              type="radio"
              name="payment-mode"
              value="one_time"
              checked={mode === "one_time"}
              disabled={locked}
              onChange={() => chooseMode("one_time")}
            />
            设备一次性购买
          </label>
        </fieldset>

        <div className="quote-workflow__fttr">
          <label htmlFor="quote-fttr-plan">FTTR 月费档位</label>
          <select
            id="quote-fttr-plan"
            value={fttrChoice}
            disabled={locked}
            onChange={(event) => setFttrChoice(event.currentTarget.value as FttrChoice)}
          >
            {mode === "one_time" ? <option value="none">不新增 FTTR</option> : null}
            {ACTIVE_CATALOG.fttrPlans.map((plan) => (
              <option key={plan} value={plan}>
                {plan} 元/月
              </option>
            ))}
            <option value="custom">自定义月费</option>
          </select>
          {fttrChoice === "custom" ? (
            <>
              <label htmlFor="quote-custom-fttr">自定义 FTTR 月费（元）</label>
              <input
                id="quote-custom-fttr"
                type="number"
                min="1"
                max="9999"
                step="1"
                value={customFttr}
                disabled={locked}
                onChange={(event) => setCustomFttr(event.currentTarget.value)}
              />
              <label htmlFor="quote-custom-fttr-note">自定义 FTTR 说明</label>
              <input
                id="quote-custom-fttr-note"
                value={customFttrNote}
                disabled={locked}
                onChange={(event) => setCustomFttrNote(event.currentTarget.value)}
              />
            </>
          ) : null}
        </div>

        <fieldset className="quote-workflow__choice-group">
          <legend>报价场景</legend>
          {(
            [
              ["custom", "自选产品"],
              ["one_key", "一键守护"],
              ["home_dual", "居家双护"],
              ["room", "按户型推荐"],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="quote-scenario"
                value={value}
                checked={scenario === value}
                disabled={locked}
                onChange={() => chooseScenario(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <aside
          aria-label="核算规则"
          className="quote-workflow__pricing-rule"
          role="note"
        >
          <strong>核算规则</strong>
          <p>按当前所选计价商品的生效单价与数量逐项相加，不自动改为其他优惠组合。</p>
          <p>人体传感器、门磁或报警按钮必须连接网关；未选网关时，系统会自动补充 1 个并在预览明细中标出。</p>
        </aside>
        {selectionNotice ? (
          <p className="quote-workflow__selection-notice" role="status">{selectionNotice}</p>
        ) : null}

        <section className="quote-workflow__catalog" aria-labelledby="catalog-title">
          <h3 id="catalog-title">大客户特优价与数量</h3>
          <div className="quote-workflow__catalog-grid">
            {PRODUCT_CONTROLS.map(({ key, sku }) => {
              const definition = ACTIVE_CATALOG.charges[sku];
              return (
                <article aria-label={definition.label} key={key}>
                  <div>
                    <h4>{definition.label}</h4>
                    <CatalogPrice definition={definition} mode={mode} />
                  </div>
                  <label htmlFor={`quote-quantity-${key}`}>
                    {definition.label}数量
                  </label>
                  <input
                    id={`quote-quantity-${key}`}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="20"
                    step="1"
                    value={quantityOf(selection, key)}
                    disabled={locked}
                    onChange={(event) => changeQuantity(key, event.currentTarget.value)}
                  />
                </article>
              );
            })}
          </div>
        </section>
      </section>

      {savedQuote ? (
        <>
          <QuotePrintDocument
            calculation={savedQuote.calculation}
            confirmedAt={savedQuote.confirmedAt}
            customFttrNote={customFttrNote.trim() || undefined}
            customerName={name.trim()}
            elderCount={elderCount}
            phoneMasked={maskPhone(phone)}
            quoteNo={savedQuote.quoteNo}
            roomType={roomType}
            version={documentVersion}
            actions={<>
              <button type="button" onClick={() => setPrintPreviewOpen(true)}>预览报价单</button>
              <button className="is-primary" disabled={busy} type="button" onClick={() => void printSavedQuote()}>打印报价</button>
            </>}
          />
        </>
      ) : (
        <section
          className="quote-workflow__preview quote-workflow__draft"
          aria-label="报价估算预览"
        >
          <h2>报价估算（未确认）</h2>
          <p className="quote-workflow__draft-notice">
            当前金额仅用于配置核对。正式报价单及报价单号将在服务端确认后生成。
          </p>
          {preview.error ? <p role="alert">{preview.error}</p> : null}
          {preview.calculation ? (
            <>
              <QuoteTotalsBreakdown
                calculation={preview.calculation}
                estimate={true}
              />
              <DraftChargeBreakdown
                calculation={preview.calculation}
                selection={selection}
              />
            </>
          ) : null}
        </section>
      )}

      {savedQuote && printPreviewOpen ? (
        <div className="quote-preview-backdrop" role="presentation">
          <section aria-label="报价单预览" aria-modal="true" className="quote-preview-dialog" role="dialog">
            <QuotePrintDocument
              calculation={savedQuote.calculation}
              confirmedAt={savedQuote.confirmedAt}
              customFttrNote={customFttrNote.trim() || undefined}
              customerName={name.trim()}
              elderCount={elderCount}
              phoneMasked={maskPhone(phone)}
              quoteNo={savedQuote.quoteNo}
              roomType={roomType}
              version={documentVersion}
              preview
              actions={<><button type="button" onClick={() => setPrintPreviewOpen(false)}>关闭预览</button><button className="is-primary" disabled={busy} type="button" onClick={() => void printSavedQuote()}>打印报价</button></>}
            />
          </section>
        </div>
      ) : null}

      <section className="quote-workflow__confirmation" aria-label="确认报价">
        {error ? <p role="alert">{error}</p> : null}
        {orderError ? <p role="alert">{orderError}</p> : null}
        {savedQuote ? (
          <p role="status">
            报价 {savedQuote.quoteNo} 已保存。请先预览报价单，确认内容后再打印。
          </p>
        ) : null}
        {savedQuote ? (
          <div className="quote-workflow__order-conversion">
            {createdOrder ? (
              <p role="status">
                订单 {createdOrder.orderNo} 已创建。
                <a href="/orders">去订单管理</a>
              </p>
            ) : (
              <>
                <p>报价已保存，尚未转为订单。</p>
                <button
                  className="quote-workflow__order-button"
                  type="button"
                  disabled={orderBusy}
                  onClick={() => setOrderCompositionOpen(true)}
                >
                  {orderBusy
                    ? "正在创建订单…"
                    : orderError
                      ? "重试转为订单"
                      : "转为订单"}
                </button>
              </>
            )}
          </div>
        ) : null}
        <button
          className="quote-workflow__submit"
          type="submit"
          form="quote-confirmation-form"
          disabled={busy || !preview.calculation}
        >
          {busy
            ? savedQuote
              ? "正在打开预览…"
              : "正在保存…"
            : savedQuote
              ? "预览报价单"
              : initialQuote
                ? "保存修改并预览"
                : "确认保存并预览"}
        </button>
      </section>
      {savedQuote && orderCompositionOpen ? (
        <OrderCompositionDialog
          busy={orderBusy}
          lines={savedQuote.calculation.chargeLines}
          onClose={() => setOrderCompositionOpen(false)}
          onConfirm={() => void convertToOrder()}
        />
      ) : null}
    </PageLayout>
  );
};
