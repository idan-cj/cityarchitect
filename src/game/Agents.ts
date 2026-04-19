import * as THREE from 'three';
import { Cell, CELL_SIZE } from '../types/game';

interface Agent {
  line:     THREE.Line;
  path:     THREE.Vector3[];
  progress: number;
  speed:    number;
}

// Agents are tiny vertical line segments that move between residential and
// commercial zones, visualising pedestrian flow without full pathfinding.
export class AgentManager {
  private scene:     THREE.Scene;
  private agents:    Agent[] = [];
  private maxAgents: number  = 40;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(cells: Map<string, Cell>, delta: number): void {
    // Cull finished agents
    this.agents = this.agents.filter((agent) => {
      agent.progress += agent.speed * delta;
      if (agent.progress >= 1) {
        this.scene.remove(agent.line);
        agent.line.geometry.dispose();
        return false;
      }

      // Interpolate position along path segments
      const segCount   = agent.path.length - 1;
      const rawSeg     = agent.progress * segCount;
      const segIdx     = Math.min(Math.floor(rawSeg), segCount - 1);
      const t          = rawSeg - segIdx;
      const from       = agent.path[segIdx];
      const to         = agent.path[Math.min(segIdx + 1, agent.path.length - 1)];

      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;

      const attr = agent.line.geometry.attributes.position as THREE.BufferAttribute;
      attr.setXYZ(0, x, 0.15, z);
      attr.setXYZ(1, x, 0.55, z); // Tiny vertical line — stylised pedestrian
      attr.needsUpdate = true;
      return true;
    });

    // Spawn new agents when under limit
    if (this.agents.length < this.maxAgents) {
      this.trySpawn(cells);
    }
  }

  private trySpawn(cells: Map<string, Cell>): void {
    const residential: Cell[] = [];
    const commercial:  Cell[] = [];

    cells.forEach((c) => {
      if (c.zone === 'residential' || c.zone === 'mixed') residential.push(c);
      if (c.zone === 'commercial'  || c.zone === 'mixed') commercial.push(c);
    });

    if (residential.length === 0 || commercial.length === 0) return;

    const src = residential[Math.floor(Math.random() * residential.length)];
    const dst = commercial [Math.floor(Math.random() * commercial.length)];
    if (src === dst) return;

    const startPos = new THREE.Vector3(
      src.x * CELL_SIZE + CELL_SIZE / 2,
      0.15,
      src.z * CELL_SIZE + CELL_SIZE / 2,
    );
    const endPos = new THREE.Vector3(
      dst.x * CELL_SIZE + CELL_SIZE / 2,
      0.15,
      dst.z * CELL_SIZE + CELL_SIZE / 2,
    );

    // Simple intermediate waypoint keeps the path slightly curved.
    const midPos = startPos.clone().lerp(endPos, 0.5);
    midPos.x    += (Math.random() - 0.5) * CELL_SIZE;
    midPos.z    += (Math.random() - 0.5) * CELL_SIZE;

    const path = [startPos, midPos, endPos];

    const positions = new Float32Array(6);
    const geo       = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat  = new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.55 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);

    this.agents.push({ line, path, progress: 0, speed: 0.06 + Math.random() * 0.06 });
  }

  dispose(): void {
    this.agents.forEach((a) => {
      this.scene.remove(a.line);
      a.line.geometry.dispose();
    });
    this.agents = [];
  }
}
