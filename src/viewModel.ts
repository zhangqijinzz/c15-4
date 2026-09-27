import { cloneScenario, reconcileWithBill, summarizeScenario, validateBill, validateDevice, validateScenarioSettings } from './domain';
import { findScenario, type EnergyRepository } from './repository';
import type { BillReconciliation, EnergyDevice, EnergyDocument, EnergyScenario, Notice, ViewStatus } from './types';

export interface ReconciliationState extends BillReconciliation {
  scenarioId: string;
  applied: boolean;
}

export interface EnergyLensState {
  document: EnergyDocument | null;
  status: ViewStatus;
  notice: Notice | null;
  reconciliation: ReconciliationState | null;
  billError: string | null;
}

type Listener = (state: EnergyLensState) => void;

export class EnergyLensViewModel {
  private state: EnergyLensState = { document: null, status: 'loading', notice: null, reconciliation: null, billError: null };
  private readonly listeners = new Set<Listener>();

  constructor(private readonly repository: EnergyRepository) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): EnergyLensState { return this.state; }

  initialize(): void {
    try {
      this.state = { document: this.repository.load(), status: 'ready', notice: null, reconciliation: null, billError: null };
    } catch {
      this.state = { document: null, status: 'error', notice: { kind: 'error', text: '本地数据读取失败，请刷新重试' }, reconciliation: null, billError: null };
    }
    this.emit();
  }

  get activeScenario(): EnergyScenario | null {
    if (!this.state.document) return null;
    return findScenario(this.state.document, this.state.document.activeScenarioId) ?? null;
  }

  get activeSummary() {
    return this.activeScenario ? summarizeScenario(this.activeScenario) : null;
  }

  updateDevice(deviceId: string, patch: Partial<Pick<EnergyDevice, 'name' | 'watts' | 'dailyHours'>>): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const device = scenario.devices.find((item) => item.id === deviceId);
    if (!device) return;
    const next = { ...device, ...patch };
    const error = validateDevice(next);
    if (error) {
      this.setNotice({ kind: 'error', text: error });
      return;
    }
    this.commit((current) => ({ ...current, devices: current.devices.map((item) => item.id === deviceId ? next : item) }), '参数已更新');
  }

  addDevice(): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const device: EnergyDevice = { id: `device-${Date.now()}`, name: '新设备', watts: 100, dailyHours: 1 };
    this.commit((current) => ({ ...current, devices: [...current.devices, device] }), '已添加设备，可继续修改参数');
  }

  removeDevice(deviceId: string): void {
    const scenario = this.activeScenario;
    if (!scenario || scenario.devices.length <= 1) {
      this.setNotice({ kind: 'info', text: '至少保留一个设备，便于计算方案' });
      return;
    }
    this.commit((current) => ({ ...current, devices: current.devices.filter((item) => item.id !== deviceId) }), '设备已移除');
  }

  updateSettings(patch: Partial<Pick<EnergyScenario, 'name' | 'pricePerKwh' | 'daysPerMonth'>>): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const next = { ...scenario, ...patch };
    const error = validateScenarioSettings(next.pricePerKwh, next.daysPerMonth);
    if (error) {
      this.setNotice({ kind: 'error', text: error });
      return;
    }
    this.commit((current) => ({ ...current, name: next.name.trim() || '未命名方案', pricePerKwh: next.pricePerKwh, daysPerMonth: next.daysPerMonth }), '计费参数已更新');
  }

  duplicateActive(): void {
    const source = this.activeScenario;
    if (!source || !this.state.document) return;
    const id = `scenario-${Date.now()}`;
    const copy = cloneScenario(source, id, `${source.name} · 副本`);
    const document = { ...this.state.document, scenarios: [...this.state.document.scenarios, copy], activeScenarioId: id };
    this.persist(document, '方案已复制，现在可以修改副本', { reconciliation: null, billError: null });
  }

  selectScenario(id: string): void {
    if (!this.state.document || !findScenario(this.state.document, id)) return;
    this.persist({ ...this.state.document, activeScenarioId: id }, '已切换方案', { reconciliation: null, billError: null });
  }

  reconcileBill(actualKwh: number, actualCost: number): void {
    const scenario = this.activeScenario;
    if (!scenario) return;
    const error = validateBill(actualKwh, actualCost, scenario.pricePerKwh);
    if (error) {
      this.state = { ...this.state, status: 'error', notice: { kind: 'error', text: error }, reconciliation: null, billError: error };
      this.emit();
      return;
    }
    const reconciliation: ReconciliationState = { ...reconcileWithBill(scenario, actualKwh, actualCost), scenarioId: scenario.id, applied: false };
    this.state = { ...this.state, status: 'editing', notice: { kind: 'success', text: '复核完成，偏差已分摊到各设备' }, reconciliation, billError: null };
    this.emit();
  }

  applyReconciliation(): void {
    const reconciliation = this.state.reconciliation;
    const scenario = this.activeScenario;
    if (!reconciliation || !scenario || reconciliation.applied || reconciliation.scenarioId !== scenario.id || reconciliation.adjustments.length === 0) return;
    const byId = new Map(reconciliation.adjustments.map((adjustment) => [adjustment.deviceId, adjustment]));
    this.commit((current) => ({
      ...current,
      devices: current.devices.map((device) => {
        const adjustment = byId.get(device.id);
        return adjustment ? { ...device, watts: adjustment.suggestedWatts, dailyHours: adjustment.suggestedDailyHours } : device;
      }),
    }), '调整建议已套回，估算结果随之更新', true);
    if (this.state.status === 'error' || !this.state.reconciliation) return;
    this.state = { ...this.state, reconciliation: { ...this.state.reconciliation, applied: true } };
    this.emit();
  }

  clearReconciliation(): void {
    if (!this.state.reconciliation && !this.state.billError) return;
    const hadError = this.state.notice?.kind === 'error';
    this.state = {
      ...this.state,
      status: hadError ? 'editing' : this.state.status,
      notice: hadError ? null : this.state.notice,
      reconciliation: null,
      billError: null,
    };
    this.emit();
  }

  complete(): void {
    this.state = { ...this.state, status: 'completed', notice: { kind: 'success', text: '本次推演已保存，可随时回来继续调整' } };
    this.emit();
  }

  private commit(update: (scenario: EnergyScenario) => EnergyScenario, notice: string, keepReconciliation = false): void {
    if (!this.state.document) return;
    const document = { ...this.state.document, scenarios: this.state.document.scenarios.map((scenario) => scenario.id === this.state.document?.activeScenarioId ? update(scenario) : scenario) };
    this.persist(document, notice, keepReconciliation
      ? { reconciliation: this.state.reconciliation, billError: this.state.billError }
      : { reconciliation: null, billError: null });
  }

  private persist(document: EnergyDocument, notice: string, extra?: Partial<EnergyLensState>): void {
    try {
      this.repository.save(document);
      this.state = { ...this.state, ...extra, document, status: 'editing', notice: { kind: 'success', text: notice } };
    } catch {
      this.state = { ...this.state, status: 'error', notice: { kind: 'error', text: '保存失败，当前页面仍可继续编辑' } };
    }
    this.emit();
  }

  private setNotice(notice: Notice): void {
    this.state = { ...this.state, status: notice.kind === 'error' ? 'error' : 'editing', notice };
    this.emit();
  }

  private emit(): void { this.listeners.forEach((listener) => listener(this.state)); }
}
