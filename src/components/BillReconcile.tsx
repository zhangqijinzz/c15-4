import { useEffect, useState } from 'react';
import { formatNumber } from '../domain';
import type { AdjustmentSuggestion, AppliedAdjustment, BillRecord, BillReconciliation } from '../types';

interface BillReconcileProps {
  bill: BillRecord | null;
  billError: string | null;
  reconciliation: BillReconciliation | null;
  lastAdjustment: AppliedAdjustment | null;
  onSubmit: (actualKwh: number, actualCost: number) => void;
  onClear: () => void;
  onApply: (suggestion: AdjustmentSuggestion) => void;
}

export function BillReconcile({ bill, billError, reconciliation, lastAdjustment, onSubmit, onClear, onApply }: BillReconcileProps) {
  const [kwhInput, setKwhInput] = useState(bill ? String(bill.actualKwh) : '');
  const [costInput, setCostInput] = useState(bill ? String(bill.actualCost) : '');
  useEffect(() => {
    setKwhInput(bill ? String(bill.actualKwh) : '');
    setCostInput(bill ? String(bill.actualCost) : '');
  }, [bill]);

  const kwh = Number(kwhInput);
  const cost = Number(costInput);
  const implied = kwh > 0 && cost > 0 ? cost / kwh : null;

  const topGaps = reconciliation ? reconciliation.devices.filter((device) => Math.abs(device.attributedGapKwh) > 0.05).slice(0, 3) : [];
  const maxAbsGap = Math.max(...topGaps.map((device) => Math.abs(device.attributedGapKwh)), 1);
  const gapLabel = reconciliation && reconciliation.gapKwh >= 0 ? '少估' : '多估';

  return <div className="reconcile-grid">
    <div className="reconcile-card">
      <div className="card-heading"><div><h3>录入账单</h3><p>照电费单填写，金额与电量会互相校验</p></div></div>
      <label className="big-field"><span>实际用电量 <em>kWh</em></span><input type="number" min="0" step="0.1" value={kwhInput} placeholder="例如 285.5" onChange={(event) => setKwhInput(event.target.value)} /></label>
      <label className="big-field"><span>账单金额 <em>元</em></span><div className="input-prefix"><b>¥</b><input type="number" min="0" step="0.01" value={costInput} placeholder="例如 176.40" onChange={(event) => setCostInput(event.target.value)} /></div></label>
      {implied !== null && <p className="implied-price">折算电价约 ¥{formatNumber(implied)} / kWh</p>}
      {billError && <p className="bill-error" role="alert">{billError}</p>}
      <div className="bill-actions">
        <button className="primary-button" onClick={() => onSubmit(kwh, cost)}>开始复核 <span>→</span></button>
        {bill && <button className="ghost-button" onClick={onClear}>清除账单</button>}
      </div>
    </div>

    <div className="reconcile-card">
      {!reconciliation && <div className="reconcile-empty"><span>◧</span><p>录入账单后，这里会算出估算与实际的差额，<br />并定位偏差主要来自哪几台设备。</p></div>}
      {reconciliation && <>
        <div className="card-heading"><div><h3>复核结果</h3><p>估算 vs 账单实际</p></div><span className={`gap-badge ${reconciliation.aligned ? 'ok' : ''}`}>{reconciliation.aligned ? '基本一致' : `${gapLabel} ${formatNumber(Math.abs(reconciliation.gapKwh))} kWh`}</span></div>
        <div className="reconcile-compare">
          <div><span>估算</span><strong>{formatNumber(reconciliation.estimatedKwh)} <small>kWh</small></strong><em>约 ¥{formatNumber(reconciliation.estimatedCost)}</em></div>
          <div><span>实际</span><strong>{formatNumber(reconciliation.bill.actualKwh)} <small>kWh</small></strong><em>¥{formatNumber(reconciliation.bill.actualCost)}</em></div>
          <div className="gap-cell"><span>差额</span><strong>{gapLabel} {formatNumber(Math.abs(reconciliation.gapKwh))} <small>kWh</small></strong><em>约 ¥{formatNumber(Math.abs(reconciliation.gapCost))}</em></div>
        </div>
        {lastAdjustment && <div className="adjust-note"><span>✓</span><p>{lastAdjustment.description}。偏差从 <b>{formatNumber(Math.abs(lastAdjustment.gapBeforeKwh))} kWh</b> 变为 <b>{formatNumber(Math.abs(reconciliation.gapKwh))} kWh</b>。</p></div>}
        {!reconciliation.aligned && topGaps.length > 0 && <div className="gap-source">
          <h4>偏差主要来自</h4>
          {topGaps.map((device) => <div className="bar-row" key={device.deviceId}>
            <div className="bar-label"><span>{device.name}</span><b>{gapLabel} ≈ {formatNumber(Math.abs(device.attributedGapKwh))} kWh</b></div>
            <div className="bar-track"><i style={{ width: `${(Math.abs(device.attributedGapKwh) / maxAbsGap) * 100}%` }} /><span>占估算 {Math.round(device.shareOfEstimate * 100)}%</span></div>
          </div>)}
        </div>}
        {reconciliation.suggestions.length > 0 && <div className="suggestions">
          <h4>调整建议 · 一键套回当前方案</h4>
          {reconciliation.suggestions.map((suggestion) => <div className="suggestion-row" key={`${suggestion.deviceId}-${suggestion.field}`}>
            <p>{suggestion.description}<small>可消除约 {formatNumber(Math.abs(suggestion.closesGapKwh))} kWh 偏差</small></p>
            <button className="apply-button" onClick={() => onApply(suggestion)}>套回方案</button>
          </div>)}
        </div>}
        {reconciliation.aligned && <p className="no-suggestion">估算与账单基本一致，无需调整。</p>}
        {!reconciliation.aligned && reconciliation.suggestions.length === 0 && <p className="no-suggestion">偏差较大，但仅靠单台设备调整无法解释，请检查是否漏录了设备。</p>}
      </>}
    </div>
  </div>;
}
