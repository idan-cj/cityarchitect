import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Cell, ToolType, ZoneType, CELL_SIZE, GRID_SIZE, ZONE_COLORS } from '../types/game';
import { cellKey } from '../store/gameStore';

type CellMap = Map<string, Cell>;

// ─── Constants ────────────────────────────────────────────────────────────────

const BW        = CELL_SIZE * 0.86;
const FH        = 1.4 / 4;          // floor-height unit, used in mixed ghost height
const MAX       = GRID_SIZE * GRID_SIZE;

const TREE_PROB = Math.min(1.0, (32 * 32 * 2) / (GRID_SIZE * GRID_SIZE * 0.65));

const ASP_W  = CELL_SIZE * 0.56;
const SW_W   = CELL_SIZE * 0.185;
const SW_OFF = ASP_W / 2 + SW_W / 2 + 0.03;

// ─── Seeded per-cell RNG ──────────────────────────────────────────────────────

function rng(x: number, z: number, slot: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7 + slot * 74.3) * 43758.5453;
  return n - Math.floor(n);
}

// ─── Palette (roads & environment only) ──────────────────────────────────────

const P = {
  road_asp:  0x3B3B3B,
  road_dash: 0xF0ECE0,
  sidewalk:  0x8D918D,
  curb:      0x72767A,
  sw_green:  0x4A6B3A,
  trunk:     0x6B4A2A,
  greens:    [0x4A6B3A, 0x688E4E, 0x3D5C30, 0x5A7A40, 0x496238] as const,
};

// ─── Geometry primitives ──────────────────────────────────────────────────────

function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const d = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { d[i*3]=c.r; d[i*3+1]=c.g; d[i*3+2]=c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(d, 3));
  return geo;
}

function box(w: number, h: number, d: number, hex: number,
             tx=0, ty=0, tz=0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  paint(g, hex);
  if (tx||ty||tz) g.translate(tx, ty, tz);
  return g;
}

function cone(r: number, h: number, segs: number, hex: number,
              tx=0, ty=0, tz=0, ry=0): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, segs);
  paint(g, hex);
  if (ry) g.rotateY(ry);
  if (tx||ty||tz) g.translate(tx, ty, tz);
  return g;
}

function cyl(rt: number, rb: number, h: number, segs: number, hex: number,
             tx=0, ty=0, tz=0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, segs);
  paint(g, hex);
  if (tx||ty||tz) g.translate(tx, ty, tz);
  return g;
}

// ─── Road geometry ────────────────────────────────────────────────────────────

type RoadDir = 'ns' | 'ew' | 'intersection' | 'isolated';
const ROAD_DIRS: RoadDir[] = ['ns', 'ew', 'intersection', 'isolated'];

function streetTree(ox: number, oz: number): THREE.BufferGeometry[] {
  return [
    cyl(0.025, 0.030, 0.12, 5, P.trunk, ox, 0.06, oz),
    cone(0.12, 0.20, 6, P.sw_green, ox, 0.12+0.10, oz),
  ];
}

function buildRoadGeo(dir: RoadDir): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const CS = CELL_SIZE;

  if (dir === 'intersection') {
    parts.push(box(CS*0.98, 0.08, CS*0.98, P.road_asp, 0, 0.04, 0));
    for (const [sx, sz] of [[-1,-1],[-1,1],[1,-1],[1,1]] as const) {
      parts.push(box(SW_W, 0.10, SW_W, P.sidewalk, sx*SW_OFF, 0.05, sz*SW_OFF));
    }
  } else {
    const isNS = dir === 'ns' || dir === 'isolated';
    const L    = CS * 0.98;

    if (isNS) {
      parts.push(box(ASP_W, 0.08, L, P.road_asp, 0, 0.04, 0));
      parts.push(box(0.04, 0.11, L, P.curb, -(ASP_W/2+0.02), 0.055, 0));
      parts.push(box(0.04, 0.11, L, P.curb,   ASP_W/2+0.02,  0.055, 0));
      parts.push(box(SW_W, 0.10, L, P.sidewalk, -SW_OFF, 0.05, 0));
      parts.push(box(SW_W, 0.10, L, P.sidewalk,  SW_OFF, 0.05, 0));
      streetTree(-SW_OFF, 0).forEach(g => parts.push(g));
      streetTree( SW_OFF, 0).forEach(g => parts.push(g));
      for (const off of [-0.20, 0.20]) {
        const g = new THREE.PlaneGeometry(CS*0.045, CS*0.36);
        g.rotateX(-Math.PI/2);
        g.translate(0, 0.085, off*CS);
        paint(g, P.road_dash);
        parts.push(g);
      }
    } else {
      parts.push(box(L, 0.08, ASP_W, P.road_asp, 0, 0.04, 0));
      parts.push(box(L, 0.11, 0.04, P.curb, 0, 0.055, -(ASP_W/2+0.02)));
      parts.push(box(L, 0.11, 0.04, P.curb, 0, 0.055,   ASP_W/2+0.02));
      parts.push(box(L, 0.10, SW_W, P.sidewalk, 0, 0.05, -SW_OFF));
      parts.push(box(L, 0.10, SW_W, P.sidewalk, 0, 0.05,  SW_OFF));
      streetTree(0, -SW_OFF).forEach(g => parts.push(g));
      streetTree(0,  SW_OFF).forEach(g => parts.push(g));
      for (const off of [-0.20, 0.20]) {
        const g = new THREE.PlaneGeometry(CS*0.36, CS*0.045);
        g.rotateX(-Math.PI/2);
        g.translate(off*CS, 0.085, 0);
        paint(g, P.road_dash);
        parts.push(g);
      }
    }
  }

  return mergeGeometries(parts, false)!;
}

