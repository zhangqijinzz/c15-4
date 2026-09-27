import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleScenario } from '../domain';
import type { EnergyDocument } from '../types';
import { EnergyLensViewModel } from '../viewModel';
import type { EnergyRepository } from '../repository';

function makeRepository(): EnergyRepository & { data: EnergyDocument; save: ReturnType<typeof vi.fn> } {
  const data: EnergyDocument = { version: 1, scenarios: [structuredClone(exampleScenario)], activeScenarioId: exampleScenario.id };
  return { data, load: () => data, save: vi.fn((next: EnergyDocument) => { data.scenarios = next.scenarios; data.activeScenarioId = next.activeScenarioId; }) };
}

describe('EnergyLensViewModel', () => {
  let repository: ReturnType<typeof makeRepository>;
  let vm: EnergyLensViewModel;
  beforeEach(() => { repository = makeRepository(); vm = new EnergyLensViewModel(repository); vm.initialize(); });

  it('initializes, persists edits, and recalculates results', () => {
    expect(vm.getState().status).toBe('ready');
    const before = vm.activeSummary?.total.monthlyKwh;
    vm.updateDevice('device-aircon', { dailyHours: 2 });
    expect(vm.activeSummary?.total.monthlyKwh).toBeLessThan(before ?? Infinity);
    expect(repository.save).toHaveBeenCalled();
  });

  it('keeps invalid values out of the document and exposes an error notice', () => {
    vm.updateDevice('device-aircon', { watts: -50 });
    expect(vm.getState().status).toBe('error');
    expect(vm.getState().notice?.text).toBe('功率不能为负数');
    expect(vm.activeScenario?.devices[0].watts).toBe(1200);
  });

  it('duplicates a scenario and can recover a saved document', () => {
    vm.duplicateActive();
    expect(vm.getState().document?.scenarios).toHaveLength(2);
    const recovered = new EnergyLensViewModel(repository);
    recovered.initialize();
    expect(recovered.getState().document?.scenarios).toHaveLength(2);
  });

  it('surfaces persistence failure as a recoverable error', () => {
    repository.save.mockImplementation(() => { throw new Error('quota'); });
    vm.addDevice();
    expect(vm.getState().status).toBe('error');
    expect(vm.getState().notice?.text).toContain('保存失败');
  });

  it('reconciles a real bill and applies suggestions back to the scenario', () => {
    const before = vm.activeSummary?.total.monthlyKwh ?? 0; // 示例方案 262.8 kWh
    vm.reconcileBill(200, 124); // 200 × 0.62 = 124，金额电量互相对得上
    const reconciliation = vm.getState().reconciliation;
    expect(reconciliation).not.toBeNull();
    expect(reconciliation?.estimatedKwh).toBeCloseTo(before);
    expect(reconciliation?.adjustments.length).toBeGreaterThan(0);
    vm.applyReconciliation();
    const after = vm.activeSummary?.total.monthlyKwh ?? 0;
    expect(Math.abs(after - 200)).toBeLessThan(2);
    expect(vm.getState().reconciliation?.applied).toBe(true);
    expect(vm.getState().reconciliation?.estimatedKwh).toBeCloseTo(before); // 调整前快照保留，可对比前后
  });

  it('refuses to reconcile when amount and kWh do not match', () => {
    vm.reconcileBill(200, 500);
    expect(vm.getState().reconciliation).toBeNull();
    expect(vm.getState().billError).toContain('对不上');
    expect(vm.getState().status).toBe('error');
    expect(vm.activeSummary?.total.monthlyKwh).toBeCloseTo(262.8); // 不硬算，方案保持原样
  });

  it('clears the reconciliation when devices change afterwards', () => {
    vm.reconcileBill(200, 124);
    expect(vm.getState().reconciliation).not.toBeNull();
    vm.updateDevice('device-aircon', { dailyHours: 5 });
    expect(vm.getState().reconciliation).toBeNull();
  });

  it('clears the reconciliation when switching or duplicating scenarios', () => {
    vm.reconcileBill(200, 124);
    vm.duplicateActive();
    expect(vm.getState().reconciliation).toBeNull();
  });
});
