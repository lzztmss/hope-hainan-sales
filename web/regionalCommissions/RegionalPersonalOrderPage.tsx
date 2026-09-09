import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import type {
  ApiClient,
  AuthenticatedUser,
  RegionalManagerOption,
  RegionalPersonalOrderDto,
} from "../api/client";
import { PageLayout } from "../components/layout";
import { RegionalActionErrorDialog } from "./RegionalActionErrorDialog";
import "./regionalCommission.css";

const PRODUCTS = [
  ["GATEWAY", "迷你网关"],
  ["WATCH", "智能手表"],
  ["MATTRESS", "智能床垫"],
  ["MOTION", "人体传感器"],
  ["DOOR", "门磁"],
  ["PORTABLE_BUTTON", "随身报警按钮"],
  ["WALL_BUTTON", "壁挂报警按钮"],
] as const;

type ProductSku = typeof PRODUCTS[number][0];
interface ProductLineForm { key: number; sku: ProductSku; quantity: string; }
interface ReturnForm { completedOn: string; reason: string; quantities: Record<string, string>; }

const emptyForm = {
  orderNo: "",
  channel: "",
  businessDate: "",
  signedOn: "",
  evidenceNo: "",
  note: "",
};

const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
const statusLabel: Record<RegionalPersonalOrderDto["status"], string> = {
  active: "有效",
  returned: "已全部退货",
  voided: "已作废",
};

