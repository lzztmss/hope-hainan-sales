import { useState } from "react";

import { isNonReturnablePackageSku } from "../../shared/pricing/returnPolicy";
import { ACTIVE_CATALOG } from "../../shared/pricing/catalog";
import type { ComponentId } from "../../shared/pricing/types";

import { formatOrderMoney, formatOrderPrice } from "./formatters";
import {
  ORDER_STATUS_LABELS,
  RETURN_STATUS_LABELS,
  type CompleteReturnInput,
  type DecideReturnInput,
  type OrderDetail,
  type OrderTransitionCommand,
  type OrderViewer,
  type ReturnRecordView,
  type TransitionOrderInput,
} from "./types";
import "./orders.css";

const afterSalesLabel = (record: Pick<ReturnRecordView, "serviceType" | "kind">): string =>
  `${record.kind === "special" ? "特殊" : "普通"}${record.serviceType === "refund" ? "退货退款" : "换货"}`;
const RETURN_REASON_LABELS = {
  no_reason: "7天无理由退货（仅限线上订单）",
  quality: "产品质量问题",
  order_mismatch: "商品错发、漏发或与订单不符",
  service_issue: "配送、安装或服务履约问题",
  other: "其他业务原因",
} as const;

export interface OrderDetailPageProps {
  order: OrderDetail;
  viewer: OrderViewer;
  onClose(): void;
  onDelete?(): Promise<void>;
  onRestore?(): Promise<void>;
  onTransition?(input: TransitionOrderInput): Promise<void>;
  onOpenReturn?(): void;
  onDecideReturn?(input: DecideReturnInput): Promise<void>;
  onCompleteReturn?(input: CompleteReturnInput): Promise<void>;
}

export interface ReturnAvailability {
  allowed: boolean;
  reason: string | null;
}

export const monthlyAmountAfterCompletedReturns = (order: OrderDetail): number => {
  if (order.status === "returned") return 0;
  const stoppedMonthlyFen = order.lines
    .filter((line) => line.lineType === "charge")
    .reduce(
      (sum, line) => sum + line.monthlyUnitFen * line.returnedQuantity,
      0,
    );
  return Math.max(0, order.monthlyTotalFen - stoppedMonthlyFen);
};

export const describeReturnAvailability = (order: OrderDetail): ReturnAvailability => {
  if (order.deletedAt) return { allowed: false, reason: "订单已在回收站，不能申请售后" };
  if (order.status === "return_pending") {
    return { allowed: false, reason: "已有售后申请正在审批，请先等待审批结果" };
  }
  if (order.status === "returned") {
    return { allowed: false, reason: "该订单已完成整单退货" };
  }
  if (order.status === "cancelled") {
    return { allowed: false, reason: "订单已取消，无需申请售后" };
  }
  if (order.status === "voided") {
    return { allowed: false, reason: "订单已作废，不能申请售后" };
  }
  if (order.signedAt === null && ["activated", "signed", "reconciled", "paid", "partially_returned"].includes(order.status)) {
    return { allowed: false, reason: "订单尚未签收，请先确认签收后再申请退货退款" };
  }
  if (order.status === "pending" || order.status === "accepted") {
    return { allowed: false, reason: "订单尚未生效，请使用“取消订单”" };
  }
  if (!order.permissions.canRequestReturn) {
    return { allowed: false, reason: "当前账号没有申请该订单售后的权限" };
  }
  const chargeLines = order.lines.filter((line) => line.lineType === "charge");
  if (chargeLines.some((line) => line.refundableQuantity > 0)) {
    return { allowed: true, reason: null };
  }
  return { allowed: false, reason: "该订单已没有剩余可处理的计价商品" };
};

interface ReturnApprovalProps {
  record: ReturnRecordView;
  viewer: OrderViewer;
  onDecideReturn?: (input: DecideReturnInput) => Promise<void>;
}

