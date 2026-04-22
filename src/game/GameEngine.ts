import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GridRenderer, buildCellMap } from './Grid';
import { BuildingManager } from './Buildings';
import { AgentManager } from './Agents';
import { useGameStore, cellKey } from '../store/gameStore';
import { GRID_SIZE, CELL_SIZE } from '../types/game';

const CENTER = (GRID_SIZE * CELL_SIZE) / 2; // world-space centre of the map

export class GameEngine {
  private renderer:        THREE.WebGLRenderer;
  private scene:           THREE.Scene;
  private camera:          THREE.PerspectiveCamera;
  private controls:        OrbitControls;
  private clock:           THREE.Clock;
  private gridRenderer:    GridRenderer;
  private buildingManager: BuildingManager;
  private agentManager:    AgentManager;
  private raycaster:       THREE.Raycaster;
  private pointer:         THREE.Vector2;
  private canvas:          HTMLCanvasElement;
  private composer:        EffectComposer;
  private animationId:     number  = 0;
  private tickInterval:    ReturnType<typeof setInterval>;

  // ── Paint-drag state ───────────────────────────────────────────────────────
  // isMouseDown tracks left-button held; lastPaintKey prevents re-painting the
  // same cell while dragging; pendingRebuild batches all paint calls in a frame
  // into a single rebuildAll so the game doesn't stall during rapid painting.
  private isMouseDown    = false;
  private isInitialPaint = false; // true only on the first cell of a new drag
  private lastPaintKey   = '';
  private pendingRebuild = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas    = canvas;
    this.raycaster = new THREE.Raycaster();
    this.pointer   = new THREE.Vector2();
    this.clock     = new THREE.Clock();

    // ── Renderer ────────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled  = true;
    this.renderer.shadowMap.type     = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping        = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.10;