// ─── Landscape trees ──────────────────────────────────────────────────────────

function buildTreeGeo(variant: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunkH = 0.16;
  parts.push(cyl(0.04, 0.06, trunkH, 5, P.trunk, 0, trunkH/2, 0));

  const green  = P.greens[variant % P.greens.length];
  const green2 = P.greens[(variant + 2) % P.greens.length];

  if (variant % 2 === 0) {
    const main = new THREE.SphereGeometry(0.26, 7, 5);
    main.scale(1.05, 0.86, 1.05);
    paint(main, green);
    main.translate(0, trunkH + 0.21, 0);
    parts.push(main);

    const sub = new THREE.SphereGeometry(0.17, 6, 4);
    sub.scale(0.90, 0.78, 0.90);
    paint(sub, green2);
    sub.translate(0.12, trunkH + 0.36, -0.07);
    parts.push(sub);
  } else {
    for (const [r, h, yOff, gIdx] of [
      [0.30, 0.34, 0.00, 0],
      [0.22, 0.28, 0.19, 2],
      [0.13, 0.22, 0.34, 4],
    ] as const) {
      parts.push(cone(r, h, 7, P.greens[gIdx % P.greens.length], 0, trunkH + yOff + h/2, 0));
    }
  }
  return mergeGeometries(parts, false)!;
}

// ─── Road direction ───────────────────────────────────────────────────────────

function roadDirection(cell: Cell, cells: CellMap): RoadDir {
  const isRoad = (dx: number, dz: number) =>
    cells.get(cellKey(cell.x+dx, cell.z+dz))?.zone === 'road';
  const ns = (isRoad(0,-1)?1:0) + (isRoad(0,1)?1:0);
  const ew = (isRoad(-1,0)?1:0) + (isRoad(1,0)?1:0);
  if (ns > 0 && ew === 0) return 'ns';
  if (ew > 0 && ns === 0) return 'ew';
  if (ns > 0 && ew > 0)  return 'intersection';
  return 'isolated';
}

// ─── Ghost box heights per zone type ─────────────────────────────────────────

const GHOST_HEIGHTS: Partial<Record<ZoneType, (u: number) => number>> = {
  residential:       (u) => 1.6 * Math.pow(2, Math.min(u, 5)),
  commercial:        ()  => 2.4,
  mixed:             (u) => FH + 1.6 * Math.pow(2, Math.min(u, 5)),
  public_education:  ()  => 1.6,
  public_security:   ()  => 2.8,
  public_government: ()  => 3.0,
  employment:        ()  => 2.0,
};

// ─── GLB manifests ────────────────────────────────────────────────────────────
// upgrades 0-1 → low_density, 2-3 → mid_density, 4-5 → high_density.
// Only residential GLBs exist; all other zones remain as ghost boxes.

