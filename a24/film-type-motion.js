// Both faces travel together through the same aperture. This preserves the
// full roll without a separate empty interval between exit and entrance.
const measuredRise = 'linear(0, .10 7%, .30 13%, .56 20%, .77 27%, .86 34%, .94 46%, .975 60%, .993 76%, 1)';
const supportsLinear = globalThis.CSS?.supports('animation-timing-function', measuredRise);
const rise = supportsLinear ? measuredRise : 'cubic-bezier(.37,0,.04,1)';
const offset = distance => `translateY(${distance}%)`;
const changeTiming = {
  change: { cueScale: 1, lineGap: 35, duration: 520 },
  quick: { cueScale: .28, lineGap: 14, duration: 210 },
};

function splitLines(face) {
  if (face.children.length || !face.offsetWidth) return;
  const content = face.firstChild;
  if (!content || content.nodeType !== Node.TEXT_NODE) return;
  // Read the browser's balanced, actually wrapped lines in the active font.
  const range = document.createRange();
  const starts = [0];
  let top;
  for (const word of content.data.matchAll(/\S+/gu)) {
    range.setStart(content, word.index);
    range.setEnd(content, word.index + word[0].length);
    const rect = range.getBoundingClientRect();
    if (top !== undefined && Math.abs(rect.top - top) > 1) starts.push(word.index);
    top = rect.top;
  }
  const text = content.data;
  face.classList.add('a24-split-face');
  face.replaceChildren(...starts.map((start, i) => {
    const mask = document.createElement('span'), ink = document.createElement('span');
    mask.className = 'a24-line-mask'; ink.className = 'a24-line-ink';
    ink.style.setProperty('--a24-line', i);
    ink.textContent = text.slice(start, starts[i + 1]);
    mask.append(ink);
    return mask;
  }));
}

const inkOf = face => face.children.length ? [...face.querySelectorAll('.a24-line-ink')] : [face];
export function createShelfTypeMotion(root) {
  const active = new Set();
  let reflowAfterMotion = false;
  function play(node, keyframes, options) {
    const animation = node.animate(keyframes, { fill: 'both', ...options });
    active.add(animation);
    animation.finished.then(() => {
      active.delete(animation);
      if (!node.closest('.a24-mask-outgoing')) animation.cancel();
      if (!active.size && reflowAfterMotion) reflow();
    }, () => active.delete(animation));
    return animation.finished;
  }
  function replace(mask, text, mode, cue = 0) {
    const timing = changeTiming[mode];
    const isCaption = mask.classList.contains('a24-note-text');
    const old = timing ? mask.firstElementChild : null;
    mask.setAttribute('aria-label', text);
    const face = document.createElement('span');
    face.className = 'a24-mask-face';
    face.textContent = text;
    if (old) {
      old.classList.add('a24-mask-outgoing');
      old.setAttribute('aria-hidden', 'true');
      mask.append(face);
    } else {
      mask.replaceChildren(face);
    }
    if (isCaption) splitLines(face);
    if (mode === 'static') return;
    const incoming = inkOf(face);
    if (!timing) {
      incoming.forEach((ink, line) => play(ink, [{ transform: offset(120) }, { transform: offset(0) }],
        { delay: cue + line * 26, duration: 550, easing: rise }));
      return;
    }

    const outgoing = old ? inkOf(old) : [];
    const heights = Array.from({ length: Math.max(incoming.length, outgoing.length) }, (_, line) =>
      (outgoing[line] || incoming[line]).getBoundingClientRect().height);
    const departures = [];
    for (const [line, height] of heights.entries()) {
      const options = { delay: cue * timing.cueScale + line * timing.lineGap,
        duration: timing.duration, easing: rise };
      if (outgoing[line]) departures.push(play(outgoing[line],
        [{ transform: offset(0) }, { transform: `translateY(${-height}px)` }], options));
      if (incoming[line]) play(incoming[line],
        [{ transform: `translateY(${height}px)` }, { transform: offset(0) }], options);
    }
    if (old) Promise.allSettled(departures).then(() => old.remove());
  }
  function rule(node, row, mode) {
    const delay = 26 + row * 58;
    if (mode === 'arrival') {
      play(node, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
        { duration: 550, delay, easing: rise });
    } else if (mode === 'change') {
      play(node, [
        { transform: 'scaleX(1)', offset: 0, easing: 'ease-in' },
        { transform: 'scaleX(.16)', offset: .32, easing: rise },
        { transform: 'scaleX(1)', offset: 1 },
      ], { duration: 520, delay });
    }
  }
  function reflow() {
    reflowAfterMotion = active.size > 0;
    if (reflowAfterMotion) return;
    root.querySelectorAll('.a24-note-text .a24-mask-face:not(.a24-mask-outgoing)').forEach(face => {
      // Reflow at the current width/font, including the one-line captions.
      face.classList.remove('a24-split-face');
      face.textContent = face.textContent;
      splitLines(face);
    });
  }
  function cancel() {
    for (const animation of active) animation.cancel();
    active.clear();
    root.querySelectorAll('.a24-mask-outgoing').forEach(face => face.remove());
    if (reflowAfterMotion) reflow();
  }
  function settle() {
    reflowAfterMotion = false;
    cancel();
    reflow();
  }
  return { replace, rule, reflow, cancel, settle };
}
