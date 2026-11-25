import * as THREE from '../vendor/three/three.module.min.js';

const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const mod = (n, length) => ((n % length) + length) % length;
const ease = t => t * t * (3 - 2 * t);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyFor = entry => `${entry.projectId}:${entry.index}`;
const discipline = (entry, category) => (entry.project.disciplines || []).some(value => String(value).toLowerCase() === category);
const categories = new Map([['all', '全部'], ['photography', '攝影'], ['design', '設計'], ['packaging-3d', '3D 包裝']]);

// Independently authored geometry and input handling. R13 research is recorded in
// references/selected-20261116/r13-notes.md. No source-site code or media is bundled.
export function mount(host, { projects = [], items, openItem }) {
  const glass = document.body.hasAttribute('data-glass');
  const filterSlot = glass ? document.getElementById('gallery-filter-slot') : null;
  const unified = Boolean(filterSlot?.isConnected);
  const imageFor = entry => glass ? (entry.item.image || entry.item.src || entry.item.small) : (entry.item.small || entry.item.image || entry.item.src);
  const aspectFor = entry => {
    if (!glass) return (entry.item.width || 1.7) / (entry.item.height || 1);
    const width = Number(glass ? entry.item.imageWidth || entry.item.width : entry.item.width);
    const height = Number(glass ? entry.item.imageHeight || entry.item.height : entry.item.height);
    return width > 0 && height > 0 ? width / height : 1.7;
  };
  const source = items || projects.flatMap(project => project.items.map((item, index) => ({ projectId: project.id, project, item, index })));
  const images = source.filter(entry => entry.item.type === 'image' &&
    [...categories.keys()].slice(1).some(category => discipline(entry, category)));
  const events = new AbortController();
  const { signal } = events;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.createElement('section');
  root.className = 'helix-root';
  root.innerHTML = `
    <div class="helix-stage" tabindex="0" role="group" aria-label="螺旋圖片畫廊。上下滾動或拖動；方向鍵瀏覽，Enter 打開作品。"><canvas class="helix-canvas" aria-hidden="true"></canvas><p class="helix-loading">正在排列圖片…</p></div>
    <header class="helix-heading"><div>${glass ? '' : '<p class="helix-eyebrow">A collection of perspectives</p>'}<h1>攝影與設計</h1></div><nav class="helix-filters" aria-label="作品分類">${[...categories].map(([value, title]) => `<button type="button" data-filter="${value}" aria-pressed="${value === 'all'}">${title}</button>`).join('')}</nav></header>
    <button class="helix-index-toggle" type="button" aria-expanded="false" aria-controls="helix-index">${glass ? '圖片目錄' : '圖片目錄 <span aria-hidden="true">↗</span>'}</button>
    <div class="helix-index" id="helix-index" hidden><div class="helix-index-heading"><h2>全部圖片</h2><p>選擇一張攝影或設計作品。</p></div><div class="helix-index-grid"></div></div>
    <footer class="helix-footer"><div class="helix-caption"><img class="helix-caption-image" alt=""><div class="helix-caption-copy"><p class="helix-caption-project"></p><h2 class="helix-caption-title"></h2><p class="helix-caption-zh"></p></div><button class="helix-open" type="button" aria-label="${glass ? '開啟所選圖片' : 'Open selected image'}">${glass ? '開啟' : '↗'}</button></div><div class="helix-navigation"><p class="helix-instruction">滾動或拖動 <span>Scroll or drag</span></p><div class="helix-stepper"><button type="button" data-step="-1" aria-label="${glass ? '上一張圖片' : 'Previous image'}">${glass ? '上一張' : '↑'}</button><span class="helix-count"></span><button type="button" data-step="1" aria-label="${glass ? '下一張圖片' : 'Next image'}">${glass ? '下一張' : '↓'}</button></div><button class="helix-pause" type="button" aria-pressed="false">暫停動態</button></div></footer><p class="helix-status" role="status" aria-live="polite"></p>`;
  host.append(root);
  const stage = root.querySelector('.helix-stage');
  const canvas = root.querySelector('canvas');
  const indexPanel = root.querySelector('.helix-index');
  const indexGrid = root.querySelector('.helix-index-grid');
  const indexButton = root.querySelector('.helix-index-toggle');
  const openButton = root.querySelector('.helix-open');
  const pauseButton = root.querySelector('.helix-pause');
  const status = root.querySelector('.helix-status');
  const loading = root.querySelector('.helix-loading');
  const captionImage = root.querySelector('.helix-caption-image');
  const captionProject = root.querySelector('.helix-caption-project');
  const captionTitle = root.querySelector('.helix-caption-title');
  const captionZh = root.querySelector('.helix-caption-zh');
  const count = root.querySelector('.helix-count');
  const filterNav = root.querySelector('.helix-filters');
  if (unified) {
    filterSlot.append(filterNav);
    indexButton.hidden = true;
    // Keep a real scene heading available to assistive technology without a
    // second visible title below the persistent header.
    root.querySelector('.helix-heading').className = 'sr-only';
  }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 100);
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const textureLoader = new THREE.TextureLoader();
  const textureCache = new Map();
  const records = [];
  const filterMemory = new Map();
  const density = 14;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'default' });
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  } catch { renderer = null; }
  let disposed = false;
  let unavailable = !renderer;
  let filtered = [...images];
  let filter = 'all';
  let offset = -Math.PI / 2 / .85;
  let velocity = 0;
  let target = null;
  let direction = 1;
  let frame = 0;
  let lastTime = 0;
  let externallyPaused = false;
  let manuallyPaused = false;
  let focusHeld = false;
  let indexOpen = false;
  let mode = 'gallery';
  let pointer = null;
  let hover = null;
  let pointerLocation = null;
  let selected = filtered[0] || null;
  let captionKey = '';
  let stageRect = { left: 0, top: 0, width: 1, height: 1 };
  let narrow = false;
  let transition = null;
  let readerState = null;

  function parameters() {
    const heightScale = glass ? (stageRect.height < 360 ? 1.15 : stageRect.height >= 650 ? (narrow ? 1.8 : 1.65) : 1.4) : 1;
    return narrow ? { radius: 1.65, gap: .3375, angle: .8925, width: 1.275, height: .75 * heightScale, bow: .15 } : { radius: 2, gap: .45, angle: .85, width: 1.7, height: heightScale, bow: .2 };
  }
  function front() { return Math.PI / 2 / parameters().angle; }
  function currentIndex() { return filtered.length ? mod(Math.round(offset + front()), filtered.length) : 0; }
  function announce(text) { status.textContent = text; }
  function wake() { if (!disposed && !frame && !unavailable) frame = requestAnimationFrame(tick); }
  function textureFor(url) {
    if (textureCache.has(url)) return textureCache.get(url).promise;
    const entry = { texture: null, promise: null };
    entry.promise = new Promise(resolve => {
      textureLoader.load(url, texture => {
        if (disposed) { texture.dispose(); resolve(null); return; }
        entry.texture = texture;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1;
        resolve(texture);
      }, undefined, () => resolve(null));
    });
    textureCache.set(url, entry);
    return entry.promise;
  }
  function assign(record, entry) {
    if (record.entry === entry) return;
    record.entry = entry;
    record.material.map = null;
    record.material.color.set(0x292929);
    record.material.needsUpdate = true;
    record.imageAspect = aspectFor(entry);
    const url = imageFor(entry);
    textureFor(url).then(texture => {
      if (disposed || record.entry !== entry) return;
      if (texture) {
        record.material.map = texture;
        record.imageAspect = glass ? (texture.image.naturalWidth || texture.image.width) / (texture.image.naturalHeight || texture.image.height) : texture.image.width / texture.image.height;
        record.material.color.set(0xffffff);
        record.material.needsUpdate = true;
        loading.hidden = true;
      } else {
        loading.textContent = '部分預覽暫時無法載入，可打開圖片目錄繼續瀏覽。';
      }
      wake();
    });
  }
  if (renderer) {
    for (let slot = 0; slot < density; slot++) {
      const geometry = new THREE.PlaneGeometry(1, 1, 32, 6);
      geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
      geometry.attributes.uv.setUsage(THREE.DynamicDrawUsage);
      const material = new THREE.MeshBasicMaterial({ color: 0x292929, side: THREE.DoubleSide, transparent: true });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      const record = { slot, mesh, geometry, material, entry: null, relative: 0, imageAspect: 1.7, hoverAmount: 0 };
      mesh.userData.record = record;
      records.push(record);
      scene.add(mesh);
    }
  }
  function updateCaption(entry = selected) {
    if (!entry) {
      captionTitle.textContent = '此分類暫無圖片';
      captionProject.textContent = '';
      captionZh.textContent = '';
      captionImage.hidden = true;
      openButton.disabled = true;
      count.textContent = '00 / 00';
      return;
    }
    selected = entry;
    const key = keyFor(entry);
    if (captionKey !== key) {
      captionKey = key;
      captionImage.hidden = false;
      captionImage.src = imageFor(entry);
      captionProject.textContent = entry.project.titleZh || entry.project.title;
      captionTitle.textContent = entry.item.labelZh || entry.item.label || entry.project.title;
      captionZh.textContent = entry.item.label || '';
      if (glass) captionProject.hidden = captionProject.textContent === captionTitle.textContent;
      openButton.setAttribute('aria-label', glass ? `開啟：${entry.item.labelZh || entry.item.label || entry.project.title}` : `Open ${entry.item.label || entry.project.title}`);
    }
    openButton.disabled = !filtered.length;
    const index = filtered.indexOf(entry);
    count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(filtered.length).padStart(2, '0')}`;
  }
  function renderIndex() {
    if (unified && !unavailable) { indexGrid.replaceChildren(); return; }
    root.querySelector('.helix-index-heading h2').textContent = filter === 'all' ? '全部作品' : categories.get(filter);
    indexGrid.innerHTML = filtered.map((entry, index) => {
      const title = entry.item.labelZh || entry.item.label || entry.project.title;
      const project = entry.project.titleZh || entry.project.title;
      const position = `${String(index + 1).padStart(2, '0')} / ${String(filtered.length).padStart(2, '0')}`;
      const label = glass ? ` aria-label="${escape(`開啟 ${position}：${title}${title === project ? '' : ` · ${project}`}`)}"` : '';
      return `<button class="helix-index-item" type="button" data-image="${index}"${label}><img src="${escape(imageFor(entry))}" alt="" loading="lazy">${glass ? `<span class="helix-index-position" aria-hidden="true">${position}</span>` : ''}<span>${escape(title)}</span>${!glass || project !== title ? `<small>${escape(project)}</small>` : ''}</button>`;
    }).join('');
  }
  function showIndex(value, moveFocus = false) {
    indexOpen = value || unavailable;
    indexPanel.hidden = !indexOpen;
    indexButton.setAttribute('aria-expanded', String(indexOpen));
    indexButton.textContent = glass ? (indexOpen && !unavailable ? '收起目錄' : '圖片目錄') : (indexOpen && !unavailable ? '收起目錄 ×' : '圖片目錄 ↗');
    root.classList.toggle('helix-index-open', indexOpen);
    hover = null;
    pointerLocation = null;
    velocity = 0;
    if (moveFocus) (indexOpen ? indexGrid.querySelector('button') : glass ? indexButton : stage)?.focus({ preventScroll: true });
    wake();
  }
  function filterBy(value) {
    if (mode !== 'gallery' || value === filter) return;
    filterMemory.set(filter, offset);
    filter = value;
    filtered = images.filter(entry => value === 'all' || discipline(entry, value));
    offset = filterMemory.get(value) ?? -front();
    velocity = 0;
    target = null;
    hover = null;
    pointerLocation = null;
    filterNav.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === value)));
    updateCaption(filtered[currentIndex()]);
    renderIndex();
    announce(`${filtered.length} 件${categories.get(value)}作品`);
    wake();
  }
  function step(delta) {
    if (mode !== 'gallery' || !filtered.length) return;
    hover = null;
    pointerLocation = null;
    velocity = 0;
    const baseline = target ?? offset;
    target = Math.round(baseline + front()) + delta - front();
    direction = Math.sign(delta);
    if (motion.matches || unavailable) { offset = target; target = null; }
    updateCaption(filtered[mod(Math.round((target ?? offset) + front()), filtered.length)]);
    announce(selected.item.labelZh || selected.item.label || selected.project.title);
    wake();
  }
  function requestOpen(entry, trigger) {
    if (!entry || mode !== 'gallery') return;
    selected = entry;
    velocity = 0;
    target = null;
    hover = null;
    pointerLocation = null;
    updateCaption(entry);
    try {
      Promise.resolve(openItem(entry.projectId, entry.index, trigger)).catch(() => announce('圖片暫時無法打開，請再試一次。'));
    } catch { announce('圖片暫時無法打開，請再試一次。'); }
  }
  function paintGeometry(record, amount = 0) {
    const p = parameters();
    const r = record.relative;
    const theta = r * p.angle;
    const rotation = Math.PI / 2 - theta;
    const cosine = Math.cos(rotation), sine = Math.sin(rotation);
    const centerX = p.radius * Math.cos(theta), centerY = r * p.gap - .5, centerZ = p.radius * Math.sin(theta);
    const reveal = glass ? 1 : 1 - record.hoverAmount * .05;
    const zoom = glass ? 1 : 1 + record.hoverAmount * .05;
    const frameHeight = glass ? Math.min(p.height, p.width / record.imageAspect) : p.height;
    const frameWidth = glass ? frameHeight * record.imageAspect : p.width;
    const ratioX = Math.min((p.width / p.height) / record.imageAspect, 1);
    const ratioY = Math.min(record.imageAspect / (p.width / p.height), 1);
    const position = record.geometry.attributes.position;
    const uv = record.geometry.attributes.uv;
    let destination = null;
    if (amount > 0 && readerState?.record === record) destination = readerPlane();
    for (let row = 0; row <= 6; row++) {
      const v = 1 - row / 6;
      for (let column = 0; column <= 32; column++) {
        const u = column / 32, index = row * 33 + column;
        const localX = (u - .5) * frameWidth * reveal;
        const localY = (v - .5) * frameHeight * reveal;
        const localZ = Math.sin(u * Math.PI) * p.bow * (glass ? frameWidth / p.width : 1);
        let x = centerX + cosine * localX + sine * localZ;
        let y = centerY + localY;
        let z = centerZ - sine * localX + cosine * localZ;
        x += y * y * .1 + Math.sin(v * Math.PI) * velocity / 30;
        if (destination) {
          x += (destination.x + (u - .5) * destination.width - x) * amount;
          y += (destination.y + (v - .5) * destination.height - y) * amount;
          z += (destination.z - z) * amount;
        }
        position.setXYZ(index, x, y, z);
        const cropU = .5 + (u - .5) * ratioX / zoom;
        const cropV = .5 + (v - .5) * ratioY / zoom;
        uv.setXY(index, glass ? u : cropU + (u - cropU) * amount, glass ? v : cropV + (v - cropV) * amount);
      }
    }
    position.needsUpdate = true;
    uv.needsUpdate = true;
    record.geometry.computeBoundingSphere();
    record.geometry.computeBoundingBox();
  }
  function readerPlane() {
    const p = readerState.normalizedRect;
    const z = 3;
    const viewHeight = 2 * (camera.position.z - z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const viewWidth = viewHeight * camera.aspect;
    const areaWidth = p.width * viewWidth, areaHeight = p.height * viewHeight;
    const aspect = readerState.record.imageAspect;
    const width = Math.min(areaWidth, areaHeight * aspect);
    const height = width / aspect;
    return { x: (p.x - .5) * viewWidth, y: (.5 - p.y) * viewHeight, width, height, z };
  }
  function layout(dt = 0, amount = 0) {
    if (!filtered.length) return;
    for (const record of records) {
      const virtual = record.slot + Math.round((offset - record.slot) / density) * density;
      record.relative = virtual - offset;
      assign(record, filtered[mod(virtual, filtered.length)]);
      const hovered = hover === record && mode === 'gallery' ? 1 : 0;
      record.hoverAmount += (hovered - record.hoverAmount) * (dt ? 1 - Math.exp(-dt * 18) : 1);
      if (Math.abs(record.hoverAmount - hovered) < .001) record.hoverAmount = hovered;
      const isReader = readerState?.record === record;
      record.material.opacity = isReader ? 1 : 1 - amount;
      if (record.material.map) record.material.color.setScalar(1 - record.hoverAmount * .2 * (1 - amount));
      paintGeometry(record, isReader ? amount : 0);
    }
  }
  function hit(x, y) {
    if (unavailable || indexOpen || !filtered.length) return null;
    pointerNdc.set((x - stageRect.left) / stageRect.width * 2 - 1, 1 - (y - stageRect.top) / stageRect.height * 2);
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(pointerNdc, camera);
    const match = raycaster.intersectObjects(records.map(record => record.mesh), false)[0];
    if (!match) return null;
    const record = match.object.userData.record;
    const yCenter = record.relative * parameters().gap - .5;
    return yCenter >= -.8 && yCenter <= 1.65 ? record : null;
  }
  function tick(time) {
    frame = 0;
    if (disposed || unavailable) return;
    const dt = lastTime ? Math.min((time - lastTime) / 1000, .045) : 1 / 60;
    lastTime = time;
    let amount = mode === 'reading' ? 1 : 0;
    if (transition) {
      const progress = transition.duration ? clamp((time - transition.start) / transition.duration, 0, 1) : 1;
      amount = transition.entering ? ease(progress) : 1 - ease(progress);
      if (progress >= 1) {
        const finished = transition;
        transition = null;
        mode = finished.entering ? 'reading' : 'gallery';
        root.classList.toggle('helix-reading', finished.entering);
        if (!finished.entering) readerState = null;
        finished.resolve();
      }
    } else if (mode === 'gallery') {
      const held = externallyPaused || manuallyPaused || focusHeld || hover || pointer || indexOpen || motion.matches || document.hidden;
      if (target !== null) {
        offset += (target - offset) * (1 - Math.exp(-dt * 8));
        if (Math.abs(target - offset) < .002) { offset = target; target = null; }
      } else if (!held) {
        offset += (velocity + direction * .108) * dt;
        velocity *= Math.exp(-dt * 4.4);
        if (Math.abs(velocity) < .005) velocity = 0;
      }
    }
    layout(dt, amount);
    if (mode === 'gallery') {
      if (pointerLocation && !pointer && target === null && !indexOpen) {
        const next = hit(pointerLocation.x, pointerLocation.y);
        if (next !== hover) { hover = next; canvas.style.cursor = hover ? 'pointer' : 'grab'; }
      }
      if (!target) updateCaption(hover?.entry || filtered[currentIndex()]);
    }
    renderer.render(scene, camera);
    const easingHover = records.some(record => Math.abs(record.hoverAmount - (hover === record && mode === 'gallery' ? 1 : 0)) > .001);
    const idle = mode === 'gallery' && !externallyPaused && !manuallyPaused && !focusHeld && !hover && !pointer && !indexOpen && !motion.matches && !document.hidden;
    if (transition || target !== null || easingHover || idle || pointer) wake();
  }
  function resize() {
    if (disposed) return;
    const rect = stage.getBoundingClientRect();
    stageRect = { left: rect.left, top: rect.top, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    const previousFront = front();
    narrow = stageRect.width < 768;
    // Keep the same front image when changing between the two source proportions.
    if (mode === 'gallery' && !pointer) {
      offset += previousFront - front();
      if (target !== null) target += previousFront - front();
    }
    camera.fov = narrow ? 45 : 32;
    camera.position.set(0, 0, narrow ? 7.8 : 9.5);
    camera.aspect = stageRect.width / stageRect.height;
    camera.updateProjectionMatrix();
    renderer?.setSize(stageRect.width, stageRect.height, false);
    lastTime = 0;
    wake();
  }
  function fallback() {
    const moveFocus = unified && stage.contains(document.activeElement);
    unavailable = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (transition) { transition.resolve(); transition = null; }
    canvas.hidden = true;
    root.classList.add('helix-fallback');
    loading.hidden = true;
    if (unified) { renderIndex(); stage.tabIndex = -1; }
    showIndex(true);
    if (moveFocus) indexGrid.querySelector('button')?.focus({ preventScroll: true });
    announce('可從圖片目錄繼續瀏覽。');
  }
  function animateReader(entering) {
    if (transition) transition.resolve();
    mode = entering ? 'entering' : 'exiting';
    return new Promise(resolve => {
      transition = { entering, start: performance.now(), duration: motion.matches ? 0 : entering ? 520 : 450, resolve };
      root.classList.add('helix-reading');
      wake();
    });
  }
  function enter({ projectId, index, rect } = {}) {
    if (disposed || (!unified && unavailable) || !filtered.length) return Promise.resolve();
    const entry = filtered.find(candidate => candidate.projectId === projectId && candidate.index === index);
    if (!entry) return Promise.resolve();
    velocity = 0;
    target = null;
    hover = null;
    pointerLocation = null;
    if (unified && selected !== entry) {
      // A choice made by the shared directory should be the visible selection
      // on return, even when its old slot was far around the spiral.
      const entryIndex = filtered.indexOf(entry);
      const virtualIndex = entryIndex + Math.round((offset + front() - entryIndex) / filtered.length) * filtered.length;
      offset = virtualIndex - front();
      if (!unavailable) layout();
    }
    selected = entry;
    if (unavailable) { updateCaption(entry); return Promise.resolve(); }
    let record = records.filter(candidate => candidate.entry === entry).sort((a, b) => Math.abs(a.relative - front()) - Math.abs(b.relative - front()))[0];
    if (!record || Math.abs(record.relative - front()) > 4) {
      offset = filtered.indexOf(entry) - front();
      layout();
      record = records.find(candidate => candidate.entry === entry);
    }
    if (!record) return Promise.resolve();
    const box = rect && rect.width > 0 && rect.height > 0 ? rect : { left: stageRect.left + stageRect.width * .12, top: stageRect.top + stageRect.height * .12, width: stageRect.width * .76, height: stageRect.height * .76 };
    readerState = { record, normalizedRect: { x: (box.left + box.width / 2 - stageRect.left) / stageRect.width, y: (box.top + box.height / 2 - stageRect.top) / stageRect.height, width: box.width / stageRect.width, height: box.height / stageRect.height } };
    updateCaption(entry);
    return animateReader(true);
  }
  function exit() {
    if (disposed || unavailable || !readerState) {
      mode = 'gallery';
      readerState = null;
      root.classList.remove('helix-reading');
      return Promise.resolve();
    }
    return animateReader(false);
  }
  function pause() { externallyPaused = true; velocity = 0; wake(); }
  function resume() { externallyPaused = false; pointerLocation = null; hover = null; lastTime = 0; wake(); }

  filterNav.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => filterBy(button.dataset.filter), { signal }));
  root.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => step(Number(button.dataset.step)), { signal }));
  openButton.addEventListener('click', () => requestOpen(selected, openButton), { signal });
  indexButton.addEventListener('click', () => showIndex(!indexOpen, true), { signal });
  indexGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-image]');
    if (!button) return;
    const entry = filtered[Number(button.dataset.image)];
    if (!unavailable) {
      showIndex(false);
      if (glass) openButton.focus({ preventScroll: true });
    }
    // The reader receives a persistent, visible return target instead of a hidden index button.
    requestOpen(entry, unavailable ? button : openButton);
  }, { signal });
  pauseButton.addEventListener('click', () => {
    manuallyPaused = !manuallyPaused;
    pauseButton.textContent = manuallyPaused ? '繼續動態' : '暫停動態';
    pauseButton.setAttribute('aria-pressed', String(manuallyPaused));
    if (glass && manuallyPaused) target = null;
    if (glass) announce(manuallyPaused ? '已暫停動態' : '已繼續動態');
    if (!manuallyPaused) focusHeld = false;
    velocity = 0;
    wake();
  }, { signal });
  root.addEventListener('focusin', () => { focusHeld = true; wake(); }, { signal });
  root.addEventListener('focusout', event => { focusHeld = root.contains(event.relatedTarget) || filterNav.contains(event.relatedTarget); wake(); }, { signal });
  if (unified) {
    filterNav.addEventListener('focusin', () => { focusHeld = true; wake(); }, { signal });
    filterNav.addEventListener('focusout', event => { focusHeld = root.contains(event.relatedTarget) || filterNav.contains(event.relatedTarget); wake(); }, { signal });
  }
  root.addEventListener('keydown', event => {
    if (mode !== 'gallery' || externallyPaused || host.hidden || host.closest('[hidden]') || !root.getClientRects().length || event.altKey || event.ctrlKey || event.metaKey) return;
    // The preview index is a disclosure, not a modal: Tab remains native,
    // Escape returns to its toggle, and arrow keys scroll the index itself.
    if (glass && indexOpen) {
      if (event.key === 'Escape' && !unavailable) {
        event.preventDefault(); event.stopPropagation(); showIndex(false, true);
      }
      return;
    }
    if (event.target.closest('button,a,input,select,textarea,summary,[role=dialog]')) return;
    if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) {
      event.preventDefault();
      step(['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1);
    } else if ((event.key === 'Enter' || event.key === ' ') && event.target === stage) {
      event.preventDefault(); requestOpen(selected, stage);
    } else if (event.key === 'Escape' && indexOpen && !unavailable) { event.preventDefault(); showIndex(false, true); }
  }, { signal });
  stage.addEventListener('wheel', event => {
    if (mode !== 'gallery' || indexOpen || unavailable || externallyPaused) return;
    event.preventDefault();
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stageRect.height : 1;
    const delta = clamp(event.deltaY * units, -300, 300);
    target = null; hover = null; pointerLocation = null;
    direction = Math.sign(delta) || direction;
    if (motion.matches || manuallyPaused || focusHeld) offset += delta * .003;
    else velocity = clamp(velocity + delta * .014, -13, 13);
    wake();
  }, { passive: false, signal });
  stage.addEventListener('pointerdown', event => {
    if (pointer || mode !== 'gallery' || unavailable || indexOpen || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    focusHeld = false;
    const record = hit(event.clientX, event.clientY);
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: performance.now(), distance: 0, record, speed: 0 };
    stage.setPointerCapture(event.pointerId);
    velocity = 0; target = null; hover = null; pointerLocation = null;
    canvas.style.cursor = 'grabbing';
    wake();
  }, { signal });
  stage.addEventListener('pointermove', event => {
    if (mode !== 'gallery' || unavailable || indexOpen) return;
    if (pointer) {
      if (pointer.id !== event.pointerId) return;
      const now = performance.now();
      const dy = event.clientY - pointer.y;
      pointer.distance = Math.max(pointer.distance, Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY));
      if (pointer.distance > 7) {
        offset += dy * .012;
        pointer.speed = clamp(dy * .012 / Math.max((now - pointer.time) / 1000, .008), -13, 13);
        direction = Math.sign(dy) || direction;
      }
      pointer.x = event.clientX; pointer.y = event.clientY; pointer.time = now;
    } else if (event.pointerType !== 'touch') pointerLocation = { x: event.clientX, y: event.clientY };
    wake();
  }, { signal });
  function finishPointer(event, cancel = false) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const last = pointer;
    pointer = null;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'grab';
    if (!cancel && last.distance <= 7 && last.record) requestOpen(last.record.entry, openButton);
    else if (!cancel && !motion.matches && !manuallyPaused && !focusHeld) velocity = last.speed;
    wake();
  }
  stage.addEventListener('pointerup', event => finishPointer(event), { signal });
  stage.addEventListener('pointercancel', event => finishPointer(event, true), { signal });
  stage.addEventListener('lostpointercapture', event => finishPointer(event, true), { signal });
  stage.addEventListener('pointerleave', () => { if (!pointer) { hover = null; pointerLocation = null; wake(); } }, { signal });
  window.addEventListener('blur', () => {
    if (pointer && stage.hasPointerCapture(pointer.id)) stage.releasePointerCapture(pointer.id);
    pointer = null; hover = null; pointerLocation = null; velocity = 0; wake();
  }, { signal });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fallback(); }, { signal });
  document.addEventListener('visibilitychange', () => { lastTime = 0; velocity = 0; wake(); }, { signal });
  motion.addEventListener('change', () => {
    velocity = 0;
    if (motion.matches && target !== null) { offset = target; target = null; }
    pauseButton.hidden = motion.matches;
    wake();
  }, { signal });
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  renderIndex();
  updateCaption();
  pauseButton.hidden = motion.matches;
  resize();
  if (unavailable || !filtered.length) fallback();

  function dispose() {
    if (disposed) return;
    disposed = true;
    events.abort();
    observer.disconnect();
    cancelAnimationFrame(frame);
    if (transition) { transition.resolve(); transition = null; }
    for (const record of records) { record.geometry.dispose(); record.material.dispose(); }
    for (const entry of textureCache.values()) entry.texture?.dispose();
    scene.clear();
    renderer?.dispose();
    if (unified) filterNav.remove();
    root.remove();
  }
  return { dispose, pause, resume, enter, exit, ...(glass ? { galleryIndexItems: () => [...filtered] } : {}) };
}
