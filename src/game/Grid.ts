import * as THREE from 'three';
import { Cell, TerrainType, GRID_SIZE, CELL_SIZE } from '../types/game';
import { fbm } from './noise';
import { cellKey } from '../store/gameStore';

const TERRAIN_COLOR: Record<TerrainType, number> = {
  land:  0xD8D0B8,   // warm concrete
  water: 0x6BA6A8,   // soft teal-blue
  cliff: 0x9E8F82,
};

// ─────────────────────────────────────────────────────────────────────────────
// Terrain generation
// ─────────────────────────────────────────────────────────────────────────────

function generateTerrainMap(): Map<string, TerrainType> {
  const map = new Map<string, TerrainType>();
  const cx  = GRID_SIZE / 2;
  const cz  = GRID_SIZE / 2;

  // Normalize FBM frequencies so feature count stays constant regardless of GRID_SIZE.
  // Baseline was GRID_SIZE=32 with frequencies 0.14 and 0.07.
  const nf  = 32 / GRID_SIZE;

  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      // Off-center ellipse so the playable area is not symmetrical.
      const dx   = (x - cx * 0.92) / (cx * 0.80);
      const dz   = (z - cz * 1.06) / (cz * 0.86);
      const base = Math.sqrt(dx * dx + dz * dz);

      // Layer two noise frequencies for a natural boundary.
      const n1   = fbm(x * 0.14 * nf, z * 0.14 * nf, 4, 42)  * 0.45;
      const n2   = fbm(x * 0.07 * nf, z * 0.07 * nf, 2, 137) * 0.18;
      const dist = base + n1 - 0.18 + n2 - 0.09;

      map.set(cellKey(x, z), dist > 1.0 ? 'cliff' : 'land');
    }
  }

  // ── River ──
  // Winds from the top-left corner down the west side of the map.
  // All parameters scale proportionally with GRID_SIZE so the river
  // looks the same relative to the map at any resolution.
  const rs = GRID_SIZE / 32; // river scale factor (1.0 at baseline 32)
  let rx = 4.0 * rs;
  for (let z = 0; z < GRID_SIZE; z++) {
    const wander = Math.sin(z * 0.28 * nf) * 1.8 * rs
                 + (fbm(z * 0.16 * nf, 1, 2, 99) - 0.5) * 3.2 * rs;
    rx = Math.max(0.8 * rs, Math.min(8.5 * rs, rx + wander * 0.22));

    const rxi    = Math.round(rx);
    const edge   = Math.round(GRID_SIZE * 0.125); // proportional edge zone (was z<4 on 32-wide)
    const halfW  = (z < edge || z > GRID_SIZE - edge)
      ? Math.max(1, Math.round(rs))
      : Math.max(2, Math.round(2 * rs));

    for (let dx2 = -halfW; dx2 <= halfW; dx2++) {
      const nx = rxi + dx2;
      if (nx >= 0 && nx < GRID_SIZE && map.get(cellKey(nx, z)) === 'land') {
        map.set(cellKey(nx, z), 'water');
      }
    }
  }

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────────────────────────────────────

export function buildCellMap(): Map<string, Cell> {
  const terrain = generateTerrainMap();
  const cells   = new Map<string, Cell>();

  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const key = cellKey(x, z);
      cells.set(key, { x, z, terrain: terrain.get(key) ?? 'cliff', zone: 'empty', upgrades: 0, employment: false });
    }
  }

  return cells;
}

// ─────────────────────────────────────────────────────────────────────────────
// GridRenderer — builds Three.js geometry for the terrain
// ─────────────────────────────────────────────────────────────────────────────

export class GridRenderer {
  private scene:          THREE.Scene;
  private terrainGroup:   THREE.Group;
  private raycasterPlane: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.scene        = scene;
    this.terrainGroup = new THREE.Group();
    scene.add(this.terrainGroup);

