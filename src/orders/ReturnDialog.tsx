import { useEffect, useMemo, useState, type FormEvent } from "react";

import { isNonReturnablePackageSku } from "../../shared/pricing/returnPolicy";
import { formatOrderMoney } from "./formatters";
import type {
  AfterSalesServiceType,
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
  const [serviceType, setServiceType] = useState<AfterSalesServiceType>("refund");
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
    setServiceType("refund");
    setType("full");
    setKind(elapsedDays !== null && elapsedDays > 7 ? "special" : "normal");
    setReasonCategory("other");
    setPartial(buildPartialState(order));
    setReason("");
    setRequestedRefundYuan("");
    setError(null);
    setSubmitting(false);
  }, [elapsedDays, open, order.id, order.version]);

  const normalDeadlineDays = serviceType === "refund" ? 7 : 15;
  const normalUnavailable = elapsedDays !== null && elapsedDays > normalDeadlineDays;

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
  const componentCount = order.lines.filter(
    (line) => line.lineType === "component",
  ).length;
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

  const refundFen = selectedItems.reduce((total, item) => {
    const line = order.lines.find((candidate) => candidate.id === item.orderLineId);
    return total + (line?.refundableUnitFen ?? 0) * item.quantity;
  }, 0);
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
    if (kind === "normal" && normalUnavailable) {
      setError(`已超过普通${serviceType === "refund" ? "退货退款" : "换货"}的 ${normalDeadlineDays} 日期限，请选择特殊处理`);
      return;
    }
    if (serviceType === "exchange" && kind === "normal" && reasonCategory !== "quality") {
      setError("普通换货仅适用于产品质量问题");
      return;
    }
    if (
      serviceType === "refund" &&
      requestedRefundFen === null
    ) {
      setError("请填写正确的申请退款金额");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        orderId: order.id,
        orderVersion: order.version,
        serviceType,
        type,
        kind,
        reasonCategory,
        requestedRefundFen: serviceType === "refund" ? requestedRefundFen! : 0,
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
            <h2 id="return-dialog-title">申请售后</h2>
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
          <fieldset className="return-type-picker">
            <legend>1. 选择售后方式</legend>
            <label><input checked={serviceType === "refund"} name="service-type" onChange={() => { setServiceType("refund"); setKind(elapsedDays !== null && elapsedDays > 7 ? "special" : "normal"); setError(null); }} type="radio" /><span><strong>退货退款</strong><small>退回商品，并填写申请退款金额</small></span></label>
            <label><input checked={serviceType === "exchange"} name="service-type" onChange={() => { setServiceType("exchange"); setKind(elapsedDays !== null && elapsedDays > 15 ? "special" : "normal"); setReasonCategory("quality"); setError(null); }} type="radio" /><span><strong>换货</strong><small>更换商品，不产生退款，也不扣回提成</small></span></label>
          </fieldset>
          <fieldset className="return-type-picker">
            <legend>2. 选择处理类型</legend>
            <label><input checked={kind === "normal"} disabled={normalUnavailable} name="return-kind" onChange={() => setKind("normal")} type="radio" /><span><strong>普通处理</strong><small>{normalUnavailable ? `已签收 ${elapsedDays} 天，超过 ${normalDeadlineDays} 日普通处理期限` : serviceType === "refund" ? "签收后 7 日内可申请普通退货退款" : "签收后 15 日内，因质量问题可申请普通换货"}</small></span></label>
            <label><input checked={kind === "special"} name="return-kind" onChange={() => setKind("special")} type="radio" /><span><strong>特殊处理</strong><small>期限内外均可申请，需详细说明具体情况</small></span></label>
          </fieldset>
          {kind === "special" ? (
            <p className="return-component-note" role="status">
              本申请会以“特殊{serviceType === "refund" ? "退货退款" : "换货"}”单独标识；审批人不变，仍由营业厅经理、大区经理或管理员处理。
            </p>
          ) : null}
          <label className="return-reason-field">
            <span>申请原因类型</span>
            <select value={reasonCategory} onChange={(event) => setReasonCategory(event.currentTarget.value as ReturnReasonCategory)}>
              <option value="no_reason">无理由退货（仅限线上销售）</option>
              <option value="quality">产品质量问题</option>
              <option value="other">其他业务原因</option>
            </select>
          </label>
          <fieldset className="return-type-picker">
            <legend>3. 选择商品范围</legend>
            <label>
              <input
                aria-label={`整单${serviceType === "refund" ? "退货" : "换货"}`}
                checked={type === "full"}
                name="return-type"
                onChange={() => {
                  setType("full");
                  setError(null);
                }}
                type="radio"
              />
              <span>
                <strong>整单{serviceType === "refund" ? "退货" : "换货"}</strong>
                <small>套餐与自购商品一起处理</small>
              </span>
            </label>
            <label>
              <input
                aria-label={`部分${serviceType === "refund" ? "退货" : "换货"}`}
                checked={type === "partial"}
                name="return-type"
                onChange={() => {
                  setType("partial");
                  setError(null);
                }}
                type="radio"
              />
              <span>
                <strong>部分{serviceType === "refund" ? "退货" : "换货"}</strong>
                <small>选择原订单中的商品和数量</small>
              </span>
            </label>
          </fieldset>

          <section className="return-line-list" aria-label={type === "full" ? `整单${serviceType === "refund" ? "退回" : "换货"}商品` : `可${serviceType === "refund" ? "退" : "换"}计价商品`}>
            {displayedLines.map((line) => {
              const state = partial[line.id];
              const packageLine = isNonReturnablePackageSku(line.sku);
              return (
                <div className="return-line" key={line.id}>
                  {type === "partial" ? (
                    <input
                      aria-label={`${line.label}，剩余可${serviceType === "refund" ? "退" : "换"} ${line.refundableQuantity} ${line.unit}`}
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
                      {packageLine ? `（套餐整套${serviceType === "refund" ? "退回" : "换货"}）` : ""}
                    </strong>
                    <span>
                      剩余可{serviceType === "refund" ? "退" : "换"} {line.refundableQuantity} {line.unit}·
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

          {packageLines.length > 0 ? (
            <section className="return-package-note" aria-label="不可退套餐">
              <strong>{type === "full" ? `以下套餐随整单一并${serviceType === "refund" ? "退回" : "换货"}` : `以下套餐仅支持整单${serviceType === "refund" ? "退回" : "换货"}`}</strong>
              <span>{packageLines.map((line) => line.label).join("、")}</span>
              <small>套餐及套餐内设备按完整方案交付，不支持部分处理套餐或拆分处理套餐内设备。</small>
            </section>
          ) : null}

          {componentCount > 0 ? (
            <p className="return-component-note">
              套装内物理设备不可单独申请售后
            </p>
          ) : null}

          {serviceType === "refund" ? (
            <div className="return-refund-summary">
              <strong>系统参考退款金额 {formatOrderMoney(refundFen)}</strong>
              <small>仅供核对，不限制申请金额；审批和实际退款都会保留记录。</small>
              {order.paymentMode === "contract_36" ? <small>月付订单只显示所选商品一个计费月的参考月费，系统不会按经过月份自动累加；请按实际业务填写申请金额。</small> : null}
              <label className="return-reason-field">
                <span>申请退款金额（元）</span>
                <input inputMode="decimal" min="0" onChange={(event) => { setRequestedRefundYuan(event.currentTarget.value); setError(null); }} placeholder="例如 50.00" step="0.01" type="number" value={requestedRefundYuan} />
              </label>
              {requestedRefundFen !== null && requestedRefundFen > refundFen ? <small role="status">申请金额高于系统参考金额，仍可提交，系统会在审批记录中标注。</small> : null}
            </div>
          ) : (
            <div className="return-refund-summary"><strong>本申请不涉及退款</strong><small>换货完成后不会增加订单退款金额，也不会扣回销售提成。</small></div>
          )}

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
              {submitting ? "正在提交…" : `提交${serviceType === "refund" ? "退货退款" : "换货"}申请`}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};
