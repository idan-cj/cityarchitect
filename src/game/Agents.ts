import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Cell, CELL_SIZE } from '../types/game';
import { useGameStore } from '../store/gameStore';

// Sidewalk offset mirrors the road geometry constant
const SW_OFF = CELL_SIZE * 0.28 + CELL_SIZE * 0.0925 + 0.03; // ≈ ASP_W/2 + SW_W/2 + gap

const MAX_CARS = 80;
const MAX_PEDS = 120;
const Y_AXIS   = new THREE.Vector3(0, 1, 0);

// ─── Geometry builders ────────────────────────────────────────────────────────

function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const d = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { d[i*3]=c.r; d[i*3+1]=c.g; d[i*3+2]=c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(d, 3));
  return geo;
}

function buildCarGeo(): THREE.BufferGeometry {
  // Body (white — multiplied by instanceColor per instance)
  const body = new THREE.BoxGeometry(0.38, 0.17, 0.60);
  body.translate(0, 0.085, 0);
  paint(body, 0xffffff);

  // Cabin (slightly narrower, raised)
  const cabin = new THREE.BoxGeometry(0.27, 0.14, 0.34);
  cabin.translate(0, 0.245, -0.02);
  paint(cabin, 0xdddddd);

  // Windscreen (dark glass — stays dark regardless of instance colour)
  const wind = new THREE.BoxGeometry(0.24, 0.10, 0.010);
  wind.translate(0, 0.235, 0.175);
  paint(wind, 0x1C2A38);

  // Rear window
  const rear = new THREE.BoxGeometry(0.24, 0.10, 0.010);
  rear.translate(0, 0.235, -0.195);
  paint(rear, 0x1C2A38);

  return mergeGeometries([body, cabin, wind, rear], false)!;
}

function buildPedGeo(): THREE.BufferGeometry {
  // Torso
  const torso = new THREE.BoxGeometry(0.11, 0.18, 0.08);
  torso.translate(0, 0.13, 0);
  paint(torso, 0xffffff); // tinted by instanceColor

  // Head (skin — slightly warm, not tinted much by instance colour)
  const head = new THREE.CylinderGeometry(0.055, 0.055, 0.09, 6);
  head.translate(0, 0.30, 0);
  paint(head, 0xFFCEA0);

  return mergeGeometries([torso, head], false)!;
}

// ─── Agent data ───────────────────────────────────────────────────────────────

interface AgentData {
  start:    THREE.Vector3;
  end:      THREE.Vector3;
  progress: number;
  speed:    number;
}

const CAR_COLORS = [
  0xCC3030, 0x3060CC, 0xE8E8E8, 0x222222,
  0xCCAA20, 0x30AA50, 0xAA3080, 0x20A8CC,
];
const PED_COLORS = [
  0x3388CC, 0xCC4444, 0x44AA44, 0xAA44AA,
  0xCCAA20, 0x884422, 0x22AAAA, 0xCC7722,
];

