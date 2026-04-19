import * as THREE from 'three';
import { Cell, ZoneType, ToolType, CELL_SIZE } from '../types/game';
import { cellKey } from '../store/gameStore';

type CellMap = Map<string, Cell>;

// ─── Palette ──────────────────────────────────────────────────────────────────

const COLOR: Record<string, number> = {
  road:        0x7A7A7A,
  residential: 0xF5C842,
  commercial:  0x4A8ECC,
  public:      0x5BB85D,
  mixed_base:  0x4A8ECC,
  mixed_top:   0xF5C842,
  demolish:    0xE05454,
};

const HOVER_COLOR: Partial<Record<ToolType, number>> = {
  road:        0x9A9A9A,
  residential: 0xF5D862,
  commercial:  0x6AAAE0,
  public:      0x70C872,
  demolish:    0xFF6666,
};

const HEIGHT: Partial<Record<ZoneType, number>> = {
  residential: 1.6,
  commercial:  2.4,
  public:      3.0,
  employment:  2.0, // standalone employment mid-rise
};

const BW           = CELL_SIZE * 0.88; // Building footprint width
const FLOOR_HEIGHT = 1.4 / 4;          // Canonical floor unit
const DIVIDER_H    = 0.022;            // Thickness of floor-plate bands
const DIVIDER_CLR  = 0xD4A82A;        // Slightly darker than residential yellow

// Employment top-floors
const EMP_H   = FLOOR_HEIGHT * 2;     // Two employment floors
const EMP_W   = BW * 0.76;            // Slightly set back — penthouse style
const EMP_CLR = 0x7A6EA8;             // Muted purple — distinct from all other zones
const EMP_DIV = 0x5A4E88;             // Darker purple for employment dividers

// ─── Builder helpers ──────────────────────────────────────────────────────────