const ReturnApproval = ({
  onDecideReturn,
  record,
  viewer,
}: ReturnApprovalProps) => {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reviewerRole = viewer.role === "store_manager" || viewer.role === "regional_manager" || viewer.role === "admin";
  const isApplicant = record.requestedById === viewer.id;
  const administratorSelfReview = isApplicant && viewer.role === "admin";
  const mayReview =
    record.status === "requested" &&
    record.canApprove &&
    reviewerRole &&
    (!isApplicant || viewer.role === "admin") &&
    Boolean(onDecideReturn);

  if (record.status !== "requested") return null;
  if (isApplicant && viewer.role !== "admin") {
    return <p className="return-self-review-note">申请人不可审批自己提交的售后申请，请由其他有权限人员处理</p>;
  }
  if (!mayReview) return null;

  const decide = async (decision: DecideReturnInput["decision"]): Promise<void> => {
    if (!note.trim()) {
      setError("请填写审批意见");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onDecideReturn?.({
        returnId: record.id,
        decision,
        note: note.trim(),
      });
    } catch (decisionError) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : "售后审批失败，请重试",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={`售后 ${record.returnNo} 审批`}
      className="return-approval"
      role="region"
    >
      {administratorSelfReview ? (
        <p className="return-self-review-note">管理员正在审批自己提交的退单，本次操作会写入审计记录。</p>
      ) : null}
      <label>
        <span>审批意见</span>
        <textarea
          disabled={busy}
          maxLength={500}
          onChange={(event) => {
            setNote(event.currentTarget.value);
            setError(null);
          }}
          placeholder="必填，说明同意或驳回依据"
          rows={2}
          value={note}
        />
      </label>
      {error ? <p className="order-form-error" role="alert">{error}</p> : null}
      <div>
        <button disabled={busy} onClick={() => void decide("reject")} type="button">
          驳回申请
        </button>
        <button
          className="order-primary-action"
          disabled={busy}
          onClick={() => void decide("approve")}
          type="button"
        >
          同意申请
        </button>
      </div>
    </section>
  );
};

interface ReturnCompletionProps {
  record: ReturnRecordView;
  viewer: OrderViewer;
  onCompleteReturn?: (input: CompleteReturnInput) => Promise<void>;
}

const yuanToFen = (value: string): number | null => {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const yuan = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const fen = yuan * 100 + cents;
  return Number.isSafeInteger(fen) ? fen : null;
};

