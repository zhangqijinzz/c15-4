import { describe, expect, it } from 'vitest';
import { estimateDevice, reconcileWithBill, summarizeScenario, validateBill, validateDevice } from '../domain';
import type { EnergyScenario } from '../types';

describe('energy domain', () => {
  it('calculates kWh and cost from watts, hours, days and price', () => {
    const result = estimateDevice({ id: 'a', name: '空调', watts: 1000, dailyHours: 2 }, 30, 0.5);
    expect(result).toEqual({ dailyKwh: 2, monthlyKwh: 60, monthlyCost: 30 });
  });

  it('keeps device shares explainable and sums to 100%', () => {
    const scenario: EnergyScenario = { id: 's', name: 'test', pricePerKwh: 1, daysPerMonth: 30, createdAt: '', devices: [
      { id: 'a', name: 'a', watts: 100, dailyHours: 1 }, { id: 'b', name: 'b', watts: 300, dailyHours: 1 },
    ] };
    const summary = summarizeScenario(scenario);
    expect(summary.total.monthlyKwh).toBe(12);
    expect(summary.devices.map((device) => device.share)).toEqual([0.25, 0.75]);
  });

  it('rejects negative power and more than 24 hours', () => {
    expect(validateDevice({ name: 'x', watts: -1, dailyHours: 1 })).toBe('功率不能为负数');
    expect(validateDevice({ name: 'x', watts: 1, dailyHours: 24.1 })).toBe('每日使用时间不能超过 24 小时');
  });
});

describe('bill reconciliation', () => {
  // 120 + 60 + 3 = 183 kWh/月，电费 ¥91.5
  const scenario: EnergyScenario = { id: 's', name: 'test', pricePerKwh: 0.5, daysPerMonth: 30, createdAt: '', devices: [
    { id: 'a', name: '空调', watts: 1000, dailyHours: 4 },
    { id: 'b', name: '冰箱', watts: 200, dailyHours: 10 },
    { id: 'c', name: '灯', watts: 20, dailyHours: 5 },
  ] };

  it('accepts a bill whose amount matches the kWh at the current price', () => {
    expect(validateBill(180, 90, 0.5)).toBeNull();
    expect(validateBill(180, 100, 0.5)).toBeNull(); // 11% 误差，在容忍范围内
  });

  it('rejects a bill whose amount and kWh do not match, instead of computing', () => {
    expect(validateBill(180, 200, 0.5)).toContain('对不上');
    expect(validateBill(180, 200, 0.5)).toContain('¥90.00');
  });

  it('rejects non-positive readings and zero price', () => {
    expect(validateBill(0, 100, 0.5)).toContain('用电量');
    expect(validateBill(100, 0, 0.5)).toContain('金额');
    expect(validateBill(100, 60, 0)).toContain('电价为 0');
  });

  it('computes the gap between estimate and bill', () => {
    const result = reconcileWithBill(scenario, 150, 75);
    expect(result.estimatedKwh).toBeCloseTo(183);
    expect(result.kwhDelta).toBeCloseTo(-33);
    expect(result.costDelta).toBeCloseTo(75 - 91.5);
    expect(result.balanced).toBe(false);
  });

  it('attributes the gap to the biggest consumers and applying suggestions closes it', () => {
    const result = reconcileWithBill(scenario, 150, 75);
    expect(result.adjustments.length).toBeGreaterThan(0);
    expect(result.adjustments[0].deviceId).toBe('a');
    const adjusted = scenario.devices.map((device) => {
      const suggestion = result.adjustments.find((item) => item.deviceId === device.id);
      return suggestion ? { ...device, watts: suggestion.suggestedWatts, dailyHours: suggestion.suggestedDailyHours } : device;
    });
    const after = summarizeScenario({ ...scenario, devices: adjusted });
    expect(Math.abs(after.total.monthlyKwh - 150)).toBeLessThan(2);
    expect(Math.abs(after.total.monthlyKwh - 150)).toBeLessThan(Math.abs(183 - 150) / 5);
  });

  it('flags large corrections as significant', () => {
    const result = reconcileWithBill(scenario, 100, 50);
    expect(result.adjustments.some((adjustment) => adjustment.significant)).toBe(true);
  });

  it('treats a nearly matching bill as balanced without adjustments', () => {
    const result = reconcileWithBill(scenario, 184, 92);
    expect(result.balanced).toBe(true);
    expect(result.adjustments).toHaveLength(0);
  });

  it('suggests watts when hours alone cannot cover the gap', () => {
    const alwaysOn: EnergyScenario = { id: 's2', name: 't', pricePerKwh: 0.5, daysPerMonth: 30, createdAt: '', devices: [
      { id: 'a', name: '服务器', watts: 100, dailyHours: 24 },
    ] };
    const result = reconcileWithBill(alwaysOn, 144, 72);
    expect(result.adjustments[0].field).toBe('watts');
    expect(result.adjustments[0].suggestedWatts).toBe(200);
  });

  it('returns no adjustments when the estimate is zero', () => {
    const empty: EnergyScenario = { id: 's3', name: 't', pricePerKwh: 0.5, daysPerMonth: 30, createdAt: '', devices: [
      { id: 'a', name: '空置', watts: 0, dailyHours: 0 },
    ] };
    const result = reconcileWithBill(empty, 100, 50);
    expect(result.adjustments).toHaveLength(0);
  });
});
