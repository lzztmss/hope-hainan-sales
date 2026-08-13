import { useEffect, useMemo, useState, type FormEvent } from "react";

import { formatOrderMoney } from "./formatters";
import type {
  OrderDetail,
  RequestReturnInput,
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
      .filter((line) => line.lineType === "charge" && line.refundableQuantity > 0)
      .map((line) => [line.id, { selected: false, quantity: "1" }]),
  );

export const ReturnDialog = ({
  onClose,
  onSubmit,
  open,
  order,
}: ReturnDialogProps) => {
  const [type, setType] = useState<ReturnType>("full");
  const [partial, setPartial] = useState(() => buildPartialState(order));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType("full");
    setPartial(buildPartialState(order));
    setReason("");
    setError(null);
    setSubmitting(false);
  }, [open, order.id, order.version]);

  const returnableLines = useMemo(
    () =>
      order.lines.filter(
        (line) => line.lineType === "charge" && line.refundableQuantity > 0,
      ),
    [order.lines],
  );
  const componentCount = order.lines.filter(
    (line) => line.lineType === "component",
  ).length;

  const selectedItems = useMemo(() => {
    if (type === "full") {
      return returnableLines.map((line) => ({
        orderLineId: line.id,
        quantity: line.refundableQuantity,
      }));
    }
    return returnableLines.flatMap((line) => {
      const state = partial[line.id];
      if (!state?.selected) return [];
      return [{ orderLineId: line.id, quantity: Number(state.quantity) }];
    });
  }, [partial, returnableLines, type]);

  const refundFen = selectedItems.reduce((total, item) => {
    const line = returnableLines.find((candidate) => candidate.id === item.orderLineId);
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
      const line = returnableLines.find(
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
                <small>退回所有剩余可退计价商品</small>
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

          <section className="return-line-list" aria-label="可退计价商品">
            {returnableLines.map((line) => {
              const state = partial[line.id];
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
                    <strong>{line.label}</strong>
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

          {componentCount > 0 ? (
            <p className="return-component-note">
              套装内物理设备不可单独退回
            </p>
          ) : null}

          <div className="return-refund-summary">
            <strong>预计退款 {formatOrderMoney(refundFen)}</strong>
            <small>最终退款以审批和服务端核算为准</small>
          </div>

          <label className="return-reason-field">
            <span>退单原因（至少 2 个字符）</span>
            <textarea
              minLength={2}
              maxLength={500}
              onChange={(event) => {
                setReason(event.currentTarget.value);
                setError(null);
              }}
              placeholder="必填，将进入审计记录"
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
