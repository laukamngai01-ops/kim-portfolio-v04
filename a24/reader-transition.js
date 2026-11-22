// The observed source uses a light page crossfade, not a dark screen wipe.
// This original implementation keeps V04's existing reader DOM and native media.
export const READER_TRANSITION_TIMING = Object.freeze({ reveal: 700, enter: 1300, conceal: 450 });

const ENTER_EASE = 'cubic-bezier(.22,.72,.22,1)';
const FADE_EASE = 'cubic-bezier(.45,0,.2,1)';

export function mountReaderTransition({ dialog, getCanvas = () => null, reducedMotion } = {}) {
  if (!dialog) throw new TypeError('A reader dialog is required.');
  const win = dialog.ownerDocument.defaultView;
  const doc = dialog.ownerDocument;
  const preference = win.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reducedMotion ?? preference.matches;
  const managedBefore = dialog.classList.contains('a24-reader-managed');
  dialog.classList.add('a24-reader-managed');
  let current = null;
  let destroyed = false;
  let state = dialog.open ? 'shown' : 'hidden';

  function parts() {
    return [
      ['.reader-top', 0, 270],
      ['#reader-number', 45, 310],
      ['#reader-title', 30, 470, true],
      ['#reader-title-zh', 90, 360],
      ['#reader-disclosure', 125, 350],
      ['.reader-role', 150, 370],
      ['#reader-intro-zh', 190, 370],
      ['.reader-copy details', 220, 350],
      ['#reader-source', 240, 340],
      ['#reader-stage', 260, 310],
      ['.reader-tools', 290, 280],
      ['#reader-thumbnails', 310, 270],
    ].flatMap(([selector, delay, duration, title]) => {
      const element = dialog.querySelector(selector);
      return element && !element.hidden ? [{ element, delay, duration, title }] : [];
    });
  }

  function snapshot() {
    return {
      visible: dialog.open,
      paper: current?.paper ? Number(win.getComputedStyle(current.paper).opacity) : (dialog.open ? 1 : 0),
      colors: current?.colors || {
        color: win.getComputedStyle(dialog).backgroundColor,
        image: win.getComputedStyle(dialog).backgroundImage,
      },
      opacity: new Map(parts().map(({ element }) => [element, Number(win.getComputedStyle(element).opacity)])),
    };
  }

  function remember(task, element, names) {
    let stored = task.styles.get(element);
    if (!stored) {
      task.styles.set(element, stored = new Map());
      task.styleAttributes.set(element, element.getAttribute('style'));
    }
    for (const name of names) if (!stored.has(name)) stored.set(name, [element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
  }

  function restoreCanvas(task) {
    const portal = task.portal;
    if (!portal) return;
    // Restore the same canvas even if the owning scene was detached meanwhile.
    if (portal.next?.parentNode === portal.parent) portal.parent.insertBefore(portal.canvas, portal.next);
    else portal.parent.append(portal.canvas);
    portal.layer.remove();
    task.portal = null;
  }

  function portalCanvas(task) {
    if (task.portal || !dialog.open) return;
    const canvas = getCanvas();
    if (canvas?.tagName !== 'CANVAS' || !canvas.parentNode) return;
    const parent = canvas.parentNode;
    const next = canvas.nextSibling;
    const layer = doc.createElement('div');
    layer.className = 'a24-reader-flight';
    layer.setAttribute('aria-hidden', 'true');
    dialog.append(layer);
    layer.append(canvas);
    task.portal = { canvas, parent, next, layer };
  }

  function cleanup(task) {
    for (const timer of task.timers) win.clearTimeout(timer);
    task.timers.clear();
    for (const animation of task.animations) animation.cancel();
    task.animations.clear();
    restoreCanvas(task);
    restoreInert(task);
    for (const [element, values] of task.styles) {
      for (const [name, [value, priority]] of values) {
        if (value) element.style.setProperty(name, value, priority);
        else element.style.removeProperty(name);
      }
      if (task.styleAttributes.get(element) === null && !element.getAttribute('style')) element.removeAttribute('style');
    }
    task.paper?.remove();
    for (const { parent, element, className } of task.rules) {
      element.remove();
      parent.classList.remove(className);
    }
    if (task.attribute === null) dialog.removeAttribute('data-cinema-transition');
    else dialog.setAttribute('data-cinema-transition', task.attribute);
  }

  function settle(task, cancelled = false, error) {
    if (task.settled) return;
    task.settled = true;
    if (cancelled) task.abort.abort();
    cleanup(task);
    if (current === task) {
      current = null;
      state = dialog.open ? 'shown' : 'hidden';
    }
    if (error) task.reject(error);
    else task.resolve({ cancelled });
  }

  function schedule(task, delay, callback) {
    const timer = win.setTimeout(() => {
      task.timers.delete(timer);
      if (current !== task || task.settled) return;
      Promise.resolve().then(callback).catch(error => settle(task, false, error));
    }, Math.max(0, delay));
    task.timers.add(timer);
  }

  function animate(task, element, keyframes, options) {
    if (!element.animate) return;
    const animation = element.animate(keyframes, { fill: 'both', easing: ENTER_EASE, ...options });
    task.animations.add(animation);
    // Cancellation is normal navigation; it must not create an unhandled rejection.
    animation.finished.catch(() => {});
  }

  function prepare(task, previous, entering) {
    task.parts = parts();
    task.colors = previous.colors;
    const paper = doc.createElement('div');
    paper.className = 'a24-reader-paper';
    paper.setAttribute('aria-hidden', 'true');
    const color = task.colors.color;
    paper.style.backgroundColor = color && color !== 'rgba(0, 0, 0, 0)' ? color : '#e9eaec';
    paper.style.backgroundImage = task.colors.image || 'none';
    paper.style.opacity = String(previous.visible ? previous.paper : 0);
    task.paper = paper;
    dialog.prepend(paper);
    task.attribute = dialog.getAttribute('data-cinema-transition');
    dialog.dataset.cinemaTransition = entering ? 'enter' : 'exit';
    if (entering && task.prepareCallback) {
      for (const element of dialog.querySelectorAll(':scope > .reader-top, :scope > .reader-layout')) {
        task.inert.set(element, element.inert);
        element.inert = true;
      }
    }
    for (const part of task.parts) {
      const { element } = part;
      remember(task, element, ['opacity', 'will-change']);
      part.from = previous.visible ? (previous.opacity.get(element) ?? 1) : (task.prepareCallback ? .001 : 0);
      element.style.opacity = String(part.from);
      element.style.willChange = 'opacity, transform';
    }
  }

  function restoreInert(task) {
    for (const [element, value] of task.inert) element.inert = value;
    task.inert.clear();
  }

  function makeRules(task) {
    for (const [selector, edge, delay] of [['.reader-top', 'bottom', 50], ['.reader-role', 'top', 150]]) {
      const parent = dialog.querySelector(selector);
      if (!parent) continue;
      const style = win.getComputedStyle(parent);
      const element = doc.createElement('span');
      const className = `a24-reader-rule-${edge}`;
      element.className = 'a24-reader-rule';
      element.setAttribute('aria-hidden', 'true');
      element.style.backgroundColor = style.getPropertyValue(`border-${edge}-color`);
      parent.append(element);
      parent.classList.add(className);
      task.rules.push({ parent, element, className });
      animate(task, element, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 470, delay });
    }
  }

  async function reveal(task) {
    if (current !== task || task.revealing) return;
    task.revealing = true;
    if (task.prepareCallback) await prepareLifecycle(task);
    if (current !== task || task.settled) return;
    restoreInert(task);
    await task.callback?.({ signal: task.abort.signal });
    if (current !== task || task.settled) return;
    task.revealed = true;
    if (task.immediate || !dialog.open) { settle(task); return; }
    portalCanvas(task);
    animate(task, task.paper, [{ opacity: Number(task.paper.style.opacity) }, { opacity: 1 }], { duration: 300, easing: FADE_EASE });
    for (const part of task.parts) {
      const keyframes = [{ opacity: part.from }, { opacity: 1 }];
      if (part.title && !task.wasOpen) {
        keyframes[0].clipPath = 'inset(0 0 100% 0)';
        keyframes[0].transform = 'translateY(14px)';
        keyframes[1].clipPath = 'inset(0 0 0% 0)';
        keyframes[1].transform = 'translateY(0)';
      }
      animate(task, part.element, keyframes, { duration: part.duration, delay: task.wasOpen ? 0 : part.delay });
    }
    if (!task.wasOpen) makeRules(task);
    schedule(task, 600, () => settle(task));
  }

  function prepareLifecycle(task) {
    if (!task.preparePromise) task.preparePromise = Promise.resolve().then(async () => {
      if (current !== task || task.settled) return;
      await task.prepareCallback?.({ signal: task.abort.signal });
      if (current !== task || task.settled) return;
      if (!task.immediate) portalCanvas(task);
    });
    return task.preparePromise;
  }

  async function conceal(task) {
    if (current !== task || task.concealing) return;
    task.concealing = true;
    // Closing a native dialog would otherwise hide the portalled live canvas.
    restoreCanvas(task);
    await task.callback?.({ signal: task.abort.signal });
    if (current === task && !task.settled) settle(task);
  }

  function begin(kind, options = {}) {
    if (destroyed) return Promise.resolve({ cancelled: true });
    const previous = snapshot();
    if (current) settle(current, true);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const task = {
      kind, promise, resolve, reject, settled: false, abort: new AbortController(),
      timers: new Set(), animations: new Set(), styles: new Map(), styleAttributes: new Map(), inert: new Map(), rules: [],
      attribute: dialog.getAttribute('data-cinema-transition'),
      immediate: options.immediate || reduced() || doc.hidden,
      wasOpen: previous.visible,
      prepareCallback: kind === 'enter' ? options.onPrepare : null,
      callback: kind === 'enter' ? options.onReveal : options.onConceal,
    };
    current = task;
    state = kind === 'enter' ? 'entering' : 'exiting';
    if (task.immediate || (kind === 'exit' && !previous.visible)) {
      Promise.resolve().then(() => kind === 'enter' ? reveal(task) : conceal(task)).catch(error => settle(task, false, error));
      return promise;
    }
    prepare(task, previous, kind === 'enter');
    if (kind === 'enter') {
      const startedAt = Number.isFinite(options.startedAt) ? options.startedAt : win.performance.now();
      const continueReveal = () => {
        const elapsed = Math.max(0, win.performance.now() - startedAt);
        schedule(task, previous.visible ? 0 : Math.max(0, READER_TRANSITION_TIMING.reveal - elapsed), () => reveal(task));
      };
      if (task.prepareCallback) {
        task.paper.style.opacity = String(previous.visible ? previous.paper : .001);
        schedule(task, 0, async () => { await prepareLifecycle(task); continueReveal(); });
      } else continueReveal();
    } else {
      portalCanvas(task);
      for (const part of task.parts) animate(task, part.element, [{ opacity: part.from }, { opacity: 0 }], { duration: 400, easing: FADE_EASE });
      animate(task, task.paper, [{ opacity: previous.paper }, { opacity: 0 }], { duration: 430, easing: FADE_EASE });
      schedule(task, READER_TRANSITION_TIMING.conceal, () => conceal(task));
    }
    return promise;
  }

  function finishForEnvironment() {
    if (!current || (!reduced() && !doc.hidden)) return;
    const task = current;
    task.immediate = true;
    for (const timer of task.timers) win.clearTimeout(timer);
    task.timers.clear();
    if (task.kind === 'enter' && task.revealing) {
      // A caller may still be loading styles inside onReveal. Its guarded
      // completion will see immediate=true and settle without starting motion.
      if (task.revealed) settle(task);
      return;
    }
    Promise.resolve(task.kind === 'enter' ? reveal(task) : conceal(task)).catch(error => settle(task, false, error));
  }
  preference.addEventListener('change', finishForEnvironment);
  doc.addEventListener('visibilitychange', finishForEnvironment);

  return {
    enter: options => begin('enter', options),
    exit: options => begin('exit', options),
    cancel() { if (current) settle(current, true); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (current) settle(current, true);
      preference.removeEventListener('change', finishForEnvironment);
      doc.removeEventListener('visibilitychange', finishForEnvironment);
      if (!managedBefore) dialog.classList.remove('a24-reader-managed');
    },
    get active() { return !!current; },
    get state() { return state; },
  };
}
