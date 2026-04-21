import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Cell, ToolType, CELL_SIZE, GRID_SIZE } from '../types/game';
import { cellKey } from '../store/gameStore';

type CellMap = Map<string, Cell>;

// ─── Constants ────────────────────────────────────────────────────────────────

const BW  = CELL_SIZE * 0.86;
const FH  = 1.4 / 4;                   // floor height unit  0.35
const MAX = GRID_SIZE * GRID_SIZE * 2; // max InstancedMesh slots

// Road cross-section dimensions
const ASP_W  = CELL_SIZE * 0.56;       // asphalt strip width
const SW_W   = CELL_SIZE * 0.185;      // sidewalk width each side
const SW_OFF = ASP_W / 2 + SW_W / 2 + 0.03; // sidewalk centre offset

// ─── Seeded per-cell RNG ──────────────────────────────────────────────────────

function rng(x: number, z: number, slot: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7 + slot * 74.3) * 43758.5453;
  return n - Math.floor(n);
}

// ─── Palette ──────────────────────────────────────────────────────────────────

// 4 stucco/plaster flavours — no pure primaries
const FLAVORS = [
  { body: 0xEDDFB2, div: 0xCDB882, par: 0xD5C290, win: 0x38506A },  // warm cream
  { body: 0xD4A85A, div: 0xAA7E32, par: 0xBE9445, win: 0x38506A },  // sandy ochre
  { body: 0x7A9868, div: 0x5A7848, par: 0x698858, win: 0x283A30 },  // sage green
  { body: 0xC07050, div: 0x9A5030, par: 0xAE6040, win: 0x3A2840 },  // terracotta
] as const;

