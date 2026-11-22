const trackSelector = '.site-header .scene-nav,.sphere-shape-control,.sphere-filters,.discs-filter-track,.helix-filters';
const actionSelector = [
  '.index-toggle', '.sphere-open', '.discs-list-toggle', '.discs-controls button',
  '.helix-index-toggle', '.helix-open', '.helix-stepper button', '.helix-pause',
  '#close-index', '#close-reader', '#previous', '#next', '#reader-source',
  '.reader-copy summary', '.reader-error button'
].join(',');
const decorated = new Map();
const dirtyTracks = new Set();
let measurementFrame = 0;
let gesture = null;
let swallowClick = null;

function cancelGesture() {
  const current = gesture;
  gesture = null;
  swallowClick = null;
  if (!current) return;
  const {track, id} = current;
  track.classList.remove('lens-dragging');
  if (track.hasPointerCapture(id)) track.releasePointerCapture(id);
  schedule(track);
}

function options(track) {
  return Array.from(track.children).filter(el => el.matches('button:not(:disabled),a[href]'));
}

function placeLens(track, x, y, width, height) {
  track.style.setProperty('--lens-x', x + 'px');
  track.style.setProperty('--lens-y', y + 'px');
  track.style.setProperty('--lens-width', width + 'px');
  track.style.setProperty('--lens-height', height + 'px');
}

function measure(track) {
  if (!track.isConnected) {
    sizes.unobserve(track);
    decorated.delete(track);
    return;
  }
  if (gesture?.dragging && gesture.track === track) return;
  const active = track.querySelector(':scope > [aria-current="page"],:scope > [aria-pressed="true"]');
  if (!active || !active.offsetWidth) return;
  placeLens(track, active.offsetLeft, active.offsetTop, active.offsetWidth, active.offsetHeight);
  track.setAttribute('data-lens-ready', '');
}

function schedule(track) {
  if (track) dirtyTracks.add(track);
  if (!measurementFrame) measurementFrame = requestAnimationFrame(() => {
    measurementFrame = 0;
    dirtyTracks.forEach(measure);
    dirtyTracks.clear();
  });
}
const sizes = new ResizeObserver(entries => entries.forEach(({target}) => schedule(target)));

function addTrack(track) {
  if (decorated.has(track)) return;
  const lens = document.createElement('i');
  lens.className = 'glass-lens';
  lens.setAttribute('aria-hidden', 'true');
  track.classList.add('glass-track');
  track.append(lens);
  decorated.set(track, lens);
  sizes.observe(track);
  schedule(track);
}
function decorate(root) {
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  if (root.matches(trackSelector)) addTrack(root);
  if (root.matches(actionSelector)) root.classList.add('glass-action');
  root.querySelectorAll(trackSelector).forEach(addTrack);
  root.querySelectorAll(actionSelector).forEach(el => el.classList.add('glass-action'));
}
const changes = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'childList') {
      record.addedNodes.forEach(decorate);
    } else if (record.attributeName === 'hidden') {
      if (record.target.hidden && gesture && record.target.contains(gesture.track)) cancelGesture();
      if (record.target.classList.contains('scene-layer') && !record.target.hidden) {
        record.target.querySelectorAll(trackSelector).forEach(schedule);
      }
    } else if (record.target.parentElement?.classList.contains('glass-track')) {
      schedule(record.target.parentElement);
    }
  }
});
decorate(document.body);
changes.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-current','aria-pressed','hidden']});
document.fonts.ready.then(() => decorated.forEach((lens,track) => schedule(track)));

document.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  cancelGesture();
  const track = event.target.closest('.glass-track');
  if (!track) return;
  const first = options(track).find(el => el.contains(event.target));
  if (!first) return;
  gesture = {track, id:event.pointerId, startX:event.clientX, startY:event.clientY, dragging:false};
});

function nearest(track, x) {
  return options(track).reduce((best, el) => {
    const r = el.getBoundingClientRect();
    const distance = Math.abs(x - r.left - r.width / 2);
    return !best || distance < best.distance ? {el, distance} : best;
  }, null)?.el;
}

document.addEventListener('pointermove', event => {
  if (!event.isPrimary) return;
  const control = event.target.closest('.glass-track');
  if (control && event.pointerType !== 'touch') {
    const box = control.getBoundingClientRect();
    const angle = 128 + (event.clientX - box.left) / Math.max(box.width, 1) * 105;
    control.style.setProperty('--track-light', angle.toFixed(0) + 'deg');
  }
  if (!gesture || event.pointerId !== gesture.id) return;
  // A release outside the window can leave no pointerup/cancel to receive.
  if (event.pointerType === 'mouse' && event.buttons === 0) {
    cancelGesture();
    return;
  }
  const {track,startX,startY} = gesture;
  if (!gesture.dragging) {
    const dx = Math.abs(event.clientX-startX), dy = Math.abs(event.clientY-startY);
    if (dy > 7 && dy > dx) { gesture = null; return; }
    if (dx < 6) return;
    track.setPointerCapture(event.pointerId);
    gesture.dragging = true;
    track.classList.add('lens-dragging');
  }
  const hovered = nearest(track, event.clientX);
  if (!hovered) return;
  const buttons = options(track);
  const first = buttons[0], last = buttons[buttons.length-1];
  const left = event.clientX-track.getBoundingClientRect().left-track.clientLeft-hovered.offsetWidth/2;
  const x = Math.max(first.offsetLeft, Math.min(last.offsetLeft+last.offsetWidth-hovered.offsetWidth,left));
  placeLens(track,x,hovered.offsetTop,hovered.offsetWidth,hovered.offsetHeight);
});

function finishGesture(event) {
  if (!gesture || event.pointerId !== gesture.id) return;
  const {track,dragging} = gesture;
  gesture = null;
  if (!dragging) return;
  track.classList.remove('lens-dragging');
  if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
  if (event.type === 'pointerup') {
    swallowClick = track;
    const item = nearest(track, event.clientX);
    if (item) {
      item.focus({preventScroll:true});
      item.click();
    }
  }
  schedule(track);
}
document.addEventListener('pointerup',finishGesture);
document.addEventListener('pointercancel',finishGesture);
document.addEventListener('lostpointercapture',finishGesture);
window.addEventListener('blur',cancelGesture);
window.addEventListener('pagehide',cancelGesture);
document.addEventListener('visibilitychange',() => {
  if (document.hidden) cancelGesture();
});
document.addEventListener('click',event => {
  if (event.detail && swallowClick?.contains(event.target)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    swallowClick = null;
  }
},true);
document.addEventListener('dragstart',event => {
  if (event.target.closest('.glass-track')) event.preventDefault();
});
