import type { Station, AlertItem, StationLocation } from '@/types/api.types';

export type { StationLocation };

export interface StationKpi {
  alerts: number;
  devicesOnline: number;
  devicesTotal: number;
  warningsCount: number;
  alarmsCount: number;
}

export interface StationView {
  station: Station;
  location: StationLocation;
  kpi: StationKpi;
  alertsList: AlertItem[];
}