const GLB_MANIFESTS: Record<string, string[]> = {
  residential_0: [
    '/models/residential/low_density/res_building_small_06.glb',
    '/models/residential/low_density/res_small_Building1.glb',
    '/models/residential/low_density/res_small_Simple%20Building.glb',
  ],
  residential_1: [
    '/models/residential/low_density/res_building_small_06.glb',
    '/models/residential/low_density/res_small_Building1.glb',
    '/models/residential/low_density/res_small_Simple%20Building.glb',
  ],
  residential_2: [
    '/models/residential/mid_density/res_building_06.glb',
    '/models/residential/mid_density/res_mid_Building2.glb',
  ],
  residential_3: [
    '/models/residential/mid_density/res_building_06.glb',
    '/models/residential/mid_density/res_mid_Building2.glb',
  ],
  residential_4: [
    '/models/residential/high_density/res_high_buildingH1.glb',
    '/models/residential/high_density/res_43-blend.glb',
  ],
  residential_5: [
    '/models/residential/high_density/res_high_buildingH1.glb',
    '/models/residential/high_density/res_43-blend.glb',
  ],
};

// ─── Hover colors ─────────────────────────────────────────────────────────────

const HOVER_COLOR: Partial<Record<ToolType, number>> = {
  road:             0x9A9A9A,
  residential:      0xF5D862,
  commercial:       0x6AAAE0,
  public_education: 0xF0A860,
  public_security:  0x3060A0,
  public_government:0xD8D0B0,
  demolish:         0xFF6666,
};

// ─── Animation entry ──────────────────────────────────────────────────────────

interface AnimEntry {
  mesh:    THREE.Mesh;
  mat:     THREE.MeshBasicMaterial;
  elapsed: number;
}

// ─── Shared GLTFLoader ────────────────────────────────────────────────────────

const loader = new GLTFLoader();

// ─── BuildingManager ──────────────────────────────────────────────────────────

