import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';

function disposeModel(model) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  model.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
    else if (object.material) materials.add(object.material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  const bitmaps = new Set([...textures].map(texture => texture.source.data));
  for (const bitmap of bitmaps) bitmap?.close?.();
}

export async function mountModelViewer(stage, item, { signal, onFailure }) {
  const response = await fetch(item.model, { signal });
  if (!response.ok) throw new Error('Model fetch failed');
  const { scene: model } = await new GLTFLoader().parseAsync(await response.arrayBuffer(), new URL('.', item.model).href);
  let renderer, controls, environment, observer;
  const canvas = document.createElement('canvas');
  const clean = () => {
    observer?.disconnect();
    controls?.dispose();
    disposeModel(model);
    environment?.dispose();
    canvas.removeEventListener('webglcontextlost', contextLost);
    canvas.remove();
    renderer?.dispose();
    renderer?.forceContextLoss();
    signal.removeEventListener('abort', clean);
  };
  const contextLost = event => {
    event.preventDefault();
    clean();
    onFailure();
  };
  try {
    signal.throwIfAborted();
    const bounds = new THREE.Box3().setFromObject(model);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) throw new Error('Model has no viewable bounds');

    canvas.className = 'reader-model-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', `${item.labelZh} 3D 模型。方向鍵旋轉，加減鍵縮放，Home 重設角度。`);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    renderer.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e6e3de');
    const studio = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    try {
      environment = pmrem.fromScene(studio, 0.045);
      scene.environment = environment.texture;
    } finally {
      studio.dispose();
      pmrem.dispose();
    }
    const centered = new THREE.Group();
    const normalize = 1 / sphere.radius;
    centered.scale.setScalar(normalize);
    centered.position.copy(sphere.center).multiplyScalar(-normalize);
    centered.add(model);
    scene.add(centered);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 60);
    controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.minDistance = 2.6;
    controls.maxDistance = 12;
    const dimensions = bounds.getSize(new THREE.Vector3());
    const sideAngle = dimensions.y < Math.min(dimensions.x, dimensions.z) * 0.35 ? 1.15 : 0.54;
    const viewDirection = new THREE.Vector3(...(item.modelView || [0.66, sideAngle, 1])).normalize();
    const render = () => renderer.render(scene, camera);
    const reset = () => {
      const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
      const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
      const distance = 1.05 / Math.sin(Math.min(vertical, horizontal));
      camera.position.copy(viewDirection).multiplyScalar(distance);
      controls.target.set(0, 0, 0);
      controls.update();
      render();
    };
    const size = () => {
      const { clientWidth, clientHeight } = stage;
      if (!clientWidth || !clientHeight) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight, false);
      reset();
    };
    controls.addEventListener('change', render);
    canvas.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const step = Math.PI / 18;
      const position = new THREE.Spherical().setFromVector3(camera.position);
      switch (event.key) {
        case 'ArrowLeft': position.theta -= step; break;
        case 'ArrowRight': position.theta += step; break;
        case 'ArrowUp': position.phi -= step; break;
        case 'ArrowDown': position.phi += step; break;
        case '+': case '=': position.radius /= 1.12; break;
        case '-': position.radius *= 1.12; break;
        case 'Home': event.preventDefault(); reset(); return;
        default: return;
      }
      event.preventDefault();
      camera.position.setFromSpherical(position.makeSafe());
      controls.update();
    }, { signal });
    canvas.addEventListener('webglcontextlost', contextLost);
    signal.addEventListener('abort', clean, { once: true });
    stage.append(canvas);
    size();
    observer = new ResizeObserver(size);
    observer.observe(stage);
    return { reset, canvas };
  } catch (error) {
    clean();
    throw error;
  }
}
