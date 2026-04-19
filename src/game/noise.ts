// Deterministic value noise — no external deps.
function hash(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.3) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function valueNoise(x: number, y: number, seed = 42): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);

  const a = hash(ix,     iy,     seed);
  const b = hash(ix + 1, iy,     seed);
  const c = hash(ix,     iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);

  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

// Fractional Brownian Motion — stacks octaves for more organic shapes.
export function fbm(x: number, y: number, octaves = 3, seed = 42): number {
  let value     = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total     = 0;

  for (let i = 0; i < octaves; i++) {
    value     += valueNoise(x * frequency, y * frequency, seed + i * 137) * amplitude;
    total     += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / total;
}
