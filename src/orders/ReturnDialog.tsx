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

export const ReturnDialog = ({
  onClose,
  onSubmit,
  open,
  order,
}: ReturnDialogProps) => {
  const elapsedDays = signedElapsedDays(order.signedAt);
  const requiresSpecial = elapsedDays !== null && elapsedDays > 15;
  const [type, setType] = useState<ReturnType>("full");
  const [kind, setKind] = useState<ReturnKind>("normal");
  const [reasonCategory, setReasonCategory] = useState<ReturnReasonCategory>("other");
  const [partial, setPartial] = useState(() => buildPartialState(order));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType("full");
    setKind(requiresSpecial ? "special" : "normal");
    setReasonCategory("other");
    setPartial(buildPartialState(order));
    setReason("");
    setError(null);
    setSubmitting(false);
  }, [open, order.id, order.version, requiresSpecial]);

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

  if (!open) return null;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (reason.trim().length < 2) {
      setError("退单原因至少填写 2 个字符");
      return;
    }
    if (selectedItems.length === 0) {
      setError("请至少选择一项可退商品");
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
        setError("退回数量不能超过可退数量");
        return;
      }
    }

    setSubmitting(true);
    try {
      await onSubmit({
        orderId: order.id,
        orderVersion: order.version,
        type,
        kind,
        reasonCategory,
        items: selectedItems,
        reason: reason.trim(),
      });
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "退单申请失败，请重试",
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
            <h2 id="return-dialog-title">申请退单</h2>
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
            <legend>申请类型</legend>
            <label><input checked={kind === "normal"} disabled={requiresSpecial} name="return-kind" onChange={() => setKind("normal")} type="radio" /><span><strong>普通退货</strong><small>{requiresSpecial ? `已签收 ${elapsedDays} 天，不能再走普通退货` : "签收后15日内按普通规则申请"}</small></span></label>
            <label><input checked={kind === "special"} name="return-kind" onChange={() => setKind("special")} type="radio" /><span><strong>特殊退款</strong><small>超过15日或不符合普通条件时申请</small></span></label>
          </fieldset>
          {kind === "special" ? (
            <p className="return-component-note" role="status">
              本申请将以“特殊退款”单独标识，审批流程不增加管理员终审，仍由有权限的营业厅经理、大区经理或管理员处理。
            </p>
          ) : null}
          <label className="return-reason-field">
            <span>申请原因类型</span>
            <select value={reasonCategory} onChange={(event) => setReasonCategory(event.currentTarget.value as ReturnReasonCategory)}>
              <option value="no_reason">无理由退货</option>
              <option value="quality">产品质量问题</option>
              <option value="other">其他业务原因</option>
            </select>
          </label>
          <fieldset className="return-type-picker">
            <legend>退单方式</legend>
            <label>
              <input
                aria-label="整单退单"
                checked={type === "full"}
                name="return-type"
                onChange={() => {
                  setType("full");
                  setError(null);
                }}
                type="radio"
              />
              <span>
                <strong>整单退单</strong>
                <small>套餐与自购商品一起整单退回</small>
              </span>
            </label>
            <label>
              <input
                aria-label="部分退单"
                checked={type === "partial"}
                name="return-type"
                onChange={() => {
                  setType("partial");
                  setError(null);
                }}
                type="radio"
              />
              <span>
                <strong>部分退单</strong>
                <small>按原订单计价商品和剩余数量退回</small>
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

          {packageLines.length > 0 ? (
            <section className="return-package-note" aria-label="不可退套餐">
              <strong>{type === "full" ? "以下套餐随整单一并退回" : "以下套餐仅支持整单退回"}</strong>
              <span>{packageLines.map((line) => line.label).join("、")}</span>
              <small>套餐及套餐内设备按完整方案交付，不支持部分退套餐或拆退套餐内设备。</small>
            </section>
          ) : null}

          {componentCount > 0 ? (
            <p className="return-component-note">
              套装内物理设备不可单独退回
            </p>
          ) : null}

          <div className="return-refund-summary">
            <strong>客户最高可退 {formatOrderMoney(refundFen)}</strong>
            <small>这是客户退款上限，不是销售提成；提成将在退单完成后按所退商品原提成自动扣回。</small>
            {order.paymentMode === "contract_36" ? (
              <small>月付商品按一个月的商品月费计算退款上限；退单完成后，订单月费将扣除已退商品的月增费。</small>
            ) : null}
          </div>

          <label className="return-reason-field">
            <span>{kind === "special" ? "特殊退款说明" : "退单原因"}（至少 2 个字符）</span>
            <textarea
              minLength={2}
              maxLength={500}
              onChange={(event) => {
                setReason(event.currentTarget.value);
                setError(null);
              }}
              placeholder={kind === "special" ? "必填，请说明超过普通退货期限后仍需退款的具体情况" : "必填，将进入审计记录"}
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
              {submitting ? "正在提交…" : "提交退单申请"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};
