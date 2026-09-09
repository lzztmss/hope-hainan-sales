import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type {
  ApiClient,
  AuthenticatedUser,
  RegionalCommissionSummary,
  RegionalCooperationStatus,
  RegionalManagerOption,
  RegionalStatementDto,
  RegionalVerificationStatus,
} from "../api/client";
import { PageLayout } from "../components/layout";
import { RegionalTemplateEditor } from "./RegionalTemplateEditor";
import "./regionalCommission.css";

const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
const dateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value))
  : "—";

const receiptStatusLabel: Record<RegionalVerificationStatus, string> = {
  pending: "待财务核验",
  verified: "已核验",
  rejected: "已退回，待更正",
};

const cooperationStatusLabel: Record<RegionalCooperationStatus, string> = {
  submitted: "资料已提交",
  finance_verified: "财务已核验",
  confirmed: "奖励已确认",
  revoked: "已撤销",
};

const statementStatusLabel: Record<RegionalStatementDto["status"], string> = {
  draft: "草稿（可重算）",
  confirmed: "已确认（已锁定）",
  paid: "已发放",
};

const settlementCategoryLabel: Record<string, string> = {
  completion: "周期目标奖",
  tiered_order: "分段订单奖",
  milestone: "里程碑奖",
  top_up: "补足奖",
  revenue_acceleration: "本月回款加速奖",
  personal_product: "个人商品提成",
  cooperation: "已确认合作奖",
  tiered_return: "有效退单扣回",
};

