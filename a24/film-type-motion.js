// Lines rise through stationary apertures. On selection, the new copy starts
// inside its aperture so the shelf remains readable between inputs.
const measuredRise = 'linear(0, .10 7%, .30 13%, .56 20%, .77 27%, .86 34%, .94 46%, .975 60%, .993 76%, 1)';
const supportsLinear = globalThis.CSS?.supports('animation-timing-function', measuredRise);
const rise = supportsLinear ? measuredRise : 'cubic-bezier(.37,0,.04,1)';
const offset = distance => `translateY(${distance}%)`;

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
      animation.cancel();
      if (!active.size && reflowAfterMotion) reflow();
    }, () => active.delete(animation));
  }
  function replace(mask, text, mode, arrivalDelay = 0) {
    if (mask.getAttribute('aria-label') === text) return;
    const arriving = mode === 'arrival';
    const isCaption = mask.classList.contains('a24-note-text');
    mask.setAttribute('aria-label', text);
    const face = document.createElement('span');
    face.className = 'a24-mask-face';
    face.textContent = text;
    mask.replaceChildren(face);
    if (isCaption) splitLines(face);
    if (mode === 'static') return;
    for (const [line, ink] of inkOf(face).entries()) {
      play(ink, [{ transform: offset(arriving ? 120 : 10) }, { transform: offset(0) }], {
        delay: arriving ? arrivalDelay + line * 26 : (isCaption ? 18 + line * 14 : 0),
        duration: arriving ? 550 : 240,
        easing: rise,
      });
    }
  }
  function rule(node, row, mode) {
    if (mode !== 'arrival') return;
    play(node, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: 550, delay: 26 + row * 58, easing: rise });
  }
  function reflow() {
    reflowAfterMotion = active.size > 0;
    if (reflowAfterMotion) return;
    root.querySelectorAll('.a24-note-text .a24-mask-face').forEach(face => {
      // Reflow at the current width/font, including the one-line captions.
      face.classList.remove('a24-split-face');
      face.textContent = face.textContent;
      splitLines(face);
    });
  }
  function cancel() {
    for (const animation of active) animation.cancel();
    active.clear();
    if (reflowAfterMotion) reflow();
  }
  function settle() {
    reflowAfterMotion = false;
    cancel();
    reflow();
  }
  return { replace, rule, reflow, cancel, settle };
}
