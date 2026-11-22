import { projects } from '../selected/data.js';
import { bindPortfolioReader } from '../selected/reader.js';
import { films, filmsURL, filmURL, resolveView } from './catalog.js';
import { mountShell } from './shell.js';
import { mountStage } from './disc-stage.js';
import { mountMissing } from './missing.js';
import { startArrival } from './arrival.js';
import { mountReaderTransition } from './reader-transition.js';
import { mountFlatStage } from './flat-stage.js';

const root = document.getElementById('cinema');
const dialog = document.getElementById('reader');
const closeButton = dialog.querySelector('#close-reader');
const readerStyles = [...document.querySelectorAll('[data-reader-style]')];
const stateKey = 'kimCinema';
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let shell, stage, missing, arrival;
let selectedIndex = 0;
let detail = null;
let opener = null;
let revision = 0;
let closeRequested = false;

const transition = mountReaderTransition({ dialog, getCanvas: () => stage?.canvas });

const reader = bindPortfolioReader(dialog, { projects, onSelect: selectReaderMedia });
for (const control of dialog.querySelectorAll('#close-reader, #previous, #next, #reader-source, .reader-copy summary')) {
  control.classList.add('glass-action');
}

function localState() { return history.state?.[stateKey] || {}; }
function commit(method, url, changes = {}) {
  const state = { ...localState(), filmId: films[selectedIndex]?.id, ...changes };
  delete state.index;
  delete state.picks;
  history[method]({ ...history.state, [stateKey]: state }, '', url);
}
function restoreSelection(view, state) {
  if (view.entry) return films.indexOf(view.entry);
  const saved = films.findIndex(film => film.id === state.filmId);
  if (saved >= 0) return saved;
  // Old history entries stored a position within one of the two shelves.
  if (view.legacyAI || state.picks) {
    const oldShelf = films.filter(film => film.isAI === !!view.legacyAI);
    const oldIndex = state.picks?.[view.legacyAI ? 'ai' : 'film'];
    return Math.max(0, films.indexOf(oldShelf[oldIndex] || oldShelf[0]));
  }
  return 0;
}
function select(index, moveDisc = true) {
  // A deliberate new selection takes precedence over the returning captions.
  if (root.dataset.flight === 'returning') delete root.dataset.flight;
  if (!films[index]) return;
  selectedIndex = index;
  commit('replaceState', location.href);
  if (moveDisc) stage.select(index, { notify: false });
  shell.setState({ entries: films, index });
}
function openFilm(entry, trigger) {
  if (!entry || detail) return;
  opener = trigger instanceof HTMLElement ? trigger : shell.stageHost;
  selectedIndex = films.indexOf(entry);
  commit('replaceState', location.href);
  commit('pushState', filmURL(entry), { fromShelf: true });
  render();
}
function closeFilm() {
  if (!detail || closeRequested) return;
  closeRequested = true;
  reader.pause();
  if (localState().fromShelf && !localState().fromDetail) history.back();
  else {
    commit('replaceState', filmsURL(), { fromShelf: false, fromDetail: false, watch: false });
    render();
  }
}
function selectReaderMedia(project, index) {
  if (!detail) return;
  // Each film has its own permanent address. Other media in the same project
  // stay on the current film's address and retain their original gallery index.
  const film = films.find(entry => entry.project === project && entry.index === index);
  if (film) {
    detail = film;
    selectedIndex = films.indexOf(film);
    document.title = 'Kim — ' + film.name;
  }
  const url = filmURL(detail);
  if (!film) url.searchParams.set('media', index);
  commit('replaceState', url, { watch: false });
}
function setReaderStyles(enabled) {
  document.body.toggleAttribute('data-glass', enabled);
  for (const link of readerStyles) link.media = enabled ? 'all' : 'not all';
}
async function loadReaderStyles() {
  setReaderStyles(true);
  await Promise.all(readerStyles.filter(link => !link.sheet).map(link => new Promise(resolve => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
  })));
}
function dismissReader() {
  if (dialog.open) dialog.close();
  reader.clear();
  setReaderStyles(false);
}
function inputPaused() {
  if (!stage) return;
  if (document.hidden || dialog.open || missing) stage.pause();
  else stage.resume();
}
function mount(view) {
  shell = mountShell(root, {
    onSelect: index => select(index),
    onOpen: (index, trigger) => openFilm(films[index], trigger),
  });
  const loadingShelf = view.kind === 'browse';
  const intro = loadingShelf && !reduce.matches;
  if (loadingShelf) arrival = startArrival(root);
  const stageOptions = {
    entries: films, initialIndex: selectedIndex, intro,
    onLoad: (loaded, total) => arrival?.progress(loaded, total),
    onSelect: index => { if (!detail) select(index, false); },
    onOpen: (index, meta) => openFilm(films[index], meta?.trigger),
  };
  stage = mountStage(shell.stageHost, stageOptions);
  if (!stage.hasWebGL) {
    stage.destroy();
    stage = mountFlatStage(shell.stageHost, stageOptions);
    arrival?.finish(true);
  }
  if (arrival) {
    if (intro) stage.playIntro();
    stage.ready.then(() => arrival.loaded(), () => arrival.finish(true));
  }
}
async function render({ initial = false } = {}) {
  const version = ++revision;
  closeRequested = false;
  const url = new URL(location.href);
  const view = resolveView(url);
  const state = localState();
  if (view.kind === 'missing') {
    root.hidden = true;
    transition.cancel();
    delete root.dataset.flight;
    dismissReader();
    if (detail) stage?.setDetail(false, { immediate: true });
    detail = null;
    if (!missing) missing = mountMissing(root, films);
    inputPaused();
    document.title = 'Kim — 404';
    return;
  }
  missing?.destroy(); missing = null; root.hidden = false;
  selectedIndex = restoreSelection(view, state);
  if (view.kind === 'browse' && (view.legacyAI || url.searchParams.has('index') || state.index !== undefined)) {
    url.pathname = filmsURL().pathname;
    url.searchParams.delete('index');
    commit('replaceState', url);
  }
  if (!shell) mount(view);
  const previous = detail;
  const immediate = initial || reduce.matches;
  detail = view.entry || null;
  document.title = 'Kim — ' + (detail?.name || 'Films');
  if (stage.selectedIndex !== selectedIndex) stage.select(selectedIndex, { immediate: immediate || !!detail || !!previous, notify: false });
  shell.setState({ entries: films, index: selectedIndex, immediate: immediate || Boolean(previous) !== Boolean(detail) });
  shell.setCovered(Boolean(detail || dialog.open));
  const instant = immediate || !stage.hasWebGL;
  if (!detail) {
    root.dataset.view = 'catalogue';
    if (previous || dialog.open) {
      reader.pause();
      if (!instant) root.dataset.flight = 'returning';
      // Keep the original dialog and media in place until their exit has drawn.
      // The same canvas starts its independent return in the background.
      const disc = stage.setDetail(false, { immediate: instant });
      const page = transition.exit({ immediate: instant, onConceal() {
        if (version !== revision) return;
        dismissReader();
        shell.setCovered(false);
        inputPaused();
        (opener?.isConnected ? opener : shell.stageHost).focus({ preventScroll: true });
        opener = null;
      }});
      const captions = root.getAnimations({ subtree: true }).filter(animation => animation.animationName?.startsWith('a24-handoff'));
      await Promise.all([disc, page, Promise.allSettled(captions.map(animation => animation.finished))]);
    } else {
      transition.cancel();
      dismissReader();
      inputPaused();
    }
  } else {
    root.dataset.view = 'reader';
    const entry = detail;
    const index = view.mediaIndex;
    const changed = reader.project !== entry.project || reader.index !== index;
    const stylesReady = loadReaderStyles();
    if (changed) reader.show(entry.project, index);
    const arriving = !dialog.open || !previous;
    const prepare = async () => {
      await stylesReady;
      if (version !== revision) return;
      if (!dialog.open) {
        dialog.showModal();
        dialog.scrollTop = 0;
        dialog.focus({ preventScroll: true });
      }
      inputPaused();
    };
    const reveal = () => {
      if (version !== revision || !dialog.open) return;
      if (arriving) closeButton.focus({ preventScroll: true });
      if (view.watch && changed && !document.hidden) {
        // A blocked autoplay request leaves the original native controls usable.
        dialog.querySelector('video')?.play().catch(() => {});
      }
      inputPaused();
    };
    if (!previous || !dialog.open || transition.active) {
      if (!instant) root.dataset.flight = 'opening';
      const startedAt = performance.now();
      const disc = stage.setDetail(true, { immediate: instant });
      const page = transition.enter({ immediate: instant, startedAt, onPrepare: prepare, onReveal: reveal });
      await Promise.all([disc, page]);
    } else {
      await prepare();
      reveal();
    }
  }
  if (version !== revision) return;
  delete root.dataset.flight;
  inputPaused();
}

closeButton.addEventListener('click', closeFilm);
dialog.addEventListener('cancel', event => { event.preventDefault(); closeFilm(); });
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && detail && !dialog.open) { event.preventDefault(); closeFilm(); }
});
window.addEventListener('popstate', () => render());
window.addEventListener('pageshow', event => { if (event.persisted) render({ initial: true }); });
window.addEventListener('pagehide', event => {
  stage?.pause(); reader.pause();
  if (!event.persisted) { transition.destroy(); arrival?.finish(true); stage?.destroy(); shell?.destroy(); missing?.destroy(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) reader.pause(); inputPaused(); });
render({ initial: true });
