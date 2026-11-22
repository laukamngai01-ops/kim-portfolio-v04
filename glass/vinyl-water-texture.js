import * as THREE from '../vendor/three/three.module.min.js';

// XY [-1,1] maps directly to UV [0,1], with positive Y towards texture row N.
// R: compact particle density / 1.6. G: a wider low-pass of that same density.
// B: a motion-deposited film / .05 nominal chamber depths. A is 255.
// A sealed thin chamber has almost constant depth: distance into the pool is
// deliberately NOT interpreted as thickness. All channels are linear data.
// The texture owns no solver, clock, level, tilt, waves, or decorative bubbles.
export function createWaterTexture() {
  const size = 128;
  const densityScale = 1.6;
  const texelWorld = 2 / size;
  const texels = size * size;
  const density = new Float32Array(texels);
  const previousDensity = new Float32Array(texels);
  const horizontal = new Float32Array(texels);
  const film = new Float32Array(texels);
  const transportedFilm = new Float32Array(texels);
  const bytes = new Uint8Array(texels * 4);
  const radiusAt = new Float32Array(texels);
  const tableSize = 1024;
  const kernel = new Float32Array(tableSize + 1);
  for (let i = 0; i <= tableSize; i++) kernel[i] = (1 - i / tableSize) ** 3;
  for (let row = 0; row < size; row++) {
    const y = (row + .5) * texelWorld - 1;
    for (let column = 0; column < size; column++) {
      const x = (column + .5) * texelWorld - 1;
      radiusAt[row * size + column] = Math.hypot(x, y);
      bytes[(row * size + column) * 4 + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'Vinyl / particle water density';
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const stats = texture.userData.waterField = {
    size, densityScale, support: .105, count: 0, maxDensity: 0, filledTexels: 0,
    chamberRadius: .95, holeRadius: .055, updates: 0,
    filmMax: 0, exposedFilmMax: 0, exposedFilmTexels: 0, active: false,
    channels: 'R=density/1.6, G=smoothed density/1.6, B=historical film/.05, A=255',
  };
  const clamp01 = value => Math.max(0, Math.min(1, value));

  function update(water, dt = 0, gx = 0, gy = -7.8) {
    const x = water?.x, y = water?.y;
    const requested = Number.isFinite(water?.count) ? Math.max(0, Math.trunc(water.count)) : 0;
    const count = x && y ? Math.min(requested, x.length, y.length) : 0;
    const spacing = Number.isFinite(water?.spacing) && water.spacing > 0 ? water.spacing : .06;
    const support = spacing * 1.75;
    const supportSquared = support * support;
    // Integral of (1-r²/h²)^3 over its disk is PI*h²/4. Normalize by
    // triangular-lattice particle area, so settled interior density is ~1.
    const particleArea = spacing * spacing * Math.sqrt(3) / 2;
    const peak = 4 * particleArea / (Math.PI * supportSquared);
    const chamber = Number.isFinite(water?.chamberRadius) ? water.chamberRadius : .95;
    const hole = Number.isFinite(water?.holeRadius) ? water.holeRadius : .055;
    density.fill(0);
    let validCount = 0;
    for (let particle = 0; particle < count; particle++) {
      const px = x[particle], py = y[particle];
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      validCount++;
      const left = Math.max(0, Math.ceil((px - support + 1) / texelWorld - .5));
      const right = Math.min(size - 1, Math.floor((px + support + 1) / texelWorld - .5));
      const bottom = Math.max(0, Math.ceil((py - support + 1) / texelWorld - .5));
      const top = Math.min(size - 1, Math.floor((py + support + 1) / texelWorld - .5));
      for (let row = bottom; row <= top; row++) {
        const dy = (row + .5) * texelWorld - 1 - py;
        const dySquared = dy * dy;
        let at = row * size + left;
        for (let column = left; column <= right; column++, at++) {
          const dx = (column + .5) * texelWorld - 1 - px;
          const squared = dx * dx + dySquared;
          if (squared >= supportSquared) continue;
          const lookup = squared / supportSquared * tableSize;
          const low = Math.floor(lookup);
          const weight = kernel[low] + (kernel[low + 1] - kernel[low]) * (lookup - low);
          density[at] += weight * peak;
        }
      }
    }
    let maximum = 0, filled = 0;
    for (let at = 0; at < texels; at++) {
      // Only clip to the solver's physical chamber and spindle. This does not
      // impose a liquid height or connect separated splashes artificially.
      const wall = clamp01((chamber - radiusAt[at]) / texelWorld + .5);
      const spindle = clamp01((radiusAt[at] - hole) / texelWorld + .5);
      const value = density[at] *= wall * spindle;
      maximum = Math.max(maximum, value);
      if (value >= .18) filled++;
      bytes[at * 4] = Math.round(clamp01(value / densityScale) * 255);
    }
    // Separable [1,4,6,4,1]/16 at two-texel spacing. R retains the actual
    // free surface and individual drops; G smooths optical variation inside it.
    for (let row = 0; row < size; row++) {
      const base = row * size;
      for (let column = 0; column < size; column++) {
        horizontal[base + column] = (
          density[base + Math.max(0, column - 4)]
          + density[base + Math.max(0, column - 2)] * 4
          + density[base + column] * 6
          + density[base + Math.min(size - 1, column + 2)] * 4
          + density[base + Math.min(size - 1, column + 4)]
        ) / 16;
      }
    }
    for (let row = 0; row < size; row++) {
      const rowA = Math.max(0, row - 4) * size, rowB = Math.max(0, row - 2) * size;
      const rowC = row * size, rowD = Math.min(size - 1, row + 2) * size, rowE = Math.min(size - 1, row + 4) * size;
      for (let column = 0; column < size; column++) {
        const value = (horizontal[rowA + column] + horizontal[rowB + column] * 4
          + horizontal[rowC + column] * 6 + horizontal[rowD + column] * 4 + horizontal[rowE + column]) / 16;
        bytes[(rowC + column) * 4 + 1] = Math.round(clamp01(value / densityScale) * 255);
      }
    }
    // Optical residue can only be deposited where real bulk particles were.
    // A reset/teleport must clear it. During motion it is transported slowly
    // along projected gravity, then drains; it never changes R or joins drops.
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, .1)) : 0;
    if (!dt) film.fill(0);
    else {
      gx = Number.isFinite(gx) ? gx : 0;
      gy = Number.isFinite(gy) ? gy : -7.8;
      const speedScale = .0012 * dt / texelWorld;
      const offsetX = Math.max(-.5, Math.min(.5, gx * speedScale));
      const offsetY = Math.max(-.5, Math.min(.5, gy * speedScale));
      const drainage = Math.exp(-dt / 1.5);
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          const sx = Math.max(0, Math.min(size - 1.001, column - offsetX));
          const sy = Math.max(0, Math.min(size - 1.001, row - offsetY));
          const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
          const a = y0 * size + x0, b = a + size;
          const above = film[a] + (film[a + 1] - film[a]) * fx;
          const below = film[b] + (film[b + 1] - film[b]) * fx;
          const at = row * size + column;
          let residue = (above + (below - above) * fy) * drainage;
          // Deposit only on a genuine receding contact line. Refilling every
          // stationary bulk cell would continuously leak/advection-shed film
          // and keep the scene active forever, despite motion having stopped.
          if (density[at] >= .18) residue = 0;
          else if (previousDensity[at] >= .18) residue = .05;
          if (radiusAt[at] >= chamber || radiusAt[at] <= hole) residue = 0;
          transportedFilm[at] = residue < .00015 ? 0 : residue;
        }
      }
      film.set(transportedFilm);
    }
    let filmMax = 0, exposedFilmMax = 0, exposedFilmTexels = 0;
    for (let at = 0; at < texels; at++) {
      const value = film[at];
      filmMax = Math.max(filmMax, value);
      if (density[at] < .18) {
        exposedFilmMax = Math.max(exposedFilmMax, value);
        if (value > .0025) exposedFilmTexels++;
      }
      bytes[at * 4 + 2] = Math.round(clamp01(value / .05) * 255);
    }
    previousDensity.set(density);
    stats.count = validCount; stats.maxDensity = maximum; stats.filledTexels = filled;
    stats.support = support; stats.chamberRadius = chamber; stats.holeRadius = hole;
    stats.filmMax = filmMax; stats.exposedFilmMax = exposedFilmMax;
    stats.exposedFilmTexels = exposedFilmTexels; stats.active = exposedFilmMax > .0025;
    stats.updates++;
    texture.needsUpdate = true;
    return stats;
  }

  // The caller owns texture.dispose(), normally through its ownTexture helper.
  return { texture, update, get active() { return stats.active; } };
}