    // Large invisible horizontal plane used exclusively for raycasting.
    const size = GRID_SIZE * CELL_SIZE + 4;
    const geo  = new THREE.PlaneGeometry(size, size);
    const mat  = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    this.raycasterPlane = new THREE.Mesh(geo, mat);
    this.raycasterPlane.rotation.x = -Math.PI / 2;
    this.raycasterPlane.position.set(
      (GRID_SIZE * CELL_SIZE) / 2,
      0.01,
      (GRID_SIZE * CELL_SIZE) / 2,
    );
    scene.add(this.raycasterPlane);
  }

  buildTerrain(cells: Map<string, Cell>): void {
    this.terrainGroup.clear();

    const byType: Record<TerrainType, Cell[]> = { land: [], water: [], cliff: [] };
    cells.forEach((c) => byType[c.terrain].push(c));

    this.buildInstanced(byType.land,  TERRAIN_COLOR.land,  0,     0.92, 0);
    this.buildInstanced(byType.water, TERRAIN_COLOR.water, -0.06, 0.18, 0.08);
    this.buildInstanced(byType.cliff, TERRAIN_COLOR.cliff, -0.1,  0.95, 0);

    this.buildGridLines();
  }

  private buildInstanced(
    cells: Cell[], color: number, yOffset: number,
    roughness = 0.92, metalness = 0,
  ): void {
    if (cells.length === 0) return;

    const geo  = new THREE.PlaneGeometry(CELL_SIZE - 0.05, CELL_SIZE - 0.05);
    const mat  = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
    mesh.receiveShadow = true;

    // Bake per-instance: rotation + position in a single matrix.
    const q   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const s   = new THREE.Vector3(1, 1, 1);
    const m   = new THREE.Matrix4();
    const tmp = new THREE.Vector3(); // reused to avoid per-cell allocation

    cells.forEach((cell, i) => {
      tmp.set(
        cell.x * CELL_SIZE + CELL_SIZE / 2,
        yOffset,
        cell.z * CELL_SIZE + CELL_SIZE / 2,
      );
      m.compose(tmp, q, s);
      mesh.setMatrixAt(i, m);
    });

    mesh.instanceMatrix.needsUpdate = true;
    this.terrainGroup.add(mesh);
  }

  // On large maps draw a coarse superimposed grid (every N cells) rather than
  // individual cell borders, which would produce ~160 k line segments and
  // look like solid grey noise when zoomed out.
  private buildGridLines(): void {
    const total    = GRID_SIZE * CELL_SIZE;
    const stepCells = GRID_SIZE > 64
      ? Math.max(5, Math.round(GRID_SIZE / 20)) // ~20 grid lines across
      : 1;                                        // per-cell lines on small maps
    const step     = stepCells * CELL_SIZE;
    const opacity  = GRID_SIZE > 64 ? 0.35 : 0.45;

    // Count lines: Math.floor(total/step)+1 vertical + same horizontal
    const lineCount = Math.floor(total / step) + 1;
    // Each line = 2 points × 3 floats
    const buf = new Float32Array(lineCount * 2 * 2 * 3);
    let   off = 0;

    for (let v = 0; v <= total; v += step) {
      // Vertical line (constant x)
      buf[off++] = v; buf[off++] = 0.02; buf[off++] = 0;
      buf[off++] = v; buf[off++] = 0.02; buf[off++] = total;
      // Horizontal line (constant z)
      buf[off++] = 0;     buf[off++] = 0.02; buf[off++] = v;
      buf[off++] = total; buf[off++] = 0.02; buf[off++] = v;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(buf.subarray(0, off), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x9A9080, transparent: true, opacity });
    this.terrainGroup.add(new THREE.LineSegments(geo, mat));
  }

  getRaycasterPlane(): THREE.Mesh { return this.raycasterPlane; }

  worldToCell(p: THREE.Vector3): { x: number; z: number } {
    return {
      x: Math.floor(p.x / CELL_SIZE),
      z: Math.floor(p.z / CELL_SIZE),
    };
  }
}
