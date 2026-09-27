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

export interface BillRecord {
  actualKwh: number;
  actualCost: number;
}

export interface DeviceGap {
  deviceId: string;
  name: string;
  estimatedKwh: number;
  shareOfEstimate: number;
  attributedGapKwh: number;
}

export interface AdjustmentSuggestion {
  deviceId: string;
  deviceName: string;
  field: 'dailyHours' | 'watts';
  currentValue: number;
  suggestedValue: number;
  closesGapKwh: number;
  description: string;
}

export interface BillReconciliation {
  bill: BillRecord;
  estimatedKwh: number;
  estimatedCost: number;
  gapKwh: number;
  gapCost: number;
  impliedPrice: number;
  aligned: boolean;
  devices: DeviceGap[];
  suggestions: AdjustmentSuggestion[];
}

export interface AppliedAdjustment {
  description: string;
  gapBeforeKwh: number;
}
