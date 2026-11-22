import { projects, items } from './data.js';
import { bindPortfolioReader } from './reader.js';

const $ = selector => document.querySelector(selector);
const host = $('#scene-host');
const reader = $('#reader');
const indexDialog = $('#index-dialog');
const stage = $('#reader-stage');
const scenes = new Map();
const glass = document.body.hasAttribute('data-glass');
let directory = null;
let directoryOpener = null;
let restoringDirectory = false;
const directoryReady = glass ? import('../glass/directory.js').then(({ createDirectory }) => {
  directory = createDirectory(indexDialog, projects, openItem);
}).catch(error => {
  console.error('Image directory unavailable', error);
}) : Promise.resolve();
const descriptions = {
  sphere: [`${projects.length} 組作品 · ${items.length} 件媒體`, '互動作品總覽'],
  discs: [`${items.filter(({ item }) => item.type === 'video').length} 部影片`, glass ? '液體黑膠影片目錄' : '影片光碟目錄'],
  helix: [`${items.filter(({ item }) => item.type === 'image').length} 張圖片`, '攝影與設計螺旋畫廊'],
};
let activeScene = 'sphere';
const mediaReader = bindPortfolioReader(reader, {
  projects, canSelect: () => !routeBusy,
  onSelect: (project, index) => history.replaceState(history.state, '', `#${activeScene}/project/${project.id}/${index}`),
});
let returnFocus = null;
let routeQueue = Promise.resolve();
let routeBusy = false;
let readerToken = 0;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const sleep = ms => new Promise(resolve => setTimeout(resolve, reduced.matches ? 0 : ms));

function text(selector, value) { $(selector).textContent = value || ''; }
function currentController() { return scenes.get(activeScene)?.controller; }
function setStatus(value) { text('#app-status', value); }

function isDirectoryRoute(hash = location.hash) {
  return glass && /^#(?:sphere|discs|helix)\/index(?:\/projects)?$/.test(hash);
}

function restoreFocus(target, fallback = host) {
  const visible = target?.isConnected && target.getClientRects().length;
  (visible ? target : fallback).focus?.({ preventScroll: true });
}

function rememberDirectory() {
  if (!restoringDirectory && indexDialog.open && isDirectoryRoute()) directory?.remember(document.activeElement);
}

function setReaderReturnLabel() {
  if (!glass) return;
  const label = isDirectoryRoute(history.state?.directoryFrom || '') ? '返回目錄' : '返回原場景';
  $('#close-reader').textContent = label;
  $('#close-reader').setAttribute('aria-label', label);
}

function fallback(layer, error) {
  console.error('Scene unavailable', error);
  layer.classList.add('scene-fallback');
  const note = document.createElement('p');
  note.textContent = '互動場景暫時無法載入，仍可直接打開作品。';
  layer.append(note);
  projects.forEach(project => {
    const button = document.createElement('button');
    const image = document.createElement('img');
    image.src = project.cover; image.alt = ''; image.loading = 'lazy';
    button.append(image, project.titleZh);
    button.addEventListener('click', () => openItem(project.id, 0, button));
    layer.append(button);
  });
  return {};
}

