export interface BagEntry {
  id: string;
  weight: number;
}

export interface HarvestEntry {
  id: string;
  workerName: string;
  bags: BagEntry[];
  totalKg: number;
  totalPay: number;
  ratePerKg: number;
  date: string; // ISO string
  timestamp: number;
  status: 'paid' | 'unpaid';
  uid: string;
}

export interface DailySummary {
  date: string;
  totalWorkers: number;
  totalBags: number;
  totalKg: number;
  totalPay: number;
}

export type View = 'dashboard' | 'history' | 'reports' | 'payroll';

export const RATE_PER_KG = 25; // KES