export const RegionalCommissionPage = ({ client, actor }: { client: ApiClient; actor: AuthenticatedUser }) => {
  const [workspace, setWorkspace] = useState("targets");
  const [managers, setManagers] = useState<readonly RegionalManagerOption[]>([]);
  const [managerId, setManagerId] = useState(actor.role === "regional_manager" ? actor.id : "");
  const [summary, setSummary] = useState<RegionalCommissionSummary | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [message, setMessage] = useState<string | null>(null);
  const [statements, setStatements] = useState<readonly RegionalStatementDto[]>([]);
  const [receiptForm, setReceiptForm] = useState({ amountYuan: "", evidenceNo: "", note: "" });
  const [receiptReviewReason, setReceiptReviewReason] = useState("");
  const [cooperationForm, setCooperationForm] = useState({ stageCode: "PROJECT", achievedOn: "", evidenceNo: "", note: "" });
  const [cooperationReasons, setCooperationReasons] = useState<Record<string, string>>({});
  const [pendingStatementAction, setPendingStatementAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!managerId) {
      setSummary(null);
      setStatements([]);
      return;
    }
    const [current, currentStatements] = await Promise.all([
      client.getRegionalCommissionSummary({ managerId, month }),
      client.listRegionalStatements(managerId),
    ]);
    setSummary(current);
    setStatements(currentStatements);
    setReceiptForm(current.receipt
      ? {
          amountYuan: (current.receipt.netReceiptFen / 100).toFixed(2),
          evidenceNo: current.receipt.evidenceNo,
          note: current.receipt.note ?? "",
        }
      : { amountYuan: "", evidenceNo: "", note: "" });
  }, [client, managerId, month]);

  useEffect(() => {
    if (actor.role === "regional_manager") return;
    void client.listRegionalManagers().then((loaded) => {
      setManagers(loaded);
      setManagerId((current) => current || loaded.find((manager) => manager.active)?.id || loaded[0]?.id || "");
    }).catch(() => setMessage("大区经理列表加载失败"));
  }, [actor.role, client]);

  useEffect(() => {
    setMessage(null);
    void load().catch((error) => setMessage(error instanceof Error ? error.message : "加载失败"));
  }, [load]);

  const canEdit = actor.role === "hr" || actor.role === "admin";
  const canReview = actor.role === "finance" || actor.role === "admin";
  const currentStatement = useMemo(
    () => statements.find((statement) => statement.settlementMonth === month),
    [month, statements],
  );
  const visibleStatements = useMemo(
    () => statements.filter((statement) => statement.settlementMonth <= month),
    [month, statements],
  );
  const draftIsStale = Boolean(
    currentStatement?.status === "draft"
    && summary
    && currentStatement.totalFen !== summary.settlementPreviewFen,
  );
  const targetPlanEnded = Boolean(
    summary?.targetPlanEndsOn && summary.targetPlanEndsOn < summary.statisticsEndsOn,
  );

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      await load();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    }
  };

  const runStatementAction = async (
    key: string,
    action: () => Promise<RegionalStatementDto>,
    success: string,
  ) => {
    setPendingStatementAction(key);
    try {
      const updated = await action();
      if (updated) {
        setStatements((current) => [
          ...current.filter((statement) => statement.settlementMonth !== updated.settlementMonth),
          updated,
        ].sort((left, right) => left.settlementMonth.localeCompare(right.settlementMonth)));
      } else {
        await load();
      }
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setPendingStatementAction(null);
    }
  };

  const saveReceipt = () => {
    const amount = Number(receiptForm.amountYuan);
    if (!Number.isFinite(amount)) {
      setMessage("净回款金额必须是有效数字；跨月退款可以填写负数");
      return;
    }
    if (!receiptForm.evidenceNo.trim()) {
      setMessage("请填写可追溯的凭据或文件编号");
      return;
    }
    void run(
      () => client.saveRegionalReceipt({
        managerId,
        month,
        netReceiptFen: Math.round(amount * 100),
        evidenceNo: receiptForm.evidenceNo.trim(),
        note: receiptForm.note.trim() || undefined,
      }),
      "净回款已保存，等待财务核验",
    );
  };

  const reviewReceipt = (approved: boolean) => {
    if (!summary?.receipt) return;
    const reason = receiptReviewReason.trim();
    if (!approved && !reason) {
      setMessage("退回更正时必须填写原因");
      return;
    }
    const success = approved ? "净回款已核验" : "净回款已退回更正";
    void run(
      () => client.verifyRegionalReceipt(summary.receipt!.id, approved, reason || undefined),
      success,
    ).then(() => setReceiptReviewReason(""));
  };

  const submitCooperation = () => {
    if (!cooperationForm.achievedOn) {
      setMessage("请选择合作阶段达成日期");
      return;
    }
    if (!cooperationForm.evidenceNo.trim()) {
      setMessage("请填写可追溯的凭据或文件编号");
      return;
    }
    void run(
      () => client.submitRegionalCooperation({
        managerId,
        ...cooperationForm,
        evidenceNo: cooperationForm.evidenceNo.trim(),
        note: cooperationForm.note.trim() || undefined,
      }),
      "合作奖资料已提交",
    );
  };

  const transitionCooperation = (id: string, action: "verify" | "confirm" | "revoke") => {
    const reason = cooperationReasons[id]?.trim();
    if (action === "revoke" && !reason) {
      setMessage("撤销合作奖必须填写原因");
      return;
    }
    const success = action === "verify" ? "合作阶段已通过财务核验" : action === "confirm" ? "合作阶段奖励已确认" : "合作阶段已撤销";
    void run(() => client.transitionRegionalCooperation(id, action, reason), success)
      .then(() => setCooperationReasons((current) => ({ ...current, [id]: "" })));
  };

  return <PageLayout
    eyebrow="大区经理"
    title="大区经理提成"
    description="按签收满 7 天的有效订单和已核验业务数据计算。"
    actions={(canEdit || actor.role === "regional_manager") ? <Link className="regional-primary-action" to="/commissions/regional/personal-orders">{canEdit ? "管理个人渠道订单" : "查看个人渠道订单"}</Link> : undefined}
  >
    {actor.role !== "regional_manager" ? <label className="regional-manager-select">
      <span>大区经理</span>
      <select value={managerId} onChange={(event) => setManagerId(event.currentTarget.value)}>
        <option value="">请选择</option>
        {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.displayName}（{manager.workNo}）</option>)}
      </select>
    </label> : null}

    <div className="regional-toolbar">
      <label>
        <span>提成数据统计截止月份</span>
        <input aria-describedby="regional-month-help" min={summary?.employmentStartDate?.slice(0, 7)} type="month" value={month} onChange={(event) => setMonth(event.currentTarget.value)} />
        <small id="regional-month-help">{summary?.statisticsStartsOn
          ? `当前月份从匹配版本的统计起点 ${summary.statisticsStartsOn} 累计至 ${summary.statisticsEndsOn}；原始订单不会被删除。`
          : "按所选月份最后一天统计，不会修改已确认的提成单。"}</small>
      </label>
      <button type="button" onClick={() => void load().catch((error) => setMessage(error instanceof Error ? error.message : "加载失败"))}>重新加载本月数据</button>
    </div>

    {message ? <div className="system-notice" role="status">{message}</div> : null}

    {actor.role === "admin" && !summary ? <nav className="ops-tabs regional-workspaces" aria-label="提成业务区域">
      <button type="button" aria-pressed={workspace === "templates"} onClick={() => setWorkspace("templates")}>提成模板</button>
    </nav> : null}
    {actor.role === "admin" && !summary && workspace === "templates" ? <section className="regional-section regional-section--wide"><RegionalTemplateEditor assignedTemplateVersionId={null} client={client} managerId={managerId} onAssignmentChange={load} onMessage={setMessage} /></section> : null}

    {summary ? <>
      <nav className="ops-tabs regional-workspaces" aria-label="提成业务区域">
        {[
          ["targets", "目标周期"],
          ...(actor.role !== "regional_manager" ? [["receipts", "回款核验"]] : []),
          ["cooperation", "合作奖"],
          ["statements", actor.role === "regional_manager" ? "我的提成单" : "月度提成结算"],
          ...(actor.role === "admin" ? [["templates", "提成模板"]] : []),
        ].map(([value, label]) => <button key={value} type="button" aria-pressed={workspace === value} onClick={() => setWorkspace(value!)}>{label}</button>)}
      </nav>

      <section className="regional-summary-grid" aria-label="提成汇总">
        {[
          ["当前版本累计有效订单", `${summary.orderCount} 笔`],
          ["周期目标奖", yuan(summary.completionFen)],
          ["分段订单奖", yuan(summary.tieredOrderFen)],
          ["里程碑奖", yuan(summary.milestoneFen)],
          ["补足奖", yuan(summary.topUpFen)],
          ["回款加速奖", yuan(summary.revenueAccelerationFen)],
          ["个人商品提成", yuan(summary.personalProductFen)],
          ["合作奖", yuan(summary.cooperationFen)],
          ["累计金额", yuan(summary.totalFen)],
        ].map(([label, value]) => <div className="regional-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </section>

      <section className="regional-section" hidden={workspace !== "targets"}>
        <div className="regional-section-heading">
          <div><h2>目标计划周期</h2><p>周期目标和 M1 开始日期来自当前模板版本；订单仍使用原始业务日期实时统计，不会复制到版本中。</p></div>
          <span>营业厅 {summary.managedOrderCount} 笔 · 个人渠道 {summary.personalOrderCount} 笔</span>
        </div>
        {summary.targetPlanStartsOn && summary.targetPlanEndsOn ? <p className="regional-inline-help">
          累计查询范围：{summary.statisticsStartsOn ?? summary.targetPlanStartsOn} 至 {summary.statisticsEndsOn}；
          目标计划范围：{summary.targetPlanStartsOn} 至 {summary.targetPlanEndsOn}{targetPlanEnded ? "（已结束）" : ""}。
          {targetPlanEnded ? " 目标周期结束后不再产生新的周期目标奖；历史订单和已产生奖项仍保留。" : ""}
        </p> : null}
        <div className="regional-table-wrap"><table><thead><tr><th>周期</th><th>起止日期</th><th>本期目标</th><th>本期有效订单</th><th>周期内累计有效订单</th><th>目标奖</th></tr></thead><tbody>
          {summary.periods.map((period) => <tr key={period.sequence}><td>M{period.sequence}</td><td>{period.startsOn} 至 {period.endsOn}</td><td>{period.targetOrderCount}</td><td>{period.orderCount}</td><td>{period.cumulativeOrderCount}</td><td>{yuan(period.rewardFen)}</td></tr>)}
        </tbody></table></div>
        {summary.periods.length === 0 ? <p className="regional-empty">所选月份没有可用的模板目标周期。请检查模板版本的适用日期和 M1 开始日期。</p> : null}
      </section>

      {actor.role !== "regional_manager" ? <section className="regional-section" hidden={workspace !== "receipts"}>
        <div className="regional-section-heading">
          <div><h2>{month.replace("-", " 年 ")} 月不含税净回款</h2><p>按自然月核验；跨月退款可使本月净回款为负数，此时回款加速奖按 0 元计算。</p></div>
          {summary.receipt ? <span className={`regional-status regional-status--${summary.receipt.verificationStatus}`}>{receiptStatusLabel[summary.receipt.verificationStatus]}</span> : <span>本月尚未录入</span>}
        </div>
        <div className="regional-entry-grid">
          <label><span>本月不含税净回款（元）</span><input type="number" step="0.01" disabled={summary.receipt?.verificationStatus === "verified"} value={receiptForm.amountYuan} onChange={(event) => { const amountYuan = event.currentTarget.value; setReceiptForm((value) => ({ ...value, amountYuan })); }} /></label>
          <label><span>凭据/文件编号</span><input disabled={summary.receipt?.verificationStatus === "verified"} value={receiptForm.evidenceNo} onChange={(event) => { const evidenceNo = event.currentTarget.value; setReceiptForm((value) => ({ ...value, evidenceNo })); }} /></label>
          <label><span>备注（选填）</span><input disabled={summary.receipt?.verificationStatus === "verified"} value={receiptForm.note} onChange={(event) => { const note = event.currentTarget.value; setReceiptForm((value) => ({ ...value, note })); }} /></label>
          <button type="button" disabled={summary.receipt?.verificationStatus === "verified"} onClick={saveReceipt}>{summary.receipt ? "保存更正" : "保存回款"}</button>
        </div>
        {summary.receipt ? <div className="regional-record-details">
          <strong>当前记录</strong>
          <span>金额 {yuan(summary.receipt.netReceiptFen)}</span>
          <span>凭据 {summary.receipt.evidenceNo}</span>
          {summary.receipt.note ? <span>备注 {summary.receipt.note}</span> : null}
          {summary.receipt.verificationReason ? <span>核验说明 {summary.receipt.verificationReason}</span> : null}
        </div> : null}
        <div className={`regional-unlock-panel ${summary.revenueAcceleration.unlocked ? "is-unlocked" : "is-locked"}`}>
          <strong>{summary.revenueAcceleration.unlocked ? "回款加速奖已解锁" : "回款加速奖尚未解锁"}</strong>
          <span>有效订单 {summary.revenueAcceleration.currentOrderCount.toLocaleString()} / {summary.revenueAcceleration.unlockOrderCount.toLocaleString()}</span>
          <span>比例 {(summary.revenueAcceleration.ratePartsPerMillion / 10_000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}% · 月度封顶 {yuan(summary.revenueAcceleration.monthlyCapFen)}</span>
          <small>{summary.revenueAcceleration.unlocked ? `本月按已核验净回款计算：${yuan(summary.revenueAccelerationFen)}` : "未达到累计订单门槛，因此本月奖励为 ¥0.00。"}</small>
        </div>
        {summary.receipt && canReview && summary.receipt.verificationStatus !== "rejected" ? <div className="regional-review-panel">
          <label><span>{summary.receipt.verificationStatus === "verified" ? "退回更正原因" : "驳回原因（核验通过时可不填）"}</span><input value={receiptReviewReason} onChange={(event) => setReceiptReviewReason(event.currentTarget.value)} /></label>
          {summary.receipt.verificationStatus === "pending" ? <button type="button" onClick={() => reviewReceipt(true)}>核验通过</button> : null}
          <button className="regional-danger-action" type="button" onClick={() => reviewReceipt(false)}>{summary.receipt.verificationStatus === "verified" ? "退回更正" : "驳回并退回"}</button>
        </div> : null}
      </section> : null}

      {canEdit ? <section className="regional-section" hidden={workspace !== "cooperation"}>
        <div className="regional-section-heading"><div><h2>海南电信合作奖资料</h2><p>同一大区经理在整个合作项目内，每个阶段最多确认并计发一次，不按月份或提成版本重置；四阶段合计最高 30,000 元。</p></div></div>
        <div className="regional-entry-grid">
          <label><span>阶段</span><select value={cooperationForm.stageCode} onChange={(event) => { const stageCode = event.currentTarget.value; setCooperationForm((value) => ({ ...value, stageCode })); }}><option value="PROJECT">省级项目立项</option><option value="CONTRACT">商务签约及系统准入</option><option value="PILOT">首批试点上线</option><option value="SCALE">规模验证</option></select></label>
          <label><span>达成日期</span><input type="date" value={cooperationForm.achievedOn} onChange={(event) => { const achievedOn = event.currentTarget.value; setCooperationForm((value) => ({ ...value, achievedOn })); }} /></label>
          <label><span>凭据/文件编号</span><input value={cooperationForm.evidenceNo} onChange={(event) => { const evidenceNo = event.currentTarget.value; setCooperationForm((value) => ({ ...value, evidenceNo })); }} /></label>
          <label><span>备注（选填）</span><input value={cooperationForm.note} onChange={(event) => { const note = event.currentTarget.value; setCooperationForm((value) => ({ ...value, note })); }} /></label>
          <button type="button" onClick={submitCooperation}>提交为新记录</button>
        </div>
        <p className="regional-inline-help">多次提交用于保留补充资料和审核历史，不代表可以重复获得同一阶段奖励。</p>
      </section> : null}

      <section className="regional-section" hidden={workspace !== "cooperation"}>
        <div className="regional-section-heading"><div><h2>合作奖进度</h2><p>“撤销”保留原凭据和原因，避免已参与计算的业务记录被无痕删除。</p></div></div>
        <div className="regional-table-wrap"><table><thead><tr><th>阶段</th><th>达成日期</th><th>金额</th><th>凭据与备注</th><th>状态</th><th>操作</th></tr></thead><tbody>
          {summary.cooperation.map((stage) => {
            const needsFinance = stage.stageCode === "PILOT" || stage.stageCode === "SCALE";
            return <tr key={stage.id}>
              <td>{stage.stageLabel}</td><td>{stage.achievedOn}</td><td>{yuan(stage.amountFen)}</td>
              <td><div className="regional-cell-stack"><span>{stage.evidenceNo}</span>{stage.note ? <small>{stage.note}</small> : null}{stage.condition ? <small className={stage.condition.satisfied ? "is-condition-met" : "is-condition-unmet"}>{stage.condition.satisfied ? "条件已满足：" : "条件未满足："}{stage.condition.label}</small> : null}{stage.revokeReason ? <small>撤销原因：{stage.revokeReason}</small> : null}</div></td>
              <td><span className={`regional-status regional-status--${stage.status}`}>{cooperationStatusLabel[stage.status]}</span>{needsFinance ? <small className="regional-status-note">需财务核验</small> : null}</td>
              <td><div className="regional-row-actions">
                {canReview && stage.status === "submitted" && needsFinance ? <button type="button" onClick={() => transitionCooperation(stage.id, "verify")}>财务核验</button> : null}
                {actor.role === "admin" && ((needsFinance && stage.status === "finance_verified") || (!needsFinance && (stage.status === "submitted" || stage.status === "finance_verified"))) ? <button type="button" onClick={() => transitionCooperation(stage.id, "confirm")}>确认奖励</button> : null}
                {actor.role === "admin" && stage.status !== "revoked" ? <><input aria-label={`${stage.stageLabel}撤销原因`} placeholder="填写撤销原因" value={cooperationReasons[stage.id] ?? ""} onChange={(event) => { const reason = event.currentTarget.value; setCooperationReasons((current) => ({ ...current, [stage.id]: reason })); }} /><button className="regional-danger-action" type="button" onClick={() => transitionCooperation(stage.id, "revoke")}>撤销</button></> : null}
              </div></td>
            </tr>;
          })}
        </tbody></table></div>
        {summary.cooperation.length === 0 ? <p className="regional-empty">暂无合作奖记录</p> : null}
      </section>

      <section className="regional-section" hidden={workspace !== "statements"}>
        <div className="regional-section-heading">
          <div><h2>月度提成结算单</h2><p>把所选月份的目标奖、订单奖、回款奖、合作奖等汇总成一张财务发放依据。它不是员工工资明细：草稿可以重算，管理员确认后金额锁定，财务发放后不再修改。</p></div>
        </div>
        <div className="regional-settlement-preview" aria-label="本月结算试算">
          <div className="regional-settlement-preview__total">
            <span>{currentStatement && currentStatement.status !== "draft" ? "本月已锁定结算金额" : "按当前数据试算，本月待结算"}</span>
            <strong>{yuan(currentStatement && currentStatement.status !== "draft" ? currentStatement.totalFen : summary.settlementPreviewFen)}</strong>
            <small>统计截止 {month} 月末</small>
          </div>
          <div className="regional-settlement-preview__source">
            <strong>所选月份匹配的规则版本</strong>
            <span>{summary.templateName && summary.templateVersionNo
              ? `${summary.templateName} · 第 ${summary.templateVersionNo} 版`
              : "尚未分配已发布模板"}</span>
            {summary.templateEffectiveFrom ? <small>规则适用期：{summary.templateEffectiveFrom}{summary.templateEffectiveTo ? ` 至 ${summary.templateEffectiveTo}` : " 起"}。切换统计月份时会按历史适用日期匹配对应版本。</small> : null}
          </div>
          <ul className="regional-settlement-rules">
            <li>营业厅订单在签收满 7 天后计为有效订单；从入职日起累计 {summary.managedOrderCount} 笔。</li>
            <li>个人渠道订单按其生效日和商品快照计入；目标计划内共 {summary.personalOrderCount} 笔。</li>
            <li>回款奖只使用本月已核验净回款，合作奖只使用已确认记录，退单按规则扣回。</li>
            <li>“本月应结算”是截止本月累计结果减去以前月份已结算金额；生成草稿时会保存这份计算快照。</li>
          </ul>
        </div>
        <div className="regional-table-wrap regional-settlement-breakdown"><table><thead><tr><th>提成组成</th><th>当前统计结果</th><th>以前月份已结算</th><th>本月应结算</th></tr></thead><tbody>
          {summary.settlementEntries.map((entry) => <tr key={entry.category}>
            <td>{settlementCategoryLabel[entry.category] ?? entry.category}</td>
            <td>{yuan(entry.accruedFen)}</td>
            <td>{yuan(entry.previouslySettledFen)}</td>
            <td className={entry.payableFen < 0 ? "is-negative" : undefined}>{yuan(entry.payableFen)}</td>
          </tr>)}
        </tbody></table></div>
        <div className="regional-table-wrap"><table><thead><tr><th>结算月份</th><th>提成金额</th><th>结算状态</th><th>确认/发放时间</th><th>下一步</th></tr></thead><tbody>
          {!currentStatement ? <tr>
            <td>{month}</td>
            <td>{yuan(summary.settlementPreviewFen)}</td>
            <td><span className="regional-status">未生成</span></td>
            <td>—</td>
            <td>{canEdit ? <button disabled={pendingStatementAction !== null} type="button" onClick={() => void runStatementAction(`calculate:${month}`, () => client.calculateRegionalStatement(managerId, month), `${month} 结算草稿已生成`)}>{pendingStatementAction === `calculate:${month}` ? "生成中…" : `生成${month.slice(5)}月结算单`}</button> : null}</td>
          </tr> : null}
          {visibleStatements.map((statement) => {
            const stale = statement.id === currentStatement?.id && draftIsStale;
            return <tr key={statement.id}>
              <td>{statement.settlementMonth}</td>
              <td>{yuan(statement.totalFen)}{stale ? <small className="regional-status-note"> 当前试算为 {yuan(summary.settlementPreviewFen)}</small> : null}</td>
              <td><span className={`regional-status regional-status--${statement.status}`}>{stale ? "草稿待更新" : statementStatusLabel[statement.status]}</span></td>
              <td>{statement.status === "paid" ? `发放 ${dateTime(statement.paidAt)}` : statement.status === "confirmed" ? `确认 ${dateTime(statement.confirmedAt)}` : "—"}</td>
              <td><div className="regional-row-actions">
                {canEdit && statement.status === "draft" ? <button disabled={pendingStatementAction !== null} type="button" onClick={() => void runStatementAction(`calculate:${statement.id}`, () => client.calculateRegionalStatement(managerId, statement.settlementMonth), `${statement.settlementMonth} 结算草稿已更新`)}>{pendingStatementAction === `calculate:${statement.id}` ? "更新中…" : "更新草稿"}</button> : null}
                {actor.role === "admin" && statement.status === "draft" ? <button disabled={stale || pendingStatementAction !== null} title={stale ? "请先按当前数据更新草稿" : undefined} type="button" onClick={() => void runStatementAction(`confirm:${statement.id}`, () => client.transitionRegionalStatement(statement.id, "confirm"), "月度结算单已确认并锁定")}>{pendingStatementAction === `confirm:${statement.id}` ? "确认中…" : "确认金额并锁定"}</button> : null}
                {(actor.role === "admin" || actor.role === "finance") && statement.status === "confirmed" ? <button disabled={pendingStatementAction !== null} type="button" onClick={() => void runStatementAction(`pay:${statement.id}`, () => client.transitionRegionalStatement(statement.id, "pay"), "月度结算单已标记发放")}>{pendingStatementAction === `pay:${statement.id}` ? "发放中…" : "确认已发放"}</button> : null}
              </div></td>
            </tr>;
          })}
        </tbody></table></div>
        {visibleStatements.length === 0 && currentStatement ? <p className="regional-empty">当前还没有更早月份的结算记录。</p> : null}
      </section>

      {actor.role === "admin" ? <section className="regional-section regional-section--wide" hidden={workspace !== "templates"}><RegionalTemplateEditor assignedTemplateVersionId={summary.templateVersionId} client={client} employmentStartDate={summary.employmentStartDate} managerId={managerId} onAssignmentChange={load} onMessage={setMessage} /></section> : null}
    </> : <div className="system-notice">{managerId ? "正在加载大区提成…" : "请选择大区经理"}</div>}
  </PageLayout>;
};