    // ── Scene ────────────────────────────────────────────────────────────────
    this.scene            = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB);
    // Fog start/end scales with map size so distant terrain fades naturally.
    const fogNear = GRID_SIZE * CELL_SIZE * 0.55;
    const fogFar  = GRID_SIZE * CELL_SIZE * 2.8;
    this.scene.fog = new THREE.Fog(0x87CEEB, fogNear, fogFar);

    // ── Camera ───────────────────────────────────────────────────────────────
    const aspect = canvas.clientWidth / canvas.clientHeight;
    // Far plane must cover the full diagonal of the map plus camera height.
    const mapDiag = Math.sqrt(2) * GRID_SIZE * CELL_SIZE;
    this.camera   = new THREE.PerspectiveCamera(45, aspect, 0.1, mapDiag * 3);
    // Start with a wide overview of the new large map.
    this.camera.position.set(CENTER + 60, 180, CENTER + 220);
    this.camera.lookAt(CENTER, 0, CENTER);

    // ── OrbitControls ────────────────────────────────────────────────────────
    this.controls               = new OrbitControls(this.camera, canvas);
    this.controls.target.set(CENTER, 0, CENTER);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minDistance   = 8;
    // Allow zooming out far enough to see the whole 400-unit map.
    this.controls.maxDistance   = GRID_SIZE * CELL_SIZE * 2.2;
    this.controls.panSpeed      = 1.2;
    this.controls.zoomSpeed     = 1.2;
    // Left-click is reserved for zone painting; camera is controlled with
    // right-drag (pan) and middle-drag (rotate), scroll to zoom.
    this.controls.mouseButtons  = {
      LEFT:   undefined,              // reserved for zone painting
      MIDDLE: THREE.MOUSE.DOLLY,      // middle-drag: zoom
      RIGHT:  THREE.MOUSE.ROTATE,     // right-drag: orbit
    };
    this.controls.update();

    // ── Lighting ─────────────────────────────────────────────────────────────
    this.setupLighting();

    // ── Game objects ─────────────────────────────────────────────────────────
    this.gridRenderer    = new GridRenderer(this.scene);
    this.buildingManager = new BuildingManager(this.scene);
    this.agentManager    = new AgentManager(this.scene);

    const cells = buildCellMap();
    useGameStore.getState().initCells(cells);
    this.gridRenderer.buildTerrain(cells);
    this.buildingManager.rebuildAll(cells);
    this.buildHorizon();

    // ── Post-processing ───────────────────────────────────────────────────────
    this.composer = this.buildComposer(canvas.clientWidth, canvas.clientHeight);

    // ── Events ───────────────────────────────────────────────────────────────
    window.addEventListener('resize',   this.onResize);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseup',   this.onMouseUp);

    // ── Game tick (every 3 s) ─────────────────────────────────────────────────
    this.tickInterval = setInterval(() => useGameStore.getState().tick(), 3000);

    this.animate();
  }

  private setupLighting(): void {
    // Soft ambient matching sky tone — no pitch-black crevices
    this.scene.add(new THREE.AmbientLight(0xFFF4E0, 0.50));

    // Late-afternoon hemisphere: warm cream sky, soft grey-blue ground bounce
    const hemi = new THREE.HemisphereLight(0xFFF4E0, 0xDFE2E5, 0.65);
    hemi.position.set(0, 50, 0);
    this.scene.add(hemi);

    // Warm afternoon sun — slightly elevated, long soft shadows.
    // Position is relative to map centre so shadows cover the whole map.
    const sun = new THREE.DirectionalLight(0xFFF0C8, 0.90);
    sun.position.set(CENTER + 50, 45, CENTER + 25);
    sun.castShadow            = true;
    sun.shadow.mapSize.set(2048, 2048);
    // Shadow frustum must encompass the full 400×400-unit map.
    const half                = GRID_SIZE * CELL_SIZE * 0.65; // generous margin
    sun.shadow.camera.left    = -half;
    sun.shadow.camera.right   =  half;
    sun.shadow.camera.top     =  half;
    sun.shadow.camera.bottom  = -half;
    sun.shadow.camera.near    = 1;
    // Far must reach across the map from the elevated sun position.
    sun.shadow.camera.far     = GRID_SIZE * CELL_SIZE * 4;
    sun.shadow.bias           = -0.0003;
    // Point the sun at the map centre.
    sun.target.position.set(CENTER, 0, CENTER);
    this.scene.add(sun.target);
    this.scene.add(sun);

    // Soft blue-grey fill from opposite side — lifts shadowed faces gently
    const fill = new THREE.DirectionalLight(0xC8D8E8, 0.28);
    fill.position.set(-30, 22, -20);
    this.scene.add(fill);
  }

  private buildComposer(w: number, h: number): EffectComposer {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));

    // SSAO — soft contact shadows where buildings meet ground
    const ssao        = new SSAOPass(this.scene, this.camera, w, h);
    ssao.kernelRadius = 0.55;
    ssao.minDistance  = 0.002;
    ssao.maxDistance  = 0.07;
    (ssao as unknown as { kernelSize: number }).kernelSize = 16;
    composer.addPass(ssao);

    // Depth-of-field — miniature toy-box feel.
    // Focus normalised depth recalculated for the new far plane.
    const bokeh = new BokehPass(this.scene, this.camera, {
      focus:    0.08,    // focal plane at roughly 200 world units
      aperture: 0.00004,
      maxblur:  0.002,   // reduced blur for the large map
    });
    composer.addPass(bokeh);

    composer.addPass(new OutputPass());
    return composer;
  }

  // Distant city silhouette on all four horizons
  private buildHorizon(): void {
    const hash = (a: number, b: number) => {
      const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };

    // Strip width scales with map so the horizon fills the view.
    const W = GRID_SIZE * CELL_SIZE * 3.5;

    const buildStrip = (stripW: number, seed: number): THREE.BufferGeometry => {
      const parts: THREE.BufferGeometry[] = [];
      let x = -stripW / 2;
      let i = 0;
      while (x < stripW / 2) {
        const w = 1.8 + hash(i, seed)     * 5.5;
        const h = 2.5 + hash(i, seed + 1) * 11.0;
        const g = new THREE.BoxGeometry(w, h, 0.4);
        const c = new THREE.Color(0x3C4455);
        const n = g.attributes.position.count;
        const d = new Float32Array(n * 3);
        for (let v = 0; v < n; v++) { d[v*3]=c.r; d[v*3+1]=c.g; d[v*3+2]=c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(d, 3));
        g.translate(x + w / 2, h / 2, 0);
        parts.push(g);
        x += w + 0.25;
        i++;
      }
      return mergeGeometries(parts, false)!;
    };

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0 });
    const D   = GRID_SIZE * CELL_SIZE * 0.72; // distance from map centre

    const sides: [number, number, number, number][] = [
      [CENTER,     0, CENTER - D,  0          ],
      [CENTER,     0, CENTER + D,  Math.PI    ],
      [CENTER - D, 0, CENTER,      Math.PI / 2],
      [CENTER + D, 0, CENTER,     -Math.PI / 2],
    ];

    sides.forEach(([px, py, pz, ry], idx) => {
      const geo  = buildStrip(W, idx * 37);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py, pz);
      mesh.rotation.y = ry;
      this.scene.add(mesh);
    });
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  private onResize = (): void => {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  };

  // Left-button down: start painting the zone onto the hovered cell.
  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return; // only left click drives painting
    const { selectedTool } = useGameStore.getState();
    if (selectedTool === 'select') return;

    this.isMouseDown    = true;
    this.isInitialPaint = true;
    this.lastPaintKey   = '';
    this.tryPaintCell(e);
  };

  // Mouse move: update hover highlight and continue painting if held.
  private onMouseMove = (e: MouseEvent): void => {
    if (this.isMouseDown) this.tryPaintCell(e);

    // Hover highlight (always updated for visual feedback)
    const hit = this.raycastGround(e);
    if (!hit) {
      useGameStore.getState().setHoveredCell(null);
      this.buildingManager.setHover(null, null);
      return;
    }

    const { x, z }        = this.gridRenderer.worldToCell(hit.point);
    const { cells, selectedTool } = useGameStore.getState();
    const cell             = cells.get(cellKey(x, z));

    if (cell && cell.terrain === 'land') {
      useGameStore.getState().setHoveredCell({ x, z });
      this.buildingManager.setHover(x, z, selectedTool);
    } else {
      useGameStore.getState().setHoveredCell(null);
      this.buildingManager.setHover(null, null);
    }
  };

  // Left-button up: stop painting.
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    this.isMouseDown    = false;
    this.isInitialPaint = false;
    this.lastPaintKey   = '';
  };

  // Core paint helper — places a zone on the cell under the cursor.
  // Skips cells that haven't changed and cells already painted this drag stroke.
  private tryPaintCell(e: MouseEvent): void {
    const hit = this.raycastGround(e);
    if (!hit) return;

    const { x, z } = this.gridRenderer.worldToCell(hit.point);
    const key       = `${x},${z}`;
    if (key === this.lastPaintKey) return; // same cell as last frame, skip

    const store    = useGameStore.getState();
    const prevCell = store.cells.get(key);
    if (!prevCell || prevCell.terrain !== 'land') return;

    const snap = {
      zone:       prevCell.zone,
      upgrades:   prevCell.upgrades,
      employment: prevCell.employment,
    };

    store.placeZone(x, z);
    this.lastPaintKey = key;

    // Check whether anything actually changed before scheduling a rebuild.
    const newCell = useGameStore.getState().cells.get(key);
    if (
      newCell &&
      (newCell.zone !== snap.zone ||
       newCell.upgrades !== snap.upgrades ||
       newCell.employment !== snap.employment)
    ) {
      this.pendingRebuild = true;
      // Pop animation only on the first cell of each drag stroke to avoid
      // spawning dozens of overlapping animations while painting.
      if (this.isInitialPaint && newCell.zone !== 'empty') {
        this.buildingManager.spawnPopAnim(x, z);
      }
    }

    this.isInitialPaint = false;
  }

  private raycastGround(e: MouseEvent): THREE.Intersection | null {
    const rect     = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits     = this.raycaster.intersectObject(this.gridRenderer.getRaycasterPlane());
    return hits.length > 0 ? hits[0] : null;
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    const delta      = this.clock.getDelta();

    this.controls.update();

    // Flush all pending zone paints in one GPU upload per frame, not per cell.
    if (this.pendingRebuild) {
      this.pendingRebuild = false;
      this.buildingManager.rebuildAll(useGameStore.getState().cells);
    }

    this.buildingManager.update(delta);
    this.agentManager.update(useGameStore.getState().cells, delta);
    this.composer.render();
  };

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    clearInterval(this.tickInterval);
    window.removeEventListener('resize',   this.onResize);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mouseup',   this.onMouseUp);
    this.agentManager.dispose();
    this.buildingManager.dispose();
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
