import { useState } from 'react';
import { formatNumber } from '../domain';
import type { DeviceAdjustment, EnergyScenario, ScenarioSummary } from '../types';
import type { ReconciliationState } from '../viewModel';

interface BillReconciliationProps {
  scenario: EnergyScenario;
  summary: ScenarioSummary;
  reconciliation: ReconciliationState | null;
  billError: string | null;
  onReconcile: (actualKwh: number, actualCost: number) => void;
  onApply: () => void;
  onReset: () => void;
}

function badgeText(adjustment: DeviceAdjustment): string {
  const direction = adjustment.attributedDeltaKwh < 0 ? '估高' : '估低';
  const fieldText = adjustment.field === 'dailyHours' ? '时长' : '功率';
  return adjustment.significant ? `${fieldText}明显${direction}` : `轻微${direction}`;
}

function suggestionText(adjustment: DeviceAdjustment): string {
  return adjustment.field === 'dailyHours'
    ? `每日时长 ${formatNumber(adjustment.currentDailyHours, 1)}h → ${formatNumber(adjustment.suggestedDailyHours, 1)}h，功率 ${formatNumber(adjustment.currentWatts, 0)}W 不变`
    : `功率 ${formatNumber(adjustment.currentWatts, 0)}W → ${formatNumber(adjustment.suggestedWatts, 0)}W，每日 ${formatNumber(adjustment.currentDailyHours, 1)}h 不变`;
}

export function BillReconciliation({ scenario, summary, reconciliation, billError, onReconcile, onApply, onReset }: BillReconciliationProps) {
  const [kwhInput, setKwhInput] = useState('');
  const [costInput, setCostInput] = useState('');

  const submit = () => onReconcile(Number(kwhInput), Number(costInput));

  return (
    <section className="recon-section" id="bill-reconciliation">
      <div className="section-title">
        <div><span className="step">04</span><h2>账单复核</h2><p>录入真实账单，看看估算差在哪、该调哪几台设备</p></div>
        {reconciliation && <button className="secondary-button" onClick={onReset}>清除复核结果</button>}
      </div>
      <div className="panel recon-panel">
        <div className="recon-form">
          <label className="big-field"><span>账单实际用电量 <em>kWh</em></span><input type="number" min="0" step="0.1" placeholder="例如 210.5" value={kwhInput} onChange={(event) => setKwhInput(event.target.value)} /></label>
          <label className="big-field"><span>账单实际金额 <em>元</em></span><div className="input-prefix"><b>¥</b><input type="number" min="0" step="0.01" placeholder="例如 128.40" value={costInput} onChange={(event) => setCostInput(event.target.value)} /></div></label>
          <button className="primary-button recon-submit" onClick={submit}>{reconciliation ? '重新复核' : '开始复核'} <span>→</span></button>
        </div>
        <p className="recon-hint">金额与电量会按当前电价 ¥{formatNumber(scenario.pricePerKwh)}/kWh 互相校验，对不上时会明确提示，不会硬算。</p>

        {billError && <div className="recon-error" role="alert"><span>!</span><p>{billError}</p></div>}

        {reconciliation && (
          <div className="recon-results">
            <div className="recon-delta-grid">
              <div className={`delta-card ${reconciliation.kwhDelta > 0 ? 'under' : ''}`}>
                <span>用电量差异</span>
                <strong>{reconciliation.kwhDelta >= 0 ? '低估' : '高估'} {formatNumber(Math.abs(reconciliation.kwhDelta))} <small>kWh</small></strong>
                <em>估算 {formatNumber(reconciliation.estimatedKwh)} kWh · 账单 {formatNumber(reconciliation.actualKwh)} kWh{reconciliation.estimatedKwh > 0 ? ` · 偏差 ${formatNumber(Math.abs(reconciliation.kwhDeltaRatio) * 100, 1)}%` : ''}</em>
              </div>
              <div className={`delta-card ${reconciliation.costDelta > 0 ? 'under' : ''}`}>
                <span>电费差异</span>
                <strong>{reconciliation.costDelta >= 0 ? '少估' : '多估'} ¥{formatNumber(Math.abs(reconciliation.costDelta))}</strong>
                <em>估算 ¥{formatNumber(reconciliation.estimatedCost)} · 账单 ¥{formatNumber(reconciliation.actualCost)}</em>
              </div>
            </div>
            <p className="recon-hint">按当前电价，账单电量 {formatNumber(reconciliation.actualKwh)} kWh 约合 ¥{formatNumber(reconciliation.expectedCost)}，与账单金额互相吻合。</p>

            {reconciliation.balanced && <div className="recon-note"><span>✓</span><p>估算与账单基本一致（偏差 {formatNumber(Math.abs(reconciliation.kwhDelta), 1)} kWh），当前方案无需调整。</p></div>}

            {!reconciliation.balanced && reconciliation.adjustments.length === 0 && (
              <div className="recon-note"><span>·</span><p>当前方案估算为 0 或无法自动分摊偏差，请先在「设备配置」中完善设备功率与时长后再复核。</p></div>
            )}

            {reconciliation.adjustments.length > 0 && (
              <div className="adjust-block">
                <div className="card-heading"><div><h3>偏差主要来自这些设备</h3><p>按各设备当前的功率与使用时长分摊账单差额</p></div></div>
                <ul className="adjust-list">
                  {reconciliation.adjustments.map((adjustment) => (
                    <li className="adjust-row" key={adjustment.deviceId}>
                      <div className="adjust-main">
                        <strong>{adjustment.name}</strong>
                        <span className={`adjust-badge ${adjustment.significant ? 'strong' : ''}`}>{badgeText(adjustment)}</span>
                        <em>分摊偏差 {adjustment.attributedDeltaKwh > 0 ? '+' : ''}{formatNumber(adjustment.attributedDeltaKwh, 1)} kWh/月</em>
                      </div>
                      <p>{suggestionText(adjustment)}</p>
                    </li>
                  ))}
                </ul>
                {reconciliation.applied ? (
                  <div className="apply-result">
                    <span>✓ 已套回</span>
                    <p>调整前估算 <b>{formatNumber(reconciliation.estimatedKwh)} kWh · ¥{formatNumber(reconciliation.estimatedCost)}</b> → 调整后 <b>{formatNumber(summary.total.monthlyKwh)} kWh · ¥{formatNumber(summary.total.monthlyCost)}</b>；账单为 {formatNumber(reconciliation.actualKwh)} kWh · ¥{formatNumber(reconciliation.actualCost)}，残余偏差 {formatNumber(Math.abs(summary.total.monthlyKwh - reconciliation.actualKwh), 1)} kWh。</p>
                  </div>
                ) : (
                  <div className="recon-actions">
                    <p>套回后上述设备的功率/时长将直接写入当前方案，估算结果随之更新。</p>
                    <button className="primary-button" onClick={onApply}>一键套回当前方案 <span>→</span></button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
