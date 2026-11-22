// A small, genuine 2D position-based fluid. There is no prescribed surface,
// height field, wave animation, or particle-to-shape target in this module.
// Density constraints follow Macklin / Müller, Position Based Fluids (2013):
// https://mmacklin.com/pbf_sig_preprint.pdf . This is an independent 2D kernel
// implementation, with unilateral pressure, a neighbor grid, and XSPH viscosity.

const CHAMBER = .95;
const HOLE = .055;
const SPACING = .06;
const RADIUS = .024; // collision radius, NOT the recommended render support
const OUTER = CHAMBER - RADIUS;
const INNER = HOLE + RADIUS;
const H = SPACING * 2.2;
const H2 = H * H;
const INV_H = 1 / H;
const NEIGHBOR_RANGE = H * 1.45;
const NEIGHBOR_RANGE2 = NEIGHBOR_RANGE * NEIGHBOR_RANGE;
const GRID_WIDTH = Math.ceil(2.1 / NEIGHBOR_RANGE);
const MAX_NEIGHBORS = 96;
const MAX_DT = 1 / 20;
const SUB_DT = 1 / 120;
const ITERATIONS = 4;
const MAX_CORRECTION = H * .1;
const MAX_SPEED = 5;
// A record is a shallow sealed gap between two plates, not an open deep pool.
// Plate drag dissipates bulk flow; XSPH below dissipates relative/shear motion.
const PLATE_DRAG = 4.6;
const OIL_VISCOSITY = .18;
const WALL_LAYER = .12;
const WALL_DRAG = 180;
const EPSILON = 45;
// Immutable rest pose is warmed once for all records, then rotated on reset.
let cachedRestX = null;
let cachedRestY = null;
const finite = value => Number.isFinite(value) ? value : 0;
const bound = (value, limit) => Math.max(-limit, Math.min(limit, finite(value)));

function restDensity() {
  // Calibrate against the very same hexagonal spacing and kernel, including self.
  let density = 0;
  for (let row = -3; row <= 3; row++) {
    for (let col = -3; col <= 3; col++) {
      const x = (col + (row & 1) * .5) * SPACING;
      const y = row * SPACING * Math.sqrt(3) / 2;
      const q = 1 - Math.hypot(x, y) * INV_H;
      if (q > 0) density += q * q;
    }
  }
  return density;
}

/**
 * Coordinates are local disc XY, in disc radii. x/y/vx/vy remain the same typed
 * arrays for the solver's lifetime. spacing=.06; radius=.024 is for collisions;
 * a renderer can use compact splat support around 1.75 * spacing.
 *
 * step(dt,gx,gy,alphaZ,wz,wx=0,wy=0): acceleration is radii/s² (gravity normally
 * ~5), angular acceleration rad/s², angular velocity rad/s. Gravity magnitude is
 * retained. Host translation inertia belongs in gx/gy, with the appropriate sign.
 * Returns true only when positions have been advanced. A sleeping solver wakes
 * on changed forces; it is safe to call step every frame or stop requesting RAF
 * while sleeping and call it again on the next input. No timers / DOM / Three.
 */
