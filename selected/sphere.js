import * as THREE from '../vendor/three/three.module.min.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (a, b, amount) => a + (b - a) * amount;
const fraction = value => value - Math.floor(value);
const random = seed => fraction(Math.sin(seed * 127.1 + 311.7) * 43758.5453);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const SHAPES = ['sphere', 'heart', 'smiley', 'star', 'grid'];
const SHAPE_LABELS = { sphere: '球體', heart: '心形', smiley: '笑臉', star: '星形', grid: '網格' };
const FILTER_LABELS = { all: '全部作品', films: '影片作品', images: '圖像作品' };
const ACCENTS = ['#087e50', '#2063e4', '#c52b87', '#b76b00', '#d24332'];
const SHAPE_SCALE = { sphere: 1, heart: .72, smiley: .65, star: .70, grid: 1 };

export function mount(host, { projects, items, openItem }) {
  const glassPreview = document.body.hasAttribute('data-glass');
  const shapeIcons = {
    sphere: '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.8" ry="8.5"/><path d="M4 9h16M4 15h16"/>',
    heart: '<path d="M12 20S3 14.7 3 8.8C3 3.8 9.1 2.4 12 6.6c2.9-4.2 9-2.8 9 2.2C21 14.7 12 20 12 20Z"/>',
    smiley: '<circle cx="12" cy="12" r="8.5"/><path d="M8 14.5c1.8 2.7 6.2 2.7 8 0M8.5 8.5v1M15.5 8.5v1"/>',
    star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4L12 17.5l-5.7 3.1 1.1-6.4L2.8 9.7l6.4-.9L12 3Z"/>',
    grid: '<rect x="3.5" y="3.5" width="6" height="6" rx="1"/><rect x="14.5" y="3.5" width="6" height="6" rx="1"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><rect x="14.5" y="14.5" width="6" height="6" rx="1"/>',
  };
  const events = new AbortController();
  const { signal } = events;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.createElement('section');
  root.className = 'sphere-root';
  root.innerHTML = `
    <div class="sphere-stage" tabindex="0" role="group" aria-label="作品排列。水平拖曳可旋轉；方向鍵選擇作品，Enter 鍵打開作品；網格模式可上下捲動。"></div>
    <div class="sphere-frame" aria-hidden="true"><span class="sphere-frame-label"></span></div>
    <div class="sphere-caption" hidden><span class="sphere-caption-text"></span><button class="sphere-open${glassPreview ? ' glass-action' : ''}" type="button" aria-label="打開作品">${glassPreview ? '打開作品' : '打開作品 ↗'}</button></div>
    <div class="sphere-status" aria-live="polite">正在載入作品</div>
    <div class="sphere-fallback" hidden></div>
    <div class="sphere-fog" aria-hidden="true"></div>
    <footer class="sphere-toolbar">
      <div class="sphere-shape-control" role="group" aria-label="選擇排列形狀">${SHAPES.map(shape => `<button type="button" data-shape="${shape}" aria-label="${shape}，${SHAPE_LABELS[shape]}排列" aria-pressed="${shape === 'sphere'}">${glassPreview ? `<svg class="sphere-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${shapeIcons[shape]}</svg><span class="sphere-control-label">${shape}</span>` : shape}</button>`).join('')}</div>
      <nav class="sphere-filters" aria-label="篩選作品">${['all', 'films', 'images'].map(filter => `<button type="button" data-filter="${filter}" aria-label="${filter}，${FILTER_LABELS[filter]}" aria-pressed="${filter === 'all'}">${filter}</button>`).join('')}</nav>
    </footer>`;
  host.append(root);

  const stage = root.querySelector('.sphere-stage');
  const frame = root.querySelector('.sphere-frame');
  const frameLabel = root.querySelector('.sphere-frame-label');
  const caption = root.querySelector('.sphere-caption');
  const captionText = root.querySelector('.sphere-caption-text');
  const openButton = root.querySelector('.sphere-open');
  const fallback = root.querySelector('.sphere-fallback');
  const status = root.querySelector('.sphere-status');
  const canvas = document.createElement('canvas');
  canvas.className = 'sphere-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stage.append(canvas);

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); }
  catch { renderer = null; }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 100);
  const loader = new THREE.TextureLoader();
  const plane = new THREE.PlaneGeometry(1, 1);
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const target = new THREE.Vector3();
  const projection = new THREE.Vector3();
  const textureCache = new Map();
  const records = [];
  let shape = 'sphere';
  let filter = 'all';
  let active = [];
  let bounds = root.getBoundingClientRect();
  let width = Math.max(1, bounds.width);
  let height = Math.max(1, bounds.height);
  let yaw = .45;
  let rotationVelocity = 0;
  let gridScroll = 0;
  let gridTarget = 0;
  let gridVelocity = 0;
  let gridHeight = 0;
  let pointer = null;
  let hovered = null;
  let keyboardIndex = -1;
  let paused = false;
  let disposed = false;
  let webgl = Boolean(renderer);
  let reading = null;
  let transition = null;
  let frameId = 0;
  let previousTime = 0;
  let interactionTime = performance.now();
  let elapsed = 0;
  let boundsFrame = { left: 20, top: 30, width: 1, height: 1, initialized: false };

  if (renderer) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setClearColor(0xc2c2c2, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  for (let index = 0; index < items.length; index++) {
    const entry = items[index];
    const aspect = (entry.item.smallWidth || entry.item.imageWidth || entry.item.width || 1) / (entry.item.smallHeight || entry.item.imageHeight || entry.item.height || 1);
    const baseWidth = aspect >= 1 ? 1.9 : 1.9 * aspect;
    const baseHeight = aspect >= 1 ? 1.9 / aspect : 1.9;
    const material = new THREE.MeshBasicMaterial({ color: 0xb3b1ac, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(plane, material);
    const borderMaterial = new THREE.MeshBasicMaterial({ color: 0xf0f0ed, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    const border = new THREE.Mesh(plane, borderMaterial);
    const group = new THREE.Group();
    group.add(border, mesh);
    mesh.scale.set(baseWidth, baseHeight, 1);
    border.scale.set(baseWidth + .018, baseHeight + .018, 1);
    const record = { entry, index, mesh, border, material, borderMaterial, group, baseWidth, baseHeight, aspect, accent: ACCENTS[index % ACCENTS.length], opacity: 0, scale: .001, shown: true, ordinal: index, texture: null, failed: false, grid: { x: 0, y: 0, scale: 1 } };
    mesh.userData.record = record;
    group.position.set((random(index + 3) - .5) * 2, (random(index + 7) - .5) * 2, -1);
    group.scale.setScalar(.001);
    records.push(record);
    scene.add(group);
    if (webgl) loadTexture(entry.item.small || entry.item.image).then(texture => {
      if (disposed) return;
      if (texture) {
        record.texture = texture;
        record.accent = accentFromImage(texture.image, record.accent);
        if (reading?.record !== record) applyTexture(record, texture);
      } else {
        record.failed = true;
      }
      updateStatus();
      wake();
    });
  }

  function loadTexture(url) {
    if (textureCache.has(url)) return textureCache.get(url);
    const promise = new Promise(resolve => {
      loader.load(url, texture => {
        if (disposed) { texture.dispose(); resolve(null); return; }
        texture.colorSpace = THREE.SRGBColorSpace;
        if (renderer) texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        resolve(texture);
      }, undefined, () => { textureCache.delete(url); resolve(null); });
    });
    textureCache.set(url, promise);
    return promise;
  }

  function applyTexture(record, texture) {
    if (!texture) return;
    record.material.map = texture;
    record.material.color.set(0xffffff);
    record.material.needsUpdate = true;
  }

  function accentFromImage(image, fallbackColor) {
    try {
      const sampler = document.createElement('canvas');
      sampler.width = sampler.height = 16;
      const context = sampler.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, 16, 16);
      const pixels = context.getImageData(0, 0, 16, 16).data;
      let best = 0;
      let hue = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const range = max - min;
        const score = range * (1 - Math.abs((max + min) / 2 - .5));
        if (score <= best || range < .15) continue;
        best = score;
        hue = (max === r ? (g - b) / range : max === g ? 2 + (b - r) / range : 4 + (r - g) / range) * 60;
      }
      return best ? `hsl(${Math.round((hue + 360) % 360)} 76% 38%)` : fallbackColor;
    } catch { return fallbackColor; }
  }

  function updateStatus() {
    if (!webgl) {
      status.textContent = '無法顯示立體排列，請在下方選擇作品';
      status.hidden = false;
      return;
    }
    const pending = records.some(record => !record.texture && !record.failed);
    const failed = records.filter(record => record.failed).length;
    status.textContent = pending ? '正在載入作品' : failed ? `${failed} 張預覽未能載入，仍可打開作品` : '';
    status.hidden = !pending && !failed;
  }

  function refreshFilter() {
    active = records.filter(record => filter === 'all' || (filter === 'films' ? record.entry.item.type === 'video' : record.entry.item.type !== 'video'));
    records.forEach(record => { record.ordinal = active.indexOf(record); record.shown = record.ordinal >= 0; });
    hovered = null;
    keyboardIndex = -1;
    gridTarget = gridScroll = gridVelocity = 0;
    root.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
    fallback.innerHTML = active.map(record => `<button type="button" data-open="${escapeHtml(record.entry.key)}"><img src="${escapeHtml(record.entry.item.small || record.entry.item.image)}" alt=""><span>${escapeHtml(record.entry.project.title)}<small>${escapeHtml(record.entry.item.labelZh || record.entry.item.label || '')}</small></span></button>`).join('');
    layoutGrid();
    wake();
  }

  function chooseShape(next) {
    shape = next;
    if (reducedMotion.matches && shape !== 'sphere') yaw = Math.round(yaw / (Math.PI * 2)) * Math.PI * 2;
    root.querySelectorAll('[data-shape]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shape === shape)));
    interactionTime = performance.now();
    rotationVelocity = 0;
    hovered = null;
    keyboardIndex = -1;
    layoutGrid();
    wake();
  }

  function unitsPerPixel(z = 0) {
    return 2 * Math.tan(THREE.MathUtils.degToRad(20)) * (camera.position.z - z) / height;
  }

  function layoutGrid() {
    const columns = Math.max(2, Math.min(7, Math.floor(width / 175)));
    const margin = width < 640 ? 20 : 44;
    const gap = width < 640 ? 12 : 18;
    const cell = (width - margin * 2 - gap * (columns - 1)) / columns;
    const bottoms = new Array(columns).fill(35);
    const units = unitsPerPixel();
    for (const record of active) {
      const column = bottoms.indexOf(Math.min(...bottoms));
      const imageHeight = cell / record.aspect;
      record.grid.x = (margin + column * (cell + gap) + cell / 2 - width / 2) * units;
      record.grid.y = bottoms[column] + imageHeight / 2;
      record.grid.scale = cell * units / record.baseWidth;
      bottoms[column] += imageHeight + gap;
    }
    gridHeight = Math.max(...bottoms, height);
    gridTarget = clamp(gridTarget, 0, Math.max(0, gridHeight - height + toolbarHeight()));
    gridScroll = clamp(gridScroll, 0, Math.max(0, gridHeight - height + toolbarHeight()));
  }

  function toolbarHeight() { return width <= 700 ? 100 : 78; }

  function shapePosition(record, result) {
    const index = record.ordinal;
    const count = Math.max(1, active.length);
    if (shape === 'grid') {
      result.set(record.grid.x, (height / 2 - record.grid.y + gridScroll) * unitsPerPixel(), 0);
    } else if (shape === 'sphere') {
      const y = count === 1 ? 0 : 1 - 2 * index / (count - 1);
      const circle = Math.sqrt(1 - y * y);
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      result.set(Math.cos(angle) * circle * 3.15, y * 2.95, Math.sin(angle) * circle * 3.15);
    } else if (shape === 'heart') {
      const rim = Math.max(6, Math.round(count * .68));
      const angle = index < rim ? index / rim * Math.PI * 2 : fraction(index * .61803398875) * Math.PI * 2;
      const radius = index < rim ? .92 : .35 + .47 * random(index + 81);
      const x = 16 * Math.sin(angle) ** 3;
      const y = 13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle);
      result.set(x * radius * .23, (y + 1.5) * radius * .23, (random(index + 4) - .5) * .65);
    } else if (shape === 'star') {
      const rim = Math.max(10, Math.round(count * .78));
      const fractionOnEdge = index < rim ? index / rim * 10 : fraction(index * .61803398875) * 10;
      const edge = Math.floor(fractionOnEdge);
      const amount = fractionOnEdge - edge;
      const angleA = edge * Math.PI / 5 + Math.PI / 2;
      const angleB = (edge + 1) * Math.PI / 5 + Math.PI / 2;
      const radiusA = edge % 2 === 0 ? 3.7 : 1.5;
      const radiusB = edge % 2 === 0 ? 1.5 : 3.7;
      const fill = index < rim ? 1 : .3 + .45 * random(index + 29);
      result.set(mix(Math.cos(angleA) * radiusA, Math.cos(angleB) * radiusB, amount) * fill, mix(Math.sin(angleA) * radiusA, Math.sin(angleB) * radiusB, amount) * fill, (random(index + 4) - .5) * .55);
    } else {
      const outer = Math.max(4, Math.round(count * .47));
      const eyes = Math.max(2, Math.round(count * .12));
      if (index < outer) {
        const angle = index / outer * Math.PI * 2;
        result.set(Math.cos(angle) * 3.25, Math.sin(angle) * 3.25, (random(index + 4) - .5) * .5);
      } else if (index < outer + eyes) {
        result.set((index - outer) % 2 ? 1.1 : -1.1, 1.05 + (random(index + 4) - .5) * .3, .1);
      } else {
        const angle = THREE.MathUtils.degToRad(205 + (index - outer - eyes) / Math.max(1, count - outer - eyes - 1) * 130);
        result.set(Math.cos(angle) * 2.05, Math.sin(angle) * 2.05 + .4, .05);
      }
    }
    if (shape !== 'grid') {
      const noise = shape === 'sphere' ? .16 : .035;
      result.x += (random(record.index * 3 + 5) - .5) * noise;
      result.y += (random(record.index * 3 + 6) - .5) * noise;
      const rotation = yaw + (!reducedMotion.matches && shape !== 'sphere' ? Math.sin(elapsed * .32) * .045 : 0);
      const x = result.x * Math.cos(rotation) + result.z * Math.sin(rotation);
      result.z = -result.x * Math.sin(rotation) + result.z * Math.cos(rotation);
      result.x = x;
      if (width < 640) result.y += .2;
    }
  }

  function drawCloud(dt) {
    const amount = reducedMotion.matches ? 1 : 1 - Math.exp(-dt / 100);
    if (!pointer) {
      yaw += rotationVelocity * dt;
      rotationVelocity *= Math.exp(-dt / 185);
      gridTarget += gridVelocity * dt;
      gridVelocity *= Math.exp(-dt / 170);
    }
    if (!reducedMotion.matches && !pointer && shape === 'sphere') yaw += dt * .000035;
    if (shape !== 'sphere' && shape !== 'grid' && !pointer && performance.now() - interactionTime > 400) yaw += (Math.round(yaw / (Math.PI * 2)) * Math.PI * 2 - yaw) * amount * .6;
    gridTarget = clamp(gridTarget, 0, Math.max(0, gridHeight - height + toolbarHeight()));
    gridScroll += (gridTarget - gridScroll) * amount;
    let unsettled = Math.abs(gridTarget - gridScroll) > .2 || Math.abs(rotationVelocity) > .00001 || Math.abs(gridVelocity) > .001;
    for (const record of records) {
      const opacity = record.shown ? 1 : 0;
      record.opacity += (opacity - record.opacity) * amount;
      if (record.shown) {
        shapePosition(record, target);
        if (record.group.position.distanceToSquared(target) > .00001) unsettled = true;
        record.group.position.lerp(target, amount);
      }
      let scale = shape === 'grid' ? record.grid.scale : SHAPE_SCALE[shape];
      if (hovered === record && shape === 'grid') scale *= 1.06;
      scale *= record.opacity;
      if (Math.abs(record.scale - scale) > .001) unsettled = true;
      record.scale += (scale - record.scale) * amount;
      record.group.scale.setScalar(Math.max(.0001, record.scale));
      record.group.quaternion.copy(camera.quaternion);
      record.material.opacity = record.opacity;
      record.borderMaterial.opacity = record.opacity;
      const order = (100 - record.group.position.distanceTo(camera.position)) * 10 + (record === hovered ? 10000 : 0);
      record.border.renderOrder = order;
      record.mesh.renderOrder = order + .5;
      record.mesh.visible = record.border.visible = record.opacity > .005;
    }
    updateOverlay(dt);
    return unsettled || (!reducedMotion.matches && shape !== 'grid');
  }

  function screenRect(record) {
    const halfWidth = record.baseWidth * record.scale / 2;
    const halfHeight = record.baseHeight * record.scale / 2;
    projection.copy(record.group.position).add(new THREE.Vector3(-halfWidth, halfHeight, 0)).project(camera);
    const left = (projection.x + 1) * width / 2;
    const top = (1 - projection.y) * height / 2;
    projection.copy(record.group.position).add(new THREE.Vector3(halfWidth, -halfHeight, 0)).project(camera);
    return { left, top, width: (projection.x + 1) * width / 2 - left, height: (1 - projection.y) * height / 2 - top };
  }

  function updateOverlay(dt) {
    if (reading || !webgl || !hovered?.shown) { frame.hidden = true; caption.hidden = true; return; }
    frame.hidden = false;
    const rect = screenRect(hovered);
    const next = { left: rect.left - 8, top: rect.top - 8, width: rect.width + 16, height: rect.height + 16 };
    frame.style.setProperty('--sphere-accent', hovered.accent);
    frameLabel.textContent = `${hovered.entry.project.title} · ${hovered.entry.index + 1}`;
    captionText.textContent = hovered.entry.item.labelZh || hovered.entry.item.label || hovered.entry.project.title;
    caption.style.setProperty('--sphere-accent', hovered.accent);
    caption.hidden = false;
    const amount = boundsFrame.initialized && !reducedMotion.matches ? 1 - Math.exp(-dt / 75) : 1;
    for (const key of ['left', 'top', 'width', 'height']) boundsFrame[key] = mix(boundsFrame[key], next[key], amount);
    boundsFrame.initialized = true;
    frame.style.transform = `translate(${boundsFrame.left}px,${boundsFrame.top}px)`;
    frame.style.width = `${Math.max(0, boundsFrame.width)}px`;
    frame.style.height = `${Math.max(0, boundsFrame.height)}px`;
    if (!caption.hidden) {
      caption.style.left = `${clamp(boundsFrame.left, 14, Math.max(14, width - 250))}px`;
      caption.style.top = `${clamp(boundsFrame.top + boundsFrame.height + 5, 28, height - toolbarHeight() - 42)}px`;
    }
  }

  function hitAt(event) {
    if (!webgl || reading || event.clientY - bounds.top > height - toolbarHeight() + 10) return null;
    mouse.set((event.clientX - bounds.left) / width * 2 - 1, -(event.clientY - bounds.top) / height * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    return raycaster.intersectObjects(active.filter(record => record.opacity > .45).map(record => record.mesh), false)[0]?.object.userData.record || null;
  }

  function openRecord(record, trigger = stage) {
    if (!record || reading) return;
    hovered = record;
    openItem(record.entry.projectId, record.entry.index, trigger);
  }

  function focusKeyboard(direction) {
    if (!active.length) return;
    keyboardIndex = (keyboardIndex + direction + active.length) % active.length;
    hovered = active[keyboardIndex];
    if (shape === 'grid') {
      gridTarget = clamp(hovered.grid.y - height * .45, 0, Math.max(0, gridHeight - height + toolbarHeight()));
    }
    interactionTime = performance.now();
    wake();
  }

  function updateLayout() {
    bounds = root.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    camera.aspect = width / height;
    camera.position.z = Math.max(14, 4.4 / (Math.tan(THREE.MathUtils.degToRad(20)) * camera.aspect));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer?.setSize(width, height, false);
    layoutGrid();
    if (reading && transition?.direction === 'in') {
      const mediaStage = document.querySelector('#reader-stage');
      if (mediaStage) reading.rect = mediaStage.getBoundingClientRect();
      transition.to = readerPose(reading.record, reading.rect);
    }
    wake();
  }

  function readerPose(record, rect) {
    const units = unitsPerPixel();
    const imageWidth = Math.min(rect.width, rect.height * record.aspect);
    return {
      position: new THREE.Vector3((rect.left + rect.width / 2 - bounds.left - width / 2) * units, (height / 2 - (rect.top + rect.height / 2 - bounds.top)) * units, 0),
      scale: imageWidth * units / record.baseWidth,
    };
  }

  async function enter({ projectId, index, rect }) {
    if (!webgl || disposed) return;
    finishPointer(null, true);
    const record = records.find(entry => entry.entry.projectId === projectId && entry.entry.index === index);
    if (!record) return;
    root.classList.add('sphere-reading');
    rotationVelocity = gridVelocity = 0;
    record.mesh.visible = record.border.visible = true;
    reading = { record, rect, origin: { position: record.group.position.clone(), scale: record.scale } };
    const texture = await loadTexture(record.entry.item.image);
    if (disposed || !webgl || !reading) return;
    if (texture) applyTexture(record, texture);
    await animate('in', record, reading.origin, readerPose(record, rect));
  }

  async function exit() {
    if (!reading) return;
    const record = reading.record;
    if (webgl) await animate('out', record, { position: record.group.position.clone(), scale: record.scale }, reading.origin);
    if (disposed) return;
    applyTexture(record, record.texture);
    reading = null;
    root.classList.remove('sphere-reading');
    hovered = record;
    const keep = new Set(items.map(entry => entry.item.small || entry.item.image));
    for (const [url, promise] of textureCache) {
      if (!keep.has(url)) { textureCache.delete(url); promise.then(texture => texture?.dispose()); }
    }
    wake();
  }

  function animate(direction, record, from, to) {
    transition?.resolve();
    return new Promise(resolve => {
      transition = { direction, record, from, to, start: performance.now(), duration: reducedMotion.matches ? 0 : 680, resolve };
      wake();
    });
  }

  function drawTransition(now) {
    const current = transition;
    const time = current.duration ? clamp((now - current.start) / current.duration, 0, 1) : 1;
    const amount = 1 - (1 - time) ** 3;
    current.record.group.position.lerpVectors(current.from.position, current.to.position, amount);
    current.record.scale = mix(current.from.scale, current.to.scale, amount);
    current.record.group.scale.setScalar(current.record.scale);
    current.record.mesh.renderOrder = 20000;
    current.record.border.renderOrder = 19999;
    const cloudOpacity = current.direction === 'in' ? 1 - amount : amount;
    for (const record of records) {
      const opacity = record === current.record ? 1 : record.opacity * cloudOpacity;
      record.material.opacity = opacity;
      record.borderMaterial.opacity = opacity;
    }
    if (time === 1) { transition = null; current.resolve(); }
  }

  function tick(now) {
    frameId = 0;
    if (disposed || !webgl || document.hidden) return;
    const dt = clamp(now - previousTime || 16, 1, 45);
    previousTime = now;
    elapsed += dt / 1000;
    let again = false;
    if (transition) { drawTransition(now); again = Boolean(transition); }
    else if (!paused && !reading) again = drawCloud(dt);
    renderer.render(scene, camera);
    if (again || pointer) wake();
  }

  function wake() {
    if (!disposed && webgl && !frameId && !document.hidden) frameId = requestAnimationFrame(tick);
  }

  function finishPointer(event, cancelled = false) {
    if (!pointer || (event && event.pointerId !== pointer.id)) return;
    const gesture = pointer;
    pointer = null;
    stage.classList.remove('sphere-dragging');
    if (stage.hasPointerCapture(gesture.id)) stage.releasePointerCapture(gesture.id);
    if (!cancelled && !gesture.moved && event) openRecord(hitAt(event));
    if (cancelled || reducedMotion.matches || !gesture.moved) rotationVelocity = gridVelocity = 0;
    else if (shape === 'grid') gridVelocity = clamp(-gesture.velocityY, -2.5, 2.5);
    else rotationVelocity = clamp(gesture.velocityX * .005, -.014, .014);
    wake();
  }

  stage.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || reading || paused || !webgl) return;
    rotationVelocity = gridVelocity = 0;
    hovered = null;
    keyboardIndex = -1;
    pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, time: performance.now(), moved: false, velocityX: 0, velocityY: 0 };
    stage.setPointerCapture(event.pointerId);
    interactionTime = performance.now();
    wake();
  }, { signal });
  stage.addEventListener('pointermove', event => {
    interactionTime = performance.now();
    if (pointer?.id === event.pointerId) {
      const now = performance.now();
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 6) pointer.moved = true;
      if (pointer.moved) {
        if (shape === 'grid') gridTarget -= dy;
        else yaw += dx * .005;
        pointer.velocityX = mix(pointer.velocityX, dx / Math.max(8, now - pointer.time), .5);
        pointer.velocityY = mix(pointer.velocityY, dy / Math.max(8, now - pointer.time), .5);
        stage.classList.add('sphere-dragging');
      }
      pointer.x = event.clientX; pointer.y = event.clientY; pointer.time = now;
    } else if (event.pointerType !== 'touch' && !reading) {
      hovered = hitAt(event);
      keyboardIndex = -1;
      stage.style.cursor = hovered ? 'pointer' : 'grab';
    }
    wake();
  }, { signal });
  stage.addEventListener('pointerleave', () => { if (!pointer && keyboardIndex < 0) { hovered = null; wake(); } }, { signal });
  stage.addEventListener('pointerup', event => finishPointer(event), { signal });
  stage.addEventListener('pointercancel', event => finishPointer(event, true), { signal });
  stage.addEventListener('lostpointercapture', event => finishPointer(event, true), { signal });
  window.addEventListener('blur', () => { finishPointer(null, true); hovered = null; wake(); }, { signal });
  stage.addEventListener('wheel', event => {
    if (shape !== 'grid' || reading || paused || !webgl) return;
    event.preventDefault();
    gridVelocity = 0;
    gridTarget += event.deltaY * (event.deltaMode === 1 ? 16 : 1);
    wake();
  }, { passive: false, signal });
  stage.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || reading || paused || !host.getClientRects().length || event.target.closest('button,a,input,select,textarea,summary,[role="dialog"]')) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); focusKeyboard(1); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); focusKeyboard(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); openRecord(hovered || active[0]); }
  }, { signal });
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || reading) return;
    if (button.dataset.shape) chooseShape(button.dataset.shape);
    else if (button.dataset.filter) { filter = button.dataset.filter; refreshFilter(); }
    else if (button === openButton) openRecord(hovered, openButton);
    else if (button.dataset.open) openRecord(records.find(record => record.entry.key === button.dataset.open), button);
  }, { signal });
  const observer = new ResizeObserver(updateLayout);
  observer.observe(host);
  window.addEventListener('resize', updateLayout, { signal });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { previousTime = performance.now(); wake(); } }, { signal });
  reducedMotion.addEventListener('change', () => { rotationVelocity = gridVelocity = 0; wake(); }, { signal });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    webgl = false;
    transition?.resolve(); transition = null;
    showFallback();
  }, { signal });

  function showFallback() {
    canvas.hidden = true;
    stage.hidden = true;
    frame.hidden = caption.hidden = true;
    fallback.hidden = false;
    root.classList.add('sphere-no-webgl');
    updateStatus();
  }

  function pause() {
    paused = true;
    finishPointer(null, true);
    if (!transition) { cancelAnimationFrame(frameId); frameId = 0; }
  }

  function resume() { paused = false; previousTime = performance.now(); wake(); }

  function dispose() {
    if (disposed) return;
    disposed = true;
    events.abort();
    observer.disconnect();
    cancelAnimationFrame(frameId);
    transition?.resolve();
    records.forEach(record => { record.material.dispose(); record.borderMaterial.dispose(); });
    plane.dispose();
    textureCache.forEach(promise => promise.then(texture => texture?.dispose()));
    renderer?.dispose();
    root.remove();
  }

  refreshFilter();
  updateLayout();
  if (!webgl) showFallback();
  return { dispose, pause, resume, enter, exit };
}