const P = {
  res_roof:    0xB02E18,
  hvac:        0xAAAAAA,
  solar:       0x2A3858,
  com_body:    0xE8C870,
  com_glass:   0x1E3040,
  com_awningR: 0xAA1C10,
  com_awningG: 0x2A5A2A,
  com_parapet: 0x3A6EA8,
  // public sub-categories
  edu_body:    0xE8904A,
  edu_div:     0xC06830,
  edu_par:     0xD07840,
  edu_win:     0x2A3858,
  edu_play:    0x4A9A50,
  edu_equip:   0xCC6633,
  sec_body:    0x1E3A5F,
  sec_div:     0x142840,
  sec_par:     0x1A3050,
  sec_win:     0x405870,
  sec_stripe:  0xD8C830,
  gov_body:    0xF0ECD8,
  gov_div:     0xD0C8A8,
  gov_par:     0xE0D4B8,
  gov_win:     0x38506A,
  gov_col:     0xE8E0CC,
  gov_dome:    0xF8F0E0,
  emp_body:    0x7A6EA8,
  emp_div:     0x5A4E88,
  emp_win:     0x25354C,
  road_asp:    0x646464,
  road_dash:   0xCABC38,
  sidewalk:    0xC8C0A8,
  curb:        0xA89880,
  sw_green:    0x2E7035,
  trunk:       0x6B4A2A,
  greens:      [0x2D7A35, 0x35883C, 0x2A6E30, 0x3D8540, 0x317838] as const,
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

// ─── Reusable parts ───────────────────────────────────────────────────────────

function windowRow(cy: number, bw: number, wW: number, wH: number,
                   hex: number): THREE.BufferGeometry[] {
  const hw = bw / 2 + 0.005;
  const wd = 0.018;
  const out: THREE.BufferGeometry[] = [];
  for (const wx of [-bw * 0.25, bw * 0.25]) {
    out.push(box(wW, wH, wd, hex,   wx, cy, -hw));
    out.push(box(wW, wH, wd, hex,   wx, cy,  hw));
    out.push(box(wd, wH, wW, hex, -hw, cy,   wx));
    out.push(box(wd, wH, wW, hex,  hw, cy,   wx));
  }
  return out;
}

function parapetRim(bw: number, topY: number, hex: number): THREE.BufferGeometry[] {
  const pH = 0.09, pW = 0.062;
  const hw = bw / 2 + pW / 2;
  return [
    box(bw + pW*2, pH, pW, hex,   0, topY + pH/2, -hw),
    box(bw + pW*2, pH, pW, hex,   0, topY + pH/2,  hw),
    box(pW, pH, bw, hex, -hw, topY + pH/2, 0),
    box(pW, pH, bw, hex,  hw, topY + pH/2, 0),
  ];
}

function roofProps(topY: number, flavor: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  // Base HVAC boxes (all flavors)
  out.push(box(BW*0.24, 0.13, BW*0.24, P.hvac,  BW*0.18, topY+0.065, -BW*0.18));
  out.push(box(BW*0.16, 0.10, BW*0.16, P.hvac, -BW*0.21, topY+0.050,  BW*0.19));

  if (flavor === 0 || flavor === 2) {
    // Solar panel array (flat, dark blue)
    out.push(box(BW*0.46, 0.03, BW*0.22, P.solar, -BW*0.06, topY+0.015, BW*0.10));
  }
  if (flavor === 1) {
    // Satellite dish: pedestal + tilted disc
    out.push(cyl(0.025, 0.025, 0.13, 5, P.hvac, BW*0.20, topY+0.065, BW*0.20));
    const disc = new THREE.CylinderGeometry(0.09, 0.09, 0.022, 8);
    disc.rotateX(Math.PI / 3);
    paint(disc, P.hvac);
    disc.translate(BW*0.20, topY + 0.19, BW*0.20);
    out.push(disc);
  }
  if (flavor === 3) {
    // Water tower: tank + two legs
    out.push(cyl(0.10, 0.10, 0.22, 7, P.hvac, -BW*0.18, topY+0.11, -BW*0.18));
    out.push(box(0.03, 0.10, 0.03, P.hvac, -BW*0.18 - 0.07, topY+0.05, -BW*0.18));
    out.push(box(0.03, 0.10, 0.03, P.hvac, -BW*0.18 + 0.07, topY+0.05, -BW*0.18));
  }
  return out;
}

// ─── Zone geometry factories ──────────────────────────────────────────────────

function buildResGeo(upgrades: number, flavor: number): THREE.BufferGeometry {
  const fl     = FLAVORS[flavor];
  const h      = 1.6 * Math.pow(2, upgrades);
  const floors = Math.floor(h / FH);
  const step   = Math.max(1, Math.floor(floors / 8)); // cap at ~8 window rows
  const parts: THREE.BufferGeometry[] = [];

  parts.push(box(BW, h, BW, fl.body, 0, h/2, 0));

  for (let f = step; f < floors; f += step) {
    parts.push(box(BW+0.01, 0.022, BW+0.01, fl.div, 0, f*FH, 0));
  }

  const wW = BW*0.17, wH = FH*0.42;
  for (let f = 0; f < floors; f += step) {
    windowRow(f*FH + FH*0.55, BW, wW, wH, fl.win).forEach(g => parts.push(g));
  }

  parapetRim(BW, h, fl.par).forEach(g => parts.push(g));
  roofProps(h, flavor).forEach(g => parts.push(g));

  const rh = BW * 0.38;
  parts.push(cone(BW*0.707, rh, 4, P.res_roof, 0, h+rh/2, 0, Math.PI/4));

  return mergeGeometries(parts, false)!;
}

function buildComGeo(): THREE.BufferGeometry {
  const h      = 2.4;
  const floors = Math.floor(h / FH);
  const parts: THREE.BufferGeometry[] = [];

  parts.push(box(BW, h, BW, P.com_body, 0, h/2, 0));

  // Storefront glass on all 4 faces (ground floor)
  const gfH = FH * 0.78;
  const hw  = BW/2 + 0.008;
  for (const s of [-1, 1]) {
    parts.push(box(BW*0.74, gfH, 0.012, P.com_glass,     0, gfH*0.52, s*hw));
    parts.push(box(0.012,   gfH, BW*0.74, P.com_glass, s*hw, gfH*0.52, 0));
  }
  // Door cutout suggestion (lighter panel)
  parts.push(box(BW*0.22, gfH*0.78, 0.014, 0x1A2C3C, 0, gfH*0.45, hw));

  // Awning + support poles (south face)
  parts.push(box(BW*0.86, 0.055, BW*0.17, P.com_awningR, 0, FH+0.028, BW/2+0.085));
  for (const ax of [-BW*0.28, BW*0.28]) {
    parts.push(cyl(0.018, 0.018, FH*0.78, 5, 0x888888, ax, FH*0.39, BW/2+0.085));
  }

  // Floor dividers + glass strips on upper floors
  const sH = FH*0.46, shw = BW/2 + 0.006;
  for (let f = 1; f < floors; f++) {
    parts.push(box(BW+0.01, 0.022, BW+0.01, 0x3A7EC0, 0, f*FH, 0));
    const yc = f*FH + FH*0.55;
    parts.push(box(BW-0.04, sH, 0.008, 0x8BBFE0,    0, yc, -shw));
    parts.push(box(BW-0.04, sH, 0.008, 0x8BBFE0,    0, yc,  shw));
    parts.push(box(0.008, sH, BW-0.04, 0x8BBFE0, -shw, yc,    0));
    parts.push(box(0.008, sH, BW-0.04, 0x8BBFE0,  shw, yc,    0));
  }

  parapetRim(BW, h, P.com_parapet).forEach(g => parts.push(g));
  roofProps(h, 0).forEach(g => parts.push(g));

  return mergeGeometries(parts, false)!;
}

function buildMixedGeo(upgrades: number, flavor: number): THREE.BufferGeometry {
  const fl     = FLAVORS[flavor];
  const comH   = FH;
  const resH   = 1.6 * Math.pow(2, upgrades);
  const topW   = BW * 0.83;
  const floors = Math.floor(resH / FH);
  const step   = Math.max(1, Math.floor(floors / 8));
  const parts: THREE.BufferGeometry[] = [];

  // Commercial base
  parts.push(box(BW, comH, BW, P.com_body, 0, comH/2, 0));
  const hw = BW/2 + 0.006;
  for (const s of [-1, 1]) {
    parts.push(box(BW*0.74, comH*0.85, 0.012, P.com_glass,     0, comH*0.5, s*hw));
    parts.push(box(0.012, comH*0.85, BW*0.74, P.com_glass, s*hw, comH*0.5, 0));
  }
  parts.push(box(BW*0.86, 0.05, BW*0.16, P.com_awningG, 0, comH+0.025, BW/2+0.08));

  // Residential tower (set back)
  parts.push(box(topW, resH, topW, fl.body, 0, comH+resH/2, 0));
  for (let f = step; f < floors; f += step) {
    parts.push(box(topW+0.01, 0.022, topW+0.01, fl.div, 0, comH+f*FH, 0));
  }
  const wW = topW*0.17, wH = FH*0.42;
  for (let f = 0; f < floors; f += step) {
    windowRow(comH + f*FH + FH*0.55, topW, wW, wH, fl.win).forEach(g => parts.push(g));
  }

  const totalH = comH + resH;
  parapetRim(topW, totalH, fl.par).forEach(g => parts.push(g));
  roofProps(totalH, flavor).forEach(g => parts.push(g));
  const rh = topW * 0.38;
  parts.push(cone(topW*0.707, rh, 4, P.res_roof, 0, totalH+rh/2, 0, Math.PI/4));

  return mergeGeometries(parts, false)!;
}

// ── Education: low warm-orange building with a rooftop play area ──────────────
function buildPubEducationGeo(): THREE.BufferGeometry {
  const h      = 1.6;
  const floors = Math.floor(h / FH);
  const parts: THREE.BufferGeometry[] = [];

  parts.push(box(BW, h, BW, P.edu_body, 0, h/2, 0));
  for (let f = 1; f < floors; f++) {
    parts.push(box(BW+0.01, 0.022, BW+0.01, P.edu_div, 0, f*FH, 0));
  }
  const wW = BW*0.20, wH = FH*0.46;
  for (let f = 0; f < floors; f++) {
    windowRow(f*FH + FH*0.55, BW, wW, wH, P.edu_win).forEach(g => parts.push(g));
  }
  parapetRim(BW, h, P.edu_par).forEach(g => parts.push(g));

  // Rooftop play area — green turf + climbing frame
  parts.push(box(BW*0.58, 0.05, BW*0.58, P.edu_play, 0, h+0.025, 0));
  // Climbing frame: two vertical poles + horizontal bar
  for (const px of [-BW*0.16, BW*0.16]) {
    parts.push(cyl(0.022, 0.022, 0.30, 4, P.edu_equip, px, h+0.05+0.15, 0));
  }
  parts.push(box(BW*0.38, 0.025, 0.025, P.edu_equip, 0, h+0.05+0.30, 0));
  // Flagpole
  parts.push(cyl(0.012, 0.012, 0.40, 4, P.hvac, BW*0.30, h+0.05+0.20, BW*0.28));
  parts.push(box(0.14, 0.055, 0.008, P.edu_equip, BW*0.30+0.07, h+0.05+0.36, BW*0.28));

  return mergeGeometries(parts, false)!;
}

// ── Security: tall navy block with radio mast and warning stripe ──────────────
function buildPubSecurityGeo(): THREE.BufferGeometry {
  const h      = 2.8;
  const floors = Math.floor(h / FH);
  const parts: THREE.BufferGeometry[] = [];

  parts.push(box(BW, h, BW, P.sec_body, 0, h/2, 0));
  for (let f = 1; f < floors; f++) {
    parts.push(box(BW+0.01, 0.022, BW+0.01, P.sec_div, 0, f*FH, 0));
  }
  const wW = BW*0.14, wH = FH*0.38;
  for (let f = 0; f < floors; f++) {
    windowRow(f*FH + FH*0.55, BW, wW, wH, P.sec_win).forEach(g => parts.push(g));
  }
  parapetRim(BW, h, P.sec_par).forEach(g => parts.push(g));

  // Warning stripe at base (yellow band across front face)
  const hw = BW/2 + 0.005;
  parts.push(box(BW*0.82, FH*0.16, 0.012, P.sec_stripe,  0, FH*0.12, hw));
  parts.push(box(BW*0.82, FH*0.16, 0.012, P.sec_stripe,  0, FH*0.12, -hw));

  // Radio mast: main shaft + 3 tapered crossbars
  const mastH = 1.1;
  parts.push(cyl(0.020, 0.020, mastH, 4, P.hvac, 0, h + mastH/2, 0));
  for (const [yFrac, len] of [[0.55, 0.30], [0.72, 0.22], [0.88, 0.14]] as const) {
    parts.push(box(len, 0.020, 0.020, P.hvac, 0, h + mastH * yFrac, 0));
  }

  return mergeGeometries(parts, false)!;
}

// ── Government: cream classical block with columns and central cupola ─────────
function buildPubGovernmentGeo(): THREE.BufferGeometry {
  const h      = 3.0;
  const floors = Math.floor(h / FH);
  const parts: THREE.BufferGeometry[] = [];

  parts.push(box(BW, h, BW, P.gov_body, 0, h/2, 0));
  for (let f = 1; f < floors; f++) {
    parts.push(box(BW+0.01, 0.022, BW+0.01, P.gov_div, 0, f*FH, 0));
  }
  const wW = BW*0.15, wH = FH*0.42;
  for (let f = 0; f < floors; f++) {
    windowRow(f*FH + FH*0.55, BW, wW, wH, P.gov_win).forEach(g => parts.push(g));
  }
  parapetRim(BW, h, P.gov_par).forEach(g => parts.push(g));

  // Entrance columns across front face (5 thin pillars)
  const frontZ = BW/2 + 0.025;
  const colH   = h * 0.80;
  for (const cx of [-BW*0.34, -BW*0.17, 0, BW*0.17, BW*0.34]) {
    parts.push(cyl(0.038, 0.042, colH, 8, P.gov_col, cx, colH/2, frontZ));
  }
  // Triangular pediment lintel above columns
  parts.push(box(BW*0.86, 0.055, 0.055, P.gov_div,  0, colH + 0.028, frontZ));
  // Wide entrance steps
  parts.push(box(BW*0.74, 0.055, BW*0.16, P.gov_div, 0, 0.028, frontZ + BW*0.06));

  // Central dome (three stacked cylinders tapering upward)
  parts.push(cyl(BW*0.24, BW*0.28, 0.28, 8, P.gov_col,  0, h + 0.14, 0));
  parts.push(cyl(BW*0.14, BW*0.24, 0.22, 8, P.gov_dome, 0, h + 0.28 + 0.11, 0));
  parts.push(cone(BW*0.07, 0.24, 8, P.gov_div,           0, h + 0.28 + 0.22 + 0.12, 0));

  return mergeGeometries(parts, false)!;
}

function buildEmpGeo(): THREE.BufferGeometry {
  const h      = 2.0;
  const floors = Math.floor(h / FH);
  const parts: THREE.BufferGeometry[] = [];

  parts.push(box(BW, h, BW, P.emp_body, 0, h/2, 0));
  for (let f = 1; f < floors; f++) {
    parts.push(box(BW+0.01, 0.022, BW+0.01, P.emp_div, 0, f*FH, 0));
  }
  const wW = BW*0.15, wH = FH*0.40;
  for (let f = 0; f < floors; f++) {
    windowRow(f*FH + FH*0.55, BW, wW, wH, P.emp_win).forEach(g => parts.push(g));
  }
  const antH = 0.48;
  parts.push(cyl(0.02, 0.02, antH, 5, P.hvac, 0, h+antH/2, 0));
  parts.push(box(0.21, 0.04, 0.09, P.hvac, 0, h+antH+0.02, 0));

  return mergeGeometries(parts, false)!;
}

function buildEmpOverlayGeo(): THREE.BufferGeometry {
  const EH = FH * 2, EW = BW * 0.76;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(EW, EH, EW, P.emp_body, 0, EH/2, 0));
  parts.push(box(EW+0.01, 0.022, EW+0.01, P.emp_div, 0, FH, 0));
  const wW = EW*0.16, wH = FH*0.40;
  for (let f = 0; f < 2; f++) {
    windowRow(f*FH + FH*0.55, EW, wW, wH, P.emp_win).forEach(g => parts.push(g));
  }
  return mergeGeometries(parts, false)!;
}