export class BuildingManager {
  private scene:        THREE.Scene;
  private meshes:       Map<string, THREE.InstancedMesh> = new Map(); // roads + trees
  private overlayMesh:  THREE.InstancedMesh;  // flat colored plane per zoned cell
  private ghostMesh:    THREE.InstancedMesh;  // white semi-transparent box per unloaded cell
  private glbObjects:   Map<string, THREE.Object3D> = new Map();
  private pendingLoads: Set<string> = new Set();
  private failedLoads:  Set<string> = new Set();
  private lastCells:    CellMap | null = null;
  private hoverMesh:    THREE.Mesh;
  private animQueue:    AnimEntry[] = [];
  private static readonly ANIM_DUR = 0.25;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Zone overlay: flat plane per zoned non-road cell, per-instance zone color
    const overlayGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.94, CELL_SIZE * 0.94);
    overlayGeo.rotateX(-Math.PI / 2);
    const overlayMat         = new THREE.MeshBasicMaterial();
    this.overlayMesh         = new THREE.InstancedMesh(overlayGeo, overlayMat, MAX);
    this.overlayMesh.count   = 0;
    this.overlayMesh.frustumCulled = false;
    scene.add(this.overlayMesh);

    // Ghost boxes: white semi-transparent, one per zoned cell without a loaded GLB
    const ghostGeo  = new THREE.BoxGeometry(BW, 1, BW); // Y scaled per-instance
    const ghostMat  = new THREE.MeshBasicMaterial({
      color:       0xFFFFFF,
      transparent: true,
      opacity:     0.35,
      depthWrite:  false,
    });
    this.ghostMesh         = new THREE.InstancedMesh(ghostGeo, ghostMat, MAX);
    this.ghostMesh.count   = 0;
    this.ghostMesh.frustumCulled = false;
    scene.add(this.ghostMesh);

    this.initStaticMeshes();

    const hgeo = new THREE.BoxGeometry(CELL_SIZE*0.96, 0.06, CELL_SIZE*0.96);
    const hmat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.22 });
    this.hoverMesh         = new THREE.Mesh(hgeo, hmat);
    this.hoverMesh.visible = false;
    scene.add(this.hoverMesh);
  }

  private initStaticMeshes(): void {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness:    0.85,
      metalness:    0.02,
    });

    const reg = (key: string, geo: THREE.BufferGeometry): void => {
      const m         = new THREE.InstancedMesh(geo, mat, MAX);
      m.count         = 0;
      m.castShadow    = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.scene.add(m);
      this.meshes.set(key, m);
    };

    for (const dir of ROAD_DIRS) reg(`road_${dir}`, buildRoadGeo(dir));
    for (let v = 0; v < 5; v++)  reg(`tree_${v}`,   buildTreeGeo(v));
  }

  rebuildAll(cells: CellMap): void {
    this.lastCells = cells;

    // Discard GLB objects for demolished/rezoned cells
    this.glbObjects.forEach((obj, key) => {
      const cell = cells.get(key);
      if (!cell || cell.zone === 'empty') {
        this.scene.remove(obj);
        this.glbObjects.delete(key);
        this.failedLoads.delete(key);
      }
    });

    // ── Roads + trees (instanced, vertex-colored) ─────────────────────────────
    const buf  = new Map<string, THREE.Matrix4[]>();
    const push = (key: string, m: THREE.Matrix4) => {
      let a = buf.get(key);
      if (!a) { a = []; buf.set(key, a); }
      a.push(m);
    };

    const Q0 = new THREE.Quaternion();
    const S1 = new THREE.Vector3(1, 1, 1);

    cells.forEach((cell) => {
      if (cell.terrain !== 'land') return;
      const wx = cell.x * CELL_SIZE + CELL_SIZE / 2;
      const wz = cell.z * CELL_SIZE + CELL_SIZE / 2;

      if (cell.zone === 'empty') {
        if (rng(cell.x, cell.z, 99) > TREE_PROB) return;
        const count = Math.floor(rng(cell.x, cell.z, 0) * 2) + 1;
        for (let i = 0; i < count; i++) {
          const ox = (rng(cell.x, cell.z, i*5+1) - 0.5) * CELL_SIZE * 0.50;
          const oz = (rng(cell.x, cell.z, i*5+2) - 0.5) * CELL_SIZE * 0.50;
          const sc = 0.72 + rng(cell.x, cell.z, i*5+3) * 0.48;
          const sv = Math.floor(rng(cell.x, cell.z, i*5+4) * 5);
          push(`tree_${sv}`, new THREE.Matrix4().compose(
            new THREE.Vector3(wx+ox, 0, wz+oz), Q0, new THREE.Vector3(sc, sc, sc),
          ));
        }
        return;
      }

      if (cell.zone === 'road') {
        push(`road_${roadDirection(cell, cells)}`,
          new THREE.Matrix4().compose(new THREE.Vector3(wx, 0, wz), Q0, S1));
      }
    });

    this.meshes.forEach((mesh, key) => {
      const mats    = buf.get(key);
      mesh.visible  = !!mats && mats.length > 0;
      if (!mesh.visible) { mesh.count = 0; return; }
      mats!.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.count                      = mats!.length;
      mesh.instanceMatrix.needsUpdate = true;
    });

    this.rebuildOverlay(cells);
    this.rebuildGhosts(cells);
    this.startGlbLoads(cells);
  }

  private rebuildOverlay(cells: CellMap): void {
    const Q0 = new THREE.Quaternion();
    const S1 = new THREE.Vector3(1, 1, 1);
    let count = 0;

    cells.forEach((cell) => {
      if (cell.terrain !== 'land' || cell.zone === 'empty' || cell.zone === 'road') return;
      const wx = cell.x * CELL_SIZE + CELL_SIZE / 2;
      const wz = cell.z * CELL_SIZE + CELL_SIZE / 2;

      this.overlayMesh.setMatrixAt(count,
        new THREE.Matrix4().compose(new THREE.Vector3(wx, 0.015, wz), Q0, S1));
      this.overlayMesh.setColorAt(count, new THREE.Color(ZONE_COLORS[cell.zone]));
      count++;
    });

    this.overlayMesh.count = count;
    this.overlayMesh.instanceMatrix.needsUpdate = true;
    if (this.overlayMesh.instanceColor) this.overlayMesh.instanceColor.needsUpdate = true;
  }

  private rebuildGhosts(cells: CellMap): void {
    const Q0 = new THREE.Quaternion();
    let count = 0;

    cells.forEach((cell) => {
      if (cell.terrain !== 'land' || cell.zone === 'empty' || cell.zone === 'road') return;
      if (this.glbObjects.has(cellKey(cell.x, cell.z))) return; // real model loaded

      const hFn = GHOST_HEIGHTS[cell.zone];
      const h   = hFn ? hFn(cell.upgrades) : 1.6;
      const wx  = cell.x * CELL_SIZE + CELL_SIZE / 2;
      const wz  = cell.z * CELL_SIZE + CELL_SIZE / 2;

      this.ghostMesh.setMatrixAt(count,
        new THREE.Matrix4().compose(
          new THREE.Vector3(wx, h / 2, wz),
          Q0,
          new THREE.Vector3(1, h, 1),
        ));
      count++;
    });

    this.ghostMesh.count = count;
    this.ghostMesh.instanceMatrix.needsUpdate = true;
  }

  private startGlbLoads(cells: CellMap): void {
    cells.forEach((cell) => {
      if (cell.terrain !== 'land' || cell.zone === 'empty' || cell.zone === 'road') return;
      const key = cellKey(cell.x, cell.z);
      if (this.glbObjects.has(key) || this.pendingLoads.has(key) || this.failedLoads.has(key)) return;

      const manifestKey = `${cell.zone}_${Math.min(cell.upgrades, 5)}`;
      const urls        = GLB_MANIFESTS[manifestKey];
      if (!urls || urls.length === 0) return;

      const url  = urls[Math.floor(rng(cell.x, cell.z, 7) * urls.length)];
      const zone = cell.zone;
      this.pendingLoads.add(key);

      loader.load(url, (gltf) => {
        this.pendingLoads.delete(key);
        const current = this.lastCells?.get(key);
        if (!current || current.zone !== zone) return; // stale — cell was rezoned

        const obj = gltf.scene;
        obj.position.set(cell.x * CELL_SIZE + CELL_SIZE / 2, 0, cell.z * CELL_SIZE + CELL_SIZE / 2);
        obj.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow    = true;
            child.receiveShadow = true;
          }
        });
        this.scene.add(obj);
        this.glbObjects.set(key, obj);
        if (this.lastCells) this.rebuildGhosts(this.lastCells);
      }, undefined, () => {
        this.pendingLoads.delete(key);
        this.failedLoads.add(key);
      });
    });
  }

  spawnPopAnim(x: number, z: number): void {
    const geo  = new THREE.BoxGeometry(CELL_SIZE * 0.88, 5, CELL_SIZE * 0.88);
    geo.translate(0, 2.5, 0);
    const mat  = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.28 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x * CELL_SIZE + CELL_SIZE / 2, 0, z * CELL_SIZE + CELL_SIZE / 2);
    mesh.scale.y = 0.001;
    this.scene.add(mesh);
    this.animQueue.push({ mesh, mat, elapsed: 0 });
  }

  update(delta: number): void {
    this.animQueue = this.animQueue.filter(entry => {
      entry.elapsed += delta;
      const t = Math.min(1, entry.elapsed / BuildingManager.ANIM_DUR);
      entry.mesh.scale.y = 1 - Math.pow(1 - t, 2);
      entry.mat.opacity  = (1 - t) * 0.28;
      if (t >= 1) {
        this.scene.remove(entry.mesh);
        entry.mat.dispose();
        entry.mesh.geometry.dispose();
        return false;
      }
      return true;
    });
  }

  updateBuilding(_cell: Cell, cells: CellMap): void {
    this.rebuildAll(cells);
  }

  setHover(x: number | null, z: number | null, tool?: ToolType): void {
    if (x === null || z === null) { this.hoverMesh.visible = false; return; }
    this.hoverMesh.visible = true;
    this.hoverMesh.position.set(
      x * CELL_SIZE + CELL_SIZE/2, 0.04, z * CELL_SIZE + CELL_SIZE/2,
    );
    const color = tool ? (HOVER_COLOR[tool] ?? 0xFFFFFF) : 0xFFFFFF;
    (this.hoverMesh.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  dispose(): void {
    this.animQueue.forEach(e => {
      this.scene.remove(e.mesh);
      e.mat.dispose();
      e.mesh.geometry.dispose();
    });
    this.animQueue = [];
    this.meshes.forEach(m => { this.scene.remove(m); m.geometry.dispose(); });
    this.meshes.clear();
    this.glbObjects.forEach(obj => this.scene.remove(obj));
    this.glbObjects.clear();
    this.scene.remove(this.overlayMesh);
    (this.overlayMesh.material as THREE.MeshBasicMaterial).dispose();
    this.overlayMesh.geometry.dispose();
    this.scene.remove(this.ghostMesh);
    (this.ghostMesh.material as THREE.MeshBasicMaterial).dispose();
    this.ghostMesh.geometry.dispose();
    this.scene.remove(this.hoverMesh);
    (this.hoverMesh.material as THREE.MeshBasicMaterial).dispose();
    this.hoverMesh.geometry.dispose();
  }
}
