export type ZoneType = 'empty' | 'road' | 'residential' | 'commercial' | 'public' | 'mixed' | 'employment';
export type ToolType = 'select' | 'road' | 'residential' | 'commercial' | 'public' | 'demolish' | 'employment';
export type TerrainType = 'land' | 'water' | 'cliff';

export interface Cell {
  x: number;
  z: number;
  terrain: TerrainType;
  zone: ZoneType;
  upgrades:   number;  // how many times the residential portion has been doubled
  employment: boolean; // employment floors stacked on top
}

// Phase 1 (early city):  any population → max 3 doublings (×8 height)
// Phase 2 (major city):  population ≥ 50 000 → max 5 doublings (×32 height)
export function maxUpgradesForPhase(population: number): number {
  if (population >= 50_000) return 5;
  return 3;
}

export interface GameMetrics {
  budget: number;
  cityHealth: number;
  education: number;
  population: number;
  walkability: number;
  tick: number;
}

export const ZONE_COLORS: Record<ZoneType, string> = {
  road:        '#787878',
  residential: '#F5C842',
  commercial:  '#4A8ECC',
  public:      '#5BB85D',
  mixed:       '#F5C842',
  employment:  '#7A6EA8',
  empty:       '#D0CDC8',
};

export const ZONE_COSTS: Partial<Record<ToolType, number>> = {
  road:        10,
  residential: 50,
  commercial:  75,
  public:      100,
  employment:  80,
  demolish:    25,
};

export const GRID_SIZE = 32;
export const CELL_SIZE = 2; // Three.js world units per cell

export type MilestoneType = 'start' | 'zone' | 'population' | 'health' | 'phase';

export interface Milestone {
  id:    string;
  tick:  number;
  label: string;
  type:  MilestoneType;
}
