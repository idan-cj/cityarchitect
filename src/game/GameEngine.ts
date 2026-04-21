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

const CENTER = (GRID_SIZE * CELL_SIZE) / 2;

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

  // Drag-detection: prevent zone placement after orbiting
  private mouseDownPos = { x: 0, y: 0 };
  private isDragging   = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas    = canvas;
    this.raycaster = new THREE.Raycaster();
    this.pointer   = new THREE.Vector2();
    this.clock     = new THREE.Clock();

    // ── Renderer ────────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled   = true;
    this.renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure  = 1.10;

    // ── Scene ────────────────────────────────────────────────────────────────
    this.scene            = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog        = new THREE.Fog(0x87CEEB, 85, 150);

    // ── Camera ───────────────────────────────────────────────────────────────
    const aspect    = canvas.clientWidth / canvas.clientHeight;
    this.camera     = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
    this.camera.position.set(CENTER + 26, 38, CENTER + 32);
    this.camera.lookAt(CENTER, 0, CENTER);

    // ── OrbitControls ────────────────────────────────────────────────────────
    this.controls                 = new OrbitControls(this.camera, canvas);
    this.controls.target.set(CENTER, 0, CENTER);
    this.controls.enableDamping   = true;
    this.controls.dampingFactor   = 0.07;
    this.controls.maxPolarAngle   = Math.PI / 2.15; // Never below horizon
    this.controls.minDistance     = 6;
    this.controls.maxDistance     = 95;
    this.controls.panSpeed        = 0.9;
    this.controls.zoomSpeed       = 1.2;
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
    this.buildingManager.rebuildAll(cells); // initial trees + any pre-placed zones
    this.buildHorizon();

    // ── Post-processing ───────────────────────────────────────────────────────
    this.composer = this.buildComposer(canvas.clientWidth, canvas.clientHeight);

    // ── Events ───────────────────────────────────────────────────────────────
    window.addEventListener('resize', this.onResize);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('click',     this.onClick);

    // ── Game tick (every 3 s) ─────────────────────────────────────────────────
    this.tickInterval = setInterval(() => useGameStore.getState().tick(), 3000);

    this.animate();
  }

  private setupLighting(): void {
    // Warm ambient — removes pitch-black crevices
    this.scene.add(new THREE.AmbientLight(0xFFECD0, 0.55));

    // Golden-hour hemisphere: warm sky above, ochre ground bounce below
    const hemi = new THREE.HemisphereLight(0xFFD090, 0x906040, 0.60);
    hemi.position.set(0, 50, 0);
    this.scene.add(hemi);

    // Low-angle golden sun — casts long, warm shadows across buildings
    const sun = new THREE.DirectionalLight(0xFFD060, 1.0);
    sun.position.set(60, 35, 20);
    sun.castShadow           = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near   = 1;
    sun.shadow.camera.far    = 180;
    sun.shadow.camera.left   = -70;
    sun.shadow.camera.right  =  70;
    sun.shadow.camera.top    =  70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.bias          = -0.0003;
    this.scene.add(sun);

    // Cool blue-sky fill — counters the warm sun on shadowed faces
    const fill = new THREE.DirectionalLight(0xA0C8FF, 0.30);
    fill.position.set(-25, 20, -25);
    this.scene.add(fill);
  }

  private buildComposer(w: number, h: number): EffectComposer {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));

    // SSAO — soft contact shadows where buildings meet ground and each other
    const ssao         = new SSAOPass(this.scene, this.camera, w, h);
    ssao.kernelRadius  = 0.55;   // hemisphere radius in world units
    ssao.minDistance   = 0.002;
    ssao.maxDistance   = 0.07;
    (ssao as unknown as { kernelSize: number }).kernelSize = 16; // lighter sample count
    composer.addPass(ssao);

    // Depth of Field — slight foreground/background blur for toy-box miniature look
    const bokeh = new BokehPass(this.scene, this.camera, {
      focus:    0.52,    // normalised depth ≈ city mid-distance
      aperture: 0.00004,
      maxblur:  0.004,
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

    const mat  = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0 });
    const D    = GRID_SIZE * CELL_SIZE * 0.72; // distance from city centre
    const W    = 180;

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

  private onMouseDown = (e: MouseEvent): void => {
    this.mouseDownPos = { x: e.clientX, y: e.clientY };
    this.isDragging   = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    const dx = e.clientX - this.mouseDownPos.x;
    const dy = e.clientY - this.mouseDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 4) this.isDragging = true;

    const hit = this.raycastGround(e);
    if (!hit) {
      useGameStore.getState().setHoveredCell(null);
      this.buildingManager.setHover(null, null);
      return;
    }

    const { x, z }   = this.gridRenderer.worldToCell(hit.point);
    const { cells, selectedTool } = useGameStore.getState();
    const cell        = cells.get(cellKey(x, z));

    if (cell && cell.terrain === 'land') {
      useGameStore.getState().setHoveredCell({ x, z });
      this.buildingManager.setHover(x, z, selectedTool);
    } else {
      useGameStore.getState().setHoveredCell(null);
      this.buildingManager.setHover(null, null);
    }
  };

  private onClick = (e: MouseEvent): void => {
    if (this.isDragging) return;

    const hit = this.raycastGround(e);
    if (!hit) return;

    const { x, z }   = this.gridRenderer.worldToCell(hit.point);
    const store       = useGameStore.getState();
    const prev           = store.cells.get(cellKey(x, z));
    const prevZone       = prev?.zone;
    const prevUpgrades   = prev?.upgrades   ?? 0;
    const prevEmployment = prev?.employment ?? false;

    store.placeZone(x, z);

    const updated = useGameStore.getState().cells;
    const cell    = updated.get(cellKey(x, z));

    // Single rebuildAll handles the changed cell and any affected road directions
    if (cell && (cell.zone !== prevZone || cell.upgrades !== prevUpgrades || cell.employment !== prevEmployment)) {
      this.buildingManager.rebuildAll(updated);
      if (cell.zone !== 'empty') this.buildingManager.spawnPopAnim(x, z);
    }
  };

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
    this.animationId   = requestAnimationFrame(this.animate);
    const delta        = this.clock.getDelta();
    this.controls.update();
    this.buildingManager.update(delta);
    this.agentManager.update(useGameStore.getState().cells, delta);
    this.composer.render();
  };

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    clearInterval(this.tickInterval);
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('click',     this.onClick);
    this.agentManager.dispose();
    this.buildingManager.dispose();
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
