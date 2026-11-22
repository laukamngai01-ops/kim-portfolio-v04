import * as THREE from '../vendor/three/three.module.min.js';

// An original implementation of R03's physical-disc browsing mechanism.
// All artwork comes from the supplied portfolio items. No reference-site assets,
// video players, audio sources, or third-party runtime packages are used here.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ease = value => value < .5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
const text = value => String(value ?? '');
const escapeHTML = value => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function mount(host, { items = [], openItem, createVinylEdition, createCinemaTitle }) {
  const glass = document.body.hasAttribute('data-glass');
  const format = createVinylEdition ? '液體黑膠唱片' : '光碟';
  const films = items.filter(entry => entry.item.type === 'video').map((entry, index, all) => {
    const siblings = all.filter(other => other.projectId === entry.projectId);
    const ordinal = siblings.indexOf(entry) + 1;
    return {
      ...entry,
      isAI: entry.project.category === 'AI Film' || entry.project.disciplines?.includes('ai-film'),
      name: siblings.length > 1 ? `${entry.project.title} / ${ordinal}` : entry.project.title,
      nameZh: siblings.length > 1 ? `${entry.project.titleZh} / ${ordinal}` : entry.project.titleZh,
      ordinal,
    };
  });
  const abort = new AbortController();
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = media.matches;
  let disposed = false;
  let paused = false;
  let lost = false;
  let reading = false;
  let filter = 'all';
  let visible = [...films];
  let selected = 0;
  let position = 0;
  let velocity = 0;
  let pointer = null;
  let hovered = null;
  let hoverX = 0;
  let hoverY = 0;
  let frame = 0;
  let previousTime = 0;
  let flight = null;
  let carry = null;
  let bounds = { width: 1, height: 1, left: 0, top: 0 };
  let renderer;
  let scene;
  let camera;
  let gallery;
  let environmentTarget;
  let viewHeight = 3.2;
  const records = new Map();
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const images = new Set();
  const raycaster = new THREE.Raycaster();
  const cursor = new THREE.Vector2();
  const axisY = new THREE.Vector3(0, 1, 0);
  const spinQuaternion = new THREE.Quaternion();
  const identityQuaternion = new THREE.Quaternion();

  host.innerHTML = `<section class="discs-scene" aria-label="影片${format}目錄">
    <div class="discs-canvas" tabindex="0" role="group" aria-label="影片${format}" aria-describedby="discs-instructions"></div>
    ${glass ? '<header class="discs-toolbar">' : ''}
    <div class="discs-heading">
      <h1 class="discs-title"></h1>${glass ? '<div class="discs-subtitle"><p class="discs-title-zh"></p><p class="discs-disclosure" hidden></p></div>' : '<p class="discs-title-zh"></p>'}
      ${glass ? '' : '<dl><div><dt>類別</dt><dd class="discs-kind"></dd></div><div><dt>創作</dt><dd class="discs-role"></dd></div></dl>'}
    </div>
    <nav class="discs-filters" aria-label="影片分類">
      ${glass ? '<div class="discs-filter-track">' : ''}
      <button type="button" data-filter="all" aria-pressed="true">全部影片</button>
      <button type="button" data-filter="film" aria-pressed="false">影片</button>
      <button type="button" data-filter="ai" aria-pressed="false">AI 影片</button>
      ${glass ? '</div>' : ''}
      <button type="button" class="discs-list-toggle" aria-expanded="false" aria-controls="discs-list">${glass ? '片單' : '片單 <span>＋</span>'}</button>
    </nav>
    ${glass ? '</header>' : ''}
    <div class="discs-list" id="discs-list" hidden></div>
    <div class="discs-caption">
      <p class="discs-description"${glass ? ' hidden' : ''}></p>${glass ? '' : '<p class="discs-disclosure"></p>'}
      <div class="discs-controls">
        <button type="button" class="discs-prev" aria-label="上一部影片">${glass ? '上一部' : '<span aria-hidden="true">←</span><small>上一部</small>'}</button>
        <span class="discs-counter" aria-live="polite" aria-atomic="true"></span>
        <button type="button" class="discs-flip" aria-pressed="false">翻到背面</button>
        <button type="button" class="discs-open">${glass ? '觀看影片' : '開啟影片 <span>↗</span>'}</button>
        <button type="button" class="discs-next" aria-label="下一部影片">${glass ? '下一部' : '<span aria-hidden="true">→</span><small>下一部</small>'}</button>
      </div>
      <p id="discs-instructions" class="discs-instructions"><span class="discs-pointer-help">${createVinylEdition ? '拖動盤面翻看，拖動空白處選片。' : '拖動光碟翻看，拖動空白處選片。'}</span><span class="discs-touch-help">${createVinylEdition ? '左右滑動選片，點選唱片開啟。' : '左右滑動選片，點選光碟開啟。'}</span><span class="discs-key-help">${glass ? '左右鍵選片' : '← → 選片'} · 空格翻面 · Enter 開啟</span></p>
    </div>
    <div class="discs-fallback" hidden><p>三維場景暫時無法顯示，仍可從片單開啟影片。</p><div></div></div>
    <span class="discs-status" role="status"></span>
  </section>`;
  const root = host.querySelector('.discs-scene');
  const canvasHost = root.querySelector('.discs-canvas');
  const title = root.querySelector('.discs-title');
  const titleZh = root.querySelector('.discs-title-zh');
  const kind = root.querySelector('.discs-kind');
  const role = root.querySelector('.discs-role');
  const description = root.querySelector('.discs-description');
  const disclosure = root.querySelector('.discs-disclosure');
  const counter = root.querySelector('.discs-counter');
  const prev = root.querySelector('.discs-prev');
  const next = root.querySelector('.discs-next');
  const flipButton = root.querySelector('.discs-flip');
  const openButton = root.querySelector('.discs-open');
  const list = root.querySelector('.discs-list');
  const listToggle = root.querySelector('.discs-list-toggle');
  const fallback = root.querySelector('.discs-fallback');
  const status = root.querySelector('.discs-status');
  const current = () => visible[selected];
  const unavailable = () => !renderer || lost;
  const cinemaTitle = glass && createCinemaTitle ? createCinemaTitle({
    heading: root.querySelector('.discs-heading'), title, titleZh, disclosure, entries: films,
    canAnimate: () => !reducedMotion && !paused && !reading && !flight && !document.hidden,
  }) : null;

  function listen(target, event, callback, options = {}) {
    target.addEventListener(event, callback, { ...options, signal: abort.signal });
  }
  function ownGeometry(geometry) { geometries.add(geometry); return geometry; }
  function ownMaterial(material) { materials.add(material); return material; }
  function ownTexture(texture) { textures.add(texture); return texture; }
  function canvasTexture(canvas) {
    const texture = ownTexture(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }
  function createCanvas(size = 1024) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    return canvas;
  }

  function drawPrint(canvas, entry, photo) {
    const ctx = canvas.getContext('2d');
    const side = canvas.width;
    ctx.fillStyle = entry.isAI ? '#343641' : '#364349';
    ctx.fillRect(0, 0, side, side);
    if (photo) {
      const scale = side / Math.min(photo.naturalWidth, photo.naturalHeight);
      const width = photo.naturalWidth * scale;
      const height = photo.naturalHeight * scale;
      ctx.drawImage(photo, (side - width) / 2, (side - height) / 2, width, height);
    }
    const shade = ctx.createLinearGradient(0, 0, 0, side);
    shade.addColorStop(0, 'rgba(0,0,0,.2)');
    shade.addColorStop(.48, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,.76)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, side, side);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fafaf3';
    ctx.font = '500 53px Archivo, sans-serif';
    const words = entry.project.title.replace(/\.$/, '').split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > 680 && line) { lines.push(line); line = word; }
      else line = candidate;
    }
    lines.push(line);
    lines.slice(0, 3).forEach((value, index) => ctx.fillText(value, side / 2, 760 + index * 59));
    ctx.font = '500 20px "DM Sans", sans-serif';
    ctx.fillText(`Kim   /   ${entry.isAI ? 'AI film' : 'Film'}   /   ${entry.ordinal}`, side / 2, 923);
    ctx.font = '500 23px "DM Sans", sans-serif';
    ctx.fillText(entry.isAI ? 'AI-assisted moving image' : 'Selected moving image', side / 2, 140);
    // The manufacturing rings are drawn locally; the physical hole is geometry.
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(512, 512, 503, 0, Math.PI * 2); ctx.stroke();
  }

  function createBackTexture() {
    const canvas = createCanvas();
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#d0d3d7'; ctx.fillRect(0, 0, 1024, 1024);
    // Fine concentric data tracks, illuminated further by physical iridescence.
    for (let radius = 126; radius < 507; radius += 1.8) {
      ctx.strokeStyle = radius % 7 < 3 ? 'rgba(255,255,255,.19)' : 'rgba(45,53,65,.09)';
      ctx.lineWidth = .6; ctx.beginPath(); ctx.arc(512, 512, radius, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#62666b'; ctx.textAlign = 'center'; ctx.font = '18px "DM Sans", sans-serif';
    ctx.fillText('Kim / Moving image archive', 512, 325);
    return canvasTexture(canvas);
  }

  function buildEnvironment() {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(.44, '#ababaf');
    gradient.addColorStop(.52, '#4d535f'); gradient.addColorStop(.68, '#ceced2'); gradient.addColorStop(1, '#f1f1ed');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(80, 30, 92, 290); ctx.fillRect(660, 0, 170, 205);
    ctx.fillStyle = '#444b57'; ctx.fillRect(350, 130, 65, 155);
    const texture = canvasTexture(canvas); texture.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    environmentTarget = pmrem.fromEquirectangular(texture);
    scene.environment = environmentTarget.texture;
    pmrem.dispose();
  }

  function ring(inner, outer, segments = 192) {
    const geometry = ownGeometry(new THREE.RingGeometry(inner, outer, segments, 1));
    const points = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < points.count; i++) uv.setXY(i, points.getX(i) / 2 + .5, points.getY(i) / 2 + .5);
    return geometry;
  }

  function buildDisc(entry, shared) {
    const group = new THREE.Group();
    const printCanvas = createCanvas(); drawPrint(printCanvas, entry);
    const printTexture = canvasTexture(printCanvas);
    // The printed artwork bypasses studio reflection/tone mapping, preventing
    // the metallic lighting from bleaching the user's photograph on a phone.
    // Hub, edge and the reverse retain their physical reflective materials.
    const frontMaterial = ownMaterial(new THREE.MeshBasicMaterial({ map: printTexture, toneMapped: false }));
    const front = new THREE.Mesh(shared.face, frontMaterial); front.position.z = .012;
    const back = new THREE.Mesh(shared.face, shared.backMaterial); back.rotation.y = Math.PI; back.position.z = -.012;
    const outer = new THREE.Mesh(shared.edge, shared.edgeMaterial); outer.rotation.x = Math.PI / 2;
    const hub = new THREE.Mesh(shared.hub, shared.hubMaterial);
    const matrix = new THREE.Mesh(shared.matrix, shared.matrixMaterial);
    const inner = new THREE.Mesh(shared.innerEdge, shared.edgeMaterial); inner.rotation.x = Math.PI / 2;
    group.add(front, back, outer, hub, matrix, inner);
    return { group, front, printTexture, printCanvas, drawPhoto(photo) {
      drawPrint(printCanvas, entry, photo);
      printTexture.needsUpdate = true;
    } };
  }

  function registerDisc(entry, model) {
    model.group.userData.key = entry.key;
    gallery.add(model.group);
    const record = { ...model, entry, spin: 0, spinTarget: 0, pitch: 0, pitchTarget: 0, photo: null };
    records.set(entry.key, record);
    const photo = new Image();
    images.add(photo);
    photo.crossOrigin = 'anonymous';
    photo.onload = () => {
      images.delete(photo);
      if (disposed) return;
      record.photo = photo;
      record.drawPhoto(photo);
      requestFrame();
    };
    photo.onerror = () => {
      images.delete(photo);
      if (!disposed && current()?.key === entry.key) status.textContent = '海報暫時無法顯示，仍可開啟影片。';
    };
    photo.src = entry.item.image || entry.item.small || entry.project.cover;
  }

  function initScene() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    canvasHost.append(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(36, 1, .1, 80);
    gallery = new THREE.Group(); gallery.rotation.set(-.49, -.49, 0); scene.add(gallery);
    if (!createVinylEdition) buildEnvironment();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xa7a5ae, 2.2));
    const key = new THREE.DirectionalLight(0xfffbef, 3.1); key.position.set(-3, 5, 6); scene.add(key);
    const fill = new THREE.DirectionalLight(0xe4e9ff, 1.6); fill.position.set(4, -1, 4); scene.add(fill);
    if (createVinylEdition) {
      const build = createVinylEdition({ scene, ring, ownGeometry, ownMaterial, ownTexture, createCanvas, canvasTexture, requestFrame });
      films.forEach((entry, index) => registerDisc(entry, build(entry, index)));
    } else {
      const shared = opticalDiscParts();
      films.forEach(entry => registerDisc(entry, buildDisc(entry, shared)));
    }
    listen(renderer.domElement, 'webglcontextlost', event => {
      event.preventDefault(); lost = true; cancelPointer(); finishFlight(false); carry = null; reading = false;
      if (frame) cancelAnimationFrame(frame); frame = 0;
      showFallback('三維場景已中斷，仍可從片單開啟每一部影片。');
    });
  }

  function opticalDiscParts() {
    return {
      face: ring(.241, .992), hub: ring(.14, .24), matrix: ring(.215, .241),
      edge: ownGeometry(new THREE.CylinderGeometry(1, 1, .024, 192, 1, true)),
      innerEdge: ownGeometry(new THREE.CylinderGeometry(.14, .14, .024, 128, 1, true)),
      backMaterial: ownMaterial(new THREE.MeshPhysicalMaterial({ map: createBackTexture(), color: 0xe0e4ec,
        metalness: 1, roughness: .19, iridescence: 1, iridescenceIOR: 1.78,
        iridescenceThicknessRange: [180, 820], clearcoat: .48, envMapIntensity: 1.25 })),
      edgeMaterial: ownMaterial(new THREE.MeshPhysicalMaterial({ color: 0xcbd0d9, metalness: .85, roughness: .18, side: THREE.DoubleSide })),
      hubMaterial: ownMaterial(new THREE.MeshPhysicalMaterial({ color: 0xdddfe6, metalness: .12, roughness: .27,
        transmission: .5, thickness: .03, ior: 1.46, side: THREE.DoubleSide, transparent: true, opacity: .85 })),
      matrixMaterial: ownMaterial(new THREE.MeshStandardMaterial({ color: 0x9fa2ab, metalness: .7, roughness: .28, side: THREE.DoubleSide })),
    };
  }

  function listMarkup(entries) {
    return entries.map(entry => `<button type="button" data-film="${escapeHTML(entry.key)}">
      <img src="${escapeHTML(entry.item.small || entry.item.image || entry.project.cover)}" alt="" loading="lazy">
      <span>${escapeHTML(entry.name)}<small>${entry.isAI ? 'AI 輔助影片 / AI film' : '影片 / Film'}</small></span><span>${glass ? '開啟' : '↗'}</span>
    </button>`).join('');
  }
  function setList(open) {
    list.hidden = !open;
    listToggle.setAttribute('aria-expanded', String(open));
    if (glass) listToggle.textContent = open ? '收起片單' : '片單';
    else listToggle.querySelector('span').textContent = open ? '−' : '＋';
  }
  function updateMeta({ animateTitle = true } = {}) {
    const entry = current();
    if (!entry) return;
    if (cinemaTitle) cinemaTitle.render(entry, { immediate: !animateTitle });
    else { title.textContent = entry.name; titleZh.textContent = entry.nameZh; }
    if (kind) kind.textContent = entry.isAI ? 'AI 影片 / AI film' : '影片 / Film';
    if (role) role.textContent = entry.project.roleZh || entry.project.role;
    description.textContent = entry.item.labelZh && entry.item.label !== entry.project.title ? entry.item.labelZh : (entry.project.introZh || entry.project.intro).split(/(?<=[。])|(?<=\.)\s/)[0];
    if (!cinemaTitle) {
      disclosure.textContent = entry.isAI ? (entry.project.disclosure || 'AI-assisted moving image / AI 輔助影片') : '';
      disclosure.hidden = !entry.isAI;
    }
    counter.textContent = `${selected + 1} / ${visible.length}`;
    prev.disabled = selected === 0; next.disabled = selected === visible.length - 1;
    const back = Math.abs(records.get(entry.key)?.spinTarget || 0) > Math.PI / 2;
    flipButton.setAttribute('aria-pressed', String(back));
    flipButton.textContent = back ? '翻回正面' : '翻到背面';
    flipButton.disabled = unavailable();
    openButton.setAttribute('aria-label', `${glass ? '觀看' : '開啟'}影片：${entry.nameZh} ${entry.name}`);
    canvasHost.setAttribute('aria-label', `${entry.nameZh}，${entry.name}，影片${format}`);
    for (const button of list.querySelectorAll('button')) button.setAttribute('aria-current', String(button.dataset.film === entry.key));
  }
  function rebuildLists() {
    list.innerHTML = listMarkup(visible);
    fallback.querySelector('div').innerHTML = listMarkup(visible);
    listToggle.setAttribute('aria-label', `片單，${visible.length} 部影片`);
  }
  function showFallback(message) {
    root.classList.add('discs-is-fallback');
    fallback.hidden = false;
    if (message) fallback.querySelector('p').textContent = message;
    canvasHost.hidden = true;
    root.classList.remove('discs-is-reading');
    updateMeta();
  }

  function setSelection(index, immediate = false) {
    if (!visible.length) return;
    selected = clamp(index, 0, visible.length - 1);
    if (immediate || reducedMotion) { position = selected; velocity = 0; }
    hovered = null; hoverX = hoverY = 0;
    updateMeta({ animateTitle: !immediate }); requestFrame();
  }
  function setFilter(value) {
    if (reading || flight) return;
    const key = current()?.key;
    filter = value;
    visible = films.filter(entry => value === 'all' || (value === 'ai' ? entry.isAI : !entry.isAI));
    for (const button of root.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === value));
    rebuildLists(); setList(false);
    setSelection(Math.max(0, visible.findIndex(entry => entry.key === key)), true);
  }
  function flip() {
    if (reading || flight || paused || unavailable()) return;
    const record = records.get(current()?.key);
    if (!record) return;
    record.spinTarget = record.spinTarget > Math.PI / 2 ? 0 : Math.PI;
    record.pitchTarget = 0;
    updateMeta(); requestFrame();
  }
  function open(entry = current(), trigger = openButton) {
    if (!entry || reading || flight || paused || disposed) return;
    cinemaTitle?.finish();
    setList(false);
    openItem(entry.projectId, entry.index, trigger);
  }

  function galleryPose(record, at = position) {
    const index = visible.findIndex(entry => entry.key === record.entry.key);
    const relative = index - at;
    const narrow = bounds.width < 700;
    const angle = relative * .35;
    const scale = 1.08 * (1 - .15 * Math.min(Math.abs(relative), 1));
    const x = narrow ? relative * 1.72 : Math.sin(angle) * 5.52;
    const y = narrow ? -Math.min(Math.abs(relative), 2) * .34 : -.015 * Math.abs(relative);
    const z = narrow ? -Math.abs(relative) * .5 : (1 - Math.cos(angle)) * 2.4;
    const rotation = new THREE.Euler(record.pitch, -angle + record.spin, 0);
    if (record.entry.key === current()?.key && !pointer && !reducedMotion) {
      rotation.x += hoverY; rotation.y += hoverX;
    }
    return { position: new THREE.Vector3(x, y, z), quaternion: new THREE.Quaternion().setFromEuler(rotation), scale: new THREE.Vector3(scale, scale, scale), index };
  }
  function applyGallery(background = 0) {
    for (const record of records.values()) {
      if (carry?.record === record) continue;
      const pose = galleryPose(record);
      record.group.visible = pose.index >= 0 && Math.abs(pose.index - position) < 4 && background < .995;
      record.group.position.copy(pose.position); record.group.position.z -= background * 6;
      record.group.quaternion.copy(pose.quaternion); record.group.scale.copy(pose.scale).multiplyScalar(1 - background * .12);
    }
  }
  function requestFrame() {
    if (!disposed && !lost && renderer && !frame && (!paused || flight)) frame = requestAnimationFrame(tick);
  }
  function tick(time) {
    frame = 0;
    if (disposed || lost || !renderer || (paused && !flight)) return;
    const frameSeconds = Math.max(.001, (time - previousTime) / 1000 || .016);
    const dt = Math.min(.034, frameSeconds);
    previousTime = time;
    let moving = false;
    if (!pointer && !reading && !flight) {
      if (reducedMotion) { position = selected; velocity = 0; }
      else {
        velocity += ((selected - position) * 170 - velocity * 24) * dt;
        position += velocity * dt;
        if (Math.abs(position - selected) < .0005 && Math.abs(velocity) < .003) { position = selected; velocity = 0; }
        else moving = true;
      }
    }
    const damping = reducedMotion ? 1 : 1 - Math.exp(-13 * dt);
    for (const record of records.values()) {
      if (carry?.record === record || pointer?.record === record) continue;
      record.spin += (record.spinTarget - record.spin) * damping;
      record.pitch += (record.pitchTarget - record.pitch) * damping;
      if (Math.abs(record.spinTarget - record.spin) > .0005 || Math.abs(record.pitch) > .0005) moving = true;
    }
    const hoverTargetX = hovered === current()?.key && !pointer && !reducedMotion ? cursor.x * .065 : 0;
    const hoverTargetY = hovered === current()?.key && !pointer && !reducedMotion ? -cursor.y * .045 : 0;
    hoverX += (hoverTargetX - hoverX) * damping; hoverY += (hoverTargetY - hoverY) * damping;
    if (Math.abs(hoverX - hoverTargetX) + Math.abs(hoverY - hoverTargetY) > .0005) moving = true;
    const animation = flight;
    const raw = animation ? clamp((time - animation.start) / animation.duration, 0, 1) : 0;
    const progress = animation ? ease(raw) : 0;
    const background = animation ? (animation.direction === 'enter' ? progress : 1 - progress) : reading ? 1 : 0;
    applyGallery(background);
    if (animation && carry) {
      const target = animation.direction === 'enter' ? readerPose(carry.rect) : galleryPose(carry.record, carry.returnPosition);
      carry.record.group.position.lerpVectors(animation.from.position, target.position, progress);
      carry.record.group.position.y += Math.sin(progress * Math.PI) * .28;
      carry.record.group.position.z += Math.sin(progress * Math.PI) * .8;
      carry.record.group.quaternion.slerpQuaternions(animation.from.quaternion, target.quaternion, progress);
      spinQuaternion.setFromAxisAngle(axisY, Math.PI * 2 * progress * (animation.direction === 'enter' ? 1 : -1));
      carry.record.group.quaternion.multiply(spinQuaternion);
      carry.record.group.scale.lerpVectors(animation.from.scale, target.scale, progress);
      carry.record.group.visible = true;
    }
    if (animation && raw >= 1) finishFlight(true);
    if (createVinylEdition) {
      for (const record of records.values()) {
        const index = visible.indexOf(record.entry);
        const nearby = index >= 0 && Math.abs(index - position) < 1.6;
        record.placeShadow(nearby && !flight && !reading && !carry);
        const liquidMoving = record.updateLiquid(Math.min(frameSeconds, .05), reducedMotion, record.entry === current(), nearby);
        moving = moving || liquidMoving;
      }
    }
    renderer.render(scene, camera);
    if (flight || ((!paused && !reading) && (moving || pointer))) requestFrame();
  }

  function resize() {
    if (disposed) return;
    bounds = (createVinylEdition ? canvasHost : root).getBoundingClientRect();
    if (!renderer || lost || bounds.width < 1 || bounds.height < 1) return;
    const aspect = bounds.width / bounds.height;
    // The vinyl stage has already reserved space for its surrounding text.
    // Fit a rotating 2.16-unit record inside the shorter side of that cell.
    if (createVinylEdition) {
      viewHeight = Math.max(2.35, 2.35 / aspect);
      gallery.rotation.set(-.19, -.24, 0);
      gallery.position.set(0, 0, 0);
    } else {
      viewHeight = Math.max(bounds.width < 700 ? 3.9 : 3.05, 2.45 / aspect);
      gallery.rotation.set(bounds.width < 700 ? -.31 : -.49, bounds.width < 700 ? -.32 : -.49, 0);
      gallery.position.set(bounds.width < 700 ? 0 : .1, viewHeight * .035, 0);
    }
    camera.aspect = aspect;
    camera.position.set(0, 0, viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(18))));
    camera.updateProjectionMatrix();
    renderer.setSize(bounds.width, bounds.height, !createVinylEdition);
    scene.updateMatrixWorld(true);
    requestFrame();
  }
  function getHit(event) {
    if (unavailable()) return null;
    cursor.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(cursor, camera);
    const meshes = [...records.values()].filter(record => record.group.visible).map(record => record.group);
    for (const intersection of raycaster.intersectObjects(meshes, true)) {
      let object = intersection.object;
      while (object && !object.userData.key) object = object.parent;
      if (object?.userData.key) return records.get(object.userData.key);
    }
    return null;
  }
  function cancelPointer() {
    if (!pointer) return;
    const active = pointer; pointer = null;
    if (active.record) { active.record.pitchTarget = 0; active.record.spinTarget = active.startSpin > Math.PI / 2 ? Math.PI : 0; }
    try { if (canvasHost.hasPointerCapture(active.id)) canvasHost.releasePointerCapture(active.id); } catch { /* capture already released */ }
    root.classList.remove('discs-is-dragging'); requestFrame();
  }
  function pointerDown(event) {
    if (pointer || event.isPrimary === false || event.button !== 0 || reading || flight || paused || unavailable()) return;
    const hit = getHit(event);
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX,
      time: performance.now(), startPosition: position, moved: false, hit,
      record: event.pointerType === 'mouse' && hit?.entry.key === current()?.key ? hit : null,
      startSpin: hit?.spin || 0, startPitch: hit?.pitch || 0, touch: event.pointerType !== 'mouse', speed: 0 };
    velocity = 0;
    canvasHost.focus({ preventScroll: true });
  }
  function pointerMove(event) {
    if (reading || flight || paused || unavailable()) return;
    if (!pointer) {
      hovered = getHit(event)?.entry.key || null;
      canvasHost.style.cursor = hovered ? 'grab' : 'ew-resize'; requestFrame(); return;
    }
    if (event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!pointer.moved && Math.hypot(dx, dy) < 6) return;
    if (!pointer.moved && pointer.touch && Math.abs(dy) > Math.abs(dx) * 1.15) { cancelPointer(); return; }
    if (!pointer.moved) {
      pointer.moved = true; root.classList.add('discs-is-dragging');
      try { canvasHost.setPointerCapture(event.pointerId); } catch { /* an interrupted gesture can lose capture */ }
    }
    if (event.cancelable) event.preventDefault();
    if (pointer.record) {
      pointer.record.spin = pointer.startSpin + dx * .012;
      pointer.record.pitch = clamp(pointer.startPitch + dy * .009, -.65, .65);
    } else {
      const span = bounds.width < 700 ? 1.55 : 4.2;
      const now = performance.now();
      const change = -(event.clientX - pointer.lastX) / bounds.width * span;
      pointer.speed = pointer.speed * .4 + change / Math.max(.008, (now - pointer.time) / 1000) * .6;
      position = clamp(pointer.startPosition - dx / bounds.width * span, 0, visible.length - 1);
      pointer.lastX = event.clientX; pointer.time = now;
      const nextSelection = Math.round(position);
      if (nextSelection !== selected) { selected = nextSelection; updateMeta(); }
    }
    requestFrame();
  }
  function pointerUp(event, cancelled = false) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const active = pointer; pointer = null;
    root.classList.remove('discs-is-dragging');
    try { if (canvasHost.hasPointerCapture(active.id)) canvasHost.releasePointerCapture(active.id); } catch { /* optional */ }
    if (active.moved) {
      if (active.record) {
        const normalized = ((active.record.spin % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const face = normalized > Math.PI / 2 && normalized < Math.PI * 1.5 ? Math.PI : 0;
        const turns = Math.round((active.record.spin - face) / (Math.PI * 2));
        active.record.spin -= turns * Math.PI * 2;
        active.record.spinTarget = cancelled ? (active.startSpin > Math.PI / 2 ? Math.PI : 0) : face;
        active.record.pitchTarget = 0;
        updateMeta();
      } else setSelection(Math.round(position + (cancelled || reducedMotion ? 0 : clamp(active.speed * .14, -.8, .8))));
    } else if (!cancelled && active.hit) {
      const index = visible.findIndex(entry => entry.key === active.hit.entry.key);
      if (index === selected) open(); else setSelection(index);
    }
    requestFrame();
  }

  function readerPose(originalRect) {
    // The root may resize its invisible dialog during our transition. Read the
    // current stage, not the rect captured before an asynchronous animation.
    const live = document.getElementById('reader-stage')?.getBoundingClientRect();
    const rect = live?.width > 0 && live?.height > 0 ? live : originalRect;
    const width = rect?.width || bounds.width * .65;
    const height = rect?.height || bounds.height * .7;
    const centerX = rect ? rect.left + width / 2 - bounds.left : bounds.width / 2;
    const centerY = rect ? rect.top + height / 2 - bounds.top : bounds.height / 2;
    const z = .7;
    const heightAtZ = viewHeight * (camera.position.z - z) / camera.position.z;
    const units = heightAtZ / bounds.height;
    return { position: new THREE.Vector3((centerX - bounds.width / 2) * units, (bounds.height / 2 - centerY) * units, z),
      quaternion: identityQuaternion, scale: new THREE.Vector3().setScalar(Math.min(width, height) * .42 * units) };
  }
  function finishFlight(completed) {
    const animation = flight;
    if (!animation) return;
    flight = null;
    if (completed && carry) {
      if (animation.direction === 'enter') {
        reading = true;
        const target = readerPose(carry.rect);
        carry.record.group.position.copy(target.position); carry.record.group.quaternion.copy(target.quaternion); carry.record.group.scale.copy(target.scale);
      } else {
        const returnState = carry.returnState;
        position = carry.returnPosition; selected = carry.returnSelected;
        carry.record.spin = carry.returnSpin; carry.record.spinTarget = carry.returnSpin;
        carry.record.pitch = 0; carry.record.pitchTarget = 0;
        carry = null; reading = false; root.classList.remove('discs-is-reading');
        if (returnState) {
          setFilter(returnState.filter);
          selected = Math.max(0, visible.findIndex(entry => entry.key === returnState.key));
          position = clamp(returnState.position, 0, visible.length - 1);
          velocity = 0;
        }
        applyGallery(0); updateMeta({ animateTitle: false });
      }
    }
    animation.resolve(completed);
  }
  function animateFlight(direction) {
    finishFlight(false);
    return new Promise(resolve => {
      const group = carry.record.group;
      flight = { direction, start: performance.now(), duration: reducedMotion ? 1 : direction === 'enter' ? 760 : 820, resolve,
        from: { position: group.position.clone(), quaternion: group.quaternion.clone(), scale: group.scale.clone() } };
      requestFrame();
    });
  }

  listen(prev, 'click', () => { if (!reading && !flight) setSelection(selected - 1); });
  listen(next, 'click', () => { if (!reading && !flight) setSelection(selected + 1); });
  listen(flipButton, 'click', flip);
  listen(openButton, 'click', () => open());
  for (const button of root.querySelectorAll('[data-filter]')) listen(button, 'click', () => setFilter(button.dataset.filter));
  listen(listToggle, 'click', () => setList(list.hidden));
  for (const container of [list, fallback]) listen(container, 'click', event => {
    const button = event.target.closest('[data-film]');
    if (!button) return;
    const index = visible.findIndex(entry => entry.key === button.dataset.film);
    if (index < 0) return;
    setSelection(index, true); open(current(), openButton);
  });
  listen(canvasHost, 'pointerdown', pointerDown);
  listen(canvasHost, 'pointermove', pointerMove, { passive: false });
  listen(canvasHost, 'pointerup', event => pointerUp(event));
  listen(canvasHost, 'pointercancel', event => pointerUp(event, true));
  // A touch starts with implicit capture on the canvas. Moving capture to
  // its host emits a bubbling loss from that child while the swipe is active.
  listen(canvasHost, 'lostpointercapture', event => {
    if (event.target === canvasHost && !canvasHost.hasPointerCapture(event.pointerId)) pointerUp(event, true);
  });
  listen(window, 'pointerup', event => pointerUp(event));
  listen(canvasHost, 'pointerleave', () => { hovered = null; requestFrame(); });
  listen(window, 'blur', cancelPointer);
  listen(canvasHost, 'keydown', event => {
    if (reading || flight || paused || host.hidden || host.closest('[hidden]') || !root.isConnected) return;
    if (event.target.closest('button,a,input,select,textarea,summary,[role=dialog]')) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const actions = { ArrowLeft: () => setSelection(selected - 1), ArrowRight: () => setSelection(selected + 1),
      Home: () => setSelection(0), End: () => setSelection(visible.length - 1), ' ': flip, Enter: () => open() };
    if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
  });
  listen(root, 'keydown', event => { if (event.key === 'Escape' && !list.hidden) { setList(false); listToggle.focus(); } });
  let wheelTime = 0;
  let wheelDelta = 0;
  listen(canvasHost, 'wheel', event => {
    if (reading || flight || paused || event.ctrlKey || unavailable()) return;
    if (event.cancelable) event.preventDefault();
    const now = performance.now();
    if (now - wheelTime > 180) wheelDelta = 0;
    wheelDelta += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(wheelDelta) > 34 && now - wheelTime > 260) {
      setSelection(selected + Math.sign(wheelDelta)); wheelDelta = 0; wheelTime = now;
    }
  }, { passive: false });
  listen(media, 'change', event => { reducedMotion = event.matches; if (reducedMotion) cinemaTitle?.finish(); requestFrame(); });
  listen(document, 'visibilitychange', () => {
    if (document.hidden) { cinemaTitle?.finish(); cancelPointer(); if (frame) cancelAnimationFrame(frame); frame = 0; }
    else requestFrame();
  });
  const observer = new ResizeObserver(resize);
  observer.observe(createVinylEdition ? canvasHost : root);
  rebuildLists();
  if (films.length) {
    try { initScene(); resize(); } catch (error) {
      lost = true;
      if (renderer) renderer.domElement.hidden = true;
      showFallback();
    }
    updateMeta(); requestFrame();
  } else {
    fallback.hidden = false; fallback.querySelector('p').textContent = '這個分類目前沒有影片。';
    canvasHost.hidden = true; root.classList.add('discs-is-fallback');
    prev.disabled = next.disabled = openButton.disabled = flipButton.disabled = true;
  }

  return {
    get hasWebGL() { return !unavailable(); },
    pause() { paused = true; cinemaTitle?.finish(); cancelPointer(); if (frame && !flight) { cancelAnimationFrame(frame); frame = 0; } },
    resume() { paused = false; resize(); requestFrame(); },
    async enter({ projectId, index, rect } = {}) {
      if (disposed || unavailable()) return;
      const entry = films.find(item => item.projectId === projectId && item.index === index);
      if (!entry) return;
      cancelPointer(); setList(false);
      const returnState = { filter, key: current()?.key, position };
      if (!visible.some(item => item.key === entry.key)) setFilter('all');
      setSelection(visible.findIndex(item => item.key === entry.key), true);
      applyGallery(0); scene.updateMatrixWorld(true);
      const record = records.get(entry.key);
      carry = { record, rect, returnPosition: position, returnSelected: selected, returnSpin: record.spinTarget, returnState };
      scene.attach(record.group);
      root.classList.add('discs-is-reading');
      await animateFlight('enter');
    },
    async exit() {
      if (disposed || unavailable() || !carry) { reading = false; root.classList.remove('discs-is-reading'); return; }
      finishFlight(false); reading = false;
      // Returning to gallery-local coordinates preserves the exact selected
      // disc and adapts its resting pose to the current viewport.
      gallery.attach(carry.record.group);
      carry.record.spin = carry.returnSpin;
      await animateFlight('exit');
    },
    dispose() {
      if (disposed) return;
      disposed = true; cinemaTitle?.dispose(); abort.abort(); observer.disconnect();
      if (frame) cancelAnimationFrame(frame); frame = 0;
      finishFlight(false); pointer = null; carry = null;
      for (const image of images) { image.onload = image.onerror = null; } images.clear();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      environmentTarget?.dispose();
      renderer?.dispose();
      records.clear(); scene?.clear(); root.remove();
    },
  };
}