const ReturnCompletion = ({
  onCompleteReturn,
  record,
  viewer,
}: ReturnCompletionProps) => {
  const [open, setOpen] = useState(false);
  const [actualYuan, setActualYuan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reviewerRole = viewer.role === "store_manager" || viewer.role === "regional_manager" || viewer.role === "admin";
  const mayComplete =
    record.status === "approved" &&
    reviewerRole &&
    record.canComplete !== false &&
    Boolean(onCompleteReturn);

  if (!mayComplete) return null;
  if (!open) {
    return (
      <button
        className="order-primary-action"
        onClick={() => setOpen(true)}
        type="button"
      >
        {record.serviceType === "refund" ? "完成退款" : "完成换货"}
      </button>
    );
  }

  const complete = async (): Promise<void> => {
    const refundFen = record.serviceType === "exchange" ? 0 : yuanToFen(actualYuan);
    if (refundFen === null) {
      setError("请输入正确的实际退款金额，最多保留两位小数");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCompleteReturn?.({ returnId: record.id, refundFen });
    } catch (completionError) {
      setError(
        completionError instanceof Error
          ? completionError.message
          : `${record.serviceType === "refund" ? "完成退款" : "完成换货"}失败，请重试`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="return-completion" aria-label={`售后 ${record.returnNo} ${record.serviceType === "refund" ? "完成退款" : "完成换货"}`}>
      {record.serviceType === "refund" ? <><p>申请退款金额 {formatOrderMoney(record.requestedRefundFen)}</p><label>
        <span>实际退款金额（元）</span>
        <input
          disabled={busy}
          inputMode="decimal"
          onChange={(event) => {
            setActualYuan(event.currentTarget.value);
            setError(null);
          }}
          value={actualYuan}
        />
      </label>{yuanToFen(actualYuan) !== null && yuanToFen(actualYuan)! > record.requestedRefundFen ? <p className="return-completion__note">实际退款金额高于申请退款金额，确认后会将差异写入审计记录。</p> : null}<p className="return-completion__note">请按最终实际退给客户的金额填写。提成按退回商品的原提成快照扣回。</p></> : <p className="return-completion__note">请确认商品已经完成更换。换货不产生退款，不改变订单退款金额，也不扣回提成。</p>}
      {error ? <p className="order-form-error" role="alert">{error}</p> : null}
      <div>
        <button disabled={busy} onClick={() => setOpen(false)} type="button">取消</button>
        <button
          className="order-primary-action"
          disabled={busy}
          onClick={() => void complete()}
          type="button"
        >
          {record.serviceType === "refund" ? "确认完成退款" : "确认换货完成"}
        </button>
      </div>
    </section>
  );
};

export const availableTransitions = (
  order: OrderDetail,
  viewer: OrderViewer,
): Array<{ command: OrderTransitionCommand; label: string; tone: string }> => {
  if (order.deletedAt) return [];
  if (order.status === "pending") {
    if (viewer.role === "hr" || viewer.role === "finance" || viewer.role === "regional_manager") return [];
    return [
      { command: "ACCEPT", label: "受理订单", tone: "order-primary-action" },
      { command: "CANCEL", label: "取消订单", tone: "order-danger-action" },
    ];
  }
  if (order.status === "accepted") {
    const transitions: Array<{
      command: OrderTransitionCommand;
      label: string;
      tone: string;
    }> = viewer.role === "sales" || viewer.role === "store_manager" || viewer.role === "admin"
      ? [{ command: "CANCEL", label: "取消订单", tone: "order-danger-action" }]
      : [];
    if (viewer.role === "store_manager" || viewer.role === "regional_manager" || viewer.role === "admin") {
      transitions.unshift({
        command: "ACTIVATE",
        label: "激活订单",
        tone: "order-primary-action",
      });
    }
    return transitions;
  }
  if (order.status === "activated") {
    return [
      { command: "SIGN", label: "确认签收", tone: "order-primary-action" },
    ];
  }
  if (order.status === "signed" && (viewer.role === "hr" || viewer.role === "admin")) {
    return [{ command: "RECONCILE", label: "确认对账", tone: "order-primary-action" }];
  }
  if (order.status === "reconciled" && (viewer.role === "finance" || viewer.role === "admin")) {
    return [{ command: "MARK_PAID", label: "确认收款", tone: "order-primary-action" }];
  }
  return [];
};

export const OrderDetailPage = ({
  onClose,
  onCompleteReturn,
  onDecideReturn,
  onDelete,
  onOpenReturn,
  onRestore,
  onTransition,
  order,
  viewer,
}: OrderDetailPageProps) => {
  const [action, setAction] = useState<"delete" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deleteAllowed =
    !order.deletedAt &&
    order.permissions.canDelete &&
    (order.status === "pending" || order.status === "accepted") &&
    Boolean(onDelete);
  const restoreAllowed =
    Boolean(order.deletedAt) && order.permissions.canRestore && Boolean(onRestore);
  const returnAvailability = describeReturnAvailability(order);
  const returnAllowed = returnAvailability.allowed && Boolean(onOpenReturn);
  const transitions = onTransition ? availableTransitions(order, viewer) : [];
  const packageComponentQuantities = order.lines
    .filter((line) => line.lineType === "charge" && isNonReturnablePackageSku(line.sku))
    .reduce((quantities, line) => {
      const definition = ACTIVE_CATALOG.charges[line.sku as keyof typeof ACTIVE_CATALOG.charges];
      if (!definition) return quantities;
      for (const [componentId, quantity] of Object.entries(definition.components)) {
        quantities[componentId as ComponentId] =
          (quantities[componentId as ComponentId] ?? 0) + (quantity ?? 0) * line.quantity;
      }
      return quantities;
    }, {} as Partial<Record<ComponentId, number>>);
  const visibleLines = order.lines.flatMap((line) => {
    if (line.lineType === "charge") return [line];
    const packageQuantity = packageComponentQuantities[line.sku as ComponentId] ?? 0;
    if (packageQuantity <= 0) return [];
    return [{ ...line, quantity: Math.min(line.quantity, packageQuantity) }];
  });
  const nextMonthlyFen = monthlyAmountAfterCompletedReturns(order);
  const hasMonthlyAdjustment =
    order.paymentMode === "contract_36" && nextMonthlyFen < order.monthlyTotalFen;
  const stoppedHeartMonthlyFen = order.lines
    .filter((line) => line.lineType === "charge")
    .reduce(
      (sum, line) => sum + line.monthlyUnitFen * line.returnedQuantity,
      0,
    );
  const nextHeartMonthlyFen =
    order.status === "returned"
      ? 0
      : Math.max(0, order.heartMonthlyFen - stoppedHeartMonthlyFen);

  const runAuditedAction = async (): Promise<void> => {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "delete") await onDelete?.();
      else await onRestore?.();
      setAction(null);
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "订单操作失败，请重试",
      );
    } finally {
      setBusy(false);
    }
  };

  const runTransition = async (command: OrderTransitionCommand): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onTransition?.({
        orderId: order.id,
        command,
        expectedVersion: order.version,
      });
    } catch (transitionError) {
      setError(
        transitionError instanceof Error
          ? transitionError.message
          : "订单状态更新失败，请重试",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="order-detail-title"
      aria-modal="true"
      className="order-detail-panel"
      role="dialog"
    >
      <header className="order-detail-panel__header">
        <div>
          <p>{order.customerMasked}·{order.customerPhoneMasked}</p>
          <h2 id="order-detail-title">订单 {order.orderNo}</h2>
        </div>
        <button onClick={onClose} type="button">关闭详情</button>
      </header>

      <section className="order-detail-hero" aria-label="订单金额和状态">
        <div>
          <span>当前状态</span>
          <strong className={`order-status is-${order.status}`}>
            {ORDER_STATUS_LABELS[order.status]}
          </strong>
        </div>
        <div>
          <span>{order.paymentMode === "contract_36" ? (hasMonthlyAdjustment ? "原订单月费" : "每月合计") : "设备合计"}</span>
          <strong>{formatOrderPrice(order.oneTimeFen, order.monthlyTotalFen)}</strong>
        </div>
        {hasMonthlyAdjustment ? (
          <div className="is-adjusted-monthly">
            <span>扣除已退商品后月费</span>
            <strong>{formatOrderMoney(nextMonthlyFen)}/月</strong>
          </div>
        ) : null}
        {order.refundedFen > 0 ? (
          <div>
            <span>已退款</span>
            <strong>{formatOrderMoney(order.refundedFen)}</strong>
          </div>
        ) : null}
      </section>

      {hasMonthlyAdjustment ? (
        <p className="order-billing-adjustment-note">
          原订单月费为 {formatOrderMoney(order.monthlyTotalFen)}/月；扣除已完成退单商品后，月费为 {formatOrderMoney(nextMonthlyFen)}/月。
        </p>
      ) : null}

      <dl className="order-detail-facts">
        <div><dt>营业厅</dt><dd>{order.storeName}</dd></div>
        <div><dt>销售员</dt><dd>{order.sellerName}</dd></div>
        <div><dt>订单渠道</dt><dd>{order.salesChannel === "online" ? "线上订单" : "线下订单"}</dd></div>
        <div><dt>服务地址</dt><dd>{order.customerAddress}</dd></div>
        <div><dt>FTTR 档位</dt><dd>{order.fttrLabel}</dd></div>
        <div><dt>{hasMonthlyAdjustment ? "原心连心月增费" : "心连心月增费"}</dt><dd>{formatOrderMoney(order.heartMonthlyFen)}/月</dd></div>
        {hasMonthlyAdjustment ? <div><dt>扣除已退商品后心连心月增费</dt><dd>{formatOrderMoney(nextHeartMonthlyFen)}/月</dd></div> : null}
        <div><dt>原合同 36 个月名义合计</dt><dd>{formatOrderMoney(order.contract36Fen)}</dd></div>
      </dl>

      <section className="order-detail-section" aria-labelledby="order-lines-title">
        <h3 id="order-lines-title">商品与安装明细</h3>
        <div className="order-detail-lines">
          {visibleLines.length === 0 ? <p>暂无商品明细</p> : null}
          {[...visibleLines]
            .sort((left, right) => Number(left.lineType === "component") - Number(right.lineType === "component"))
            .map((line) => (
            <article
              className="order-detail-line"
              data-line-type={line.lineType}
              data-returned={line.returnedQuantity > 0 ? "true" : "false"}
              key={line.id}
            >
              <div>
                <span>
                  {line.returnedQuantity > 0
                    ? line.returnedQuantity >= line.quantity ? "已退商品" : "部分已退"
                    : line.lineType === "component"
                    ? "套餐内设备"
                    : isNonReturnablePackageSku(line.sku)
                      ? "计价套餐 · 仅可整单退"
                      : "计价商品"}
                </span>
                <strong>{line.label}×{line.quantity}{line.unit}</strong>
                {line.returnedQuantity > 0 ? (
                  <small className="order-line-returned">
                    已退 {line.returnedQuantity}{line.unit}
                    {line.returnedQuantity < line.quantity
                      ? ` · 剩余 ${line.quantity - line.returnedQuantity}${line.unit}`
                      : " · 已全部退回"}
                  </small>
                ) : null}
              </div>
              <div>
                <span>
                  {line.lineType === "component"
                    ? "套餐内含 · 不另收费"
                    : line.monthlySubtotalFen > 0
                    ? `${formatOrderMoney(line.monthlySubtotalFen)}/月`
                    : formatOrderMoney(line.oneTimeSubtotalFen)}
                </span>
                {line.locations.length > 0 ? <small>{line.locations.join("、")}</small> : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="order-detail-section" aria-labelledby="order-timeline-title">
        <h3 id="order-timeline-title">订单进度</h3>
        {order.timeline.length === 0 ? <p>暂无进度记录</p> : (
          <ol className="order-timeline">
            {order.timeline.map((entry) => (
              <li key={entry.id}>
                <span>{ORDER_STATUS_LABELS[entry.status]}</span>
                <strong>{entry.note}</strong>
                <small>{entry.at}·{entry.actorName}</small>
              </li>
            ))}
          </ol>
        )}
      </section>

      {order.returns.length > 0 ? (
        <section className="order-detail-section" aria-labelledby="order-returns-title">
          <h3 id="order-returns-title">售后记录</h3>
          <div className="order-return-records">
            {order.returns.map((record) => (
              <article key={record.id}>
                <header>
                  <div>
                    <strong>{record.returnNo} · {afterSalesLabel(record)} · {record.type === "full" ? "整单" : "部分商品"}</strong>
                    <span>{record.requestedAt}·{record.requestedByName}</span>
                  </div>
                  <span className={`return-status is-${record.status}`}>
                    {record.kind === "special" ? `${afterSalesLabel(record)}${RETURN_STATUS_LABELS[record.status]}` : record.serviceType === "exchange" && record.status === "completed" ? "换货已完成" : RETURN_STATUS_LABELS[record.status]}
                  </span>
                </header>
                <p>{RETURN_REASON_LABELS[record.reasonCategory]}：{record.reason}</p>
                <div className="order-return-items">
                  <span>
                    {record.status === "completed"
                      ? record.serviceType === "refund" ? "已退回商品" : "已换货商品"
                      : record.status === "rejected"
                        ? "申请商品（已驳回）"
                        : record.serviceType === "refund" ? "申请退回商品" : "申请换货商品"}
                  </span>
                  <ul>
                    {record.items.map((item) => (
                      <li key={item.orderLineId}>
                        <strong>{item.label} × {item.quantity}</strong>
                        {record.serviceType === "exchange" ? <small>换货</small> : null}
                      </li>
                    ))}
                  </ul>
                </div>
                <strong>
                  {record.serviceType === "exchange"
                    ? "换货不涉及退款和提成扣回"
                    : record.status === "completed"
                      ? `实际退款 ${formatOrderMoney(record.refundFen)}`
                      : `申请退款 ${formatOrderMoney(record.requestedRefundFen)}`}
                </strong>
                <ReturnApproval
                  onDecideReturn={onDecideReturn}
                  record={record}
                  viewer={viewer}
                />
                <ReturnCompletion
                  onCompleteReturn={onCompleteReturn}
                  record={record}
                  viewer={viewer}
                />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {error ? <p className="order-form-error order-detail-error" role="alert">{error}</p> : null}

      {action ? (
        <section className="order-audit-action" aria-label={action === "delete" ? "删除订单" : "恢复订单"}>
          <strong>{action === "delete" ? "确认移入回收站？" : "确认恢复该订单？"}</strong>
          <p>
            {action === "delete"
              ? "仅待受理或已受理订单可删除，之后可由有权限人员恢复。"
              : "恢复后订单将重新出现在正常订单列表中。"}
          </p>
          <div>
            <button disabled={busy} onClick={() => setAction(null)} type="button">取消</button>
            <button
              className="order-primary-action"
              disabled={busy}
              onClick={() => void runAuditedAction()}
              type="button"
            >
              {action === "delete" ? "确认删除" : "确认恢复"}
            </button>
          </div>
        </section>
      ) : null}

      <footer className="order-detail-actions">
        {transitions.map((transition) => (
          <button
            className={transition.tone}
            disabled={busy}
            key={transition.command}
            onClick={() => void runTransition(transition.command)}
            type="button"
          >
            {transition.label}
          </button>
        ))}
        {deleteAllowed ? (
          <button className="order-danger-action" disabled={busy} onClick={() => setAction("delete")} type="button">
            删除到回收站
          </button>
        ) : null}
        {restoreAllowed ? (
          <button className="order-primary-action" disabled={busy} onClick={() => setAction("restore")} type="button">
            恢复订单
          </button>
        ) : null}
        {onOpenReturn ? (
          <div className="order-return-action-state">
            <button
              aria-describedby={!returnAllowed ? "order-return-unavailable-reason" : undefined}
              className="order-warning-action"
              disabled={!returnAllowed}
              onClick={returnAllowed ? onOpenReturn : undefined}
              type="button"
            >
              申请退货退款
            </button>
            {!returnAllowed ? (
              <small id="order-return-unavailable-reason">{returnAvailability.reason}</small>
            ) : null}
          </div>
        ) : null}
      </footer>
    </section>
  );
};