export const RegionalPersonalOrderPage = ({
  client,
  actor,
}: {
  client: ApiClient;
  actor: AuthenticatedUser;
}) => {
  const canEdit = actor.role === "hr" || actor.role === "admin";
  const [managers, setManagers] = useState<readonly RegionalManagerOption[]>([]);
  const [managerId, setManagerId] = useState(actor.role === "regional_manager" ? actor.id : "");
  const [orders, setOrders] = useState<readonly RegionalPersonalOrderDto[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [lines, setLines] = useState<ProductLineForm[]>([{ key: 1, sku: "GATEWAY", quantity: "1" }]);
  const [nextLineKey, setNextLineKey] = useState(2);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voidReasons, setVoidReasons] = useState<Record<string, string>>({});
  const [returnForms, setReturnForms] = useState<Record<string, ReturnForm>>({});
  const showError = (value: unknown, fallback: string) => {
    const errorMessage = value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
    setMessage(errorMessage);
    setActionError(errorMessage);
  };

  const loadOrders = useCallback(async () => {
    if (!managerId) {
      setOrders([]);
      return;
    }
    const response = await client.listRegionalPersonalOrders(managerId);
    setOrders(response.items as readonly RegionalPersonalOrderDto[]);
  }, [client, managerId]);

  useEffect(() => {
    void client.listRegionalManagers().then((loaded) => {
      setManagers(loaded);
      if (actor.role !== "regional_manager") {
        setManagerId((current) => current || loaded.find((manager) => manager.active)?.id || loaded[0]?.id || "");
      }
    }).catch((error) => showError(error, "大区经理加载失败，请刷新重试"));
  }, [actor.role, client]);

  useEffect(() => {
    void loadOrders().catch((error) => showError(error, "个人渠道订单加载失败"));
  }, [loadOrders]);

  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!managerId) {
      showError("请选择大区经理", "请选择大区经理");
      return;
    }
    const productLines = lines.map((line) => ({
      sku: line.sku,
      label: PRODUCTS.find(([sku]) => sku === line.sku)?.[1] ?? line.sku,
      quantity: Number(line.quantity),
    }));
    if (productLines.some((line) => !Number.isSafeInteger(line.quantity) || line.quantity <= 0)) {
      showError("每个商品数量必须是大于 0 的整数", "商品数量不正确");
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      await client.createRegionalPersonalOrder({
        managerId,
        orderNo: form.orderNo.trim(),
        channel: form.channel.trim(),
        orderCount: 1,
        businessDate: form.businessDate,
        signedOn: form.signedOn,
        evidenceNo: form.evidenceNo.trim(),
        note: form.note.trim() || undefined,
        lines: productLines,
      });
      setForm(emptyForm);
      setLines([{ key: nextLineKey, sku: "GATEWAY", quantity: "1" }]);
      setNextLineKey((value) => value + 1);
      await loadOrders();
      setMessage("个人渠道订单及逐件提成快照已保存。");
    } catch (error) {
      showError(error, "订单保存失败，请检查后重试");
    } finally {
      setBusy(false);
    }
  };

  const voidOrder = async (order: RegionalPersonalOrderDto) => {
    const reason = voidReasons[order.id]?.trim();
    if (!reason) {
      showError("作废订单必须填写原因", "作废失败");
      return;
    }
    setBusy(true);
    try {
      await client.voidRegionalPersonalOrder(order.id, reason);
      await loadOrders();
      setMessage(`订单 ${order.orderNo} 已作废，原记录和原因已保留。`);
    } catch (error) {
      showError(error, "作废失败");
    } finally {
      setBusy(false);
    }
  };

  const returnFormFor = (order: RegionalPersonalOrderDto): ReturnForm =>
    returnForms[order.id] ?? {
      completedOn: "",
      reason: "",
      quantities: Object.fromEntries(order.lines.map((line) => [line.id, String(line.returnedQuantity)])),
    };

  const updateReturnForm = (order: RegionalPersonalOrderDto, patch: Partial<ReturnForm>) => {
    const current = returnFormFor(order);
    setReturnForms((forms) => ({ ...forms, [order.id]: { ...current, ...patch } }));
  };

  const returnOrder = async (order: RegionalPersonalOrderDto) => {
    const current = returnFormFor(order);
    if (!current.completedOn || !current.reason.trim()) {
      showError("登记退货必须填写完成日期和原因", "退货登记失败");
      return;
    }
    const returnedLines = order.lines.map((line) => ({
      lineId: line.id,
      returnedQuantity: Number(current.quantities[line.id] ?? line.returnedQuantity),
    }));
    if (returnedLines.some((line, index) =>
      !Number.isSafeInteger(line.returnedQuantity)
      || line.returnedQuantity < 0
      || line.returnedQuantity > order.lines[index]!.quantity)) {
      showError("退货数量必须在 0 和原商品数量之间", "退货数量不正确");
      return;
    }
    setBusy(true);
    try {
      await client.returnRegionalPersonalOrder(order.id, {
        completedOn: current.completedOn,
        reason: current.reason.trim(),
        lines: returnedLines,
      });
      await loadOrders();
      setMessage(`订单 ${order.orderNo} 的退货已登记，将按退货完成月份进入调整。`);
    } catch (error) {
      showError(error, "退货登记失败");
    } finally {
      setBusy(false);
    }
  };

  return <PageLayout
    actions={<Link className="regional-secondary-action" to="/commissions/regional">返回提成总览</Link>}
    description={canEdit ? "一张业务订单可录入多个商品，系统保存逐件数量、单价和提成小计。" : "查看个人渠道订单、逐件提成和退货状态。"}
    eyebrow="大区经理提成"
    title={canEdit ? "个人渠道订单管理" : "我的个人渠道订单"}
  >
    <RegionalActionErrorDialog message={actionError} onClose={() => setActionError(null)} />
    {message ? <div className="regional-notice" role="status">{message}</div> : null}

    {actor.role !== "regional_manager" ? <label className="regional-manager-select">
      <span>大区经理</span>
      <select value={managerId} onChange={(event) => setManagerId(event.currentTarget.value)}>
        <option value="">请选择大区经理</option>
        {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.displayName}（{manager.workNo}）</option>)}
      </select>
    </label> : null}

    {canEdit ? <form className="regional-form" onSubmit={(event) => void submit(event)}>
      <section className="regional-form-section" aria-labelledby="order-basic-heading">
        <div className="regional-section-heading"><div><h2 id="order-basic-heading">订单信息</h2><p>带 * 的项目为必填项，请按订单凭据如实填写。</p></div></div>
        <div className="regional-form-grid">
          <label className="regional-field"><span>订单号 *</span><input autoComplete="off" required value={form.orderNo} onChange={(event) => update("orderNo", event.currentTarget.value)} /></label>
          <label className="regional-field"><span>个人渠道 *</span><input placeholder="例如：政企客户转介" required value={form.channel} onChange={(event) => update("channel", event.currentTarget.value)} /></label>
          <label className="regional-field"><span>业务日期 *</span><input required type="date" value={form.businessDate} onChange={(event) => update("businessDate", event.currentTarget.value)} /></label>
          <label className="regional-field"><span>签收日期 *</span><input min={form.businessDate || undefined} required type="date" value={form.signedOn} onChange={(event) => update("signedOn", event.currentTarget.value)} /></label>
          <label className="regional-field"><span>凭据/业务编号 *</span><input required value={form.evidenceNo} onChange={(event) => update("evidenceNo", event.currentTarget.value)} /></label>
          <label className="regional-field"><span>备注（选填）</span><input value={form.note} onChange={(event) => update("note", event.currentTarget.value)} /></label>
        </div>
      </section>

      <section className="regional-form-section" aria-labelledby="order-lines-heading">
        <div className="regional-section-heading">
          <div><h2 id="order-lines-heading">商品与设备明细</h2><p>组合套餐必须拆成实际小件录入，系统按保存时的模板单价形成快照。</p></div>
          <button type="button" onClick={() => {
            setLines((current) => [...current, { key: nextLineKey, sku: "GATEWAY", quantity: "1" }]);
            setNextLineKey((value) => value + 1);
          }}>新增商品行</button>
        </div>
        <div className="regional-order-line-list">
          {lines.map((line, index) => <div className="regional-order-line" key={line.key}>
            <label className="regional-field"><span>商品 {index + 1}</span><select value={line.sku} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, sku: event.currentTarget.value as ProductSku } : item))}>{PRODUCTS.map(([sku, label]) => <option key={sku} value={sku}>{label}</option>)}</select></label>
            <label className="regional-field"><span>数量</span><input min="1" required step="1" type="number" value={line.quantity} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, quantity: event.currentTarget.value } : item))} /></label>
            <button className="regional-danger-action" aria-disabled={lines.length === 1} type="button" onClick={() => lines.length === 1 ? showError("至少需要保留一行商品明细。", "不能删除最后一行") : setLines((current) => current.filter((item) => item.key !== line.key))}>删除本行</button>
          </div>)}
        </div>
      </section>
      <div className="regional-form-actions"><button className="regional-primary-action" disabled={busy} type="submit">{busy ? "保存中…" : "保存订单并核算"}</button></div>
    </form> : null}

    <section className="regional-section regional-section--wide">
      <div className="regional-section-heading"><div><h2>个人渠道订单记录</h2><p>逐件提成使用录入保存时的模板快照；历史记录不会因以后模板变更而重算。</p></div><span>{orders.length} 笔</span></div>
      {orders.length === 0 ? <p className="regional-empty">暂无个人渠道订单。</p> : <div className="regional-personal-order-list">
        {orders.map((order) => {
          const orderReturn = returnFormFor(order);
          const subtotal = order.lines.reduce((sum, line) => sum + (line.quantity - line.returnedQuantity) * line.unitCommissionFen, 0);
          return <article className="regional-personal-order-card" key={order.id}>
            <header><div><strong>{order.orderNo}</strong><span>{order.channel} · 业务 {order.businessDate} · 签收 {order.signedOn} · 满 7 天计入 {order.effectiveOn}</span></div><span className={`regional-status regional-status--${order.status}`}>{statusLabel[order.status]}</span></header>
            <div className="regional-table-wrap"><table><thead><tr><th>商品</th><th>数量</th><th>已退</th><th>单价</th><th>当前小计</th></tr></thead><tbody>{order.lines.map((line) => <tr key={line.id}><td>{line.label}</td><td>{line.quantity}</td><td>{line.returnedQuantity}</td><td>{yuan(line.unitCommissionFen)}</td><td>{yuan((line.quantity - line.returnedQuantity) * line.unitCommissionFen)}</td></tr>)}</tbody><tfoot><tr><th colSpan={4}>当前商品提成</th><th>{yuan(subtotal)}</th></tr></tfoot></table></div>
            <p>凭据 {order.evidenceNo}{order.note ? ` · ${order.note}` : ""}{order.returnReason ? ` · 退货原因：${order.returnReason}` : ""}{order.voidReason ? ` · 作废原因：${order.voidReason}` : ""}</p>
            {canEdit && order.status !== "voided" ? <details className="regional-order-adjustment">
              <summary>登记退货或作废</summary>
              <div className="regional-return-grid">
                <label><span>退货完成日期</span><input type="date" value={orderReturn.completedOn} onChange={(event) => updateReturnForm(order, { completedOn: event.currentTarget.value })} /></label>
                <label><span>退货原因</span><input value={orderReturn.reason} onChange={(event) => updateReturnForm(order, { reason: event.currentTarget.value })} /></label>
                {order.lines.map((line) => <label key={line.id}><span>{line.label}累计退货数量（最多 {line.quantity}）</span><input min="0" max={line.quantity} step="1" type="number" value={orderReturn.quantities[line.id] ?? line.returnedQuantity} onChange={(event) => updateReturnForm(order, { quantities: { ...orderReturn.quantities, [line.id]: event.currentTarget.value } })} /></label>)}
                <button disabled={busy} type="button" onClick={() => void returnOrder(order)}>保存退货记录</button>
              </div>
              <div className="regional-void-row"><input aria-label={`${order.orderNo}作废原因`} placeholder="作废原因（必填）" value={voidReasons[order.id] ?? ""} onChange={(event) => setVoidReasons((current) => ({ ...current, [order.id]: event.currentTarget.value }))} /><button className="regional-danger-action" disabled={busy} type="button" onClick={() => void voidOrder(order)}>作废订单</button></div>
            </details> : null}
          </article>;
        })}
      </div>}
    </section>
  </PageLayout>;
};