function box(w: number, h: number, d: number, color: number, castShadow = true): THREE.Mesh {
  const geo  = new THREE.BoxGeometry(w, h, d);
  const mat  = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow    = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

// Adds horizontal floor-plate bands at every FLOOR_HEIGHT interval.
// Only interior joints are drawn (skips the very bottom and top).
function floorDividers(
  group: THREE.Group,
  wx: number, wz: number,
  w: number, d: number,
  totalH: number, yBase: number,
  color: number = DIVIDER_CLR,
): void {
  const floorCount = Math.floor(totalH / FLOOR_HEIGHT);
  if (floorCount < 2) return;

  const geo = new THREE.BoxGeometry(w + 0.01, DIVIDER_H, d + 0.01);
  const mat = new THREE.MeshBasicMaterial({ color });

  for (let f = 1; f < floorCount; f++) {
    const band = new THREE.Mesh(geo, mat);
    band.position.set(wx, yBase + f * FLOOR_HEIGHT, wz);
    group.add(band);
  }
}

function addEmploymentFloors(group: THREE.Group, wx: number, wz: number, baseY: number): void {
  const emp = box(EMP_W, EMP_H, EMP_W, EMP_CLR);
  emp.position.set(wx, baseY + EMP_H / 2, wz);
  group.add(emp);
  floorDividers(group, wx, wz, EMP_W, EMP_W, EMP_H, baseY, EMP_DIV);
}

type RoadDir = 'ns' | 'ew' | 'intersection' | 'isolated';

function roadDirection(cell: Cell, cells: CellMap): RoadDir {
  const isRoad = (dx: number, dz: number) =>
    cells.get(cellKey(cell.x + dx, cell.z + dz))?.zone === 'road';

  const ns = (isRoad(0, -1) ? 1 : 0) + (isRoad(0, 1) ? 1 : 0);
  const ew = (isRoad(-1, 0) ? 1 : 0) + (isRoad(1, 0) ? 1 : 0);

  if (ns > 0 && ew === 0) return 'ns';
  if (ew > 0 && ns === 0) return 'ew';
  if (ns > 0 && ew > 0)  return 'intersection';
  return 'isolated'; // no road neighbours → default N-S
}

function addRoadMarkings(group: THREE.Group, wx: number, wz: number, dir: RoadDir): void {
  if (dir === 'intersection') return; // crossing — no centre-line dashes

  const lineMat = new THREE.MeshBasicMaterial({ color: 0xD4C860, side: THREE.DoubleSide });

  // PlaneGeometry(width, height) lies in XY; after rotation.x=-PI/2:
  //   width  → X axis,  height → Z axis.
  // N-S road: dashes run along Z (thin in X, long in Z), offset in Z.
  // E-W road: dashes run along X (long in X, thin in Z), offset in X.
  const isNS   = dir === 'ns' || dir === 'isolated';
  const dashW  = isNS ? CELL_SIZE * 0.055 : CELL_SIZE * 0.42;
  const dashH  = isNS ? CELL_SIZE * 0.42  : CELL_SIZE * 0.055;
  const geo    = new THREE.PlaneGeometry(dashW, dashH);

  for (const offset of [-0.22, 0.22]) {
    const mark = new THREE.Mesh(geo, lineMat);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(
      isNS ? wx : wx + offset * CELL_SIZE,
      0.09,
      isNS ? wz + offset * CELL_SIZE : wz,
    );
    group.add(mark);
  }
}

function buildGroup(cell: Cell, cells: CellMap): THREE.Group {
  const group = new THREE.Group();
  const wx    = cell.x * CELL_SIZE + CELL_SIZE / 2;
  const wz    = cell.z * CELL_SIZE + CELL_SIZE / 2;

  // buildingTop tracks the Y of the current roof — employment stacks above it.
  let buildingTop = 0;

  if (cell.zone === 'road') {
    const m = box(CELL_SIZE * 0.98, 0.08, CELL_SIZE * 0.98, COLOR.road, false);
    m.position.set(wx, 0.04, wz);
    group.add(m);
    addRoadMarkings(group, wx, wz, roadDirection(cell, cells));

  } else if (cell.zone === 'mixed') {
    // Ground floor: Commercial (blue)
    const baseH = FLOOR_HEIGHT;
    const b     = box(BW, baseH, BW, COLOR.mixed_base);
    b.position.set(wx, baseH / 2, wz);
    group.add(b);

    // Upper floors: Residential (yellow), slightly narrower — doubles with upgrades
    const topH = (HEIGHT.residential ?? 1.6) * Math.pow(2, cell.upgrades);
    const topW = BW * 0.84;
    const t    = box(topW, topH, topW, COLOR.mixed_top);
    t.position.set(wx, baseH + topH / 2, wz);
    group.add(t);
    floorDividers(group, wx, wz, topW, topW, topH, baseH);
    buildingTop = baseH + topH;

  } else if (cell.zone === 'residential') {
    const h = (HEIGHT.residential ?? 1.6) * Math.pow(2, cell.upgrades);
    const m = box(BW, h, BW, COLOR.residential);
    m.position.set(wx, h / 2, wz);
    group.add(m);
    floorDividers(group, wx, wz, BW, BW, h, 0);
    buildingTop = h;

  } else if (cell.zone === 'commercial') {
    const h = HEIGHT.commercial ?? 2.4;
    const m = box(BW, h, BW, COLOR.commercial);
    m.position.set(wx, h / 2, wz);
    group.add(m);
    floorDividers(group, wx, wz, BW, BW, h, 0, 0x3A7EC0);
    buildingTop = h;

  } else if (cell.zone === 'employment') {
    // Standalone employment building — same colour as the overlay floors.
    const h = HEIGHT.employment ?? 2.0;
    const m = box(BW, h, BW, EMP_CLR);
    m.position.set(wx, h / 2, wz);
    group.add(m);
    floorDividers(group, wx, wz, BW, BW, h, 0, EMP_DIV);
    buildingTop = h;

  } else {
    // public and any future zones
    const h = HEIGHT[cell.zone] ?? 1.6;
    const m = box(BW, h, BW, COLOR[cell.zone] ?? 0xAAAAAA);
    m.position.set(wx, h / 2, wz);
    group.add(m);
    buildingTop = h;
  }

  // Employment floors sit on top of residential, commercial, or mixed buildings.
  if (cell.employment && buildingTop > 0) {
    addEmploymentFloors(group, wx, wz, buildingTop);
  }

  return group;
}

// ─── BuildingManager ─────────────────────────────────────────────────────────

export class BuildingManager {
  private scene:     THREE.Scene;
  private buildings: Map<string, THREE.Group> = new Map();
  private hoverMesh: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    const geo = new THREE.BoxGeometry(CELL_SIZE * 0.96, 0.06, CELL_SIZE * 0.96);
    const mat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.25 });
    this.hoverMesh         = new THREE.Mesh(geo, mat);
    this.hoverMesh.visible = false;
    scene.add(this.hoverMesh);
  }

  updateBuilding(cell: Cell, cells: CellMap): void {
    const key      = cellKey(cell.x, cell.z);
    const existing = this.buildings.get(key);

    if (existing) {
      this.scene.remove(existing);
      this.buildings.delete(key);
    }

    if (cell.zone === 'empty' || cell.terrain !== 'land') return;

    const group = buildGroup(cell, cells);
    this.scene.add(group);
    this.buildings.set(key, group);
  }

  setHover(x: number | null, z: number | null, tool?: ToolType): void {
    if (x === null || z === null) {
      this.hoverMesh.visible = false;
      return;
    }
    this.hoverMesh.visible = true;
    this.hoverMesh.position.set(
      x * CELL_SIZE + CELL_SIZE / 2,
      0.04,
      z * CELL_SIZE + CELL_SIZE / 2,
    );
    const color = tool ? (HOVER_COLOR[tool] ?? 0xFFFFFF) : 0xFFFFFF;
    (this.hoverMesh.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  dispose(): void {
    this.buildings.forEach((g) => this.scene.remove(g));
    this.buildings.clear();
  }
}
