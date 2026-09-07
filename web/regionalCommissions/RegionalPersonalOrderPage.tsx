import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import type { ApiClient, RegionalManagerOption } from "../api/client";
import { PageLayout } from "../components/layout";
import "./regionalCommission.css";

const PRODUCTS = [
  ["GATEWAY", "FTTR 网关"],
  ["WATCH", "智能手表"],
  ["MATTRESS", "智能床垫"],
  ["MOTION", "人体传感器"],
  ["DOOR", "门磁传感器"],
  ["PORTABLE_BUTTON", "便携按钮"],
  ["WALL_BUTTON", "墙面按钮"],
] as const;

const emptyForm = {
  orderNo: "",
  channel: "",
  businessDate: "",
  signedOn: "",
  evidenceNo: "",
  sku: "GATEWAY",
  quantity: "1",
};

export const RegionalPersonalOrderPage = ({ client }: { client: ApiClient }) => {
  const [managers, setManagers] = useState<readonly RegionalManagerOption[]>([]);
  const [managerId, setManagerId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void client
      .listRegionalManagers()
      .then(setManagers)
      .catch((error) => setMessage(error instanceof Error ? error.message : "大区经理加载失败，请刷新重试"));
  }, [client]);

  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setIsSaving(true);
    try {
      await client.createRegionalPersonalOrder({
        managerId,
        orderNo: form.orderNo.trim(),
        channel: form.channel.trim(),
        orderCount: 1,
        businessDate: form.businessDate,
        signedOn: form.signedOn,
        evidenceNo: form.evidenceNo.trim(),
        lines: [{ sku: form.sku, label: PRODUCTS.find(([sku]) => sku === form.sku)?.[1] ?? form.sku, quantity: Number(form.quantity) }],
      });
      setForm(emptyForm);
      setMessage("个人渠道订单已保存，可继续录入下一笔订单。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "订单保存失败，请检查后重试");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageLayout
      actions={<Link className="regional-secondary-action" to="/commissions/regional">返回提成总览</Link>}
      description="登记大区经理个人拓展渠道产生的订单，保存后将按签收日期进入对应提成周期。"
      eyebrow="大区经理提成"
      title="录入个人渠道订单"
    >
      {message ? <div className="regional-notice" role="status">{message}</div> : null}

      <form className="regional-form" onSubmit={(event) => void submit(event)}>
        <section className="regional-form-section" aria-labelledby="order-basic-heading">
          <div className="regional-section-heading">
            <div>
              <h2 id="order-basic-heading">订单信息</h2>
              <p>带 * 的项目为必填项，请按订单凭据如实填写。</p>
            </div>
          </div>
          <div className="regional-form-grid">
            <label className="regional-field">
              <span>大区经理 *</span>
              <select required value={managerId} onChange={(event) => setManagerId(event.currentTarget.value)}>
                <option value="">请选择大区经理</option>
                {managers.filter((manager) => manager.active).map((manager) => (
                  <option key={manager.id} value={manager.id}>{manager.displayName}（{manager.workNo}）</option>
                ))}
              </select>
            </label>
            <label className="regional-field">
              <span>订单号 *</span>
              <input autoComplete="off" required value={form.orderNo} onChange={(event) => update("orderNo", event.currentTarget.value)} />
            </label>
            <label className="regional-field">
              <span>个人渠道 *</span>
              <input placeholder="例如：政企客户转介" required value={form.channel} onChange={(event) => update("channel", event.currentTarget.value)} />
            </label>
            <label className="regional-field">
              <span>业务日期 *</span>
              <input required type="date" value={form.businessDate} onChange={(event) => update("businessDate", event.currentTarget.value)} />
            </label>
            <label className="regional-field">
              <span>签收日期 *</span>
              <input min={form.businessDate || undefined} required type="date" value={form.signedOn} onChange={(event) => update("signedOn", event.currentTarget.value)} />
            </label>
            <label className="regional-field">
              <span>凭据编号 *</span>
              <input required value={form.evidenceNo} onChange={(event) => update("evidenceNo", event.currentTarget.value)} />
            </label>
          </div>
        </section>

        <section className="regional-form-section" aria-labelledby="order-product-heading">
          <div className="regional-section-heading">
            <div>
              <h2 id="order-product-heading">商品明细</h2>
              <p>当前每笔记录录入一种商品；同一订单包含多种商品时，请分笔登记。</p>
            </div>
          </div>
          <div className="regional-form-grid regional-form-grid--product">
            <label className="regional-field">
              <span>商品 *</span>
              <select required value={form.sku} onChange={(event) => update("sku", event.currentTarget.value)}>
                {PRODUCTS.map(([sku, label]) => <option key={sku} value={sku}>{label}</option>)}
              </select>
            </label>
            <label className="regional-field">
              <span>数量 *</span>
              <input min="1" required step="1" type="number" value={form.quantity} onChange={(event) => update("quantity", event.currentTarget.value)} />
            </label>
          </div>
        </section>

        <div className="regional-form-actions">
          <Link className="regional-secondary-action" to="/commissions/regional">取消</Link>
          <button className="regional-primary-action" disabled={isSaving} type="submit">
            {isSaving ? "正在保存…" : "保存订单"}
          </button>
        </div>
      </form>
    </PageLayout>
  );
};
