import { useEffect, useMemo, useState, type FormEvent } from "react";

import { isNonReturnablePackageSku } from "../../shared/pricing/returnPolicy";
import { formatOrderMoney } from "./formatters";
import type {
  OrderDetail,
  RequestReturnInput,
  ReturnKind,
  ReturnReasonCategory,
  ReturnType,
} from "./types";
import "./orders.css";

export interface ReturnDialogProps {
  open: boolean;
  order: OrderDetail;
  onClose(): void;
  onSubmit(input: RequestReturnInput): Promise<void>;
}

interface PartialLineState {
  selected: boolean;
  quantity: string;
}

const buildPartialState = (order: OrderDetail): Record<string, PartialLineState> =>
  Object.fromEntries(
    order.lines
      .filter(
        (line) =>
          line.lineType === "charge" &&
          !isNonReturnablePackageSku(line.sku) &&
          line.refundableQuantity > 0,
      )
      .map((line) => [line.id, { selected: false, quantity: "1" }]),
  );

const shanghaiDayNumber = (value: Date): number => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Math.floor(Date.UTC(number("year"), number("month") - 1, number("day")) / 86_400_000);
};

const signedElapsedDays = (signedAt: string | null): number | null => {
  if (!signedAt) return null;
  const signed = new Date(signedAt);
  if (Number.isNaN(signed.getTime())) return null;
  return Math.max(0, shanghaiDayNumber(new Date()) - shanghaiDayNumber(signed));
};

const yuanToFen = (value: string): number | null => {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const fen = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(fen) ? fen : null;
};

