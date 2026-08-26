import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import type {
  AuthenticatedUser,
  ReturnRecordDto,
} from "../api/client";
import { PageLayout } from "../components/layout";
import { Pagination } from "../components/Pagination";
import type { AfterSalesServiceType, ReturnKind, ReturnStatus } from "../orders/types";
import type {
  CompleteManagedReturnInput,
  DecideManagedReturnInput,
} from "./returnManagementApi";
import "./returns.css";

export interface ReturnManagementPageProps {
  actor: AuthenticatedUser;
  items: readonly ReturnRecordDto[];
  page?: number;
  total?: number;
  onPageChange?(page: number): void;
  status?: ReturnStatus | "";
  serviceType?: AfterSalesServiceType | "";
  returnKind?: ReturnKind | "";
  loading?: boolean;
  loadError?: string | null;
  onStatusChange?(status: ReturnStatus | ""): void;
  onServiceTypeChange?(serviceType: AfterSalesServiceType | ""): void;
  onReturnKindChange?(returnKind: ReturnKind | ""): void;
  onStoreChange?(storeId: string): void;
  onSellerChange?(sellerId: string): void;
  storeId?: string;
  sellerId?: string;
  stores?: readonly { id: string; label: string }[];
  sellers?: readonly { id: string; label: string; storeId: string }[];
  onReload?(): void;
  onDecide(input: DecideManagedReturnInput): Promise<void>;
  onComplete(input: CompleteManagedReturnInput): Promise<void>;
}

const RETURN_STATUS_LABELS: Readonly<Record<ReturnStatus, string>> = {
  requested: "待审批",
  approved: "已同意",
  rejected: "已驳回",
  completed: "已完成",
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
  actor.role === "store_manager" || actor.role === "regional_manager" || actor.role === "admin";

const globalDataRole = (actor: AuthenticatedUser): boolean =>
  actor.role === "admin" || actor.role === "hr" || actor.role === "finance";

const afterSalesLabel = (record: Pick<ReturnRecordDto, "serviceType" | "returnKind">): string =>
  `${record.returnKind === "special" ? "特殊" : "普通"}${record.serviceType === "refund" ? "退货退款" : "换货"}`;

const RETURN_REASON_LABELS = {
  no_reason: "7天无理由退货（仅限线上订单）",
  quality: "产品质量问题",
  order_mismatch: "商品错发、漏发或与订单不符",
  service_issue: "配送、安装或服务履约问题",
  other: "其他业务原因",
} as const;

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
    actor.role !== "admin"
  ) {
    return <span className="returns-self-review">本人申请，请由其他有权限人员审批</span>;
  }
  if (record.status === "requested") {
    return (
      <button
        aria-label={`审批售后 ${record.returnNo}`}
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
        aria-label={`${record.serviceType === "refund" ? "确认退款" : "确认换货完成"} ${record.returnNo}`}
        className="returns-primary-button"
        onClick={() => onOpenCompletion(record)}
        type="button"
      >
        {record.serviceType === "refund" ? "确认退款" : "确认换货完成"}
      </button>
    );
  }
  return <span className="returns-no-action">无待办操作</span>;
};

const ReturnStatusBadge = ({ record }: { record: ReturnRecordDto }) => (
  <span className={`returns-status is-${record.status}`}>
    {record.returnKind === "special" ? `${afterSalesLabel(record)}${RETURN_STATUS_LABELS[record.status]}` : record.serviceType === "exchange" && record.status === "completed" ? "换货已完成" : RETURN_STATUS_LABELS[record.status]}
  </span>
);

