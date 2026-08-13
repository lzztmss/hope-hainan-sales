import type { QuoteCalculation, RoomType } from "../../shared/pricing/types";
import type { ReactNode } from "react";
import "./quoteManagement.css";

export interface QuotePrintDocumentProps {
  quoteNo: string;
  confirmedAt: string;
  customerName: string;
  phoneMasked: string;
  roomType?: RoomType;
  elderCount: number;
  customFttrNote?: string;
  version: number;
  calculation: QuoteCalculation;
  actions?: ReactNode;
  preview?: boolean;
}

const money = (fen: number) =>
  `¥${(fen / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`;

const roomLabel: Record<RoomType, string> = {
  one_bedroom: "一室一厅",
  two_bedroom: "两室一厅",
  three_bedroom: "三室一厅",
};

export const QuotePrintDocument = ({
  actions,
  calculation,
  confirmedAt,
  customFttrNote,
  customerName,
  elderCount,
  phoneMasked,
  preview = false,
  quoteNo,
  roomType,
  version,
}: QuotePrintDocumentProps) => (
  <article className={`quote-management__detail quote-management__print-document${preview ? " quote-management__print-document--preview" : ""}`}>
    <header className="quote-management__print-header">
      <img src="/haipo-logo.jpg" alt="海魄科技标识" />
      <div><strong>海南联通 FTTR 心连心融合套餐</strong><h2>客户报价单</h2></div>
    </header>
    <section>
      <h2>客户与报价</h2>
      <dl>
        <div><dt>报价单号</dt><dd>{quoteNo}</dd></div>
        <div><dt>报价日期</dt><dd>{new Date(confirmedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</dd></div>
        <div><dt>客户</dt><dd>{customerName}</dd></div>
        <div><dt>手机</dt><dd>{phoneMasked}</dd></div>
        <div><dt>客户户型</dt><dd>{roomType ? roomLabel[roomType] : "未填写"}</dd></div>
        <div><dt>长者人数</dt><dd>{elderCount} 位</dd></div>
        <div><dt>支付方式</dt><dd>{calculation.mode === "contract_36" ? "36 个月合约月付" : "设备一次性购买"}</dd></div>
        <div><dt>FTTR 方案</dt><dd>{calculation.fttrKind === "none" ? "不新增 FTTR" : calculation.fttrKind === "custom" ? `自定义：${customFttrNote ?? "以业务受理为准"}` : `${calculation.fttrPlan} 元/月`}</dd></div>
        <div><dt>报价版本</dt><dd>第 {version} 版</dd></div>
        <div><dt>价格版本</dt><dd>{calculation.catalogVersion}</dd></div>
        <div><dt>每月合计</dt><dd>{money(calculation.monthlyTotalFen)}</dd></div>
        <div><dt>36个月月费</dt><dd>{money(calculation.contract36Fen)}</dd></div>
        <div><dt>一次性费用</dt><dd>{money(calculation.oneTimeFen)}</dd></div>
        <div><dt>预计总支出</dt><dd>{money(calculation.contract36Fen + calculation.oneTimeFen)}</dd></div>
      </dl>
    </section>
    <section>
      <h2>计价商品</h2>
      <ul>{calculation.chargeLines.map((line) => (
        <li key={line.sku}><strong>{line.label} × {line.quantity} {line.unit}</strong><span>{line.monthlySubtotalFen ? `${money(line.monthlySubtotalFen)}/月` : money(line.oneTimeSubtotalFen)}</span></li>
      ))}</ul>
    </section>
    <section className="quote-management__print-note">
      <h2>报价说明</h2>
      <p>本报价内容取自系统已保存的第 {version} 版数据。最终资费、业务受理、网络覆盖与安装点位，以海南联通现场确认及双方签署的订单为准。</p>
    </section>
    <section>
      <h2>最终实际设备</h2>
      <ul>{calculation.componentLines.map((line) => (
        <li key={line.componentId}><strong>{line.label} × {line.quantity} {line.unit}</strong><span>{line.locations.join("、")}</span></li>
      ))}</ul>
    </section>
    {actions ? <footer className="quote-management__actions">{actions}</footer> : null}
  </article>
);