async function showScene(name, resumeScene = true) {
  if (!Object.hasOwn(descriptions, name)) name = 'sphere';
  for (const [key, value] of scenes) {
    if (key !== name) { value.controller.pause?.(); value.layer.hidden = true; }
  }
  activeScene = name;
  document.body.dataset.scene = name;
  text('#scene-caption', descriptions[name][0]);
  host.setAttribute('aria-label', descriptions[name][1]);
  document.querySelectorAll('[data-scene-link]').forEach(link => {
    if (link.dataset.sceneLink === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (!scenes.has(name)) {
    const layer = document.createElement('div');
    layer.className = `scene-layer scene-layer-${name}`;
    layer.style.cssText = 'position:absolute;inset:0';
    host.append(layer);
    let controller;
    try {
      const module = glass && name === 'discs' ? await import('../glass/discs.js') : await import(`./${name}.js`);
      controller = await module.mount(layer, { projects, items, openItem });
    } catch (error) { layer.replaceChildren(); controller = fallback(layer, error); }
    scenes.set(name, { controller: controller || {}, layer });
  }
  const entry = scenes.get(name);
  entry.layer.hidden = false;
  if (resumeScene && !reader.open && !indexDialog.open && !document.hidden) entry.controller.resume?.();
  document.title = `Kim — ${name === 'sphere' ? 'Overview' : name === 'discs' ? 'Cinema' : 'Gallery'} · V04`;
}

async function openReader(project, index) {
  const token = ++readerToken;
  mediaReader.show(project, index);
  setReaderReturnLabel();
  reader.classList.remove('is-leaving');
  reader.classList.add('is-preparing');
  reader.showModal(); reader.scrollTop = 0;
  const { left, top, width, height } = stage.getBoundingClientRect();
  try { await currentController()?.enter?.({ projectId: project.id, index: mediaReader.index, rect: { left, top, width, height } }); }
  catch (error) { console.error('Scene entry transition', error); }
  if (token !== readerToken) return;
  currentController()?.pause?.();
  reader.classList.remove('is-preparing');
  $('#close-reader').focus({ preventScroll: true });
  setStatus(`已打開 ${project.titleZh}`);
}

async function closeReader({ resumeScene = true, focusScene = true } = {}) {
  if (!reader.open) return;
  ++readerToken; mediaReader.pause();
  reader.classList.add('is-leaving');
  await sleep(220);
  reader.classList.add('is-preparing');
  try { await currentController()?.exit?.(); }
  catch (error) { console.error('Scene exit transition', error); }
  reader.close(); mediaReader.clear();
  reader.classList.remove('is-preparing', 'is-leaving');
  if (resumeScene && !indexDialog.open && !document.hidden) currentController()?.resume?.();
  if (focusScene) restoreFocus(returnFocus);
  setStatus('已返回原場景');
}

function openItem(projectId, index = 0, trigger) {
  if (routeBusy || reader.open) return;
  const project = projects.find(project => project.id === projectId);
  if (!project) return;
  const directoryFrom = glass && indexDialog.open && isDirectoryRoute() ? location.hash : null;
  if (directoryFrom) directory?.remember(trigger || document.activeElement);
  returnFocus = indexDialog.open ? $('#open-index') : (trigger instanceof HTMLElement ? trigger : document.activeElement);
  if (indexDialog.open) indexDialog.close();
  history.pushState({ selectedReader: true, ...(directoryFrom ? { directoryFrom } : {}) }, '', `#${activeScene}/project/${projectId}/${Number(index) || 0}`);
  queueRoute();
}

function requestClose() {
  if (routeBusy || !reader.open) return;
  if (history.state?.selectedReader) {
    if (glass) routeBusy = true;
    history.back();
  }
  else { history.replaceState(null, '', `#${activeScene}`); queueRoute(); }
}

function requestCloseIndex() {
  if (!glass) { indexDialog.close(); return; }
  if (routeBusy || !indexDialog.open) return;
  rememberDirectory();
  if (history.state?.glassDirectory) {
    routeBusy = true;
    history.back();
  } else {
    history.replaceState(null, '', `#${activeScene}`);
    queueRoute();
  }
}

async function syncRoute() {
  routeBusy = true;
  try {
    const parts = location.hash.slice(1).split('/');
    const name = Object.hasOwn(descriptions, parts[0]) ? parts[0] : 'sphere';
    const wantsDirectory = glass && parts[1] === 'index';
    const project = parts[1] === 'project' ? projects.find(project => project.id === parts[2]) : null;
    const leavingReader = reader.open && (name !== activeScene || !project || project !== mediaReader.project);
    const leavingIndex = glass && indexDialog.open && (!wantsDirectory || name !== activeScene);
    if (leavingIndex) indexDialog.close();
    if (leavingReader) await closeReader({ resumeScene: !glass, focusScene: !glass });
    await showScene(name, !glass);
    if (wantsDirectory) {
      currentController()?.pause?.();
      const entries = name === 'helix' ? currentController()?.galleryIndexItems?.() : null;
      if (directory) {
        restoringDirectory = true;
        try { directory.show(entries || null, parts[2]); }
        finally { restoringDirectory = false; }
        // Keep a snapshot while this route is active, including browser Forward exits.
        rememberDirectory();
      } else {
        if (!indexDialog.open) indexDialog.showModal();
        $('#close-index').focus({ preventScroll: true });
      }
    } else if (project) {
      if (reader.open) { mediaReader.show(project, parts[3]); setReaderReturnLabel(); }
      else await openReader(project, parts[3]);
    } else {
      if (parts.length > 1 || parts[0] !== name) history.replaceState(null, '', `#${name}`);
      if (glass) {
        if (document.hidden) currentController()?.pause?.();
        else currentController()?.resume?.();
        if (leavingIndex) restoreFocus(directoryOpener, $('#open-index'));
        else if (leavingReader) restoreFocus(returnFocus);
      }
    }
  } finally { routeBusy = false; }
}

function queueRoute() {
  routeQueue = routeQueue.then(() => directoryReady).then(syncRoute).catch(error => { routeBusy = false; setStatus('場景載入失敗，請使用目錄。'); console.error(error); });
  return routeQueue;
}

projects.forEach((project, index) => {
  const row = document.createElement('button'); row.className = 'index-row';
  const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
  const image = document.createElement('img'); image.src = project.cover; image.alt = ''; image.loading = 'lazy';
  const name = document.createElement('span'); name.className = 'index-name'; name.textContent = project.title;
  const chinese = document.createElement('small'); chinese.textContent = project.titleZh; name.append(chinese);
  const category = document.createElement('span'); category.className = 'index-category'; category.textContent = project.category;
  row.append(number, image, name, category);
  if (!document.body.hasAttribute('data-glass')) {
    const arrow = document.createElement('span'); arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
    row.append(arrow);
  }
  row.addEventListener('click', () => openItem(project.id, 0, row));
  $('#index-list').append(row);
});

$('#open-index').addEventListener('click', () => {
  if (routeBusy) return;
  if (glass) {
    directoryOpener = $('#open-index');
    directory?.clear();
    history.pushState({ glassDirectory: true }, '', `#${activeScene}/index`);
    queueRoute();
    return;
  }
  currentController()?.pause?.(); indexDialog.showModal(); $('#close-index').focus();
});
$('#close-index').addEventListener('click', requestCloseIndex);
indexDialog.addEventListener('cancel', event => {
  if (!glass) return;
  event.preventDefault();
  requestCloseIndex();
});
if (glass) {
  indexDialog.addEventListener('scroll', rememberDirectory);
  indexDialog.addEventListener('focusin', rememberDirectory);
  indexDialog.addEventListener('click', rememberDirectory);
}
indexDialog.addEventListener('close', () => {
  // Route reconciliation owns glass focus and resume, even when this event arrives late.
  if (glass) return;
  if (!reader.open && !routeBusy && !document.hidden) currentController()?.resume?.();
  if (!reader.open && !routeBusy) $('#open-index').focus({ preventScroll: true });
});
$('#close-reader').addEventListener('click', requestClose);
reader.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
$('.skip-link').addEventListener('click', event => { event.preventDefault(); host.focus({ preventScroll: true }); });
window.addEventListener('hashchange', queueRoute);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { mediaReader.pause(); currentController()?.pause?.(); }
  else if (!reader.open && !indexDialog.open) currentController()?.resume?.();
});
window.addEventListener('pagehide', () => { mediaReader.pause(); for (const { controller } of scenes.values()) controller.pause?.(); });
window.addEventListener('pageshow', () => { if (!reader.open && !indexDialog.open && !document.hidden) currentController()?.resume?.(); });
window.addEventListener('beforeunload', () => { for (const { controller } of scenes.values()) controller.dispose?.(); });
await directoryReady;
queueRoute();
