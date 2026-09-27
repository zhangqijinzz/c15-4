export interface EnergyDevice {
  id: string;
  name: string;
  watts: number;
  dailyHours: number;
}

export interface EnergyScenario {
  id: string;
  name: string;
  pricePerKwh: number;
  daysPerMonth: number;
  devices: EnergyDevice[];
  createdAt: string;
}

export interface EnergyDocument {
  version: 1;
  scenarios: EnergyScenario[];
  activeScenarioId: string;
}

export type ViewStatus = 'loading' | 'ready' | 'editing' | 'error' | 'completed';

export interface Notice {
  kind: 'success' | 'error' | 'info';
  text: string;
}

export interface EnergyEstimate {
  dailyKwh: number;
  monthlyKwh: number;
  monthlyCost: number;
}

export interface ScenarioSummary {
  total: EnergyEstimate;
  devices: Array<EnergyDevice & EnergyEstimate & { share: number }>;
}

export interface DeviceAdjustment {
  deviceId: string;
  name: string;
  field: 'dailyHours' | 'watts';
  currentWatts: number;
  currentDailyHours: number;
  suggestedWatts: number;
  suggestedDailyHours: number;
  currentMonthlyKwh: number;
  targetMonthlyKwh: number;
  attributedDeltaKwh: number;
  significant: boolean;
}

export interface BillReconciliation {
  actualKwh: number;
  actualCost: number;
  expectedCost: number;
  estimatedKwh: number;
  estimatedCost: number;
  kwhDelta: number;
  costDelta: number;
  kwhDeltaRatio: number;
  balanced: boolean;
  adjustments: DeviceAdjustment[];
}
