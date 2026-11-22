import * as THREE from '../vendor/three/three.module.min.js';

// Original optics are baked by scripts/bake-a24-optics.py. No per-pixel noise
// generation or PMREM render pass runs on the visitor's main thread.
const asset = name => new URL(`./textures/${name}`, import.meta.url).href;
const bounded = promise => {
  let timer;
  return Promise.race([promise, new Promise(resolve => { timer = setTimeout(resolve, 1800); })])
    .finally(() => clearTimeout(timer));
};

function loadMap(name, neutral, onChange) {
  // WebGL2 allocates immutable texture storage on first draw. Keep the fallback
  // at the baked dimensions so the later image replaces pixels, not storage.
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const context = canvas.getContext('2d'); context.fillStyle = neutral; context.fillRect(0, 0, 1024, 1024);
  const texture = new THREE.Texture(canvas);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8; texture.flipY = false; texture.needsUpdate = true;
  const image = new Image(); let disposed = false, settle;
  const ready = new Promise(resolve => { settle = resolve; });
  image.onload = () => {
    if (!disposed) { texture.image = image; texture.needsUpdate = true; canvas.width = canvas.height = 1; onChange(); }
    settle();
  };
  image.onerror = () => settle();
  texture.addEventListener('dispose', () => {
    disposed = true; image.onload = image.onerror = null; image.removeAttribute('src'); settle();
  });
  image.src = asset(name);
  return { texture, ready };
}

export function createCDSurfaceMaps(onChange = () => {}) {
  const entries = {
    texture: loadMap('cd-texture.webp', '#d6d6d6', onChange),
    normal: loadMap('cd-normal.webp', '#8080ff', onChange),
    frontNormal: loadMap('cd-frontNormal.webp', '#8080ff', onChange),
    frontRoughness: loadMap('cd-frontRoughness.webp', '#e5e5e5', onChange),
  };
  return { ...Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, value.texture])),
    ready: bounded(Promise.all(Object.values(entries).map(value => value.ready))) };
}

export function createCDEnvironment(_renderer, onChange = () => {}) {
  // Same 256px/cube-face CubeUV atlas produced by Three r180's PMREM generator.
  // A dim neutral atlas is usable immediately; late/failed requests never block
  // the artwork or navigation. The compressed payload preserves every f16 bit.
  const width = 768, height = 1024;
  const data = new Uint16Array(width * height * 4); data.fill(0x2400);
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mapping = THREE.CubeUVReflectionMapping; texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false; texture.flipY = false; texture.needsUpdate = true;
  let disposed = false; const abort = new AbortController();
  const ready = bounded(fetch(asset('cd-studio.cubeuv.bin.gz'), { signal: abort.signal })
    .then(response => {
      if (!response.ok) throw new Error('CD studio unavailable');
      return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }).then(buffer => {
      if (disposed || buffer.byteLength !== data.byteLength) return;
      texture.image.data = new Uint16Array(buffer); texture.needsUpdate = true; onChange();
    }).catch(() => {}));
  return { texture, ready, dispose() { disposed = true; abort.abort(); texture.dispose(); } };
}