export const ReturnDialog = ({
  onClose,
  onSubmit,
  open,
  order,
}: ReturnDialogProps) => {
  const elapsedDays = signedElapsedDays(order.signedAt);
  const [type, setType] = useState<ReturnType>("full");
  const [kind, setKind] = useState<ReturnKind>("normal");
  const [reasonCategory, setReasonCategory] = useState<ReturnReasonCategory>("other");
  const [partial, setPartial] = useState(() => buildPartialState(order));
  const [reason, setReason] = useState("");
  const [requestedRefundYuan, setRequestedRefundYuan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType("full");
    setKind(elapsedDays !== null && elapsedDays > 7 ? "special" : "normal");
    setReasonCategory("other");
    setPartial(buildPartialState(order));
    setReason("");
    setRequestedRefundYuan("");
    setError(null);
    setSubmitting(false);
  }, [elapsedDays, open, order.id, order.version]);

  const normalDeadlineDays = 7;
  const outsideNormalWindow = elapsedDays !== null && elapsedDays > normalDeadlineDays;

  const returnableLines = useMemo(
    () =>
      order.lines.filter(
        (line) =>
          line.lineType === "charge" &&
          !isNonReturnablePackageSku(line.sku) &&
          line.refundableQuantity > 0,
      ),
    [order.lines],
  );
  const fullReturnLines = useMemo(
    () =>
      order.lines.filter(
        (line) => line.lineType === "charge" && line.refundableQuantity > 0,
      ),
    [order.lines],
  );
  const componentLines = order.lines.filter(
    (line) => line.lineType === "component",
  );
  const packageLines = order.lines.filter(
    (line) =>
      line.lineType === "charge" &&
      isNonReturnablePackageSku(line.sku) &&
      line.refundableQuantity > 0,
  );
  const displayedLines = type === "full" ? fullReturnLines : returnableLines;

  const selectedItems = useMemo(() => {
    if (type === "full") {
      return fullReturnLines.map((line) => ({
        orderLineId: line.id,
        quantity: line.refundableQuantity,
      }));
    }
    return returnableLines.flatMap((line) => {
      const state = partial[line.id];
      if (!state?.selected) return [];
      return [{ orderLineId: line.id, quantity: Number(state.quantity) }];
    });
  }, [fullReturnLines, partial, returnableLines, type]);

  const requestedRefundFen = yuanToFen(requestedRefundYuan);

  if (!open) return null;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (reason.trim().length < 2) {
      setError("售后说明至少填写 2 个字符");
      return;
    }
    if (selectedItems.length === 0) {
      setError("请至少选择一项商品");
      return;
    }
    for (const item of selectedItems) {
      const eligibleLines = type === "full" ? fullReturnLines : returnableLines;
      const line = eligibleLines.find(
        (candidate) => candidate.id === item.orderLineId,
      );
      if (
        !line ||
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0 ||
        item.quantity > line.refundableQuantity
      ) {
        setError("申请数量不能超过剩余可处理数量");
        return;
      }
    }
    if (kind === "normal" && outsideNormalWindow) {
      setError(`已超过普通退货退款的 ${normalDeadlineDays} 日期限，请选择特殊处理`);
      return;
    }
    if (kind === "special" && !outsideNormalWindow) {
      setError("签收后7日内只能使用普通处理");
      return;
    }
    if (reasonCategory === "no_reason" && (order.salesChannel !== "online" || outsideNormalWindow)) {
      setError("7天无理由退货仅适用于签收后7日内的线上订单");
      return;
    }
    if (requestedRefundFen === null) {
      setError("请填写正确的申请退款金额");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        orderId: order.id,
        orderVersion: order.version,
        serviceType: "refund",
        type,
        kind,
        reasonCategory,
        requestedRefundFen,
        items: selectedItems,
        reason: reason.trim(),
      });
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "售后申请失败，请重试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="order-modal-backdrop order-modal-backdrop--return">
      <section
        aria-labelledby="return-dialog-title"
        aria-modal="true"
        className="return-dialog"
        role="dialog"
      >
        <header className="return-dialog__header">
          <div>
            <p>{order.orderNo}</p>
            <h2 id="return-dialog-title">申请退货退款</h2>
          </div>
          <button disabled={submitting} onClick={onClose} type="button">
            关闭
          </button>
        </header>

        <form
          className="return-dialog__form"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <p className="return-order-channel">
            <strong>{order.salesChannel === "online" ? "线上订单" : "线下订单"}</strong>
            <span>{outsideNormalWindow ? `已签收 ${elapsedDays} 天，按7天外特殊退货处理` : "签收后7日内，按普通退货处理"}</span>
          </p>
          <fieldset className="return-type-picker">
            <legend>1. 选择处理类型</legend>
            <label><input checked={kind === "normal"} disabled={outsideNormalWindow} name="return-kind" onChange={() => setKind("normal")} type="radio" /><span><strong>普通处理（7天内）</strong><small>{outsideNormalWindow ? `已签收 ${elapsedDays} 天，超过普通处理期限` : "当前可申请普通退货退款"}</small></span></label>
            <label><input checked={kind === "special"} disabled={!outsideNormalWindow} name="return-kind" onChange={() => setKind("special")} type="radio" /><span><strong>特殊处理（7天外）</strong><small>{outsideNormalWindow ? "当前须按特殊退货处理，并详细说明情况" : "签收未超过7天，暂不开放特殊处理"}</small></span></label>
          </fieldset>
          {kind === "special" ? (
            <p className="return-component-note" role="status">
              本申请会以“特殊退货退款”单独标识；审批人不变，仍由营业厅经理、大区经理或管理员处理。
            </p>
          ) : null}
          <label className="return-reason-field">
            <span>申请原因类型</span>
            <select value={reasonCategory} onChange={(event) => setReasonCategory(event.currentTarget.value as ReturnReasonCategory)}>
              {order.salesChannel === "online" && !outsideNormalWindow ? <option value="no_reason">7天无理由退货（仅限线上订单）</option> : null}
              <option value="quality">产品质量问题</option>
              <option value="order_mismatch">商品错发、漏发或与订单不符</option>
              <option value="service_issue">配送、安装或服务履约问题</option>
              <option value="other">其他业务原因</option>
            </select>
          </label>
          <fieldset className="return-type-picker">
            <legend>2. 选择商品范围</legend>
            <label>
              <input
                aria-label="整单退货"
                checked={type === "full"}
                name="return-type"
                onChange={() => {
                  setType("full");
                  setError(null);
                }}
                type="radio"
              />
              <span>
                <strong>整单退货</strong>
                <small>套餐与自购商品一起处理</small>
              </span>
            </label>
            <label>
              <input
                aria-label="部分退货"
                checked={type === "partial"}
                name="return-type"
                onChange={() => {
                  setType("partial");
                  setError(null);
                }}
                type="radio"
              />
              <span>
                <strong>部分退货</strong>
                <small>选择原订单中的商品和数量</small>
              </span>
            </label>
          </fieldset>

          <section className="return-line-list" aria-label={type === "full" ? "整单退回商品" : "可退计价商品"}>
            {displayedLines.map((line) => {
              const state = partial[line.id];
              const packageLine = isNonReturnablePackageSku(line.sku);
              return (
                <div className="return-line" key={line.id}>
                  {type === "partial" ? (
                    <input
                      aria-label={`${line.label}，剩余可退 ${line.refundableQuantity} ${line.unit}`}
                      checked={state?.selected ?? false}
                      onChange={(event) => {
                        const selected = event.currentTarget.checked;
                        setPartial((current) => ({
                          ...current,
                          [line.id]: {
                            quantity: current[line.id]?.quantity ?? "1",
                            selected,
                          },
                        }));
                        setError(null);
                      }}
                      type="checkbox"
                    />
                  ) : null}
                  <div>
                    <strong>
                      {line.label}
                      {packageLine ? "（套餐整套退回）" : ""}
                    </strong>
                    <span>
                      剩余可退 {line.refundableQuantity} {line.unit}·
                      {formatOrderMoney(line.refundableUnitFen)}/{line.unit}
                    </span>
                  </div>
                  {type === "partial" && state?.selected ? (
                    <label>
                      <span className="visually-hidden">{line.label}退回数量</span>
                      <input
                        aria-label={`${line.label}退回数量`}
                        inputMode="numeric"
                        max={line.refundableQuantity}
                        min="1"
                        onChange={(event) => {
                          const quantity = event.currentTarget.value;
                          setPartial((current) => ({
                            ...current,
                            [line.id]: {
                              selected: true,
                              quantity,
                            },
                          }));
                          setError(null);
                        }}
                        type="number"
                        value={state.quantity}
                      />
                    </label>
                  ) : (
                    <strong>×{line.refundableQuantity}</strong>
                  )}
                </div>
              );
            })}
          </section>

          {componentLines.length > 0 ? (
            <section className="return-component-list" aria-label="套餐内设备">
              <header>
                <div>
                  <strong>套餐内设备</strong>
                  <small>蓝色设备由套餐包含，不单独计价</small>
                </div>
                <span>{type === "full" ? "随整套一并退回" : "不可单独选择"}</span>
              </header>
              {packageLines.length > 0 ? (
                <div className="return-component-price-reference">
                  <strong>对应套餐价格参考</strong>
                  {packageLines.map((line) => (
                    <span key={line.id}>
                      {line.label}：{order.paymentMode === "contract_36"
                        ? `${formatOrderMoney(line.monthlySubtotalFen)}/月（36个月合约月付）`
                        : `${formatOrderMoney(line.oneTimeSubtotalFen)}（一次性支付）`}
                    </span>
                  ))}
                  <small>{order.paymentMode === "contract_36" ? "申请退款时请结合实际已收取的月费填写。" : "申请退款时可按订单一次性支付金额参考填写。"}</small>
                </div>
              ) : null}
              {componentLines.map((line) => (
                <article className="return-component-line" key={line.id}>
                  <div>
                    <span>套餐内设备</span>
                    <strong>{line.label} × {line.quantity}{line.unit}</strong>
                    {line.locations.length > 0 ? <small>{line.locations.join("、")}</small> : null}
                  </div>
                  <strong>套餐内含 · 不另收费</strong>
                </article>
              ))}
            </section>
          ) : null}

          {packageLines.length > 0 ? (
            <section className="return-package-note" aria-label="不可退套餐">
              <strong>{type === "full" ? "以下套餐随整单一并退回" : "以下套餐仅支持整单退回"}</strong>
              <span>{packageLines.map((line) => line.label).join("、")}</span>
              <small>套餐及套餐内设备按完整方案交付，不支持部分处理套餐或拆分处理套餐内设备。</small>
            </section>
          ) : null}

          <div className="return-refund-summary">
            <label className="return-reason-field">
              <span>申请退款金额（元）</span>
              <input inputMode="decimal" min="0" onChange={(event) => { setRequestedRefundYuan(event.currentTarget.value); setError(null); }} step="0.01" type="number" value={requestedRefundYuan} />
            </label>
            <small>请按本次售后实际申请的退款金额填写，审批和最终退款都会保留记录。</small>
          </div>

          <label className="return-reason-field">
            <span>{kind === "special" ? "特殊处理说明" : "售后说明"}（至少 2 个字符）</span>
            <textarea
              minLength={2}
              maxLength={500}
              onChange={(event) => {
                setReason(event.currentTarget.value);
                setError(null);
              }}
              placeholder={kind === "special" ? "必填，请详细说明为什么需要特殊处理" : "必填，将进入售后和审计记录"}
              rows={3}
              value={reason}
            />
          </label>
          {error ? <p className="order-form-error" role="alert">{error}</p> : null}

          <footer className="return-dialog__actions">
            <button disabled={submitting} onClick={onClose} type="button">
              取消
            </button>
            <button className="order-primary-action" disabled={submitting} type="submit">
              {submitting ? "正在提交…" : "提交退货退款申请"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};
