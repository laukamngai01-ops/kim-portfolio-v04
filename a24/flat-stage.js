// Accessible library for browsers that cannot create a WebGL canvas.
export function mountFlatStage(host, { entries, initialIndex = 0, onSelect, onOpen }) {
  const shelf = document.createElement('div');
  shelf.className = 'a24-flat-list';
  shelf.setAttribute('aria-label', '影片列表');
  host.dataset.webgl = 'fallback';
  host.append(shelf);
  let selected = initialIndex;
  function select(index) {
    selected = Math.max(0, Math.min(entries.length - 1, index));
    for (const [i, button] of Array.from(shelf.children).entries()) button.setAttribute('aria-current', i === selected ? 'true' : 'false');
  }
  function setEntries(next, index) {
    entries = next;
    shelf.replaceChildren(...entries.map((entry, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      const disc = document.createElement('span');
      disc.className = 'a24-disc-thumbnail';
      const img = document.createElement('img');
      img.alt = ''; img.src = entry.discPrint || entry.poster;
      disc.append(img);
      const label = document.createElement('span');
      label.textContent = entry.name;
      button.append(disc, label);
      button.addEventListener('click', () => { select(i); onSelect(i); onOpen(i, { trigger: button }); });
      return button;
    }));
    select(index);
  }
  setEntries(entries, initialIndex);
  return {
    select, setEntries, setDetail(open) { shelf.hidden = open; },
    pause() {}, resume() {}, playIntro() {}, ready: Promise.resolve(), destroy() { shelf.remove(); },
    get selectedIndex() { return selected; }, hasWebGL: false,
  };
}
