import { useMemo, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

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
} from "../api/client";
import { PageLayout } from "../components/layout";
import "./quoteWorkflow.css";

export type QuoteWorkflowClient = Pick<
  ApiClient,
  "confirmQuote" | "createOrderFromQuote" | "recordQuotePrint"
>;

export interface QuoteWorkflowPageProps {
  client: QuoteWorkflowClient;
  createIdempotencyKey?: () => string;
  createOrderIdempotencyKey?: () => string;
}

type QuantityKey = Exclude<keyof QuoteSelection, "locations">;
type Scenario = "custom" | "one_key" | "home_dual" | "room";
type FttrChoice = "none" | "custom" | `${number}`;

const ROOM_LABELS: Record<RoomType, string> = {
  one_bedroom: "一室一厅",
  two_bedroom: "两室一厅",
  three_bedroom: "三室一厅",
};

const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  contract_36: "36 个月月付",
  one_time: "设备一次性购买",
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

const formatShanghaiDate = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
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
}: QuoteWorkflowPageProps) => {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [roomType, setRoomType] = useState<RoomType>("one_bedroom");
  const [elderCount, setElderCount] = useState<1 | 2 | 3 | 4>(1);
  const [mode, setMode] = useState<PaymentMode>("contract_36");
  const [fttrChoice, setFttrChoice] = useState<FttrChoice>("159");
  const [customFttr, setCustomFttr] = useState("");
  const [customFttrNote, setCustomFttrNote] = useState("");
  const [scenario, setScenario] = useState<Scenario>("custom");
  const [selection, setSelection] = useState<QuoteSelection>(initialSelection);
  const [savedQuote, setSavedQuote] = useState<ConfirmedQuoteSummary | null>(null);
  const [createdOrder, setCreatedOrder] = useState<OrderMutationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
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
    setSelection((current) =>
      scenarioSelection(nextScenario, roomType, elderCount, current),
    );
  };

  const changeRoom = (nextRoom: RoomType) => {
    setRoomType(nextRoom);
    if (scenario === "room") {
      setSelection(buildRoomPreset(nextRoom, elderCount));
    }
  };

  const changeElderCount = (nextCount: 1 | 2 | 3 | 4) => {
    setElderCount(nextCount);
    if (scenario === "room") {
      setSelection(buildRoomPreset(roomType, nextCount));
    }
  };

  const changeQuantity = (key: QuantityKey, value: string) => {
    const parsed = Number(value);
    const quantity = Number.isInteger(parsed)
      ? Math.min(20, Math.max(0, parsed))
      : 0;
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
        idempotencyKey.current ??= createIdempotencyKey();
        const input: ConfirmQuoteInput = {
          customer: {
            name: name.trim(),
            phone: phone.trim(),
            roomType,
            elderCount,
          },
          pricing,
        };
        quote = await client.confirmQuote(input, idempotencyKey.current);
        quoteConfirmed = true;
        flushSync(() => setSavedQuote(quote));
      }

      await client.recordQuotePrint(quote.id);
      window.print();
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

  const documentFttr =
    fttrChoice === "none"
      ? "不新增 FTTR"
      : fttrChoice === "custom"
        ? `${customFttr || "--"} 元/月（${customFttrNote.trim() || "待补充说明"}）`
        : `${fttrChoice} 元/月`;
  const documentQuoteDate = formatShanghaiDate(
    savedQuote?.confirmedAt ?? new Date(),
  );
  const documentCalculation = savedQuote?.calculation ?? preview.calculation;

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
      description="页面只展示大客户特优价；确认时服务端会用当前有效价格版本重新核价。"
      eyebrow="销售报价"
      title="新建报价"
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
        <section
          className="quote-workflow__preview quote-workflow__document"
          aria-label="正式客户报价单"
        >
        <header className="quote-workflow__document-header">
          <img src="/haipo-logo.jpg" alt="海魄科技标识" />
          <div>
            <p className="quote-workflow__company-name">海魄科技</p>
            <h2>海南联通 FTTR 心连心融合套餐销售报价系统</h2>
            <p>客户报价单</p>
          </div>
        </header>

        <dl className="quote-workflow__document-meta">
          <div>
            <dt>报价单号</dt>
            <dd>{savedQuote?.quoteNo ?? "确认保存后生成"}</dd>
          </div>
          <div>
            <dt>报价日期</dt>
            <dd>{documentQuoteDate}</dd>
          </div>
          <div>
            <dt>客户姓名或称呼</dt>
            <dd>{name.trim() || "待填写"}</dd>
          </div>
          <div>
            <dt>联系电话</dt>
            <dd>{maskPhone(phone)}</dd>
          </div>
          <div>
            <dt>客户户型</dt>
            <dd>{ROOM_LABELS[roomType]}</dd>
          </div>
          <div>
            <dt>长者人数</dt>
            <dd>{elderCount} 位</dd>
          </div>
          <div>
            <dt>支付方式</dt>
            <dd>{PAYMENT_MODE_LABELS[mode]}</dd>
          </div>
          <div>
            <dt>FTTR 方案</dt>
            <dd>{documentFttr}</dd>
          </div>
        </dl>

        {preview.error ? <p role="alert">{preview.error}</p> : null}
        {documentCalculation ? (
          <>
            <p className="quote-workflow__catalog-version">
              报价价格版本：<strong>{documentCalculation.catalogVersion}</strong>
            </p>
            <QuoteTotalsBreakdown calculation={documentCalculation} estimate={false} />
            <div className="quote-workflow__preview-columns">
              <section aria-labelledby="charge-lines-title">
                <h3 id="charge-lines-title">计价商品</h3>
                <ul>
                  {documentCalculation.chargeLines.map((line) => (
                    <li key={line.sku}>
                      <span>
                        <strong>{line.label}</strong>
                        <small>
                          数量 {line.quantity} {line.unit} · {line.monthlyUnitFen > 0
                            ? `月付单价 ¥${formatMoney(line.monthlyUnitFen)}`
                            : `一次性单价 ¥${formatMoney(line.oneTimeUnitFen)}`}
                        </small>
                      </span>
                      <strong>
                        {line.monthlySubtotalFen > 0
                          ? `月付小计 ¥${formatMoney(line.monthlySubtotalFen)}`
                          : `一次性小计 ¥${formatMoney(line.oneTimeSubtotalFen)}`}
                      </strong>
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-labelledby="component-lines-title">
                <h3 id="component-lines-title">物理设备与点位</h3>
                <ul>
                  {documentCalculation.componentLines.map((line) => (
                    <li key={line.componentId}>
                      <strong>{line.label} × {line.quantity} {line.unit}</strong>
                      <span>安装 / 使用点位：{line.locations.join("、")}</span>
                      <small>{line.reason}</small>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <div className="quote-workflow__entitlements">
              <h3>专属权益</h3>
              {ACTIVE_CATALOG.entitlements.map((entitlement) => (
                <p key={entitlement.label}>
                  <strong>{entitlement.label}</strong>：{entitlement.display}
                </p>
              ))}
            </div>

            <section
              className="quote-workflow__disclaimer"
              aria-labelledby="quote-disclaimer-title"
            >
              <h3 id="quote-disclaimer-title">报价说明</h3>
              <p>
                本报价根据上述户型、人数和产品配置生成。最终资费、业务受理、
                网络覆盖与安装点位以海南联通现场确认及双方签署的订单为准。
              </p>
              <p>客户联系电话仅用于报价与服务联系，本报价单已做脱敏展示。</p>
            </section>
          </>
        ) : null}
        </section>
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

      <section className="quote-workflow__confirmation" aria-label="确认报价">
        {error ? <p role="alert">{error}</p> : null}
        {orderError ? <p role="alert">{orderError}</p> : null}
        {savedQuote ? (
          <p role="status">
            报价 {savedQuote.quoteNo} 已保存。系统打印窗口关闭或取消，不会删除这份报价。
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
                  onClick={() => void convertToOrder()}
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
              ? "正在准备打印…"
              : "正在保存…"
            : savedQuote
              ? "重新打印已保存报价"
              : "确认保存并打印"}
        </button>
      </section>
    </PageLayout>
  );
};
