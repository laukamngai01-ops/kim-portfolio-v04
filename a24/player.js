// Authored locally from observed interaction, with portfolio media only.
// The caller owns URL/history; callbacks request navigation, methods execute it.
const clock = value => {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const keyOf = entry => entry?.key || entry?.id || entry?.src;
const titleOf = entry => entry?.name || entry?.title || entry?.project?.title || '';
const posterOf = entry => entry?.poster || entry?.item?.image || entry?.project?.cover || '';
const srcOf = entry => entry?.src || entry?.item?.src || '';
const safeFocus = element => {
  if (element?.isConnected && element.getClientRects().length && !element.closest('[inert],[hidden]')) {
    element.focus({ preventScroll: true });
  }
};

export function mountPlayer(host, { onClose, onNext, onWatch } = {}) {
  const life = new AbortController();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map();
  const discArt = new Map();
  const savedScroll = new Map();
  let entry = null, nextEntry = null, opener = null, watchOpener = null;
  let opened = false, watching = false, destroyed = false, detailRevision = 0, watchRevision = 0;
  let idleTimer = 0, loadingTimer = 0, revealFrame = 0, resumeAfterVisibility = false;
  let seeking = false, wasPlaying = false, loadFailed = false, touchWasIdle = false;

  const detail = document.createElement('section');
  detail.className = 'a24-detail';
  detail.hidden = true;
  detail.setAttribute('aria-label', '影片詳情');
  detail.innerHTML = `
    <button class="a24-detail-back" type="button" aria-label="返回唱片目錄">BACK <span>返回唱片</span></button>
    <div class="a24-detail-sheet">
      <header class="a24-detail-heading">
        <h1 class="a24-detail-title" tabindex="-1"></h1>
        <p class="a24-detail-title-zh" lang="zh-Hant"></p>
        <div class="a24-detail-credit"><span>CREATIVE ROLE / 創作角色</span><p></p></div>
        <dl class="a24-detail-facts"></dl>
        <p class="a24-detail-disclosure"></p>
        <div class="a24-detail-call"><button class="a24-film-link" type="button" data-watch>WATCH FILM <span>觀看影片</span></button></div>
      </header>
      <section class="a24-detail-art" aria-label="影片畫面">
        <div class="a24-detail-art-surface">
          <img class="a24-detail-poster" alt="" decoding="async">
          <div class="a24-detail-lines" aria-hidden="true"></div>
        </div>
        <button class="a24-film-link a24-detail-watch" type="button" data-watch>WATCH FILM <span>觀看影片</span></button>
      </section>
      <section class="a24-detail-intro" aria-label="關於作品">
        <p class="a24-detail-intro-zh" lang="zh-Hant"></p>
        <p class="a24-detail-intro-en" lang="en"></p>
        <p class="a24-detail-series"></p>
      </section>
      <button class="a24-detail-next" type="button" aria-label="下一部影片">
        <span class="a24-detail-next-label">UP NEXT <span>下一部</span></span>
        <span class="a24-detail-next-title"></span>
        <span class="a24-detail-next-disc"><img alt="" decoding="async" loading="lazy"><i aria-hidden="true"></i></span>
        <span class="a24-detail-next-zh" lang="zh-Hant"></span>
      </button>
    </div>`;

  const dialog = document.createElement('dialog');
  dialog.className = 'a24-player';
  dialog.setAttribute('aria-label', '影片播放器');
  dialog.innerHTML = `
    <video class="a24-player-video" preload="none" playsinline muted></video>
    <div class="a24-player-top">
      <div class="a24-player-credit"><span class="a24-player-name"></span><span class="a24-player-role"></span></div>
      <button class="a24-player-close" type="button" aria-label="關閉播放器，返回影片詳情">CLOSE <span>關閉</span></button>
    </div>
    <button class="a24-player-unmute" type="button">TAP FOR SOUND <span>點按開啟聲音</span></button>
    <div class="a24-player-message" role="status" aria-live="polite"><span></span><button type="button" hidden>重新載入</button></div>
    <div class="a24-player-bottom">
      <button class="a24-player-toggle" type="button" aria-label="播放影片"><span class="a24-player-icon" aria-hidden="true">▶</span><span class="a24-player-word">PLAY</span></button>
      <span class="a24-player-time">00:00 / 00:00</span>
      <input class="a24-player-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="播放進度" aria-valuetext="00:00" disabled>
      <button class="a24-player-sound" type="button" aria-label="開啟聲音" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3z"/><path class="a24-sound-wave" d="M16 7c4 3 4 7 0 10M19 4c6 5 6 11 0 16"/><path class="a24-sound-cross" d="m16 9 6 6m0-6-6 6"/></svg><span class="a24-player-word">SOUND</span></button>
      <button class="a24-player-fullscreen" type="button" aria-label="全螢幕播放"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg><span class="a24-player-word">MAXIMIZE</span></button>
    </div>`;
  // Fullscreen accepts this div, not an HTMLDialogElement. Keep every custom
  // control inside the fullscreen element so its close action stays reachable.
  const screen = document.createElement('div');
  screen.className = 'a24-player-screen';
  screen.append(...dialog.childNodes);
  dialog.append(screen);
  host.append(detail, dialog);
  const $ = selector => detail.querySelector(selector);
  const $$ = selector => dialog.querySelector(selector);
  const video = $$('.a24-player-video');
  const title = $('.a24-detail-title');
  const nextButton = $('.a24-detail-next');
  const art = $('.a24-detail-art');
  const artSurface = $('.a24-detail-art-surface');
  const poster = $('.a24-detail-poster');
  const topPlay = $('.a24-detail-call [data-watch]');
  const closeButton = $$('.a24-player-close');
  const toggle = $$('.a24-player-toggle');
  const sound = $$('.a24-player-sound');
  const unmute = $$('.a24-player-unmute');
  const seek = $$('.a24-player-seek');
  const time = $$('.a24-player-time');
  const status = $$('.a24-player-message');
  const retry = status.querySelector('button');
  const fullscreen = $$('.a24-player-fullscreen');
  const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: life.signal });

  function animate(element, frames, duration, immediate = false) {
    animations.get(element)?.cancel();
    animations.delete(element);
    if (immediate || reduced.matches || !element.animate) return Promise.resolve();
    const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.22,.7,.16,1)', fill: 'none' });
    animations.set(element, animation);
    return animation.finished.catch(() => {}).finally(() => {
      if (animations.get(element) === animation) animations.delete(element);
    });
  }

  function setMessage(message = '', retryable = false) {
    status.querySelector('span').textContent = message;
    retry.hidden = !retryable;
    status.hidden = !message;
  }

  function updatePlayback() {
    const playing = !video.paused && !video.ended;
    dialog.dataset.playing = String(playing);
    dialog.dataset.muted = String(video.muted || video.volume === 0);
    toggle.setAttribute('aria-label', playing ? '暫停影片' : video.ended ? '重新播放影片' : '播放影片');
    toggle.querySelector('.a24-player-word').textContent = playing ? 'PAUSE' : video.ended ? 'REPLAY' : 'PLAY';
    toggle.querySelector('.a24-player-icon').textContent = playing ? 'Ⅱ' : '▶';
    const audible = !video.muted && video.volume > 0;
    sound.setAttribute('aria-pressed', String(audible));
    sound.setAttribute('aria-label', audible ? '關閉聲音' : '開啟聲音');
    unmute.hidden = audible || loadFailed || !watching;
    if (!playing) showControls();
  }

  function updateTime() {
    const duration = Number.isFinite(video.duration) ? video.duration : entry?.durationSeconds || 0;
    time.textContent = `${clock(video.currentTime)} / ${clock(duration)}`;
    seek.disabled = !Number.isFinite(video.duration) || video.duration <= 0;
    if (!seeking) seek.value = String(Math.round((video.currentTime / (duration || 1)) * 1000));
    seek.style.setProperty('--a24-progress', `${Number(seek.value) / 10}%`);
    seek.setAttribute('aria-valuetext', `${clock(video.currentTime)} / ${clock(duration)}`);
  }

  function showControls() {
    clearTimeout(idleTimer);
    dialog.dataset.idle = 'false';
    if (!watching || video.paused || reduced.matches) return;
    idleTimer = setTimeout(() => {
      if (!watching || video.paused || seeking || dialog.querySelector(':focus-visible')) return;
      dialog.dataset.idle = 'true';
    }, 2600);
  }

  async function play() {
    if (!watching || destroyed) return;
    const revision = watchRevision;
    try {
      if (video.ended) video.currentTime = 0;
      await video.play();
      if (revision !== watchRevision || !watching) return;
      setMessage();
      showControls();
    } catch (error) {
      if (revision !== watchRevision || !watching || error.name === 'AbortError') return;
      if (!loadFailed) setMessage('點按播放以開始觀看');
      updatePlayback();
    }
  }

  function stopMedia() {
    clearTimeout(loadingTimer);
    clearTimeout(idleTimer);
    video.pause();
    video.muted = true;
    resumeAfterVisibility = false;
  }

  function releaseMedia() {
    stopMedia();
    video.removeAttribute('src');
    video.load();
    seeking = false;
    seek.value = '0';
    seek.disabled = true;
  }

  function requestWatch(value, trigger) {
    if (value === watching) return;
    if (trigger) watchOpener = trigger;
    if (onWatch) onWatch(value);
    else void watch(value);
  }

  function requestClose() {
    if (watching) requestWatch(false);
    else if (opened) {
      if (onClose) onClose();
      else void close();
    }
  }

  function setLines(container, text, count = 4) {
    const words = text.replace(/\s+\/\s+\d+$/, '').trim().split(/\s+/);
    const groups = [];
    const rows = Math.min(count, words.length);
    for (let i = 0; i < rows; i++) {
      const take = Math.ceil(words.length / (rows - i));
      groups.push(words.splice(0, take).join(' '));
    }
    container.replaceChildren(...groups.map((group, index) => {
      const line = document.createElement('span');
      line.textContent = group;
      line.style.setProperty('--line-index', String(index));
      return line;
    }));
  }

  function renderNext() {
    nextButton.hidden = !nextEntry;
    if (!nextEntry) return;
    nextButton.setAttribute('aria-label', `下一部影片：${nextEntry.nameZh || titleOf(nextEntry)}`);
    setLines($('.a24-detail-next-title'), titleOf(nextEntry), 2);
    $('.a24-detail-next-zh').textContent = nextEntry.nameZh || nextEntry.titleZh || '';
    const nextImage = $('.a24-detail-next-disc img');
    nextImage.src = posterOf(nextEntry);
    nextImage.classList.remove('has-disc-print');
    const nextKey = keyOf(nextEntry), requestedEntry = nextEntry;
    if (!discArt.has(nextKey)) {
      discArt.set(nextKey, import('./disc-stage.js')
        .then(module => module.createDiscArtwork(requestedEntry, { size: 768 }))
        .then(canvas => canvas.toDataURL('image/png'))
        .catch(() => { discArt.delete(nextKey); return null; }));
    }
    discArt.get(nextKey).then(url => {
      if (!url || destroyed || keyOf(nextEntry) !== nextKey) return;
      nextImage.src = url;
      nextImage.classList.add('has-disc-print');
    });
  }

  function renderEntry() {
    const project = entry.project || {};
    const item = entry.item || {};
    title.textContent = titleOf(entry);
    $('.a24-detail-title-zh').textContent = entry.nameZh || entry.titleZh || project.titleZh || '';
    $('.a24-detail-credit p').textContent = project.roleZh || entry.role || project.role || '';
    const width = item.width || 16, height = item.height || 9;
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const divisor = gcd(width, height);
    const format = `${width / divisor}:${height / divisor}`;
    const facts = [
      ['COLLECTION / 系列', project.title || titleOf(entry)],
      ['FORMAT / 畫幅', format],
      ['TYPE / 類別', entry.isAI ? 'AI-assisted film / AI 輔助影片' : 'Film / 影片'],
      ['RUNTIME / 片長', entry.durationSeconds ? clock(entry.durationSeconds) : '—'],
    ];
    $('.a24-detail-facts').replaceChildren(...facts.map(([label, value]) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value; row.append(dt, dd); return row;
    }));
    const disclosure = project.disclosure || (entry.isAI ? 'AI-assisted film / AI 輔助影片' : '');
    $('.a24-detail-disclosure').textContent = disclosure;
    $('.a24-detail-disclosure').hidden = !disclosure;
    poster.src = posterOf(entry);
    poster.alt = `${entry.nameZh || titleOf(entry)} — 影片預告畫面`;
    poster.style.objectPosition = entry.posterFocus || (width < height ? '50% 35%' : '50% 50%');
    art.dataset.orientation = width < height ? 'portrait' : 'landscape';
    setLines($('.a24-detail-lines'), project.title || titleOf(entry));
    $('.a24-detail-intro-zh').textContent = project.introZh || '';
    $('.a24-detail-intro-en').textContent = project.intro || '';
    $('.a24-detail-series').textContent = item.labelZh && item.labelZh !== project.titleZh ? item.labelZh : entry.nameZh || titleOf(entry);
    $$('.a24-player-name').textContent = titleOf(entry);
    $$('.a24-player-role').textContent = project.roleZh || project.role || '';
    dialog.setAttribute('aria-label', `影片播放器：${entry.nameZh || titleOf(entry)}`);
    video.poster = posterOf(entry);
    renderNext();
    updateTime();
  }

  async function open(newEntry, options = {}) {
    if (destroyed || !newEntry) return;
    const revision = ++detailRevision;
    const same = opened && keyOf(entry) === keyOf(newEntry);
    if (options.trigger) opener = options.trigger;
    else if (!opened && !detail.contains(document.activeElement) && !dialog.contains(document.activeElement)) {
      opener = document.activeElement;
    }
    nextEntry = options.nextEntry || null;
    if (same) {
      renderNext();
      if ('watch' in options) await watch(Boolean(options.watch), options);
      return;
    }
    if (entry && opened) savedScroll.set(keyOf(entry), detail.scrollTop);
    if (dialog.open) await watch(false, { immediate: true, restoreFocus: false });
    if (revision !== detailRevision || destroyed) return;
    entry = newEntry;
    watchOpener = null;
    renderEntry();
    detail.hidden = false;
    detail.inert = false;
    opened = true;
    detail.scrollTop = options.restoreScroll ? savedScroll.get(keyOf(entry)) || 0 : 0;
    updateScrollArtwork();
    safeFocus(title);
    await animate(detail, [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }], 620, options.immediate);
    if (revision !== detailRevision || destroyed) return;
    if (options.watch) await watch(true, options);
  }

  async function watch(value, { immediate = false, restoreFocus = true } = {}) {
    if (destroyed || (value && (!opened || !entry))) return;
    if (value === watching && (value ? dialog.open : !dialog.open)) return;
    const revision = ++watchRevision;
    watching = value;
    if (value) {
      loadFailed = false;
      if (!watchOpener) watchOpener = detail.contains(document.activeElement) ? document.activeElement : topPlay;
      setMessage('載入影片…');
      video.muted = true;
      video.defaultMuted = true;
      video.volume = .55;
      video.preload = 'auto';
      video.src = srcOf(entry);
      video.load();
      if (!dialog.open) dialog.showModal();
      dialog.dataset.idle = 'false';
      dialog.dataset.muted = 'true';
      closeButton.focus({ preventScroll: true });
      updateTime(); updatePlayback();
      loadingTimer = setTimeout(() => {
        if (watching && video.readyState < 2) setMessage('影片仍在載入，可以重試或返回詳情。', true);
      }, 12000);
      if (document.hidden) resumeAfterVisibility = true;
      else void play();
      await animate(dialog, [{ opacity: 0, clipPath: 'inset(48% 0 48% 0)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)' }], 760, immediate);
      if (revision === watchRevision && watching) showControls();
    } else {
      stopMedia();
      if (document.fullscreenElement && dialog.contains(document.fullscreenElement)) {
        try { await document.exitFullscreen(); } catch { /* Closing must still complete. */ }
      }
      await animate(dialog, [{ opacity: 1, clipPath: 'inset(0 0 0 0)' }, { opacity: 0, clipPath: 'inset(48% 0 48% 0)' }], 820, immediate);
      if (revision !== watchRevision || destroyed || watching) return;
      if (dialog.open) dialog.close();
      releaseMedia();
      if (restoreFocus && opened) safeFocus(watchOpener || topPlay);
    }
  }

  async function close({ immediate = false, restoreFocus = true } = {}) {
    if (destroyed) return;
    const revision = ++detailRevision;
    if (entry && opened) savedScroll.set(keyOf(entry), detail.scrollTop);
    opened = false;
    detail.inert = true;
    await watch(false, { immediate, restoreFocus: false });
    if (revision !== detailRevision || destroyed) return;
    await animate(detail, [{ opacity: 1 }, { opacity: 0 }], 420, immediate);
    if (revision !== detailRevision || destroyed) return;
    detail.hidden = true;
    if (restoreFocus) safeFocus(opener);
  }

  listen($('.a24-detail-back'), 'click', requestClose);
  detail.querySelectorAll('[data-watch]').forEach(button => listen(button, 'click', () => requestWatch(true, button)));
  listen(nextButton, 'click', () => { if (nextEntry && onNext) onNext(nextEntry); });
  listen(closeButton, 'click', () => requestWatch(false));
  listen(dialog, 'cancel', event => { event.preventDefault(); requestWatch(false); });
  listen(document, 'keydown', event => {
    if (!opened || destroyed || event.defaultPrevented) return;
    if (event.key === 'Escape' && !dialog.open) { event.preventDefault(); requestClose(); }
  });
  listen(dialog, 'keydown', event => {
    showControls();
    if (event.target.closest('input,select,textarea')) return;
    if ((event.code === 'Space' && !event.target.closest('button,a')) || event.key.toLowerCase() === 'k') {
      event.preventDefault(); video.paused ? void play() : video.pause();
    } else if (event.key.toLowerCase() === 'm') {
      event.preventDefault(); video.muted = !video.muted;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (!Number.isFinite(video.duration)) return;
      event.preventDefault(); video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (event.key === 'ArrowRight' ? 5 : -5)));
    }
  });
  listen(toggle, 'click', () => { video.paused ? void play() : video.pause(); });
  listen(video, 'pointerdown', event => { touchWasIdle = event.pointerType === 'touch' && dialog.dataset.idle === 'true'; });
  listen(video, 'click', event => {
    if (touchWasIdle) { touchWasIdle = false; showControls(); return; }
    video.paused ? void play() : video.pause(); showControls();
  });
  listen(sound, 'click', () => { video.muted = !video.muted; showControls(); });
  listen(unmute, 'click', () => {
    video.muted = false;
    // The unmute prompt disappears; keep keyboard focus inside the active player.
    safeFocus(toggle);
    if (video.paused) void play();
    showControls();
  });
  listen(dialog, 'pointermove', showControls);
  listen(dialog, 'focusin', showControls);
  listen(retry, 'click', () => {
    loadFailed = false; video.load(); setMessage('載入影片…'); void play();
  });
  listen(seek, 'pointerdown', () => { seeking = true; wasPlaying = !video.paused; video.pause(); showControls(); });
  listen(seek, 'input', () => {
    if (Number.isFinite(video.duration)) video.currentTime = Number(seek.value) / 1000 * video.duration;
    seek.style.setProperty('--a24-progress', `${Number(seek.value) / 10}%`);
    updateTime();
  });
  const finishSeek = () => {
    if (!seeking) return;
    seeking = false;
    if (wasPlaying) void play();
    updateTime();
  };
  listen(window, 'pointerup', finishSeek);
  listen(window, 'pointercancel', finishSeek);
  listen(seek, 'change', finishSeek);
  listen(fullscreen, 'click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (screen.requestFullscreen) await screen.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      else setMessage('此瀏覽器不支援全螢幕。影片已按完整比例顯示。');
    } catch { setMessage('無法進入全螢幕。可繼續在此觀看。'); }
  });
  listen(document, 'fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    fullscreen.setAttribute('aria-label', active ? '退出全螢幕' : '全螢幕播放');
    fullscreen.querySelector('.a24-player-word').textContent = active ? 'MINIMIZE' : 'MAXIMIZE';
    showControls();
  });
  for (const event of ['play', 'pause', 'ended', 'volumechange']) listen(video, event, updatePlayback);
  for (const event of ['loadedmetadata', 'durationchange', 'timeupdate']) listen(video, event, updateTime);
  listen(video, 'waiting', () => { if (watching && !loadFailed) setMessage('載入影片…'); });
  listen(video, 'playing', () => { clearTimeout(loadingTimer); setMessage(); showControls(); });
  listen(video, 'canplay', () => { if (!loadFailed) setMessage(); });
  listen(video, 'error', () => {
    if (!watching || !video.getAttribute('src')) return;
    loadFailed = true; clearTimeout(loadingTimer);
    setMessage('影片未能載入。請重試，或關閉播放器返回詳情。', true); updatePlayback();
  });
  listen(document, 'visibilitychange', () => {
    if (!watching) return;
    if (document.hidden) { resumeAfterVisibility = !video.paused; video.pause(); }
    else if (resumeAfterVisibility) { resumeAfterVisibility = false; void play(); }
  });

  // An authored paper edge reveals the trailer still as the reader scrolls.
  // Geometry depends on scroll and size only: no timer, idle loop or copied path.
  function updateScrollArtwork() {
    if (destroyed || !opened) return;
    const width = art.clientWidth, height = art.clientHeight;
    if (!width || !height) return;
    const top = art.offsetTop - detail.scrollTop;
    const viewport = detail.clientHeight;
    const progress = Math.min(1, Math.max(0, (viewport - top) / viewport));
    art.style.setProperty('--a24-reveal-progress', progress.toFixed(4));
    if (reduced.matches) {
      artSurface.style.clipPath = 'none';
      poster.style.transform = 'none';
      nextButton.style.setProperty('--a24-next-rise', '0px');
      return;
    }
    const amplitude = width < 700 ? 86 : 170;
    const flatten = Math.min(1, Math.max(0, top / (amplitude * .8)));
    const retreat = Math.max(.25, 1 - detail.scrollTop / (art.offsetTop + amplitude) * .85);
    if (top <= 0) artSurface.style.clipPath = 'none';
    else {
      const points = [];
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        const broad = Math.exp(-Math.pow((t - .48) / .29, 2));
        const shoulder = Math.exp(-Math.pow((t - .23) / .075, 2));
        const ridge = .94 - .72 * broad - .19 * shoulder
          + .045 * Math.sin(t * Math.PI * 7.2 + progress * .7)
          + .023 * Math.sin(t * Math.PI * 17.4);
        const y = Math.max(0, ((width < 700 ? 0 : 18) + amplitude * ridge) * retreat * flatten);
        points.push([t * width, y]);
      }
      const n = value => value.toFixed(2);
      let path = `M 0 ${n(points[0][1])}`;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        path += ` Q ${n(a[0])} ${n(a[1])} ${n((a[0] + b[0]) / 2)} ${n((a[1] + b[1]) / 2)}`;
      }
      path += ` L ${width} ${n(points[64][1])} L ${width} ${height} L 0 ${height} Z`;
      artSurface.style.clipPath = `path('${path}')`;
    }
    // Only the promotional still has framing/parallax. The player stays contain.
    const shift = Math.max(-3, Math.min(3, (top / viewport - .3) * 6));
    poster.style.transform = `translateY(${shift.toFixed(3)}%) scale(1.08)`;
    const nextTop = nextButton.offsetTop - detail.scrollTop;
    const amount = Math.min(1, Math.max(0, 1 - nextTop / viewport));
    nextButton.style.setProperty('--a24-next-rise', `${(1 - amount) * 60}px`);
  }

  function scheduleArtwork() {
    if (revealFrame || destroyed || !opened) return;
    revealFrame = requestAnimationFrame(() => { revealFrame = 0; updateScrollArtwork(); });
  }
  listen(detail, 'scroll', scheduleArtwork, { passive: true });
  listen(window, 'resize', scheduleArtwork, { passive: true });
  listen(reduced, 'change', scheduleArtwork);
  const artworkResize = new ResizeObserver(scheduleArtwork);
  artworkResize.observe(art);

  function destroy() {
    if (destroyed) return;
    destroyed = true; opened = false; watching = false;
    detailRevision++; watchRevision++;
    life.abort();
    artworkResize.disconnect();
    clearTimeout(idleTimer); clearTimeout(loadingTimer); cancelAnimationFrame(revealFrame);
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
    releaseMedia();
    if (dialog.open) dialog.close();
    detail.remove(); dialog.remove(); savedScroll.clear(); discArt.clear();
  }

  return { open, watch, close, destroy, get isOpen() { return opened; }, get isWatching() { return watching; } };
}