export function createCDFrontMaterial(maps) {
  const print = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: .42, metalness: 0, toneMapped: false,
    specularIntensity: .45,
    roughnessMap: maps.frontRoughness, normalMap: maps.frontNormal, normalScale: new THREE.Vector2(.3, .3),
    clearcoat: .8, clearcoatRoughness: 0,
    clearcoatNormalMap: maps.frontNormal, clearcoatNormalScale: new THREE.Vector2(.3, .3),
    envMapIntensity: .32,
  });
  // The photograph is already graded for display. Keep its linear RGB as
  // the ink colour, with a small contribution from the shelf lighting. The
  // physical shader still supplies the textured reflection of the lacquer.
  print.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec3 litInk = totalDiffuse;
      #ifdef USE_CLEARCOAT
        litInk *= 1.0 - material.clearcoat * Fcc;
      #endif
      vec3 reflection = max(outgoingLight - litInk, vec3(0.0));
      vec3 ink = mix(diffuseColor.rgb, min(litInk, vec3(1.0)), 0.085);
      // Leave room for the coloured highlight even on white paint.
      outgoingLight = (ink + reflection) / (1.0 + max3(reflection));
      #include <opaque_fragment>
    `);
  };
  return print;
}

// Broad studio walls complement the small, bright panels in the baked map.
// Add their incident light at the environment lookup, before the physical
// BRDF, so the reflection follows the tilted surface and its etched normals.
function lightBareMetal(shader) {
  const environment = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
    'return envMapColor.rgb * envMapIntensity;',
    `// Project into a finite studio so the softbox crosses different parts
     // of the disc as it rotates, even when the camera is nearly head-on.
     vec3 surface = (cameraPosition - transpose(mat3(viewMatrix)) * vViewPosition) / 3.8;
     surface /= max(1.0, length(surface) / 0.90);
     float along = dot(surface, reflectVec);
     float distanceToWall = sqrt(1.0 - dot(surface, surface) + along * along) - along;
     vec3 wallDir = surface + distanceToWall * reflectVec;
     vec3 wall = (vec3(0.17, 0.18, 0.19) + 0.072 * wallDir.y) * trackFill;
     float across = dot(wallDir, normalize(vec3(0.65, 0.74, -0.12)));
     float window = exp2(-17.0 * across * across);
     float wrap = 0.35 + 0.65 * smoothstep(-0.55, 0.85, wallDir.z);
     float bounce = max(0.0, dot(wallDir, normalize(vec3(0.75, -0.32, -0.55))));
     wall += vec3(1.30, 1.37, 1.44) * window * wrap;
     wall += vec3(0.56, 0.49, 0.42) * bounce * bounce;
     return (envMapColor.rgb + wall) * envMapIntensity;`
  );
  shader.fragmentShader = shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>',
    'float trackFill = 1.0;\n' + environment);
}

export function createCDRimMaterial() {
  const rim = new THREE.MeshPhysicalMaterial({
    color: 0xd0d2d3, metalness: .42, roughness: .27, clearcoat: .24,
    clearcoatRoughness: .20, side: THREE.DoubleSide, envMapIntensity: .85,
  });
  rim.onBeforeCompile = lightBareMetal;
  return rim;
}

export function createCDHubMaterial() {
  const resin = new THREE.MeshPhysicalMaterial({
    color: 0x9a9d9b, metalness: 0, roughness: .16, ior: 1.58,
    transparent: true, depthWrite: false, envMapIntensity: .75,
  });
  // The paper behind the hole is below the transparent canvas. Composite
  // the resin over it (or over a neighbouring disc already in the depth pass).
  resin.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 hubXY;\nvarying vec3 hubRadialView;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        hubXY = position.xy;
        hubRadialView = mat3(modelViewMatrix) * vec3(position.xy, 0.0);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 hubXY;\nvarying vec3 hubRadialView;')
      .replace('#include <opaque_fragment>', `
      float r = length(hubXY);
      float aa = max(fwidth(r), .00015);
      // An injection mark has a pair of fine facets. Its bright and dark
      // arcs trade places as the disc turns under the fixed studio light.
      vec3 panel = normalize(mat3(viewMatrix) * vec3(-.72, .76, .32) + .42 * normalize(vViewPosition));
      float azimuth = dot(normalize(hubRadialView), panel);
      float key = smoothstep(-.62, .90, azimuth);
      float edge = 1.0 - smoothstep(.128, .132 + aa, r);
      float ridge = (1.0 - smoothstep(.0007, .0024 + aa, abs(r - .1575))) * min(1.0, .003 / aa);
      float shoulder = smoothstep(.1805 - aa, .1836, r) * (1.0 - smoothstep(.186, .188 + aa, r));
      float facet = max(edge, max(.72 * ridge, .82 * shoulder));
      float grazing = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
      float glint = min(.35, max3(reflectedLight.directSpecular + reflectedLight.indirectSpecular));
      float facetLight = mix(.065, 1.55, pow(mix(1.0 - key, key, edge), 1.6));
      outgoingLight = mix(outgoingLight, vec3(facetLight) * vec3(.98, 1.0, 1.015), facet);
      diffuseColor.a = clamp(.085 + .10 * (1.0 - key) + .37 * grazing * grazing + glint + .56 * facet, .08, .92);
      #include <opaque_fragment>
    `);
  };
  return resin;
}

export function createCDBackMaterial(maps) {
  const back = new THREE.MeshPhysicalMaterial({
    color: 0x9c9fa1, metalness: .94, roughness: .23, anisotropy: .16,
    roughnessMap: maps.texture, normalMap: maps.normal, normalScale: new THREE.Vector2(.86, .86),
    clearcoat: .18, clearcoatRoughness: .14,
    iridescence: .28, iridescenceIOR: 1.50, iridescenceThicknessRange: [360, 360],
    envMapIntensity: .84,
  });
  back.onBeforeCompile = shader => {
    lightBareMetal(shader);
    // Scatter along concentric tracks instead of along a single UV axis.
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `
      #include <lights_physical_fragment>
      vec2 radial = normalize(vNormalMapUv - 0.5);
      // The two flanks of each stamped track collect different amounts of
      // scattered room light. The normal map also filters this at a distance.
      trackFill += 2.25 * dot(mapN.xy, radial);
      material.anisotropyT = normalize(-radial.y * tbn[0] + radial.x * tbn[1]);
      material.anisotropyB = normalize(cross(normal, material.anisotropyT));
    `);
  };
  return back;
}
