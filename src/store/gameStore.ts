import { create } from 'zustand';
import { Cell, GameMetrics, ToolType, ZoneType, ZONE_COSTS, maxUpgradesForPhase } from '../types/game';

export const cellKey = (x: number, z: number) => `${x},${z}`;

interface GameStore {
  cells: Map<string, Cell>;
  metrics: GameMetrics;
  selectedTool: ToolType;
  diagnosticMode: boolean;
  hoveredCell: { x: number; z: number } | null;

  initCells:       (cells: Map<string, Cell>) => void;
  placeZone:       (x: number, z: number) => void;
  setSelectedTool: (tool: ToolType) => void;
  toggleDiagnostic: () => void;
  setHoveredCell:  (cell: { x: number; z: number } | null) => void;
  tick:            () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  cells: new Map(),
  metrics: {
    budget:     5000,
    cityHealth: 50,
    education:  30,
    population: 0,
    walkability: 0,
    tick:       0,
  },
  selectedTool:   'road',
  diagnosticMode: false,
  hoveredCell:    null,

  initCells: (cells) => set({ cells }),

  placeZone: (x, z) => {
    const { cells, selectedTool, metrics } = get();
    const key  = cellKey(x, z);
    const cell = cells.get(key);
    if (!cell || cell.terrain !== 'land') return;

    if (selectedTool === 'select') return;

    if (selectedTool === 'demolish') {
      if (cell.zone === 'empty') return;
      const newCells = new Map(cells);
      newCells.set(key, { ...cell, zone: 'empty', upgrades: 0, employment: false });
      set({ cells: newCells, metrics: { ...metrics, budget: metrics.budget - (ZONE_COSTS.demolish ?? 25) } });
      return;
    }

    // ── Employment placement / overlay toggle ─────────────────────────────────
    if (selectedTool === 'employment') {
      const cost = ZONE_COSTS.employment ?? 80;

      if (cell.zone === 'empty') {
        // Standalone employment building on bare land.
        if (metrics.budget < cost) return;
        const newCells = new Map(cells);
        newCells.set(key, { ...cell, zone: 'employment' });
        set({ cells: newCells, metrics: { ...metrics, budget: metrics.budget - cost } });
        return;
      }

      if (cell.zone === 'employment') {
        // Remove standalone employment (acts like demolish).
        if (metrics.budget < (ZONE_COSTS.demolish ?? 25)) return;
        const newCells = new Map(cells);
        newCells.set(key, { ...cell, zone: 'empty', upgrades: 0, employment: false });
        set({ cells: newCells, metrics: { ...metrics, budget: metrics.budget - (ZONE_COSTS.demolish ?? 25) } });
        return;
      }

      // Overlay on residential / commercial / mixed — toggle.
      const eligible = cell.zone === 'residential' || cell.zone === 'commercial' || cell.zone === 'mixed';
      if (!eligible) return;
      if (!cell.employment && metrics.budget < cost) return;
      const newCells = new Map(cells);
      newCells.set(key, { ...cell, employment: !cell.employment });
      set({ cells: newCells, metrics: { ...metrics, budget: metrics.budget - (cell.employment ? 0 : cost) } });
      return;
    }

    // ── Residential height upgrade ────────────────────────────────────────────
    // Clicking residential tool on an existing residential or mixed-use cell
    // doubles the building height, up to the phase cap.
    if (
      selectedTool === 'residential' &&
      (cell.zone === 'residential' || cell.zone === 'mixed')
    ) {
      const cap = maxUpgradesForPhase(metrics.population);
      if (cell.upgrades >= cap) return; // Phase limit reached
      const newCells = new Map(cells);
      newCells.set(key, { ...cell, upgrades: cell.upgrades + 1 });
      set({ cells: newCells });
      return;
    }

    // ── Standard zone placement / re-zone ────────────────────────────────────
    const toolZone = selectedTool as ZoneType;

    // Mixed-use: place Commercial on top of Residential
    if (toolZone === 'commercial' && cell.zone === 'residential') {
      const cost = (ZONE_COSTS.commercial ?? 75) / 2;
      if (metrics.budget < cost) return;
      const newCells = new Map(cells);
      newCells.set(key, { ...cell, zone: 'mixed' });
      set({ cells: newCells, metrics: { ...metrics, budget: metrics.budget - cost } });
      return;
    }

    if (cell.zone === toolZone) return; // Already this zone — no-op

    const budgetCost = cell.zone !== 'empty'
      ? 0                                  // Re-zone is free
      : (ZONE_COSTS[selectedTool] ?? 0);   // Fresh placement costs

    if (metrics.budget < budgetCost) return;

    const newCells = new Map(cells);
    // Changing zone resets upgrades and employment — the building starts fresh.
    newCells.set(key, { ...cell, zone: toolZone, upgrades: 0, employment: false });
    set({ cells: newCells, metrics: { ...metrics, budget: metrics.budget - budgetCost } });
  },

  setSelectedTool:  (tool) => set({ selectedTool: tool }),
  toggleDiagnostic: ()     => set((s) => ({ diagnosticMode: !s.diagnosticMode })),
  setHoveredCell:   (cell) => set({ hoveredCell: cell }),

  tick: () => {
    const { cells, metrics } = get();
    let population       = 0;
    let commercialCount  = 0;
    let publicCount      = 0;
    let roadCount        = 0;
    let employmentCount  = 0;

    cells.forEach((cell) => {
      if (cell.zone === 'residential' || cell.zone === 'mixed') population     += 100 * Math.pow(2, cell.upgrades);
      if (cell.zone === 'commercial'  || cell.zone === 'mixed') commercialCount++;
      if (cell.zone === 'public')                               publicCount++;
      if (cell.zone === 'road')                                 roadCount++;
      if (cell.employment || cell.zone === 'employment')         employmentCount++;
    });

    const walkability = Math.min(
      100,
      ((roadCount * 3 + commercialCount * 5) / Math.max(1, population)) * 100,
    );
    const education  = Math.min(100, publicCount * 10);
    const employmentScore = Math.min(100, employmentCount * 8);
    const cityHealth = Math.min(
      100,
      walkability * 0.35 + education * 0.25 + Math.min(100, commercialCount * 5) * 0.25 + employmentScore * 0.15,
    );
    const budgetGrowth = cityHealth * 0.5 + population * 0.1 + employmentCount * 2;

    set({
      metrics: {
        ...metrics,
        population,
        walkability: Math.round(walkability),
        education:   Math.round(education),
        cityHealth:  Math.round(cityHealth),
        budget:      metrics.budget + budgetGrowth,
        tick:        metrics.tick + 1,
      },
    });
  },
}));
