import { filmsURL, galleryURL } from './catalog.js';

export function filmHeader(current = 'films') {
  const home = filmsURL().href;
  return `<header class="portfolio-masthead">
    <a class="portfolio-brand a24-wordmark" href="${home}" aria-label="Kim 首頁">Kim</a>
    <nav class="portfolio-sections a24-navigation" aria-label="作品分類">
      <div class="a24-nav-row">
        <a class="a24-nav-link" href="${home}" data-section="films" aria-label="Films · 影片" ${current === 'films' ? 'aria-current="page"' : ''}><span class="portfolio-section-label">Films</span></a>
        <a class="a24-nav-link" href="${galleryURL.href}" data-section="gallery" aria-label="Gallery · 攝影與設計"><span class="portfolio-section-label">Gallery</span></a>
      </div>
    </nav>
  </header>`;
}
