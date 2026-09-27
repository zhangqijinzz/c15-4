import type { BillReconciliation, DeviceAdjustment, EnergyDevice, EnergyEstimate, EnergyScenario, ScenarioSummary } from './types';

export const MAX_DAILY_HOURS = 24;

// 账单金额与电量按当前电价互相校验时允许的相对误差（兼容阶梯电价带来的小幅偏差）
export const BILL_PRICE_TOLERANCE = 0.15;
// 估算与账单偏差在该范围内视为基本一致，无需调整
export const BILL_BALANCE_TOLERANCE_RATIO = 0.03;
const MAX_ADJUSTED_DEVICES = 3;
const COVERAGE_TARGET = 0.8;
const SIGNIFICANT_CHANGE_RATIO = 0.25;

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

export function validateBill(actualKwh: number, actualCost: number, pricePerKwh: number): string | null {
  if (!Number.isFinite(actualKwh) || actualKwh <= 0) return '请填写账单上的实际用电量（kWh）';
  if (!Number.isFinite(actualCost) || actualCost <= 0) return '请填写账单上的实际金额（元）';
  if (pricePerKwh <= 0) return '当前方案电价为 0，无法校验账单金额，请先在「时间与价格」中设置电价';
  const expectedCost = actualKwh * pricePerKwh;
  const mismatch = Math.abs(actualCost - expectedCost) / expectedCost;
  if (mismatch > BILL_PRICE_TOLERANCE) {
    return `金额与电量对不上：按当前电价 ${formatNumber(pricePerKwh)} 元/kWh，${formatNumber(actualKwh)} kWh 约合 ¥${formatNumber(expectedCost)}，与账单金额 ¥${formatNumber(actualCost)} 相差 ${formatNumber(mismatch * 100, 1)}%。请核对录入，或先调整方案电价`;
  }
  return null;
}

export function reconcileWithBill(scenario: EnergyScenario, actualKwh: number, actualCost: number): BillReconciliation {
  const summary = summarizeScenario(scenario);
  const estimatedKwh = summary.total.monthlyKwh;
  const estimatedCost = summary.total.monthlyCost;
  const kwhDelta = actualKwh - estimatedKwh;
  const balanced = Math.abs(kwhDelta) <= Math.max(0.5, actualKwh * BILL_BALANCE_TOLERANCE_RATIO);
  return {
    actualKwh,
    actualCost,
    expectedCost: actualKwh * scenario.pricePerKwh,
    estimatedKwh,
    estimatedCost,
    kwhDelta,
    costDelta: actualCost - estimatedCost,
    kwhDeltaRatio: estimatedKwh > 0 ? kwhDelta / estimatedKwh : 0,
    balanced,
    adjustments: balanced ? [] : buildAdjustments(scenario, summary, kwhDelta),
  };
}

function buildAdjustments(scenario: EnergyScenario, summary: ScenarioSummary, kwhDelta: number): DeviceAdjustment[] {
  const candidates = summary.devices.filter((device) => device.monthlyKwh > 0).sort((a, b) => b.monthlyKwh - a.monthlyKwh);
  const chosen: typeof candidates = [];
  let covered = 0;
  for (const device of candidates) {
    if (chosen.length > 0 && (chosen.length >= MAX_ADJUSTED_DEVICES || covered >= summary.total.monthlyKwh * COVERAGE_TARGET)) break;
    chosen.push(device);
    covered += device.monthlyKwh;
  }
  const chosenTotal = chosen.reduce((sum, device) => sum + device.monthlyKwh, 0);
  if (chosenTotal <= 0) return [];
  return chosen.map((device): DeviceAdjustment | null => {
    const attributedDeltaKwh = kwhDelta * (device.monthlyKwh / chosenTotal);
    const targetMonthlyKwh = Math.max(0, device.monthlyKwh + attributedDeltaKwh);
    let suggestedWatts = device.watts;
    let suggestedDailyHours = device.dailyHours;
    let field: DeviceAdjustment['field'] = 'dailyHours';
    const requiredHours = device.watts > 0 ? (targetMonthlyKwh * 1000) / (device.watts * scenario.daysPerMonth) : Number.POSITIVE_INFINITY;
    if (device.watts > 0 && requiredHours <= MAX_DAILY_HOURS) {
      suggestedDailyHours = roundTo(requiredHours, 1);
    } else if (device.dailyHours > 0) {
      field = 'watts';
      suggestedWatts = Math.max(0, Math.round((targetMonthlyKwh * 1000) / (device.dailyHours * scenario.daysPerMonth)));
    } else {
      return null;
    }
    if (suggestedWatts === device.watts && suggestedDailyHours === device.dailyHours) return null;
    const changeRatio = device.monthlyKwh > 0 ? targetMonthlyKwh / device.monthlyKwh : 1;
    return {
      deviceId: device.id,
      name: device.name,
      field,
      currentWatts: device.watts,
      currentDailyHours: device.dailyHours,
      suggestedWatts,
      suggestedDailyHours,
      currentMonthlyKwh: device.monthlyKwh,
      targetMonthlyKwh,
      attributedDeltaKwh,
      significant: Math.abs(changeRatio - 1) >= SIGNIFICANT_CHANGE_RATIO,
    };
  }).filter((adjustment): adjustment is DeviceAdjustment => adjustment !== null);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function cloneScenario(source: EnergyScenario, id: string, name: string): EnergyScenario {
  return { ...source, id, name, createdAt: new Date().toISOString(), devices: source.devices.map((device) => ({ ...device, id: `${id}-${device.id}` })) };
}