// ─── Road with full cross-section ────────────────────────────────────────────

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
    // Full asphalt + corner sidewalk patches
    parts.push(box(CS*0.98, 0.08, CS*0.98, P.road_asp, 0, 0.04, 0));
    for (const [sx, sz] of [[-1,-1],[-1,1],[1,-1],[1,1]] as const) {
      parts.push(box(SW_W, 0.10, SW_W, P.sidewalk, sx*SW_OFF, 0.05, sz*SW_OFF));
    }
  } else {
    const isNS = dir === 'ns' || dir === 'isolated';
    const L    = CS * 0.98; // cell length

    if (isNS) {
      // Asphalt centre strip
      parts.push(box(ASP_W, 0.08, L, P.road_asp, 0, 0.04, 0));
      // Curb lips
      parts.push(box(0.04, 0.11, L, P.curb, -(ASP_W/2+0.02), 0.055, 0));
      parts.push(box(0.04, 0.11, L, P.curb,   ASP_W/2+0.02,  0.055, 0));
      // Sidewalks
      parts.push(box(SW_W, 0.10, L, P.sidewalk, -SW_OFF, 0.05, 0));
      parts.push(box(SW_W, 0.10, L, P.sidewalk,  SW_OFF, 0.05, 0));
      // Street trees (one per sidewalk side)
      streetTree(-SW_OFF, 0).forEach(g => parts.push(g));
      streetTree( SW_OFF, 0).forEach(g => parts.push(g));
      // Centre-line dashes
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

// ─── Landscape trees ─────────────────────────────────────────────────────────

function buildTreeGeo(variant: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunkH = 0.16;
  parts.push(cyl(0.04, 0.06, trunkH, 5, P.trunk, 0, trunkH/2, 0));
  const green = P.greens[variant % P.greens.length];
  for (const [r, h, yOff] of [
    [0.30, 0.32, 0.00] as const,
    [0.22, 0.27, 0.18] as const,
    [0.13, 0.22, 0.32] as const,
  ]) {
    parts.push(cone(r, h, 7, green, 0, trunkH+yOff+h/2, 0));
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

// ─── Hover colours ────────────────────────────────────────────────────────────

const HOVER_COLOR: Partial<Record<ToolType, number>> = {
  road:             0x9A9A9A,
  residential:      0xF5D862,
  commercial:       0x6AAAE0,
  public_education: 0xF0A860,
  public_security:  0x3060A0,
  public_government:0xD8D0B0,
  demolish:         0xFF6666,
};

// ─── BuildingManager ──────────────────────────────────────────────────────────

interface AnimEntry {
  mesh:    THREE.Mesh;
  mat:     THREE.MeshBasicMaterial;
  elapsed: number;
}

export class BuildingManager {
  private scene:     THREE.Scene;
  private meshes:    Map<string, THREE.InstancedMesh> = new Map();
  private hoverMesh: THREE.Mesh;
  private animQueue: AnimEntry[] = [];
  private static readonly ANIM_DUR = 0.25;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initMeshes();

    const geo = new THREE.BoxGeometry(CELL_SIZE*0.96, 0.06, CELL_SIZE*0.96);
    const mat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.22 });
    this.hoverMesh         = new THREE.Mesh(geo, mat);
    this.hoverMesh.visible = false;
    scene.add(this.hoverMesh);
  }

  private initMeshes(): void {
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

    // Residential: 4 flavors × 6 upgrade levels
    for (let f = 0; f < 4; f++) {
      for (let u = 0; u <= 5; u++) reg(`res_${f}_${u}`, buildResGeo(u, f));
    }
    // Mixed: 4 flavors × 6 upgrade levels
    for (let f = 0; f < 4; f++) {
      for (let u = 0; u <= 5; u++) reg(`mix_${f}_${u}`, buildMixedGeo(u, f));
    }

    reg('commercial',       buildComGeo());
    reg('public_education', buildPubEducationGeo());
    reg('public_security',  buildPubSecurityGeo());
    reg('public_government',buildPubGovernmentGeo());
    reg('employment',       buildEmpGeo());
    reg('emp_overlay', buildEmpOverlayGeo());

    for (const dir of ROAD_DIRS) reg(`road_${dir}`, buildRoadGeo(dir));
    for (let v = 0; v < 5; v++) reg(`tree_${v}`, buildTreeGeo(v));
  }

  rebuildAll(cells: CellMap): void {
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

      // Landscape trees on empty land
      if (cell.zone === 'empty') {
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

      const flavor = Math.floor(rng(cell.x, cell.z, 0) * 4);
      const upg    = Math.min(cell.upgrades, 5);
      const origin = new THREE.Matrix4().compose(new THREE.Vector3(wx, 0, wz), Q0, S1);

      let key: string | null = null;
      let top                = 0;

      switch (cell.zone) {
        case 'road':
          key = `road_${roadDirection(cell, cells)}`;
          break;
        case 'residential':
          key = `res_${flavor}_${upg}`;
          top = 1.6 * Math.pow(2, upg);
          break;
        case 'commercial':
          key = 'commercial';
          top = 2.4;
          break;
        case 'mixed':
          key = `mix_${flavor}_${upg}`;
          top = FH + 1.6 * Math.pow(2, upg);
          break;
        case 'public_education':
          key = 'public_education';
          top = 1.6;
          break;
        case 'public_security':
          key = 'public_security';
          top = 2.8;
          break;
        case 'public_government':
          key = 'public_government';
          top = 3.0;
          break;
        case 'employment':
          key = 'employment';
          top = 2.0;
          break;
      }

      if (key) push(key, origin);

      if (cell.employment && top > 0) {
        push('emp_overlay', new THREE.Matrix4().compose(
          new THREE.Vector3(wx, top, wz), Q0, S1,
        ));
      }
    });

    this.meshes.forEach((mesh, key) => {
      const mats = buf.get(key);
      mesh.visible = !!mats && mats.length > 0;
      if (!mesh.visible) { mesh.count = 0; return; }
      mats!.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.count                      = mats!.length;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  spawnPopAnim(x: number, z: number): void {
    const geo = new THREE.BoxGeometry(CELL_SIZE * 0.88, 5, CELL_SIZE * 0.88);
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
    this.scene.remove(this.hoverMesh);
    (this.hoverMesh.material as THREE.MeshBasicMaterial).dispose();
    this.hoverMesh.geometry.dispose();
  }
}