export function createVinylWater({ seed = 173 } = {}) {
  const initialX = [];
  const initialY = [];
  const rowHeight = SPACING * Math.sqrt(3) / 2;
  for (let row = -Math.ceil(OUTER / rowHeight); row <= 0; row++) {
    const y = (row + .5) * rowHeight;
    if (y > 0) continue;
    for (let col = -Math.ceil(OUTER / SPACING); col <= Math.ceil(OUTER / SPACING); col++) {
      const x = (col + (row & 1) * .5) * SPACING;
      const r = Math.hypot(x, y);
      if (r <= OUTER && r >= INNER) { initialX.push(x); initialY.push(y); }
    }
  }
  const count = initialX.length;
  // Fixed boundary samples supply the density missing behind solid walls.
  // They carry no fluid mass and are never returned to the renderer. Without
  // them a pressure solver can stack/compress fluid along the circular floor.
  const wallX = [], wallY = [];
  for (let layer = 0; layer < 3; layer++) {
    const r = CHAMBER + RADIUS + layer * rowHeight;
    const samples = Math.round(2 * Math.PI * r / SPACING);
    for (let i = 0; i < samples; i++) {
      const angle = (i + (layer & 1) * .5) / samples * Math.PI * 2;
      wallX.push(Math.cos(angle) * r); wallY.push(Math.sin(angle) * r);
    }
  }
  wallX.push(0); wallY.push(0);
  for (let i = 0; i < 6; i++) {
    const angle = i / 6 * Math.PI * 2;
    wallX.push(Math.cos(angle) * (HOLE - RADIUS));
    wallY.push(Math.sin(angle) * (HOLE - RADIUS));
  }
  const totalCount = count + wallX.length;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const px = new Float32Array(totalCount);
  const py = new Float32Array(totalCount);
  for (let i = 0; i < wallX.length; i++) { px[count + i] = wallX[i]; py[count + i] = wallY[i]; }
  const lambda = new Float32Array(count);
  const dx = new Float32Array(count);
  const dy = new Float32Array(count);
  const head = new Int16Array(GRID_WIDTH * GRID_WIDTH);
  const next = new Int16Array(totalCount);
  const neighbors = new Int16Array(count * MAX_NEIGHBORS);
  const pairGradient = new Float32Array(count * MAX_NEIGHBORS);
  const pairRepulsion = new Float32Array(count * MAX_NEIGHBORS);
  const neighborCount = new Uint8Array(count);
  const rho0 = restDensity();
  const invRho = 1 / rho0;
  let asleep = false;
  let quietTime = 0;
  let elapsed = 0;
  let remainder = 0;
  let lastGX = 0, lastGY = -5, lastAlpha = 0, lastWZ = 0, lastWX = 0, lastWY = 0;
  const metrics = { rmsSpeed: 0, maxSpeed: 0, kineticEnergy: 0, centreX: 0, centreY: 0,
    maxCompression: 0, neighborOverflow: 0, simulatedTime: 0, substeps: 0 };

  function cell(value) {
    return Math.max(0, Math.min(GRID_WIDTH - 1, Math.floor((value + 1.05) / NEIGHBOR_RANGE)));
  }

  function buildNeighbors() {
    head.fill(-1);
    for (let i = 0; i < totalCount; i++) {
      const key = cell(px[i]) + cell(py[i]) * GRID_WIDTH;
      next[i] = head[key];
      head[key] = i;
    }
    for (let i = 0; i < count; i++) {
      const cx = cell(px[i]), cy = cell(py[i]);
      let n = 0;
      for (let yy = Math.max(0, cy - 1); yy <= Math.min(GRID_WIDTH - 1, cy + 1); yy++) {
        for (let xx = Math.max(0, cx - 1); xx <= Math.min(GRID_WIDTH - 1, cx + 1); xx++) {
          for (let j = head[xx + yy * GRID_WIDTH]; j !== -1; j = next[j]) {
            if (j === i) continue;
            const rx = px[i] - px[j], ry = py[i] - py[j];
            if (rx * rx + ry * ry < NEIGHBOR_RANGE2) {
              if (n < MAX_NEIGHBORS) neighbors[i * MAX_NEIGHBORS + n++] = j;
              else metrics.neighborOverflow++;
            }
          }
        }
      }
      neighborCount[i] = n;
    }
  }

  function confine(i) {
    const r2 = px[i] * px[i] + py[i] * py[i];
    if (r2 > OUTER * OUTER) {
      const scale = (OUTER - 1e-7) / Math.sqrt(r2);
      px[i] *= scale; py[i] *= scale;
    } else if (r2 < INNER * INNER) {
      if (r2 > 1e-12) {
        const scale = (INNER + 1e-7) / Math.sqrt(r2);
        px[i] *= scale; py[i] *= scale;
      } else { px[i] = INNER + 1e-7; py[i] = 0; }
    }
  }

  function substep(dt, gx, gy, alpha, wz, wx, wy, warming = false) {
    // In the centre plane: -alpha×r, -omega×(omega×r), -2omega×v.
    const centrifugalX = wy * wy + wz * wz;
    const centrifugalY = wx * wx + wz * wz;
    const cross = wx * wy;
    for (let i = 0; i < count; i++) {
      const ax = gx + alpha * y[i] + centrifugalX * x[i] - cross * y[i] + 2 * wz * vy[i];
      const ay = gy - alpha * x[i] + centrifugalY * y[i] - cross * x[i] - 2 * wz * vx[i];
      vx[i] += ax * dt; vy[i] += ay * dt;
      const speed2 = vx[i] * vx[i] + vy[i] * vy[i];
      if (speed2 > MAX_SPEED * MAX_SPEED) {
        const scale = MAX_SPEED / Math.sqrt(speed2);
        vx[i] *= scale; vy[i] *= scale;
      }
      px[i] = x[i] + vx[i] * dt;
      py[i] = y[i] + vy[i] * dt;
      // Swept collision stops fast particles tunneling through the central bore.
      const moveX = px[i] - x[i], moveY = py[i] - y[i];
      const travel2 = moveX * moveX + moveY * moveY;
      const toward = x[i] * moveX + y[i] * moveY;
      if (travel2 > 1e-12 && toward < 0) {
        const discriminant = toward * toward - travel2 * (x[i] * x[i] + y[i] * y[i] - INNER * INNER);
        if (discriminant > 0) {
          const hit = (-toward - Math.sqrt(discriminant)) / travel2;
          if (hit >= 0 && hit < 1) {
            const hitX = x[i] + moveX * hit, hitY = y[i] + moveY * hit;
            const nx = hitX / INNER, ny = hitY / INNER;
            const remainX = moveX * (1 - hit), remainY = moveY * (1 - hit);
            const inward = Math.min(0, remainX * nx + remainY * ny);
            px[i] = hitX + remainX - inward * nx;
            py[i] = hitY + remainY - inward * ny;
          }
        }
      }
      confine(i);
    }
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      // Rebuild midway as well: violent reversals cannot keep a stale neighbor set.
      if ((iteration & 1) === 0) buildNeighbors();
      let maxCompression = 0;
      for (let i = 0; i < count; i++) {
        let density = 1, sumGX = 0, sumGY = 0, sumGradient2 = 0;
        const offset = i * MAX_NEIGHBORS;
        for (let n = 0; n < neighborCount[i]; n++) {
          const j = neighbors[offset + n];
          const rx = px[i] - px[j], ry = py[i] - py[j];
          const r2 = rx * rx + ry * ry;
          if (r2 >= H2 || r2 < 1e-12) {
            pairGradient[offset + n] = pairRepulsion[offset + n] = 0;
            continue;
          }
          const r = Math.sqrt(r2), q = 1 - r * INV_H;
          density += q * q;
          const gradient = -2 * q * INV_H * invRho / r;
          pairGradient[offset + n] = gradient;
          pairRepulsion[offset + n] = j < count && r < SPACING * .65 ? (SPACING * .65 - r) * .17 / r : 0;
          const gradX = gradient * rx, gradY = gradient * ry;
          sumGX += gradX; sumGY += gradY;
          if (j < count) sumGradient2 += gradX * gradX + gradY * gradY;
        }
        // An under-dense free surface is allowed to separate. Negative pressure
        // would instead pull sparse particles into an artificial elastic blob.
        const compression = Math.max(0, density * invRho - 1);
        lambda[i] = -compression / (sumGradient2 + sumGX * sumGX + sumGY * sumGY + EPSILON);
        if (compression > maxCompression) maxCompression = compression;
      }
      metrics.maxCompression = maxCompression;
      for (let i = 0; i < count; i++) {
        let correctionX = 0, correctionY = 0;
        const offset = i * MAX_NEIGHBORS;
        for (let n = 0; n < neighborCount[i]; n++) {
          const j = neighbors[offset + n];
          const rx = px[i] - px[j], ry = py[i] - py[j];
          const pressure = lambda[i] + (j < count ? lambda[j] : 0);
          // Symmetric short-range anti-clumping; it does not tie neighbors or
          // define a surface, and vanishes before the normal particle spacing.
          const correction = pressure * pairGradient[offset + n] + pairRepulsion[offset + n];
          correctionX += rx * correction; correctionY += ry * correction;
        }
        const length2 = correctionX * correctionX + correctionY * correctionY;
        if (length2 > MAX_CORRECTION * MAX_CORRECTION) {
          const scale = MAX_CORRECTION / Math.sqrt(length2);
          correctionX *= scale; correctionY *= scale;
        }
        dx[i] = correctionX; dy[i] = correctionY;
      }
      // Jacobi update: every pair observes the same position snapshot.
      for (let i = 0; i < count; i++) { px[i] += dx[i]; py[i] += dy[i]; confine(i); }
    }
    for (let i = 0; i < count; i++) {
      vx[i] = (px[i] - x[i]) / dt;
      vy[i] = (py[i] - y[i]) / dt;
      const r = Math.hypot(px[i], py[i]);
      if (r >= OUTER - .0001 || r <= INNER + .0001) {
        const nx = px[i] / r, ny = py[i] / r;
        const normalSpeed = vx[i] * nx + vy[i] * ny;
        if ((r >= OUTER - .0001 && normalSpeed > 0) || (r <= INNER + .0001 && normalSpeed < 0)) {
          vx[i] -= normalSpeed * nx * 1.01;
          vy[i] -= normalSpeed * ny * 1.01;
        }
        const contactDrag = Math.exp(-1.8 * dt);
        vx[i] *= contactDrag; vy[i] *= contactDrag;
      }
    }
    // Scale shear diffusion with elapsed time; a 240 Hz display must not make
    // the same oil twice as viscous as a 120 Hz one.
    const viscosity = (warming ? .045 : OIL_VISCOSITY) * Math.min(1, dt / SUB_DT);
    for (let i = 0; i < count; i++) {
      let sx = 0, sy = 0;
      const offset = i * MAX_NEIGHBORS;
      for (let n = 0; n < neighborCount[i]; n++) {
        const j = neighbors[offset + n];
        if (j >= count) continue;
        const rx = px[i] - px[j], ry = py[i] - py[j];
        const r2 = rx * rx + ry * ry;
        if (r2 >= H2) continue;
        const q = 1 - Math.sqrt(r2) * INV_H;
        sx += (vx[j] - vx[i]) * q * q;
        sy += (vy[j] - vy[i]) * q * q;
      }
      dx[i] = sx * viscosity; dy[i] = sy * viscosity;
    }
    const damping = warming ? .96 : Math.exp(-PLATE_DRAG * dt);
    for (let i = 0; i < count; i++) {
      vx[i] = (vx[i] + dx[i]) * damping;
      vy[i] = (vy[i] + dy[i]) * damping;
      // A finite near-wall viscous layer slows tangential drainage. It is a
      // velocity drag, not a spring, positional pin, or prescribed film shape.
      // Interior liquid can roll past the slower wall layer and form heavy folds.
      const distance = Math.hypot(px[i], py[i]);
      const wallWeight = Math.max(0, 1 - (OUTER - distance) / WALL_LAYER);
      if (!warming && wallWeight > 0) {
        const nx = px[i] / distance, ny = py[i] / distance;
        const tangent = -ny * vx[i] + nx * vy[i];
        const wallDrag = Math.exp(-WALL_DRAG * wallWeight * wallWeight * dt);
        vx[i] -= ny * tangent * (wallDrag - 1);
        vy[i] += nx * tangent * (wallDrag - 1);
      }
      const speed2 = vx[i] * vx[i] + vy[i] * vy[i];
      if (speed2 > MAX_SPEED * MAX_SPEED) {
        const scale = MAX_SPEED / Math.sqrt(speed2);
        vx[i] *= scale; vy[i] *= scale;
      }
      x[i] = px[i]; y[i] = py[i];
    }
  }

  function measure() {
    let speed2 = 0, maxSpeed2 = 0, sumX = 0, sumY = 0;
    for (let i = 0; i < count; i++) {
      const v2 = vx[i] * vx[i] + vy[i] * vy[i];
      speed2 += v2; maxSpeed2 = Math.max(maxSpeed2, v2);
      sumX += x[i]; sumY += y[i];
    }
    metrics.rmsSpeed = Math.sqrt(speed2 / count);
    metrics.maxSpeed = Math.sqrt(maxSpeed2);
    metrics.kineticEnergy = speed2 / (2 * count); // unit total mass
    metrics.centreX = sumX / count; metrics.centreY = sumY / count;
    metrics.simulatedTime = elapsed;
  }

  function step(dt, gx = 0, gy = -5, alphaZ = 0, wz = 0, wx = 0, wy = 0) {
    dt = Math.max(0, Math.min(MAX_DT, finite(dt)));
    if (!dt) return false;
    // Only pathological input is capped; a tilt never normalizes projected g.
    gx = bound(gx, 120); gy = bound(gy, 120);
    alphaZ = bound(alphaZ, 200); wz = bound(wz, 20); wx = bound(wx, 20); wy = bound(wy, 20);
    const changed = Math.abs(gx - lastGX) + Math.abs(gy - lastGY)
      + Math.abs(alphaZ - lastAlpha) * .05 + Math.abs(wz - lastWZ)
      + Math.abs(wx - lastWX) + Math.abs(wy - lastWY) > .015;
    // Accumulate small changes while asleep instead of losing them each frame.
    if (asleep && !changed) return false;
    if (changed) { asleep = false; quietTime = 0; }
    lastGX = gx; lastGY = gy; lastAlpha = alphaZ; lastWZ = wz; lastWX = wx; lastWY = wy;
    // Fixed physics ticks prevent variable-frame pressure projections from
    // continually injecting tiny velocity pulses into otherwise settled oil.
    // Rendering may run faster or slower; only whole 120 Hz ticks advance mass.
    const accumulated = remainder + dt;
    const steps = Math.min(6, Math.floor(accumulated / SUB_DT + 1e-9));
    remainder = Math.max(0, accumulated - steps * SUB_DT);
    if (!steps) { metrics.substeps = 0; return false; }
    const simulated = steps * SUB_DT;
    metrics.neighborOverflow = 0;
    for (let s = 0; s < steps; s++) substep(SUB_DT, gx, gy, alphaZ, wz, wx, wy);
    elapsed += simulated;
    metrics.substeps = steps;
    measure();
    // Slow oil is not already at rest. Let the wall layer finish draining before
    // sleep instead of freezing a low-speed fold with the former water threshold.
    if (!changed && metrics.rmsSpeed < .008 && metrics.maxSpeed < .045) quietTime += simulated;
    else quietTime = 0;
    if (quietTime > 1) { vx.fill(0); vy.fill(0); asleep = true; measure(); }
    return true;
  }

  function reset(upX = 0, upY = 1) {
    upX = finite(upX); upY = finite(upY);
    const length = Math.hypot(upX, upY);
    upX = length > 1e-6 ? upX / length : 0;
    upY = length > 1e-6 ? upY / length : 1;
    let randomSeed = 173;
    const random = () => ((randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0) / 4294967296);
    if (!cachedRestX) {
      for (let i = 0; i < count; i++) {
        x[i] = initialX[i] + (random() - .5) * SPACING * .025;
        y[i] = initialY[i] + (random() - .5) * SPACING * .025;
      }
      vx.fill(0); vy.fill(0);
      // Settle actual particles once, not a drawn line or precomputed animation.
      for (let i = 0; i < 90; i++) substep(SUB_DT, 0, -5, 0, 0, 0, 0, true);
      cachedRestX = x.slice(); cachedRestY = y.slice();
    }
    randomSeed = (Number(seed) || 173) >>> 0;
    for (let i = 0; i < count; i++) {
      const jitterX = (random() - .5) * SPACING * .003;
      const jitterY = (random() - .5) * SPACING * .003;
      px[i] = (cachedRestX[i] + jitterX) * upY + (cachedRestY[i] + jitterY) * upX;
      py[i] = -(cachedRestX[i] + jitterX) * upX + (cachedRestY[i] + jitterY) * upY;
      confine(i);
      x[i] = px[i]; y[i] = py[i];
    }
    vx.fill(0); vy.fill(0);
    elapsed = quietTime = remainder = 0;
    lastGX = -5 * upX; lastGY = -5 * upY;
    lastAlpha = lastWZ = lastWX = lastWY = 0;
    asleep = true;
    metrics.neighborOverflow = 0; metrics.substeps = 0;
    measure();
  }

  reset();
  return {
    x, y, vx, vy, count, spacing: SPACING, radius: RADIUS,
    chamberRadius: CHAMBER, holeRadius: HOLE, kernelRadius: H,
    step, reset,
    get sleeping() { return asleep; },
    stats() { return { ...metrics, sleeping: asleep, count, restDensity: rho0 }; },
  };
}