const ReturnItems = ({ record }: { record: ReturnRecordDto }) => (
  <ul className="returns-item-list" aria-label={`${record.returnNo} 退回商品`}>
    {record.items.map((item) => (
      <li key={`${item.orderLineId}-${item.sku}`}>
        <strong>{item.label} ×{item.quantity}</strong>
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
      setError(reason instanceof Error ? reason.message : "售后审批失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="returns-dialog-backdrop">
      <section
        aria-label={`审批售后 ${record.returnNo}`}
        aria-modal="true"
        className="returns-dialog"
        role="dialog"
      >
        <header>
          <div><span>{record.returnNo}</span><h2>审批{afterSalesLabel(record)}</h2></div>
          <button disabled={busy} onClick={onClose} type="button">关闭</button>
        </header>
        <div className="returns-dialog__body">
          <div className="returns-dialog-summary">
            <span>业务类型</span>
            <strong>{afterSalesLabel(record)} · {RETURN_REASON_LABELS[record.reasonCategory]}</strong>
            <span>申请原因</span>
            <strong>{record.reason}</strong>
            {record.serviceType === "refund" ? <><span>申请退款金额</span><strong>{formatMoney(record.requestedRefundFen)}</strong></> : <><span>金额处理</span><strong>换货不涉及退款和提成扣回</strong></>}
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
            {busy ? "正在提交…" : "驳回申请"}
          </button>
          <button
            className="returns-primary-button"
            disabled={busy}
            onClick={() => void submit("approved")}
            type="button"
          >
            {busy ? "正在提交…" : "同意申请"}
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
    const refundFen = record.serviceType === "exchange" ? 0 : yuanToFen(actualYuan);
    if (refundFen === null) {
      setError("请输入正确的实际退款金额，最多保留两位小数");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onComplete({ returnId: record.id, refundFen });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${record.serviceType === "refund" ? "退款" : "换货"}确认失败，请重试`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="returns-dialog-backdrop">
      <section
        aria-label={`${record.serviceType === "refund" ? "确认退款" : "确认换货完成"} ${record.returnNo}`}
        aria-modal="true"
        className="returns-dialog"
        role="dialog"
      >
        <header>
          <div><span>{record.returnNo}</span><h2>{record.serviceType === "refund" ? "确认实际退款" : "确认换货完成"}</h2></div>
          <button disabled={busy} onClick={onClose} type="button">关闭</button>
        </header>
        <div className="returns-dialog__body">
          {record.serviceType === "refund" ? <><div className="returns-refund-request"><span>申请退款金额</span><strong>{formatMoney(record.requestedRefundFen)}</strong></div><label className="returns-actual-refund-field">
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
          </label>{yuanToFen(actualYuan) !== null && yuanToFen(actualYuan)! > record.requestedRefundFen ? <p className="returns-form-warning">实际退款金额高于申请退款金额，确认后会将差异写入审计记录。</p> : null}<p className="returns-dialog-guidance">请按最终实际退给客户的金额填写。退货完成后，系统会按退回商品的原提成快照扣回提成。</p></> : <p className="returns-dialog-guidance">请确认换货已经实际完成。该操作不会产生退款，不会改变订单退款金额，也不会扣回销售提成。</p>}
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
            {busy ? "正在确认…" : record.serviceType === "refund" ? "确认完成退款" : "确认换货完成"}
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
  onServiceTypeChange,
  onReturnKindChange,
  onStoreChange,
  onSellerChange,
  storeId = "",
  sellerId = "",
  stores = [],
  sellers = [],
  status = "",
  serviceType = "",
  returnKind = "",
  page = 1,
  total = items.length,
  onPageChange,
}: ReturnManagementPageProps) => {
  const [approval, setApproval] = useState<ReturnRecordDto | null>(null);
  const [completion, setCompletion] = useState<ReturnRecordDto | null>(null);
  const [draftStatus, setDraftStatus] = useState(status);
  const [draftServiceType, setDraftServiceType] = useState(serviceType);
  const [draftReturnKind, setDraftReturnKind] = useState(returnKind);
  const [draftStoreId, setDraftStoreId] = useState(storeId);
  const [draftSellerId, setDraftSellerId] = useState(sellerId);

  useEffect(() => {
    setDraftStatus(status);
    setDraftServiceType(serviceType);
    setDraftReturnKind(returnKind);
    setDraftStoreId(storeId);
    setDraftSellerId(sellerId);
  }, [returnKind, sellerId, serviceType, status, storeId]);

  const applyFilters = () => {
    onStatusChange?.(draftStatus);
    onServiceTypeChange?.(draftServiceType);
    onReturnKindChange?.(draftReturnKind);
    onStoreChange?.(draftStoreId);
    onSellerChange?.(draftSellerId);
    onReload?.();
  };

  const resetFilters = () => {
    setDraftStatus("");
    setDraftServiceType("");
    setDraftReturnKind("");
    setDraftStoreId("");
    setDraftSellerId("");
    onStatusChange?.("");
    onServiceTypeChange?.("");
    onReturnKindChange?.("");
    onStoreChange?.("");
    onSellerChange?.("");
    onReload?.();
  };

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
      description={globalDataRole(actor) ? "查看全部营业厅退货退款；人力资源和财务仅查看，审批和完成仍由业务管理人员处理。" : actor.role === "regional_manager" ? "查看所管营业厅退货退款，并处理审批。" : "查看本营业厅退货退款并处理审批。"}
      eyebrow="订单管理"
      title="售后管理"
    >
      <section className="returns-toolbar" aria-label="售后筛选">
        <label>
          <span>售后状态</span>
          <select
            disabled={loading}
            onChange={(event) => setDraftStatus(event.currentTarget.value as ReturnStatus | "")}
            value={draftStatus}
          >
            <option value="">全部状态</option>
            {(Object.entries(RETURN_STATUS_LABELS) as Array<[ReturnStatus, string]>).map(
              ([value, label]) => <option key={value} value={value}>{label}</option>,
            )}
          </select>
        </label>
        <label><span>处理类型</span><select disabled={loading} value={draftReturnKind} onChange={(event) => setDraftReturnKind(event.currentTarget.value as ReturnKind | "")}><option value="">全部类型</option><option value="normal">普通处理</option><option value="special">特殊处理</option></select></label>
        {globalDataRole(actor) || actor.role === "regional_manager" ? <label><span>营业厅</span><select disabled={loading} value={draftStoreId} onChange={(event) => { setDraftStoreId(event.currentTarget.value); setDraftSellerId(""); }}><option value="">全部营业厅</option>{stores.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : null}
        <label><span>销售员</span><select disabled={loading} value={draftSellerId} onChange={(event) => setDraftSellerId(event.currentTarget.value)}><option value="">全部可见销售员</option>{sellers.filter((option) => !draftStoreId || option.storeId === draftStoreId).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <div className="returns-toolbar__actions"><button className="returns-primary-button" disabled={loading} onClick={applyFilters} type="button">查询</button><button disabled={loading} onClick={resetFilters} type="button">重置</button></div>
        <p><strong>{total}</strong> 笔售后</p>
      </section>

      {loadError ? (
        <section className="returns-state is-error" role="alert">
          <div><strong>暂时无法读取售后记录</strong><span>{loadError}</span></div>
          {onReload ? <button onClick={onReload} type="button">重新加载</button> : null}
        </section>
      ) : null}
      {loading ? <p className="returns-loading" role="status">正在读取售后记录…</p> : null}
      {!loading && !loadError && items.length === 0 ? (
        <section className="returns-state"><strong>暂无符合条件的售后记录</strong><span>可调整筛选条件后重新查询。</span></section>
      ) : null}

      <div className="returns-table-shell">
        <table aria-label="售后列表" className="returns-desktop-table">
          <thead><tr><th>售后与订单</th><th>申请信息</th><th>原因与商品</th><th>金额信息</th><th>状态</th><th><span className="returns-visually-hidden">操作</span></th></tr></thead>
          <tbody>
            {items.map((record) => (
              <tr key={record.id}>
                <td><strong>{record.returnNo}</strong><Link className="returns-order-link" to={`/orders/${record.orderId}`}>原订单 {record.orderNo}</Link><small>{afterSalesLabel(record)} · {record.returnType === "full" ? "整单" : "部分商品"}</small></td>
                <td><strong>申请人 ID：{record.requestedBy}</strong><span>{formatDateTime(record.requestedAt)}</span></td>
                <td><small>{RETURN_REASON_LABELS[record.reasonCategory]}</small><p>{record.reason}</p><ReturnItems record={record} /></td>
                <td>{record.serviceType === "refund" ? <><strong>申请退款 {formatMoney(record.requestedRefundFen)}</strong>{record.status === "completed" ? <span>实际退款 {formatMoney(record.refundFen)}</span> : null}</> : <><strong>换货不涉及退款</strong><small>不扣回提成</small></>}</td>
                <td><ReturnStatusBadge record={record} /></td>
                <td>{actionFor(record)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label="移动端售后列表" className="returns-mobile-list">
        {items.map((record) => (
          <li key={record.id}>
            <article className="returns-mobile-card">
              <header><div><span>{afterSalesLabel(record)} · {record.returnType === "full" ? "整单" : "部分商品"}</span><strong>{record.returnNo}</strong></div><ReturnStatusBadge record={record} /></header>
              <div className="returns-mobile-meta"><Link className="returns-order-link" to={`/orders/${record.orderId}`}>原订单 {record.orderNo}</Link><span>申请人 ID：{record.requestedBy}</span><span>{formatDateTime(record.requestedAt)}</span></div>
              <p>{RETURN_REASON_LABELS[record.reasonCategory]}：{record.reason}</p>
              <ReturnItems record={record} />
              <div className="returns-mobile-amount">{record.serviceType === "refund" ? <><strong>申请退款 {formatMoney(record.requestedRefundFen)}</strong>{record.status === "completed" ? <span>实际退款 {formatMoney(record.refundFen)}</span> : null}</> : <><strong>换货不涉及退款</strong><small>不扣回提成</small></>}</div>
              <footer>{actionFor(record)}</footer>
            </article>
          </li>
        ))}
      </ul>
      <Pagination
        onPageChange={(nextPage) => onPageChange?.(nextPage)}
        page={page}
        totalItems={total}
      />

      {approval ? <ApprovalDialog actor={actor} onClose={() => setApproval(null)} onDecide={onDecide} record={approval} /> : null}
      {completion ? <CompletionDialog onClose={() => setCompletion(null)} onComplete={onComplete} record={completion} /> : null}
    </PageLayout>
  );
};
