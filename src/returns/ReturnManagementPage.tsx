import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import type {
  AuthenticatedUser,
  ReturnRecordDto,
} from "../api/client";
import { PageLayout } from "../components/layout";
import type { ReturnStatus } from "../orders/types";
import type {
  CompleteManagedReturnInput,
  DecideManagedReturnInput,
} from "./returnManagementApi";
import "./returns.css";

export interface ReturnManagementPageProps {
  actor: AuthenticatedUser;
  items: readonly ReturnRecordDto[];
  status?: ReturnStatus | "";
  loading?: boolean;
  loadError?: string | null;
  onStatusChange?(status: ReturnStatus | ""): void;
  onReload?(): void;
  onDecide(input: DecideManagedReturnInput): Promise<void>;
  onComplete(input: CompleteManagedReturnInput): Promise<void>;
}

const RETURN_STATUS_LABELS: Readonly<Record<ReturnStatus, string>> = {
  requested: "待审批",
  approved: "已同意",
  rejected: "已驳回",
  completed: "已完成退款",
};

const formatMoney = (fen: number): string =>
  `¥${(fen / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replaceAll("/", "-");
};

const yuanToFen = (value: string): number | null => {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const yuan = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const fen = yuan * 100 + cents;
  return Number.isSafeInteger(fen) ? fen : null;
};

const reviewerRole = (actor: AuthenticatedUser): boolean =>
  actor.role === "store_manager" || actor.role === "admin";

interface RecordActionProps {
  actor: AuthenticatedUser;
  record: ReturnRecordDto;
  onOpenApproval(record: ReturnRecordDto): void;
  onOpenCompletion(record: ReturnRecordDto): void;
}

const RecordAction = ({
  actor,
  onOpenApproval,
  onOpenCompletion,
  record,
}: RecordActionProps) => {
  if (!reviewerRole(actor)) return <span className="returns-no-action">仅可查看</span>;
  if (
    record.status === "requested" &&
    record.requestedBy === actor.id &&
    actor.role === "store_manager"
  ) {
    return <span className="returns-self-review">厅长本人申请，请由管理员审批</span>;
  }
  if (record.status === "requested") {
    return (
      <button
        aria-label={`审批退单 ${record.returnNo}`}
        className="returns-primary-button"
        onClick={() => onOpenApproval(record)}
        type="button"
      >
        审批
      </button>
    );
  }
  if (record.status === "approved") {
    return (
      <button
        aria-label={`确认退款 ${record.returnNo}`}
        className="returns-primary-button"
        onClick={() => onOpenCompletion(record)}
        type="button"
      >
        确认退款
      </button>
    );
  }
  return <span className="returns-no-action">无待办操作</span>;
};

const ReturnStatusBadge = ({ status }: { status: ReturnStatus }) => (
  <span className={`returns-status is-${status}`}>
    {RETURN_STATUS_LABELS[status]}
  </span>
);

const ReturnItems = ({ record }: { record: ReturnRecordDto }) => (
  <ul className="returns-item-list" aria-label={`${record.returnNo} 退回商品`}>
    {record.items.map((item) => (
      <li key={`${item.orderLineId}-${item.sku}`}>
        <strong>{item.label} ×{item.quantity}</strong>
        <span>{formatMoney(item.maxRefundFen)}</span>
      </li>
    ))}
  </ul>
);

interface ApprovalDialogProps {
  actor: AuthenticatedUser;
  record: ReturnRecordDto;
  onClose(): void;
  onDecide(input: DecideManagedReturnInput): Promise<void>;
}

const ApprovalDialog = ({ actor, onClose, onDecide, record }: ApprovalDialogProps) => {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (decision: "approved" | "rejected") => {
    const normalized = note.trim();
    if (!normalized) {
      setError("请填写审批意见");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onDecide({ returnId: record.id, decision, note: normalized });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "退单审批失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="returns-dialog-backdrop">
      <section
        aria-label={`审批退单 ${record.returnNo}`}
        aria-modal="true"
        className="returns-dialog"
        role="dialog"
      >
        <header>
          <div><span>{record.returnNo}</span><h2>审批退单</h2></div>
          <button disabled={busy} onClick={onClose} type="button">关闭</button>
        </header>
        <div className="returns-dialog__body">
          <div className="returns-dialog-summary">
            <span>申请原因</span>
            <strong>{record.reason}</strong>
            <span>最高可退 {formatMoney(record.maxRefundFen)}</span>
          </div>
          {actor.role === "admin" && record.requestedBy === actor.id ? (
            <p className="returns-audit-note">管理员正在审批自己代客户提交的退单，本次自审会单独写入审计记录。</p>
          ) : null}
          <label>
            <span>审批意见</span>
            <textarea
              disabled={busy}
              maxLength={1_000}
              onChange={(event) => {
                setNote(event.currentTarget.value);
                setError(null);
              }}
              placeholder="必填，说明同意或驳回依据"
              rows={4}
              value={note}
            />
          </label>
          {error ? <p className="returns-form-error" role="alert">{error}</p> : null}
        </div>
        <footer>
          <button disabled={busy} onClick={() => void submit("rejected")} type="button">
            {busy ? "正在提交…" : "驳回退单"}
          </button>
          <button
            className="returns-primary-button"
            disabled={busy}
            onClick={() => void submit("approved")}
            type="button"
          >
            {busy ? "正在提交…" : "同意退单"}
          </button>
        </footer>
      </section>
    </div>
  );
};

interface CompletionDialogProps {
  record: ReturnRecordDto;
  onClose(): void;
  onComplete(input: CompleteManagedReturnInput): Promise<void>;
}

const CompletionDialog = ({ onClose, onComplete, record }: CompletionDialogProps) => {
  const [actualYuan, setActualYuan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const refundFen = yuanToFen(actualYuan);
    if (refundFen === null) {
      setError("请输入正确的实际退款金额，最多保留两位小数");
      return;
    }
    if (refundFen > record.maxRefundFen) {
      setError("实际退款金额不能超过最高可退金额");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onComplete({ returnId: record.id, refundFen });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "退款确认失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="returns-dialog-backdrop">
      <section
        aria-label={`确认退款 ${record.returnNo}`}
        aria-modal="true"
        className="returns-dialog"
        role="dialog"
      >
        <header>
          <div><span>{record.returnNo}</span><h2>确认实际退款</h2></div>
          <button disabled={busy} onClick={onClose} type="button">关闭</button>
        </header>
        <div className="returns-dialog__body">
          <div className="returns-refund-limit">
            <span>最高可退</span>
            <strong>{formatMoney(record.maxRefundFen)}</strong>
          </div>
          <label>
            <span>实际退款金额（元）</span>
            <input
              disabled={busy}
              inputMode="decimal"
              onChange={(event) => {
                setActualYuan(event.currentTarget.value);
                setError(null);
              }}
              placeholder="例如 800.00"
              value={actualYuan}
            />
          </label>
          <p className="returns-audit-note">
            此处只填写实际退给客户的金额，不是销售提成。确认后，系统会按本次退回商品及其原提成快照自动扣回销售提成；即使客户退款为 0 元，提成仍可能发生扣回。
          </p>
          {error ? <p className="returns-form-error" role="alert">{error}</p> : null}
        </div>
        <footer>
          <button disabled={busy} onClick={onClose} type="button">取消</button>
          <button
            className="returns-primary-button"
            disabled={busy}
            onClick={() => void submit()}
            type="button"
          >
            {busy ? "正在确认…" : "确认完成退款"}
          </button>
        </footer>
      </section>
    </div>
  );
};

export const ReturnManagementPage = ({
  actor,
  items,
  loadError = null,
  loading = false,
  onComplete,
  onDecide,
  onReload,
  onStatusChange,
  status = "",
}: ReturnManagementPageProps) => {
  const [approval, setApproval] = useState<ReturnRecordDto | null>(null);
  const [completion, setCompletion] = useState<ReturnRecordDto | null>(null);

  useEffect(() => {
    if (!approval && !completion) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setApproval(null);
        setCompletion(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [approval, completion]);

  const actionFor = (record: ReturnRecordDto) => (
    <RecordAction
      actor={actor}
      onOpenApproval={setApproval}
      onOpenCompletion={setCompletion}
      record={record}
    />
  );

  return (
    <PageLayout
      actions={onReload ? (
        <button className="returns-refresh-button" disabled={loading} onClick={onReload} type="button">
          刷新数据
        </button>
      ) : null}
      description={actor.role === "admin" ? "查看全部营业厅退单，审批后按实际金额确认退款。" : "查看本营业厅退单，审批后按实际金额确认退款。"}
      eyebrow="订单管理"
      title="退单管理"
    >
      <section className="returns-toolbar" aria-label="退单筛选">
        <label>
          <span>退单状态</span>
          <select
            disabled={loading}
            onChange={(event) => onStatusChange?.(event.currentTarget.value as ReturnStatus | "")}
            value={status}
          >
            <option value="">全部状态</option>
            {(Object.entries(RETURN_STATUS_LABELS) as Array<[ReturnStatus, string]>).map(
              ([value, label]) => <option key={value} value={value}>{label}</option>,
            )}
          </select>
        </label>
        <p><strong>{items.length}</strong> 笔退单</p>
      </section>

      {loadError ? (
        <section className="returns-state is-error" role="alert">
          <div><strong>暂时无法读取退单</strong><span>{loadError}</span></div>
          {onReload ? <button onClick={onReload} type="button">重新加载</button> : null}
        </section>
      ) : null}
      {loading ? <p className="returns-loading" role="status">正在读取退单…</p> : null}
      {!loading && !loadError && items.length === 0 ? (
        <section className="returns-state"><strong>暂无符合条件的退单</strong><span>可切换状态后重新查询。</span></section>
      ) : null}

      <div className="returns-table-shell">
        <table aria-label="退单列表" className="returns-desktop-table">
          <thead><tr><th>退单与订单</th><th>申请信息</th><th>原因与商品</th><th>退款金额</th><th>状态</th><th><span className="returns-visually-hidden">操作</span></th></tr></thead>
          <tbody>
            {items.map((record) => (
              <tr key={record.id}>
                <td><strong>{record.returnNo}</strong><Link className="returns-order-link" to={`/orders/${record.orderId}`}>查看订单</Link><small>{record.returnType === "full" ? "整单退单" : "部分退单"}</small></td>
                <td><strong>申请人 ID：{record.requestedBy}</strong><span>{formatDateTime(record.requestedAt)}</span></td>
                <td><p>{record.reason}</p><ReturnItems record={record} /></td>
                <td><strong>最高可退 {formatMoney(record.maxRefundFen)}</strong>{record.maxRefundFen === 0 ? <small>月付订单暂无实收月费数据，当前仅按一次性实收金额核算</small> : null}{record.status === "completed" ? <span>实际已退 {formatMoney(record.refundFen)}</span> : null}</td>
                <td><ReturnStatusBadge status={record.status} /></td>
                <td>{actionFor(record)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label="移动端退单列表" className="returns-mobile-list">
        {items.map((record) => (
          <li key={record.id}>
            <article className="returns-mobile-card">
              <header><div><span>{record.returnType === "full" ? "整单退单" : "部分退单"}</span><strong>{record.returnNo}</strong></div><ReturnStatusBadge status={record.status} /></header>
              <div className="returns-mobile-meta"><Link className="returns-order-link" to={`/orders/${record.orderId}`}>查看订单</Link><span>申请人 ID：{record.requestedBy}</span><span>{formatDateTime(record.requestedAt)}</span></div>
              <p>{record.reason}</p>
              <ReturnItems record={record} />
              <div className="returns-mobile-amount"><strong>最高可退 {formatMoney(record.maxRefundFen)}</strong>{record.maxRefundFen === 0 ? <small>暂无实收月费数据，仅按一次性实收核算</small> : null}{record.status === "completed" ? <span>实际已退 {formatMoney(record.refundFen)}</span> : null}</div>
              <footer>{actionFor(record)}</footer>
            </article>
          </li>
        ))}
      </ul>

      {approval ? <ApprovalDialog actor={actor} onClose={() => setApproval(null)} onDecide={onDecide} record={approval} /> : null}
      {completion ? <CompletionDialog onClose={() => setCompletion(null)} onComplete={onComplete} record={completion} /> : null}
    </PageLayout>
  );
};
