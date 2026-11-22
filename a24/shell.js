// Original interface implementation based on direct observation of Ravi
// Klaassens' A24 tribute. No reference code, fonts or media are included.
import { filmHeader } from './header.js';
import { createShelfTypeMotion } from './film-type-motion.js?v=2';

export function mountShell(root, {
  onSelect = () => {}, onOpen = () => {},
} = {}) {
  const abort = new AbortController();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  root.classList.add('a24-shell');
  root.innerHTML = `
    <div class="a24-stage" tabindex="0" role="region" aria-label="影片光碟；左右鍵選片，Enter 開啟影片"></div>
    <section class="a24-info" aria-label="目前影片">
      <h1 class="a24-film-title a24-mask"></h1>
      <dl class="a24-metadata">
        <div class="a24-meta-row"><dt><i class="a24-meta-rule" aria-hidden="true"></i><span class="a24-mask" data-label="Title"></span></dt><dd class="a24-mask" data-field="titleZh"></dd></div>
        <div class="a24-meta-row"><dt><i class="a24-meta-rule" aria-hidden="true"></i><span class="a24-mask" data-label="Role"></span></dt><dd class="a24-mask" data-field="role"></dd></div>
        <div class="a24-meta-row"><dt><i class="a24-meta-rule" aria-hidden="true"></i><span class="a24-mask" data-label="Format"></span></dt><dd class="a24-mask" data-field="format"></dd></div>
      </dl>
    </section>
    <div class="a24-project-notes" aria-label="作品資料">
      <section><p class="a24-note-label a24-mask" data-field="noteLabel"></p><p class="a24-note-text a24-mask" data-field="note"></p></section>
      <section><p class="a24-note-label a24-mask" data-field="filmNumber"></p><p class="a24-note-text a24-mask" data-field="filmNote"></p></section>
    </div>
    <div class="a24-player-host"></div>
    ${filmHeader()}
    <div class="a24-keyboard-controls"><button type="button" data-action="previous">上一部</button><button type="button" data-action="open">開啟影片</button><button type="button" data-action="next">下一部</button></div>
    <p class="a24-live" aria-live="polite" aria-atomic="true"></p>`;

  const $ = selector => root.querySelector(selector);
  const stageHost = $('.a24-stage');
  const playerHost = $('.a24-player-host');
  const masthead = $('.portfolio-masthead');
  const info = $('.a24-info');
  const notes = $('.a24-project-notes');
  const title = $('.a24-film-title');
  const fields = Object.fromEntries([...root.querySelectorAll('[data-field]')].map(e => [e.dataset.field, e]));
  const typeMotion = createShelfTypeMotion(root);
  const rows = [...info.querySelectorAll('.a24-meta-row')];
  const labels = rows.map(row => row.querySelector('[data-label]'));
  const rules = rows.map(row => row.querySelector('.a24-meta-rule'));
  let entries = [], index = 0, key = null;
  let covered = false, disposed = false;

  const keyOf = entry => entry?.key || entry?.id || `${entry?.projectId}:${entry?.index}`;
  const nameOf = entry => entry?.name || entry?.title || entry?.project?.title || '';
  const nameZhOf = entry => entry?.nameZh || entry?.titleZh || entry?.project?.titleZh || '';
  function formatOf(entry) {
    const item = entry.item || entry;
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const divisor = item.width && item.height ? gcd(item.width, item.height) : 0;
    const ratio = divisor ? `${item.width / divisor}:${item.height / divisor}` : '';
    const seconds = Number(entry.durationSeconds);
    const rounded = Math.round(seconds);
    const duration = Number.isFinite(seconds) && seconds > 0 ? `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}` : typeof entry.duration === 'string' ? entry.duration : '';
    return [entry.isAI ? 'AI 輔助影片' : '影片', duration, ratio].filter(Boolean).join(' · ');
  }
  function renderDetails(entry, immediate) {
    if (!entry) return;
    const nextKey = keyOf(entry);
    if (nextKey === key) return;
    let motion = 'static';
    if (!covered && !reduced.matches && !document.hidden && title.animate) {
      if (key === null && root.dataset.arriving === 'true') motion = 'arrival';
      else if (key !== null && !immediate) motion = 'change';
    }
    typeMotion.cancel();
    key = nextKey;
    const project = entry.project || {};
    info.dataset.key = nextKey;
    typeMotion.replace(title, nameOf(entry), motion);
    const values = [
      [fields.titleZh, nameZhOf(entry)],
      [fields.role, project.roleZh || entry.projectRoleZh || project.role || entry.projectRole || ''],
      [fields.format, formatOf(entry)],
    ];
    values.forEach(([mask, value], row) => {
      typeMotion.replace(labels[row], labels[row].dataset.label, motion, 44 + row * 58);
      typeMotion.replace(mask, value, motion, 64 + row * 58);
      typeMotion.rule(rules[row], row, motion);
    });
    const sequence = number => String(number).padStart(2, '0');
    typeMotion.replace(fields.noteLabel, entry.isAI ? 'AI-assisted film experiment' : 'Selected project', motion, 258);
    typeMotion.replace(fields.note, project.source?.subtitle?.[0] || entry.label || entry.item?.label || nameOf(entry), motion, 276);
    typeMotion.replace(fields.filmNumber, `Film note · ${sequence(index + 1)} / ${sequence(entries.length)}`, motion, 316);
    typeMotion.replace(fields.filmNote, entry.filmNote || entry.label || nameOf(entry), motion, 334);
    $('.a24-live').textContent = `${nameOf(entry)}，${nameZhOf(entry)}${entry.isAI ? '，AI 輔助影片' : ''}`;
    $('[data-action="open"]').setAttribute('aria-label', `開啟 ${nameZhOf(entry) || nameOf(entry)}`);
  }
  function choose(next, trigger) {
    if (!entries.length) return;
    const bounded = (next + entries.length) % entries.length;
    onSelect(bounded, trigger);
    stageHost.focus({ preventScroll: true });
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button,a');
    if (!button || !root.contains(button)) return;
    if (button.matches('a')) {
      if (button.dataset.section === 'films' && !covered &&
          !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        stageHost.focus({ preventScroll: true });
      }
      return;
    }
    if (button.dataset.action === 'previous') choose(index - 1, button);
    if (button.dataset.action === 'next') choose(index + 1, button);
    if (button.dataset.action === 'open') onOpen(index, button);
  }, { signal: abort.signal });
  window.addEventListener('resize', typeMotion.settle, { signal: abort.signal });
  document.fonts?.addEventListener('loadingdone', typeMotion.reflow, { signal: abort.signal });
  reduced.addEventListener('change', () => {
    if (!reduced.matches) return;
    typeMotion.settle();
  }, { signal: abort.signal });

  return {
    stageHost, playerHost,
    setState(state) {
      if (disposed) return;
      if (state.entries) entries = state.entries;
      if (state.index !== undefined) index = Math.max(0, Math.min(entries.length - 1, state.index));
      root.dataset.selection = String(index);
      renderDetails(entries[index], state.immediate);
    },
    setCovered(value) {
      covered = Boolean(value); root.dataset.covered = String(covered);
      info.inert = covered; notes.inert = covered;
      info.setAttribute('aria-hidden', String(covered)); notes.setAttribute('aria-hidden', String(covered));
      stageHost.inert = covered;
      $('.a24-keyboard-controls').inert = covered;
      if (covered) typeMotion.settle();
    },
    setWatch(value) {
      masthead.inert = Boolean(value); root.dataset.watching = String(Boolean(value));
    },
    destroy() {
      disposed = true; typeMotion.settle(); abort.abort();
      root.replaceChildren(); root.classList.remove('a24-shell');
      for (const name of ['selection', 'covered', 'watching']) delete root.dataset[name];
    },
  };
}
