import * as THREE from 'three';
import { Cell, ZoneType, ToolType, CELL_SIZE } from '../types/game';
import { cellKey } from '../store/gameStore';

type CellMap = Map<string, Cell>;

// Deterministic per-cell random (sine hash — no external deps)
function rng(x: number, z: number, slot: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7 + slot * 74.3) * 43758.5453;
  return n - Math.floor(n);
}

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

// Warm sandy/terracotta residential color variations
const RES_COLORS  = [0xF5C842, 0xF0BC38, 0xF2C050, 0xEDB830, 0xF5CA55];
const ROOF_COLORS = [0xC04020, 0xB83A1C, 0xCC4428, 0xA83418, 0xD04C2C];

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
  employment:  2.0,
};

const BW           = CELL_SIZE * 0.88;
const FLOOR_HEIGHT = 1.4 / 4;
const DIVIDER_H    = 0.022;
const DIVIDER_CLR  = 0xD4A82A;

const EMP_H   = FLOOR_HEIGHT * 2;
const EMP_W   = BW * 0.76;
const EMP_CLR = 0x7A6EA8;
const EMP_DIV = 0x5A4E88;

// ─── Builder helpers ──────────────────────────────────────────────────────────

function box(w: number, h: number, d: number, color: number, castShadow = true): THREE.Mesh {
  const geo  = new THREE.BoxGeometry(w, h, d);
  const mat  = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow    = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

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

// Pyramid roof for residential buildings (4-sided cone)
function addPitchedRoof(
  group: THREE.Group,
  wx: number, wz: number,
  topY: number,
  w: number,
  color: number,
): void {
  const roofH = w * 0.40;
  // ConeGeometry radius is measured to vertex; use w*0.707 so diagonal matches w
  const geo   = new THREE.ConeGeometry(w * 0.707, roofH, 4);
  const mat   = new THREE.MeshLambertMaterial({ color });
  const roof  = new THREE.Mesh(geo, mat);
  roof.position.set(wx, topY + roofH / 2, wz);
  roof.rotation.y = Math.PI / 4; // align square base to cardinal directions
  roof.castShadow = true;
  group.add(roof);
}

// Horizontal glass strip windows across all 4 faces of a building, per floor
function addGlassStrips(
  group: THREE.Group,
  wx: number, wz: number,
  w: number, h: number,
): void {
  const floorCount = Math.floor(h / FLOOR_HEIGHT);
  const glassMat   = new THREE.MeshBasicMaterial({ color: 0x8BCFF5 });
  const stripH     = FLOOR_HEIGHT * 0.48;
  const hw         = w / 2 + 0.006;

  for (let f = 0; f < floorCount; f++) {
    const yc = f * FLOOR_HEIGHT + FLOOR_HEIGHT * 0.55;
    // North / South faces (constant X extent)
    for (const zOff of [-hw, hw]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, stripH, 0.008), glassMat);
      m.position.set(wx, yc, wz + zOff);
      group.add(m);
    }
    // East / West faces (constant Z extent)
    for (const xOff of [-hw, hw]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.008, stripH, w - 0.04), glassMat);
      m.position.set(wx + xOff, yc, wz);
      group.add(m);
    }
  }
}

// Commercial rooftop: flat parapet rim + small AC unit
function addCommercialRoof(
  group: THREE.Group,
  wx: number, wz: number,
  topY: number,
  w: number,
): void {
  const parapetH = 0.09;
  const parapet  = box(w + 0.05, parapetH, w + 0.05, 0x3A6EA8);
  parapet.position.set(wx, topY + parapetH / 2, wz);
  group.add(parapet);

  const ac = box(w * 0.24, 0.13, w * 0.24, 0xBBBBBB);
  ac.position.set(wx + w * 0.17, topY + parapetH + 0.065, wz - w * 0.17);
  group.add(ac);
}

// Stepped crown for public / institutional buildings
function addPublicRoof(
  group: THREE.Group,
  wx: number, wz: number,
  topY: number,
  w: number,
): void {
  const s1 = box(w * 0.78, 0.26, w * 0.78, 0x4EA855);
  s1.position.set(wx, topY + 0.13, wz);
  s1.castShadow = true;
  group.add(s1);

  const s2 = box(w * 0.46, 0.20, w * 0.46, 0x62C468);
  s2.position.set(wx, topY + 0.26 + 0.10, wz);
  s2.castShadow = true;
  group.add(s2);
}

