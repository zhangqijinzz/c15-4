import { describe, expect, it } from 'vitest';
import { estimateDevice, exampleScenario, reconcileBill, summarizeScenario, validateBill, validateDevice } from '../domain';
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

  it('accepts a bill whose amount matches kWh within tolerance', () => {
    expect(validateBill({ actualKwh: 100, actualCost: 62 }, 0.62)).toBeNull();
    expect(validateBill({ actualKwh: 100, actualCost: 68 }, 0.62)).toBeNull();
  });

  it('rejects a bill whose amount and kWh do not add up', () => {
    expect(validateBill({ actualKwh: 100, actualCost: 120 }, 0.62)).toContain('对不上');
    expect(validateBill({ actualKwh: 0, actualCost: 62 }, 0.62)).toContain('用电量');
    expect(validateBill({ actualKwh: 100, actualCost: 0 }, 0.62)).toContain('金额');
  });

  it('attributes the gap to devices by share and suggests closing it via hours', () => {
    const result = reconcileBill(exampleScenario, { actualKwh: 200, actualCost: 124 });
    expect(result.estimatedKwh).toBeCloseTo(262.8, 5);
    expect(result.gapKwh).toBeCloseTo(-62.8, 5);
    expect(result.aligned).toBe(false);
    expect(result.devices[0].deviceId).toBe('device-aircon');
    expect(result.devices[0].attributedGapKwh).toBeCloseTo(-62.8 * (216 / 262.8), 5);
    const suggestion = result.suggestions[0];
    expect(suggestion.deviceId).toBe('device-aircon');
    expect(suggestion.field).toBe('dailyHours');
    expect(suggestion.suggestedValue).toBeCloseTo(4.3, 5);
  });

  it('treats a bill within 2% of the estimate as aligned and suggests nothing', () => {
    const result = reconcileBill(exampleScenario, { actualKwh: 260, actualCost: 161.2 });
    expect(result.aligned).toBe(true);
    expect(result.suggestions).toHaveLength(0);
  });
});
