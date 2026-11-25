import * as THREE from '../vendor/three/three.module.min.js';
import { createCDEnvironment, createCDSurfaceMaps, createCDFrontMaterial, createCDBackMaterial, createCDRimMaterial, createCDHubMaterial } from './disc-material.js';
import { createShelfHandoff } from './shelf-handoff.js';

// Original geometry and textures. The camera and shelf proportions were measured
// from the public A24 tribute; no reference artwork, model or source is shipped.
const PI = Math.PI;
const DEG = PI / 180;
const BORE_RADIUS = .125;
const PRINT_INNER_RADIUS = .188;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const imagePromises = new Map();
const imageURL = entry => entry.discPrint ?? entry.poster ?? entry.item?.image ?? entry.item?.small ?? entry.project?.cover;
const entryKey = entry => entry.key ?? entry.id ?? imageURL(entry);

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (!imagePromises.has(url)) imagePromises.set(url, new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => { imagePromises.delete(url); resolve(null); };
    image.src = url;
  }));
  return imagePromises.get(url);
}

/** Same authored print for the scene and the lightweight UP NEXT preview. */
export async function createDiscArtwork(entry, { size = 1024 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = await loadImage(imageURL(entry));
  const center = size / 2;
  context.save();
  context.beginPath(); context.arc(center, center, center, 0, PI * 2); context.clip();
  context.fillStyle = '#dadbd8'; context.fillRect(0, 0, size, size);
  if (image) {
    const scale = size / Math.min(image.naturalWidth, image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  }
  context.restore();
  context.globalCompositeOperation = 'destination-out';
  context.beginPath(); context.arc(center, center, center * BORE_RADIUS, 0, PI * 2); context.fill();
  context.globalCompositeOperation = 'source-over';
  return canvas;
}

function annulus(inner, outer, segments = 192) {
  const geometry = new THREE.RingGeometry(inner, outer, segments, 1);
  const positions = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) uv.setXY(i, positions.getX(i) * .5 + .5, positions.getY(i) * .5 + .5);
  return geometry;
}

function pressedHubGeometry() {
  // Revolve the section from the print edge across the face, around the open
  // bore and back underneath. Only the narrow moulding ridge rises above it.
  const face = [
    [PRINT_INNER_RADIUS, .0056], [.185, .0056], [.183, .0047], [.181, .0056],
    [.161, .0056], [.1585, .0068], [.156, .0056],
    [.130, .0056], [.127, .0045], [BORE_RADIUS, .0026],
  ];
  const underside = face.slice().reverse().map(([radius, z]) => [radius, -z]);
  const profile = [...face, ...underside].map(([radius, z]) => new THREE.Vector2(radius, z));
  return new THREE.LatheGeometry(profile, 192).rotateX(PI / 2);
}

function studioEnvironment(renderer, onChange) {
  return createCDEnvironment(renderer, onChange);
}

function opticalMaps(onChange) {
  return createCDSurfaceMaps(onChange);
}

const OUTLINE_STEP_MS = 100;
const OUTLINE_SEGMENTS = 72;

function outlineGeometry(radius, seed) {
  const geometry = new THREE.BufferGeometry(), indices = [];
  const position = new THREE.BufferAttribute(new Float32Array((OUTLINE_SEGMENTS + 1) * 6), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  for (let i = 0; i < OUTLINE_SEGMENTS; i++) {
    const j = i * 2; indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
  }
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.18);
  geometry.userData.stroke = { radius, seed };
  return geometry;
}

// Each exposure is a freshly drawn, open pen stroke. The 10 Hz cadence and
// changing arc extent are intentional; the disc itself still animates smoothly.
function updateOutlineGeometry(geometry, exposure, extent) {
  const { radius, seed } = geometry.userData.stroke;
  const random = channel => {
    let n = Math.imul(exposure + seed * 131 + channel * 977, 0x45d9f3b);
    n = Math.imul(n ^ n >>> 16, 0x45d9f3b);
    return ((n ^ n >>> 16) >>> 0) / 4294967296;
  };
  const start = random(1) * PI * 2;
  const sweep = (3.45 + random(2) * 1.68) * extent;
  const p1 = random(3) * PI * 2, p2 = random(4) * PI * 2, p3 = random(5) * PI * 2;
  const attribute = geometry.attributes.position, positions = attribute.array;
  for (let i = 0; i <= OUTLINE_SEGMENTS; i++) {
    const s = i / OUTLINE_SEGMENTS, angle = start + sweep * s;
    const r = radius + .015 * Math.sin(angle * 3 + p1) + .013 * Math.sin(angle * 7 + p2) + .006 * Math.sin(angle * 11 + p3);
    const tip = clamp(Math.min(s, 1 - s) / .05, 0, 1);
    const halfWidth = .006 * tip * tip * (3 - 2 * tip);
    const x = Math.cos(angle), y = Math.sin(angle), offset = i * 6;
    positions[offset] = x * (r - halfWidth); positions[offset + 1] = y * (r - halfWidth); positions[offset + 2] = 0;
    positions[offset + 3] = x * (r + halfWidth); positions[offset + 4] = y * (r + halfWidth); positions[offset + 5] = 0;
  }
  attribute.needsUpdate = true;
}

export function mountStage(host, {
  entries: initialEntries = [], initialIndex = 0, onSelect = () => {},
  onOpen = () => {}, onError = () => {}, onLoad = () => {}, reducedMotion,
} = {}) {
  let entries = [...initialEntries], selected = clamp(initialIndex, 0, Math.max(0, entries.length - 1));
  let destroyed = false, paused = false, contextLost = false;
  let width = 1, height = 1, narrow = false, frame = 0, lastTime = 0;
  let position = selected, targetPosition = selected, detailTarget = 0;
  const handoff = createShelfHandoff();
  // Neighbouring records travel together away from the viewer along the
  // tilted shelf normal, including records to the left of the selection.
  const departureAxis = new THREE.Vector3(.5, -Math.sqrt(3) / 4, -.75);
  const departureTurn = new THREE.Quaternion();
  const turnAxis = new THREE.Vector3(0, 1, 0);
  let pointer = null, hoverPoint = null, hoverDirty = false, hoverIndex = -1;
  let wheelTime = -Infinity, pendingDetail = null;
  let ready = Promise.resolve(), intro = 1, introDuration = 1.1, pendingIntro = null;
  let outlineTimer = 0, outlineTarget = null, outlineRecord = null, outlineExtent = 0, outlineExposure = -1;
  let outlineTransition = null, outlineFrameDue = 0;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reducedMotion ?? media.matches;
  const abort = new AbortController();
  const resources = new Set(), recordCache = new Map();
  const own = resource => { resources.add(resource); return resource; };
  const previousTabIndex = host.getAttribute('tabindex');
  const previousRole = host.getAttribute('role');
  const previousLabel = host.getAttribute('aria-label');
  host.tabIndex = 0;
  host.setAttribute('role', 'group');
  host.setAttribute('aria-roledescription', '互動光碟片架');
  host.setAttribute('aria-label', '影片光碟：左右鍵選片，空白鍵翻面，Enter 觀看影片');
  host.style.touchAction = 'pan-y';

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (error) {
    host.dataset.webgl = 'unavailable'; onError(error);
    return {
      select(index, { notify = false } = {}) { selected = clamp(index, 0, Math.max(0, entries.length - 1)); if (notify) onSelect(selected, { source: 'api' }); },
      setEntries(next, index = 0) { entries = [...next]; selected = clamp(index, 0, Math.max(0, entries.length - 1)); },
      setDetail() { return Promise.resolve(); }, flip() {}, pause() {}, resume() {}, resize() {},
      playIntro() { return Promise.resolve(); }, get ready() { return Promise.resolve(); },
      destroy() { abort.abort(); restoreHost(); },
      get selectedIndex() { return selected; }, get hasWebGL() { return false; }, get canvas() { return host; },
    };
  }
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  host.append(canvas); host.dataset.webgl = 'ready';
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .86;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 100); camera.position.z = 4.4;
  const env = studioEnvironment(renderer, invalidate); scene.environment = env.texture;
  scene.environmentIntensity = .8;
  scene.add(new THREE.AmbientLight(0xffffff, .85));
  for (const [x, y, z, intensity, color] of [[1.75, -4, 3, .75, 0xfff9e8], [-5, -2, 4, .3, 0xffffff], [0, 2, -4, .7, 0x4c9fff]]) {
    const light = new THREE.DirectionalLight(color, intensity); light.position.set(x, y, z); scene.add(light);
  }
  const maps = opticalMaps(invalidate); Object.values(maps).filter(value => value?.isTexture).forEach(own);
  const faceGeometry = own(annulus(PRINT_INNER_RADIUS, .974));
  const backGeometry = own(annulus(PRINT_INNER_RADIUS, .974));
  const edgeFaceGeometry = own(annulus(.974, 1));
  // Round the polished edge into the cylindrical wall over its existing width.
  const edgePosition = edgeFaceGeometry.attributes.position;
  const edgeNormal = edgeFaceGeometry.attributes.normal;
  for (let i = 0; i < edgePosition.count; i++) {
    const x = edgePosition.getX(i), y = edgePosition.getY(i);
    if (Math.hypot(x, y) > .99) edgeNormal.setXYZ(i, .72 * x, .72 * y, .694);
  }
  const hubGeometry = own(pressedHubGeometry());
  const hitGeometry = own(new THREE.CircleGeometry(1, 96));
  const hitMaterial = own(new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  const rimGeometry = own(new THREE.CylinderGeometry(1, 1, .0112, 192, 1, true));
  rimGeometry.rotateX(PI / 2);
  const rim = own(createCDRimMaterial());
  rim.envMap = env.texture;
  const back = own(createCDBackMaterial(maps));
  back.envMap = env.texture;
  const hub = own(createCDHubMaterial());
  hub.envMap = env.texture;
  const lineMaterial = own(new THREE.MeshBasicMaterial({ color: 0x000000, depthWrite: false, side: THREE.DoubleSide }));
  const lines = new THREE.Group();
  for (const [radius, seed] of [[1.06, 17], [1.11, 53]]) lines.add(new THREE.Mesh(own(outlineGeometry(radius, seed)), lineMaterial));
  scene.add(lines);
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const desktopRotation = new THREE.Euler(-30 * DEG, -30 * DEG, 0, 'XYZ');
  const desktopQuaternion = new THREE.Quaternion().setFromEuler(desktopRotation);
  const basePosition = new THREE.Vector3(), localYaw = new THREE.Quaternion(), hoverRotation = new THREE.Quaternion();
  let records = [];

  function makeRecord(entry) {
    const key = entryKey(entry);
    if (recordCache.has(key)) return recordCache.get(key);
    const group = new THREE.Group();
    const print = own(createCDFrontMaterial(maps));
    print.envMap = env.texture;
    const frontMesh = new THREE.Mesh(faceGeometry, print); frontMesh.position.z = .0056;
    const reverse = new THREE.Mesh(backGeometry, back); reverse.rotation.y = PI; reverse.position.z = -.0056;
    const frontEdge = new THREE.Mesh(edgeFaceGeometry, rim); frontEdge.position.z = .0057;
    const backEdge = new THREE.Mesh(edgeFaceGeometry, rim); backEdge.position.z = -.0057; backEdge.rotation.y = PI;
    group.add(frontMesh, reverse, new THREE.Mesh(rimGeometry, rim), new THREE.Mesh(hubGeometry, hub),
      new THREE.Mesh(hitGeometry, hitMaterial), frontEdge, backEdge);
    const record = { entry, group, frontMesh, print, loaded: false, yaw: 0, targetYaw: 0, tiltX: 0, tiltY: 0, targetTiltX: 0, targetTiltY: 0,
      dragX: 0, dragY: 0, targetDragX: 0, targetDragY: 0, inertiaX: 0, inertiaY: 0, shelfQuaternion: new THREE.Quaternion() };
    group.userData.record = record;
    group.traverse(object => { object.userData.record = record; });
    scene.add(group); recordCache.set(key, record);
    record.ready = createDiscArtwork(entry).then(artwork => {
      if (destroyed) return;
      const texture = own(new THREE.CanvasTexture(artwork)); texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      print.map = texture; print.needsUpdate = true; record.loaded = true;
      onLoad(records.filter(item => item.loaded).length, records.length); invalidate();
    });
    return record;
  }

  function setEntries(next, index = 0, { immediate = false } = {}) {
    cancelPointer(); clearHover();
    outlineTarget = outlineRecord = outlineTransition = null; outlineExtent = 0;
    for (const record of records) record.group.visible = false;
    entries = [...next]; records = entries.map(makeRecord);
    ready = Promise.all([...records.map(record => record.ready), maps.ready, env.ready]);
    onLoad(records.filter(record => record.loaded).length, records.length);
    selected = clamp(index, 0, Math.max(0, entries.length - 1));
    position = targetPosition = selected;
    updateLabel();
    if (immediate || reduced()) draw(0); else invalidate();
  }

  function updateLabel() {
    const entry = entries[selected];
    host.setAttribute('aria-label', `${entry?.titleZh ?? entry?.nameZh ?? entry?.title ?? '影片光碟'}，${selected + 1} / ${entries.length}。左右鍵選片，空白鍵翻面，Enter 觀看影片`);
    host.dataset.selectedIndex = String(selected);
  }
  function select(index, { immediate = false, notify = false, source = 'api' } = {}) {
    if (destroyed || !entries.length) return;
    cancelPointer();
    const next = clamp(Math.round(index), 0, entries.length - 1);
    const changed = next !== selected;
    selected = targetPosition = next;
    hoverDirty = true;
    records.forEach(record => { record.targetTiltX = record.targetTiltY = 0; });
    if (immediate || reduced()) position = targetPosition;
    updateLabel(); invalidate();
    if (notify && changed) onSelect(selected, { source });
  }
  function flip() {
    if (destroyed || paused || detailTarget || !records[selected]) return;
    const record = records[selected]; record.targetYaw = Math.round(record.targetYaw / PI) * PI + PI;
    if (reduced()) record.yaw = record.targetYaw;
    invalidate();
  }

  function pose(record, index) {
    const distance = index - position;
    const main = Math.max(0, 1 - Math.abs(distance));
    let scale;
    if (narrow) {
      const worldWidth = 2 * camera.position.z * Math.tan(20 * DEG) * width / height;
      const mainScale = Math.min(1.08, worldWidth * .3547);
      scale = mainScale * (.4 + .6 * main);
      const depth = -mainScale / 3 * Math.min(1, Math.abs(distance));
      const worldHeight = 2 * (camera.position.z - depth) * Math.tan(20 * DEG);
      basePosition.set(distance * worldHeight * width / height * .5,
        -worldHeight * .105 * Math.min(1, Math.abs(distance)), depth);
      if (Math.abs(distance) < 1) basePosition.add(new THREE.Vector3(0, mainScale * .04 * main, 0).applyEuler(new THREE.Euler(-30 * DEG, 0, 0)));
      record.group.quaternion.copy(desktopQuaternion);
    } else {
      const angle = distance * .35;
      basePosition.set(Math.sin(angle) * 5.52, .06 * main, (1 - Math.cos(angle)) * 2.4).multiplyScalar(1.08).applyQuaternion(desktopQuaternion);
      scale = 1.08 * (.88 + .12 * main);
      record.group.quaternion.copy(desktopQuaternion);
      localYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
      record.group.quaternion.multiply(localYaw);
    }
    record.shelfQuaternion.copy(record.group.quaternion);
    hoverRotation.setFromEuler(new THREE.Euler(record.tiltX, record.tiltY, 0));
    record.shelfQuaternion.multiply(hoverRotation);
    localYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), record.yaw);
    record.group.quaternion.multiply(localYaw);
    hoverRotation.setFromEuler(new THREE.Euler(record.dragX + record.tiltX, record.dragY + record.tiltY, 0, 'XYZ'));
    record.group.quaternion.multiply(hoverRotation);
    const primary = index === selected;
    const departure = primary ? handoff.pose.main : handoff.pose.side;
    if (primary && handoff.pose.turn) {
      departureTurn.setFromAxisAngle(turnAxis, handoff.pose.turn * PI * .5);
      record.group.quaternion.multiply(departureTurn);
    } else if (!primary && departure < 1) {
      const travel = narrow ? 1.46 * Math.min(1.08, 2 * camera.position.z * Math.tan(20 * DEG) * width / height * .3547) : 2.4;
      basePosition.addScaledVector(departureAxis, travel * (1-departure));
    }
    if (intro < 1) {
      const arrival = 1 - Math.pow(1 - intro, 3);
      if (Math.abs(distance) > .01 && !narrow) {
        const worldHeight = 2 * camera.position.z * Math.tan(20 * DEG);
        const start = new THREE.Vector3(Math.sign(distance) * worldHeight * width / height * .5, -worldHeight * .105, -.2);
        basePosition.lerp(start, 1 - arrival);
        scale *= .4 + .6 * arrival;
      } else scale *= .025 + .975 * arrival;
    }
    record.group.position.copy(basePosition);
    record.group.scale.setScalar(scale * departure);
    record.group.visible = Math.abs(distance) < (narrow ? 2.2 : 3.6) && departure > .00005;
  }

  function draw(dt) {
    if (destroyed || contextLost) return false;
    const ease = reduced() ? 1 : 1 - Math.exp(-dt * 10);
    const previousPosition = position, previousIntro = intro;
    if (intro < 1) intro = reduced() ? 1 : Math.min(1, intro + dt / introDuration);
    position += (targetPosition - position) * ease;
    if (Math.abs(position - targetPosition) < .0002) position = targetPosition;
    const changingView = handoff.update(performance.now());
    let active = position !== targetPosition || changingView || intro < 1;
    records.forEach((record, index) => {
      const rotating = pointer?.rotate && pointer.moved && index === selected;
      if (reduced()) {
        record.dragX = rotating ? record.targetDragX : 0;
        record.dragY = rotating ? record.targetDragY : 0;
        record.inertiaX = record.inertiaY = 0;
      } else if (rotating) {
        const follow = 1 - Math.exp(-dt * 20);
        record.dragX += (record.targetDragX - record.dragX) * follow;
        record.dragY += (record.targetDragY - record.dragY) * follow;
      } else {
        // Decaying angular velocity carries a quick release for a moment, while
        // the held/released disc returns with the measured 4.4/s damping.
        const settle = Math.exp(-4.4 * dt), momentum = Math.exp(-14 * dt);
        record.dragX = record.dragX * settle + record.inertiaX * (settle - momentum) / 9.6;
        record.dragY = record.dragY * settle + record.inertiaY * (settle - momentum) / 9.6;
        record.inertiaX *= momentum; record.inertiaY *= momentum;
      }
      if (Math.abs(record.dragX) < .0001) record.dragX = 0;
      if (Math.abs(record.dragY) < .0001) record.dragY = 0;
      if (Math.abs(record.inertiaX) < .0001) record.inertiaX = 0;
      if (Math.abs(record.inertiaY) < .0001) record.inertiaY = 0;
      active ||= !reduced() && (rotating
        ? Math.abs(record.targetDragX - record.dragX) > .0001 || Math.abs(record.targetDragY - record.dragY) > .0001
        : record.dragX !== 0 || record.dragY !== 0 || record.inertiaX !== 0 || record.inertiaY !== 0);
      record.yaw += (record.targetYaw - record.yaw) * ease;
      record.tiltX += (record.targetTiltX - record.tiltX) * ease;
      record.tiltY += (record.targetTiltY - record.tiltY) * ease;
      if (Math.abs(record.yaw - record.targetYaw) < .0003) record.yaw = record.targetYaw;
      if (Math.abs(record.tiltX - record.targetTiltX) < .0001) record.tiltX = record.targetTiltX;
      if (Math.abs(record.tiltY - record.targetTiltY) < .0001) record.tiltY = record.targetTiltY;
      active ||= record.yaw !== record.targetYaw || record.tiltX !== record.targetTiltX || record.tiltY !== record.targetTiltY;
      pose(record, index);
    });
    if (hoverPoint && !pointer && (hoverDirty || position !== previousPosition || intro !== previousIntro) && allowed()) {
      // A moving shelf can bring a different disc under a stationary cursor.
      scene.updateMatrixWorld(true);
      if (updateHover()) active = true;
    }
    const now = performance.now();
    const hoverRecord = records[pointer?.rotate ? pointer.index : pointer?.moved ? -1 : hoverIndex];
    const nextOutlineTarget = !paused && !detailTarget && hoverRecord?.group.visible ? hoverRecord : null;
    if (nextOutlineTarget !== outlineTarget) {
      outlineTarget = nextOutlineTarget;
      if (outlineTarget) {
        if (outlineRecord !== outlineTarget || outlineExtent === 0) outlineExtent = .24;
        outlineRecord = outlineTarget;
      }
      outlineTransition = { from: outlineExtent, to: outlineTarget ? 1 : 0, start: now, duration: outlineTarget ? 350 : 420 };
      outlineExposure = -1;
    }
    if (reduced()) {
      outlineExtent = outlineTarget ? 1 : 0; outlineTransition = null;
    } else if (outlineTransition) {
      const progress = clamp((now - outlineTransition.start) / outlineTransition.duration, 0, 1);
      outlineExtent = THREE.MathUtils.lerp(outlineTransition.from, outlineTransition.to, progress);
      if (progress === 1) outlineTransition = null;
    }
    lines.visible = outlineExtent > .001 && Boolean(outlineRecord?.group.visible);
    if (lines.visible) {
      lines.position.copy(outlineRecord.group.position);
      lines.quaternion.copy(outlineRecord.shelfQuaternion);
      lines.scale.copy(outlineRecord.group.scale);
      const exposure = reduced() ? 0 : Math.floor(now / OUTLINE_STEP_MS);
      if (outlineExposure !== exposure) {
        outlineExposure = exposure;
        // Keep the final withdrawing mark readable until the pen lifts away.
        const extent = Math.max(.22, outlineExtent);
        for (const stroke of lines.children) updateOutlineGeometry(stroke.geometry, exposure, extent);
      }
    }
    outlineFrameDue = !reduced() && (outlineTarget || outlineTransition)
      ? Math.min((Math.floor(now / OUTLINE_STEP_MS) + 1) * OUTLINE_STEP_MS,
        outlineTransition ? outlineTransition.start + outlineTransition.duration : Infinity) : 0;
    scene.updateMatrixWorld(true); renderer.render(scene, camera);
    if (!handoff.active && pendingDetail) { const resolve = pendingDetail; pendingDetail = null; resolve(); }
    if (intro === 1 && pendingIntro) { const resolve = pendingIntro; pendingIntro = null; resolve(); }
    return active;
  }
  function tick(time) {
    frame = 0;
    const dt = Math.min(.05, Math.max(.001, lastTime ? (time - lastTime) / 1000 : 1 / 60)); lastTime = time;
    if (draw(dt)) frame = requestAnimationFrame(tick);
    else {
      lastTime = 0;
      if (outlineFrameDue && !destroyed && !contextLost) {
        outlineTimer = setTimeout(() => { outlineTimer = 0; invalidate(); }, Math.max(1, outlineFrameDue - performance.now()));
      }
    }
  }
  function invalidate() {
    if (outlineTimer) { clearTimeout(outlineTimer); outlineTimer = 0; }
    if (!frame && !destroyed && !contextLost) frame = requestAnimationFrame(tick);
  }
  function resize() {
    if (destroyed) return;
    const bounds = host.getBoundingClientRect(); width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
    narrow = width < 768;
    camera.aspect = width / height; camera.updateProjectionMatrix();
    renderer.setSize(width, height, false); hoverDirty = true; invalidate();
  }
  function setDetail(open, { immediate = false } = {}) {
    cancelPointer(); clearHover(); detailTarget = open ? 1 : 0;
    if (pendingDetail) { pendingDetail(); pendingDetail = null; }
    handoff.set(Boolean(open), immediate || reduced() || contextLost);
    if (!handoff.active) { draw(0); return Promise.resolve(); }
    return new Promise(resolve => { pendingDetail = resolve; invalidate(); });
  }
  function playIntro(duration = 1100) {
    if (pendingIntro) { pendingIntro(); pendingIntro = null; }
    if (destroyed || contextLost || reduced() || detailTarget) return Promise.resolve();
    introDuration = clamp(duration / 1000, .2, 2); intro = 0; draw(0);
    return new Promise(resolve => { pendingIntro = resolve; invalidate(); });
  }
  function getHit(event) {
    const rect = canvas.getBoundingClientRect();
    ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    raycaster.setFromCamera(ndc, camera);
    const visible = records.filter(record => record.group.visible).map(record => record.group);
    const hit = raycaster.intersectObjects(visible, true)[0];
    return hit ? { index: records.indexOf(hit.object.userData.record), hit } : null;
  }
  function allowed() { return !destroyed && !paused && !contextLost && !detailTarget && !host.hidden && host.getClientRects().length > 0; }
  function rememberHover(event) {
    hoverPoint = { clientX: event.clientX, clientY: event.clientY };
    hoverDirty = true;
  }
  function clearHover() {
    hoverPoint = null; hoverDirty = false; hoverIndex = -1;
    canvas.style.cursor = 'grab';
    records.forEach(record => { record.targetTiltX = record.targetTiltY = 0; });
  }
  function updateHover() {
    hoverDirty = false;
    const hit = getHit(hoverPoint);
    hoverIndex = hit?.index ?? -1;
    canvas.style.cursor = hit ? 'pointer' : 'grab';
    const record = records[selected];
    if (!record) return;
    if (hoverIndex === selected && !reduced()) {
      const rect = canvas.getBoundingClientRect();
      record.targetTiltX = clamp(-(hoverPoint.clientY - rect.top - height / 2) / height * .48, -.16, .16);
      record.targetTiltY = clamp((hoverPoint.clientX - rect.left - width / 2) / width * .42, -.16, .16);
    } else record.targetTiltX = record.targetTiltY = 0;
    return record.tiltX !== record.targetTiltX || record.tiltY !== record.targetTiltY;
  }
  function down(event) {
    if (!allowed() || pointer || !event.isPrimary || event.button > 0) return;
    if (event.pointerType === 'touch') { clearHover(); invalidate(); }
    const hit = getHit(event), record = records[selected];
    pointer = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY,
      index: hit?.index ?? -1, rotate: event.pointerType !== 'touch' && hit?.index === selected,
      dragX: record?.dragX || 0, dragY: record?.dragY || 0, moved: false,
      lastX: event.clientX, lastY: event.clientY, time: performance.now(), velocity: 0, velocityY: 0 };
    if (pointer.rotate && record) { record.inertiaX = record.inertiaY = 0; }
    canvas.setPointerCapture?.(event.pointerId);
  }
  function move(event) {
    if (!allowed()) return;
    if (pointer) {
      if (event.pointerId !== pointer.id) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      pointer.moved ||= Math.hypot(dx, dy) > 6;
      const now = performance.now(); pointer.velocity = (event.clientX - pointer.lastX) / Math.max(1, now - pointer.time);
      pointer.velocityY = (event.clientY - pointer.lastY) / Math.max(1, now - pointer.time);
      pointer.lastX = event.clientX; pointer.lastY = event.clientY; pointer.time = now;
      if (pointer.rotate && pointer.moved) {
        const record = records[selected];
        record.targetDragX = pointer.dragX + dy * .00428;
        record.targetDragY = pointer.dragY + dx * .00428;
        record.targetTiltX = record.targetTiltY = 0;
      } else if (pointer.moved && Math.abs(dx) > Math.abs(dy)) {
        targetPosition = clamp(selected - dx / (narrow ? width * .62 : width * .38), -.13, records.length - .87);
      }
      invalidate(); return;
    }
    if (event.pointerType === 'touch') return;
    rememberHover(event);
    invalidate();
  }
  function cancelPointer() {
    if (!pointer) return;
    try { canvas.releasePointerCapture(pointer.id); } catch {}
    pointer = null; clearHover(); targetPosition = selected;
    const record = records[selected];
    if (record) {
      record.targetYaw = Math.round(record.targetYaw / PI) * PI; record.targetTiltX = record.targetTiltY = 0;
      record.targetDragX = record.targetDragY = record.inertiaX = record.inertiaY = 0;
    }
  }
  function up(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const gesture = pointer; pointer = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch {}
    if (!allowed()) return;
    if (gesture.type !== 'touch' && document.elementFromPoint(event.clientX, event.clientY) === canvas) rememberHover(event);
    else clearHover();
    if (!gesture.moved) {
      if (gesture.index === selected) onOpen(selected, { trigger: host });
      else if (gesture.index >= 0) select(gesture.index, { notify: true, source: 'disc' });
    } else if (gesture.rotate) {
      const record = records[selected];
      record.targetDragX = record.targetDragY = 0;
      const freshRelease = !reduced() && performance.now() - gesture.time < 80;
      record.inertiaX = freshRelease ? clamp(gesture.velocityY * 4.28, -6, 6) : 0;
      record.inertiaY = freshRelease ? clamp(gesture.velocity * 4.28, -6, 6) : 0;
    } else {
      const dx = event.clientX - gesture.x;
      const step = Math.abs(dx) > 35 || Math.abs(gesture.velocity) > .45 ? -Math.sign(dx || gesture.velocity) : 0;
      select(selected + step, { notify: true, source: 'drag' });
    }
    invalidate();
  }
  function leave() {
    if (pointer) return;
    clearHover(); invalidate();
  }
  function wheel(event) {
    if (!allowed() || pointer || Math.max(Math.abs(event.deltaY), Math.abs(event.deltaX)) < 2) return;
    event.preventDefault();
    const time = performance.now();
    if (time - wheelTime < 420) return;
    wheelTime = time;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    select(selected + Math.sign(delta), { notify: true, source: 'wheel' });
  }
  function keyboard(event) {
    if (!allowed() || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('button,a,input,select,textarea,summary,[role="dialog"],[contenteditable="true"]')) return;
    if (event.code === 'Space') { event.preventDefault(); flip(); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault(); select(selected + (event.key === 'ArrowRight' ? 1 : -1), { notify: true, source: 'keyboard', immediate: reduced() });
    } else if (event.key === 'Enter') { event.preventDefault(); onOpen(selected, { trigger: host }); }
  }
  function restoreHost() {
    for (const [name, value] of [['tabindex', previousTabIndex], ['role', previousRole], ['aria-label', previousLabel]]) {
      if (value === null) host.removeAttribute(name); else host.setAttribute(name, value);
    }
    host.removeAttribute('aria-roledescription'); delete host.dataset.webgl; delete host.dataset.selectedIndex;
  }
  function pause() { paused = true; cancelPointer(); leave(); }
  function resume() { paused = false; invalidate(); }
  function destroy() {
    if (destroyed) return;
    cancelPointer(); destroyed = true; abort.abort(); observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    if (outlineTimer) clearTimeout(outlineTimer);
    pendingDetail?.(); pendingDetail = null;
    pendingIntro?.(); pendingIntro = null;
    for (const resource of resources) resource.dispose();
    env.dispose(); renderer.dispose(); canvas.remove(); restoreHost(); recordCache.clear();
  }
  for (const [name, handler] of [['pointerdown', down], ['pointerenter', move], ['pointermove', move], ['pointerup', up],
    ['pointerleave', leave], ['pointercancel', event => { if (pointer?.id === event.pointerId) { cancelPointer(); invalidate(); } }],
    ['lostpointercapture', event => { if (pointer?.id === event.pointerId) { cancelPointer(); invalidate(); } }]]) {
    canvas.addEventListener(name, handler, { signal: abort.signal });
  }
  canvas.addEventListener('wheel', wheel, { passive: false, signal: abort.signal });
  window.addEventListener('keydown', keyboard, { signal: abort.signal });
  window.addEventListener('blur', () => { cancelPointer(); leave(); }, { signal: abort.signal });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); contextLost = true; cancelPointer(); clearHover(); host.dataset.webgl = 'unavailable';
    if (outlineTimer) { clearTimeout(outlineTimer); outlineTimer = 0; }
    pendingDetail?.(); pendingDetail = null; pendingIntro?.(); pendingIntro = null;
    onError(new Error('WebGL context lost'));
  }, { signal: abort.signal });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false; host.dataset.webgl = 'ready';
    // Render-target environment pixels are GPU-only, so recreate them after loss.
    env.texture.needsUpdate = true;
    Object.values(maps).filter(value => value?.isTexture).forEach(texture => { texture.needsUpdate = true; });
    resize();
  }, { signal: abort.signal });
  media.addEventListener('change', () => {
    if (reduced()) { position = targetPosition; handoff.set(Boolean(detailTarget), true); for (const record of records) record.yaw = record.targetYaw; }
    invalidate();
  }, { signal: abort.signal });
  const observer = new ResizeObserver(resize); observer.observe(host);
  setEntries(entries, selected, { immediate: true }); resize();
  return {
    select, setEntries, setDetail, playIntro, flip, pause, resume, resize, destroy,
    get ready() { return ready; },
    get selectedIndex() { return selected; }, get hasWebGL() { return !contextLost; }, get canvas() { return canvas; },
  };
}