// Trees scattered across an empty land cell (1–2 per cell, seeded)
function addTrees(group: THREE.Group, wx: number, wz: number, x: number, z: number): void {
  const count    = Math.floor(rng(x, z, 0) * 2) + 1; // 1 or 2
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7A5C3A });
  const greens   = [0x3B7A43, 0x4A8A52, 0x558A45, 0x3D7355, 0x447A3E];

  for (let i = 0; i < count; i++) {
    const ox    = (rng(x, z, i * 5 + 1) - 0.5) * CELL_SIZE * 0.52;
    const oz    = (rng(x, z, i * 5 + 2) - 0.5) * CELL_SIZE * 0.52;
    const scale = 0.65 + rng(x, z, i * 5 + 3) * 0.55;

    // Trunk
    const trunkH   = 0.22 * scale;
    const trunkGeo = new THREE.CylinderGeometry(0.034 * scale, 0.055 * scale, trunkH, 5);
    const trunk    = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(wx + ox, trunkH / 2, wz + oz);
    trunk.castShadow = true;
    group.add(trunk);

    // Canopy (6-sided cone for a leafy silhouette)
    const canopyH   = 0.52 * scale;
    const canopyR   = 0.21 * scale;
    const color     = greens[Math.floor(rng(x, z, i * 5 + 4) * greens.length)];
    const canopyGeo = new THREE.ConeGeometry(canopyR, canopyH, 6);
    const canopyMat = new THREE.MeshLambertMaterial({ color });
    const canopy    = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(wx + ox, trunkH + canopyH * 0.42, wz + oz);
    canopy.castShadow = true;
    group.add(canopy);
  }
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
  return 'isolated';
}

function addRoadMarkings(group: THREE.Group, wx: number, wz: number, dir: RoadDir): void {
  if (dir === 'intersection') return;

  const lineMat = new THREE.MeshBasicMaterial({ color: 0xD4C860, side: THREE.DoubleSide });
  const isNS    = dir === 'ns' || dir === 'isolated';
  const dashW   = isNS ? CELL_SIZE * 0.055 : CELL_SIZE * 0.42;
  const dashH   = isNS ? CELL_SIZE * 0.42  : CELL_SIZE * 0.055;
  const geo     = new THREE.PlaneGeometry(dashW, dashH);

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
  let buildingTop = 0;

  if (cell.zone === 'empty') {
    addTrees(group, wx, wz, cell.x, cell.z);
    return group;

  } else if (cell.zone === 'road') {
    const m = box(CELL_SIZE * 0.98, 0.08, CELL_SIZE * 0.98, COLOR.road, false);
    m.position.set(wx, 0.04, wz);
    group.add(m);
    addRoadMarkings(group, wx, wz, roadDirection(cell, cells));

  } else if (cell.zone === 'mixed') {
    // Ground floor: Commercial (blue) with glass
    const baseH = FLOOR_HEIGHT;
    const b     = box(BW, baseH, BW, COLOR.mixed_base);
    b.position.set(wx, baseH / 2, wz);
    group.add(b);
    addGlassStrips(group, wx, wz, BW, baseH);

    // Upper floors: Residential (varied yellow), slightly narrower
    const topH      = (HEIGHT.residential ?? 1.6) * Math.pow(2, cell.upgrades);
    const topW      = BW * 0.84;
    const resColor  = RES_COLORS[Math.floor(rng(cell.x, cell.z, 0) * RES_COLORS.length)];
    const t         = box(topW, topH, topW, resColor);
    t.position.set(wx, baseH + topH / 2, wz);
    group.add(t);
    floorDividers(group, wx, wz, topW, topW, topH, baseH);
    buildingTop = baseH + topH;

    const roofColor = ROOF_COLORS[Math.floor(rng(cell.x, cell.z, 1) * ROOF_COLORS.length)];
    addPitchedRoof(group, wx, wz, buildingTop, topW, roofColor);

  } else if (cell.zone === 'residential') {
    const h        = (HEIGHT.residential ?? 1.6) * Math.pow(2, cell.upgrades);
    const resColor = RES_COLORS[Math.floor(rng(cell.x, cell.z, 0) * RES_COLORS.length)];
    const m        = box(BW, h, BW, resColor);
    m.position.set(wx, h / 2, wz);
    group.add(m);
    floorDividers(group, wx, wz, BW, BW, h, 0);
    buildingTop = h;

    const roofColor = ROOF_COLORS[Math.floor(rng(cell.x, cell.z, 1) * ROOF_COLORS.length)];
    addPitchedRoof(group, wx, wz, buildingTop, BW, roofColor);

  } else if (cell.zone === 'commercial') {
    const h = HEIGHT.commercial ?? 2.4;
    const m = box(BW, h, BW, COLOR.commercial);
    m.position.set(wx, h / 2, wz);
    group.add(m);
    floorDividers(group, wx, wz, BW, BW, h, 0, 0x3A7EC0);
    addGlassStrips(group, wx, wz, BW, h);
    buildingTop = h;
    addCommercialRoof(group, wx, wz, buildingTop, BW);

  } else if (cell.zone === 'employment') {
    const h = HEIGHT.employment ?? 2.0;
    const m = box(BW, h, BW, EMP_CLR);
    m.position.set(wx, h / 2, wz);
    group.add(m);
    floorDividers(group, wx, wz, BW, BW, h, 0, EMP_DIV);
    buildingTop = h;

  } else {
    // public and future zones
    const h = HEIGHT[cell.zone] ?? 1.6;
    const m = box(BW, h, BW, COLOR[cell.zone] ?? 0xAAAAAA);
    m.position.set(wx, h / 2, wz);
    group.add(m);
    buildingTop = h;
    if (cell.zone === 'public') {
      addPublicRoof(group, wx, wz, buildingTop, BW);
    }
  }

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

    // Empty land now gets trees; skip only non-land terrain
    if (cell.terrain !== 'land') return;

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