export class AgentManager {
  private scene:   THREE.Scene;
  private carMesh: THREE.InstancedMesh;
  private pedMesh: THREE.InstancedMesh;
  private cars:    AgentData[] = [];
  private peds:    AgentData[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    const bMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness:    0.88,
      metalness:    0.05,
    });

    this.carMesh            = new THREE.InstancedMesh(buildCarGeo(), bMat.clone(), MAX_CARS);
    this.carMesh.count      = 0;
    this.carMesh.castShadow = true;
    this.carMesh.frustumCulled = false;
    scene.add(this.carMesh);

    this.pedMesh            = new THREE.InstancedMesh(buildPedGeo(), bMat.clone(), MAX_PEDS);
    this.pedMesh.count      = 0;
    this.pedMesh.castShadow = false;
    this.pedMesh.frustumCulled = false;
    scene.add(this.pedMesh);

    // Pre-assign stable per-slot instance colours
    for (let i = 0; i < MAX_CARS; i++) {
      this.carMesh.setColorAt(i, new THREE.Color(CAR_COLORS[i % CAR_COLORS.length]));
    }
    for (let i = 0; i < MAX_PEDS; i++) {
      this.pedMesh.setColorAt(i, new THREE.Color(PED_COLORS[i % PED_COLORS.length]));
    }
    if (this.carMesh.instanceColor) this.carMesh.instanceColor.needsUpdate = true;
    if (this.pedMesh.instanceColor) this.pedMesh.instanceColor.needsUpdate = true;
  }

  update(cells: Map<string, Cell>, delta: number): void {
    const { population } = useGameStore.getState().metrics;

    // Density scales with population: 1 car per 400 pop, 1 ped per 200 pop
    const density = Math.floor(population / 400);
    const maxCars = Math.min(density, MAX_CARS);
    const maxPeds = Math.min(density * 2, MAX_PEDS);

    // Collect road cells for car spawning and spawn points
    const roadCells: Cell[] = [];
    cells.forEach(c => {
      if (c.zone === 'road' && c.terrain === 'land') roadCells.push(c);
    });

    // Advance agents, discard those that finished
    this.cars = this.cars.filter(a => { a.progress += a.speed * delta; return a.progress < 1; });
    this.peds = this.peds.filter(a => { a.progress += a.speed * delta; return a.progress < 1; });

    // Spawn cars on roads
    let attempts = 0;
    while (this.cars.length < maxCars && roadCells.length >= 2 && attempts++ < 20) {
      const s = roadCells[Math.floor(Math.random() * roadCells.length)];
      const e = roadCells[Math.floor(Math.random() * roadCells.length)];
      if (s === e) continue;
      const laneOff = (Math.random() < 0.5 ? 1 : -1) * 0.18;
      this.cars.push({
        start: new THREE.Vector3(
          s.x * CELL_SIZE + CELL_SIZE/2 + laneOff,
          0.14,
          s.z * CELL_SIZE + CELL_SIZE/2,
        ),
        end: new THREE.Vector3(
          e.x * CELL_SIZE + CELL_SIZE/2 + laneOff,
          0.14,
          e.z * CELL_SIZE + CELL_SIZE/2,
        ),
        progress: Math.random() * 0.3, // stagger start
        speed:    0.06 + Math.random() * 0.05,
      });
    }

    // Spawn pedestrians on sidewalks
    attempts = 0;
    while (this.peds.length < maxPeds && roadCells.length >= 2 && attempts++ < 20) {
      const s = roadCells[Math.floor(Math.random() * roadCells.length)];
      const e = roadCells[Math.floor(Math.random() * roadCells.length)];
      if (s === e) continue;
      const swSide = (Math.random() < 0.5 ? 1 : -1) * SW_OFF;
      this.peds.push({
        start: new THREE.Vector3(
          s.x * CELL_SIZE + CELL_SIZE/2 + swSide,
          0.11,
          s.z * CELL_SIZE + CELL_SIZE/2,
        ),
        end: new THREE.Vector3(
          e.x * CELL_SIZE + CELL_SIZE/2 + swSide,
          0.11,
          e.z * CELL_SIZE + CELL_SIZE/2,
        ),
        progress: Math.random() * 0.5,
        speed:    0.025 + Math.random() * 0.015,
      });
    }

    // Upload matrices to GPU
    const pos  = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const sc   = new THREE.Vector3(1, 1, 1);
    const mat  = new THREE.Matrix4();

    this.cars.forEach((agent, i) => {
      pos.lerpVectors(agent.start, agent.end, agent.progress);
      const dir = agent.end.clone().sub(agent.start);
      if (dir.lengthSq() > 0.0001) quat.setFromAxisAngle(Y_AXIS, Math.atan2(dir.x, dir.z));
      this.carMesh.setMatrixAt(i, mat.compose(pos, quat, sc));
    });
    this.carMesh.count                      = this.cars.length;
    this.carMesh.instanceMatrix.needsUpdate = true;

    quat.identity();
    this.peds.forEach((agent, i) => {
      pos.lerpVectors(agent.start, agent.end, agent.progress);
      this.pedMesh.setMatrixAt(i, mat.compose(pos, quat, sc));
    });
    this.pedMesh.count                      = this.peds.length;
    this.pedMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    [this.carMesh, this.pedMesh].forEach(m => {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this.cars = [];
    this.peds = [];
  }
}
