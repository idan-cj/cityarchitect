import * as THREE from 'three';
import { Cell, TerrainType, GRID_SIZE, CELL_SIZE } from '../types/game';
import { fbm } from './noise';
import { cellKey } from '../store/gameStore';

const TERRAIN_COLOR: Record<TerrainType, number> = {
  land:  0xCEC8B2,   // warm stone pavement
  water: 0x5AAEC8,   // richer teal-blue
  cliff: 0x9E8F82,
};

// ─────────────────────────────────────────────────────────────────────────────
// Terrain generation
// ─────────────────────────────────────────────────────────────────────────────

function generateTerrainMap(): Map<string, TerrainType> {
  const map = new Map<string, TerrainType>();
  const cx  = GRID_SIZE / 2;
  const cz  = GRID_SIZE / 2;

  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      // Off-center ellipse so the playable area is not symmetrical.
      const dx      = (x - cx * 0.92) / (cx * 0.80);
      const dz      = (z - cz * 1.06) / (cz * 0.86);
      const base    = Math.sqrt(dx * dx + dz * dz);

      // Layer two noise frequencies for a natural boundary.
      const n1      = fbm(x * 0.14, z * 0.14, 4, 42)  * 0.45;
      const n2      = fbm(x * 0.07, z * 0.07, 2, 137) * 0.18;
      const dist    = base + n1 - 0.18 + n2 - 0.09;

      map.set(cellKey(x, z), dist > 1.0 ? 'cliff' : 'land');
    }
  }

  // ── River ──
  // Winds from the top-left corner down the west side of the map.
  let rx = 4.0;
  for (let z = 0; z < GRID_SIZE; z++) {
    const wander   = Math.sin(z * 0.28) * 1.8 + (fbm(z * 0.16, 1, 2, 99) - 0.5) * 3.2;
    rx             = Math.max(0.8, Math.min(8.5, rx + wander * 0.22));
    const rxi      = Math.round(rx);
    const halfW    = z < 4 || z > GRID_SIZE - 4 ? 1 : 2;

    for (let dx = -halfW; dx <= halfW; dx++) {
      const nx = rxi + dx;
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

    this.buildInstanced(byType.land,  TERRAIN_COLOR.land,  0);
    this.buildInstanced(byType.water, TERRAIN_COLOR.water, -0.06);
    this.buildInstanced(byType.cliff, TERRAIN_COLOR.cliff, -0.1);

    this.buildGridLines(byType.land);
  }

  private buildInstanced(cells: Cell[], color: number, yOffset: number): void {
    if (cells.length === 0) return;

    const geo  = new THREE.PlaneGeometry(CELL_SIZE - 0.05, CELL_SIZE - 0.05);
    const mat  = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
    mesh.receiveShadow = true;

    // Bake per-instance: rotation + position in a single matrix.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const s = new THREE.Vector3(1, 1, 1);
    const m = new THREE.Matrix4();

    cells.forEach((cell, i) => {
      m.compose(
        new THREE.Vector3(
          cell.x * CELL_SIZE + CELL_SIZE / 2,
          yOffset,
          cell.z * CELL_SIZE + CELL_SIZE / 2,
        ),
        q, s,
      );
      mesh.setMatrixAt(i, m);
    });

    mesh.instanceMatrix.needsUpdate = true;
    this.terrainGroup.add(mesh);
  }

  private buildGridLines(cells: Cell[]): void {
    const pts: THREE.Vector3[] = [];

    cells.forEach(({ x, z }) => {
      const wx = x * CELL_SIZE;
      const wz = z * CELL_SIZE;
      const cs = CELL_SIZE;
      // Only top and left edges to avoid doubling shared borders.
      pts.push(
        new THREE.Vector3(wx,      0.02, wz),
        new THREE.Vector3(wx + cs, 0.02, wz),
        new THREE.Vector3(wx,      0.02, wz),
        new THREE.Vector3(wx,      0.02, wz + cs),
      );
    });

    const geo  = new THREE.BufferGeometry().setFromPoints(pts);
    const mat  = new THREE.LineBasicMaterial({ color: 0x9A9080, transparent: true, opacity: 0.45 });
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
