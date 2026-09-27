import type { AdjustmentSuggestion, BillRecord, BillReconciliation, EnergyDevice, EnergyEstimate, EnergyScenario, ScenarioSummary } from './types';

export const MAX_DAILY_HOURS = 24;

export const exampleScenario: EnergyScenario = {
  id: 'scenario-home',
  name: '夏日居家方案',
  pricePerKwh: 0.62,
  daysPerMonth: 30,
  createdAt: '2026-01-01T00:00:00.000Z',
  devices: [
    { id: 'device-aircon', name: '客厅空调', watts: 1200, dailyHours: 6 },
    { id: 'device-fridge', name: '冰箱', watts: 150, dailyHours: 10 },
    { id: 'device-lamp', name: '书桌台灯', watts: 12, dailyHours: 5 },
  ],
};

export function estimateDevice(device: EnergyDevice, daysPerMonth: number, pricePerKwh: number): EnergyEstimate {
  const dailyKwh = (device.watts * device.dailyHours) / 1000;
  const monthlyKwh = dailyKwh * daysPerMonth;
  return { dailyKwh, monthlyKwh, monthlyCost: monthlyKwh * pricePerKwh };
}

export function summarizeScenario(scenario: EnergyScenario): ScenarioSummary {
  const devices = scenario.devices.map((device) => ({
    ...device,
    ...estimateDevice(device, scenario.daysPerMonth, scenario.pricePerKwh),
    share: 0,
  }));
  const total = devices.reduce(
    (sum, device) => ({
      dailyKwh: sum.dailyKwh + device.dailyKwh,
      monthlyKwh: sum.monthlyKwh + device.monthlyKwh,
      monthlyCost: sum.monthlyCost + device.monthlyCost,
    }),
    { dailyKwh: 0, monthlyKwh: 0, monthlyCost: 0 },
  );
  return {
    total,
    devices: devices.map((device) => ({ ...device, share: total.monthlyKwh ? device.monthlyKwh / total.monthlyKwh : 0 })),
  };
}

export function validateDevice(device: Pick<EnergyDevice, 'name' | 'watts' | 'dailyHours'>): string | null {
  if (!device.name.trim()) return '请填写设备名称';
  if (!Number.isFinite(device.watts) || device.watts < 0) return '功率不能为负数';
  if (!Number.isFinite(device.dailyHours) || device.dailyHours < 0) return '使用时间不能为负数';
  if (device.dailyHours > MAX_DAILY_HOURS) return '每日使用时间不能超过 24 小时';
  return null;
}

export function validateScenarioSettings(pricePerKwh: number, daysPerMonth: number): string | null {
  if (!Number.isFinite(pricePerKwh) || pricePerKwh < 0) return '电价不能为负数';
  if (!Number.isFinite(daysPerMonth) || daysPerMonth < 1 || daysPerMonth > 31) return '计费天数需在 1–31 天之间';
  return null;
}

export function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function cloneScenario(source: EnergyScenario, id: string, name: string): EnergyScenario {
  return { ...source, id, name, createdAt: new Date().toISOString(), devices: source.devices.map((device) => ({ ...device, id: `${id}-${device.id}` })) };
}

export const BILL_PRICE_TOLERANCE = 0.15;

export function validateBill(bill: BillRecord, pricePerKwh: number): string | null {
  if (!Number.isFinite(bill.actualKwh) || bill.actualKwh <= 0) return '请填写账单上的实际用电量（kWh）';
  if (!Number.isFinite(bill.actualCost) || bill.actualCost <= 0) return '请填写账单上的实际金额（元）';
  if (pricePerKwh > 0) {
    const implied = bill.actualCost / bill.actualKwh;
    if (Math.abs(implied - pricePerKwh) / pricePerKwh > BILL_PRICE_TOLERANCE) {
      return `金额与电量对不上：账单折算电价约 ¥${formatNumber(implied)} / kWh，与当前电价 ¥${formatNumber(pricePerKwh)} 相差超过 ${Math.round(BILL_PRICE_TOLERANCE * 100)}%，请核对录入`;
    }
  }
  return null;
}

export function reconcileBill(scenario: EnergyScenario, bill: BillRecord): BillReconciliation {
  const summary = summarizeScenario(scenario);
  const gapKwh = bill.actualKwh - summary.total.monthlyKwh;
  const aligned = Math.abs(gapKwh) < Math.max(0.5, bill.actualKwh * 0.02);
  const devices = summary.devices
    .map((device) => ({
      deviceId: device.id,
      name: device.name,
      estimatedKwh: device.monthlyKwh,
      shareOfEstimate: device.share,
      attributedGapKwh: device.share * gapKwh,
    }))
    .sort((a, b) => Math.abs(b.attributedGapKwh) - Math.abs(a.attributedGapKwh));
  return {
    bill,
    estimatedKwh: summary.total.monthlyKwh,
    estimatedCost: summary.total.monthlyCost,
    gapKwh,
    gapCost: bill.actualCost - summary.total.monthlyCost,
    impliedPrice: bill.actualCost / bill.actualKwh,
    aligned,
    devices,
    suggestions: aligned ? [] : buildSuggestions(scenario, summary, bill.actualKwh),
  };
}

function buildSuggestions(scenario: EnergyScenario, summary: ScenarioSummary, actualKwh: number): AdjustmentSuggestion[] {
  const total = summary.total.monthlyKwh;
  const ranked = summary.devices
    .filter((device) => device.monthlyKwh > 0)
    .sort((a, b) => b.monthlyKwh - a.monthlyKwh)
    .slice(0, 3);
  const suggestions: AdjustmentSuggestion[] = [];
  for (const device of ranked) {
    const targetKwh = actualKwh - (total - device.monthlyKwh);
    if (targetKwh < 0) continue;
    if (device.watts > 0) {
      const rawHours = (targetKwh * 1000) / (device.watts * scenario.daysPerMonth);
      if (rawHours <= MAX_DAILY_HOURS) {
        const hours = Math.min(MAX_DAILY_HOURS, Math.round(rawHours * 10) / 10);
        if (hours !== device.dailyHours) {
          suggestions.push({
            deviceId: device.id,
            deviceName: device.name,
            field: 'dailyHours',
            currentValue: device.dailyHours,
            suggestedValue: hours,
            closesGapKwh: device.monthlyKwh - (device.watts * hours * scenario.daysPerMonth) / 1000,
            description: `将「${device.name}」每日使用从 ${formatNumber(device.dailyHours, 1)} 小时调整为 ${formatNumber(hours, 1)} 小时`,
          });
          continue;
        }
      }
    }
    if (device.dailyHours > 0) {
      const watts = Math.round((targetKwh * 1000) / (device.dailyHours * scenario.daysPerMonth));
      if (watts >= 0 && watts !== device.watts) {
        suggestions.push({
          deviceId: device.id,
          deviceName: device.name,
          field: 'watts',
          currentValue: device.watts,
          suggestedValue: watts,
          closesGapKwh: device.monthlyKwh - (watts * device.dailyHours * scenario.daysPerMonth) / 1000,
          description: `将「${device.name}」功率从 ${formatNumber(device.watts, 0)} W 调整为 ${formatNumber(watts, 0)} W`,
        });
      }
    }
  }
  return suggestions;
}
