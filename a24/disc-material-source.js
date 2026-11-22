import * as THREE from '../vendor/three/three.module.min.js';

// A local, HDR studio built from geometry. Its reflection is evaluated by the
// physical material for the actual surface normal; no glint is painted on art.
export function createCDEnvironment(renderer) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(.004, .0045, .005);
  const panels = [
    { size: [6, .12], position: [-1.2, 3.2, -5], color: [4, 6, 10] },
    { size: [1.5, 2.2], position: [-4, -2.5, -2], color: [.8, .73, .65] },
    { size: [.6, 5], position: [4, -.8, -.4], color: [.7, 1, 1.6] },
    { size: [4.5, 2], position: [0, -4, -2], color: [.12, .13, .15] },
    { size: [.6, 2.5], position: [-4, 3, 1], color: [1.5, 1.8, 1.6] },
  ];
  for (const panel of panels) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...panel.size),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(...panel.color), side: THREE.DoubleSide, toneMapped: false }));
    mesh.position.set(...panel.position); mesh.lookAt(0, 0, 0); studio.add(mesh);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(studio, .015, .1, 30);
  generator.dispose();
  for (const object of studio.children) { object.geometry.dispose(); object.material.dispose(); }
  return target;
}

function randomAt(x, y, salt) {
  let value = Math.imul(x + salt * 131, 374761393) + Math.imul(y + salt * 97, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

function dataTexture(data, size) {
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8; texture.flipY = true; texture.needsUpdate = true;
  return texture;
}

export function createCDSurfaceMaps() {
  const size = 1024;
  const backNormal = new Uint8Array(size * size * 4), frontNormal = new Uint8Array(backNormal.length);
  const roughness = new Uint8Array(backNormal.length), frontRoughness = new Uint8Array(backNormal.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5 - size * .5) / (size * .5), dy = (y + .5 - size * .5) / (size * .5);
    const r = Math.hypot(dx, dy), nx = dx / Math.max(.001, r), ny = dy / Math.max(.001, r);
    const g1 = randomAt(x, y, 1) * 2 - 1, g2 = randomAt(x, y, 2) * 2 - 1;
    // Resolvable grooves, with mipmaps for grazing views. The previous 2600-rad
    // normal field beat against the pixel grid and made a large coloured X.
    const groove = .17 * Math.sin(r * 920) + .045 * Math.sin(r * 461);
    const offset = (y * size + x) * 4;
    for (const [pixels, grain, etched] of [[backNormal, .04, groove], [frontNormal, .08, groove * .5]]) {
      const xx = nx * etched + g1 * grain, yy = ny * etched + g2 * grain;
      const zz = Math.sqrt(Math.max(.01, 1 - xx * xx - yy * yy));
      pixels[offset] = 127.5 + xx * 127.5; pixels[offset + 1] = 127.5 + yy * 127.5;
      pixels[offset + 2] = 127.5 + zz * 127.5; pixels[offset + 3] = 255;
    }
    for (const [pixels, level] of [[roughness, .79 + .1 * randomAt(x, y, 3)], [frontRoughness, .84 + .13 * randomAt(x, y, 4)]]) {
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = level * 255; pixels[offset + 3] = 255;
    }
  }
  return { texture: dataTexture(roughness, size), normal: dataTexture(backNormal, size),
    frontNormal: dataTexture(frontNormal, size), frontRoughness: dataTexture(frontRoughness, size) };
}
