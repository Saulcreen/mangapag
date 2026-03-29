/* ═══════════════════════════════════════════════════
   KUROMANGA — script.js
   APIs: Jikan (trending/info) + MangaDex (search/browse/reader)
   ═══════════════════════════════════════════════════ */

'use strict';

// ── CONFIG ──
const JIKAN       = 'https://api.jikan.moe/v4';
const MDEX_BASE   = 'https://api.mangadex.org';
const MDEX_COVERS = 'https://uploads.mangadex.org/covers';

// Proxies CORS en orden de preferencia
const CORS_PROXIES = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

async function fetchMDex(path) {
  const url = `${MDEX_BASE}${path}`;
  // Intentar directo primero
  try {
    const res = await fetch(url);
    if (res.ok) return res.json();
  } catch(_) {}
  // Proxies en orden — allorigins primero para URLs largas
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];
  for (const p of proxies) {
    try {
      const res = await fetch(p);
      if (res.ok) {
        const text = await res.text();
        return JSON.parse(text);
      }
    } catch(_) {}
  }
  throw new Error('No se pudo conectar con MangaDex');
}

// URL directa para portadas (GitHub Pages no necesita proxy)
function proxyCover(mangaId, filename) {
  // filename ya incluye .jpg, solo agregar .512.jpg al final
  const base = filename.endsWith('.jpg') ? filename.slice(0, -4) : filename;
  return `${MDEX_COVERS}/${mangaId}/${base}.512.jpg`;
}

// URL directa para páginas del lector
function proxyPage(url) {
  return url;
}

// ── STATE ──
let favorites = JSON.parse(localStorage.getItem('km_favorites') || '[]');
let history   = JSON.parse(localStorage.getItem('km_history')   || '[]');
let currentPage   = 1;
let currentGenre  = '';
let currentType   = '';
let currentQuery  = '';
let totalPages    = 1;
let isLoading     = false;

// ── Reader state ──
let readerMangaId    = null;
let readerChapters   = [];
let readerChapterIdx = 0;
let readerPages      = [];
let readerPageIdx    = 0;

// ── MANGADEX GENRE MAP ──
const GENRE_MAP = {
  'action':        '391b0423-d847-456f-aff0-8b0cfc03066b',
  'romance':       '423e2eae-a7a2-4a8b-ac03-a8351462d71d',
  'fantasy':       'cdc58593-87dd-415e-bbc0-2ec27bf404cc',
  'horror':        'cdad7e68-1419-41dd-bdce-27753074a640',
  'comedy':        '4d32cc48-9f00-4cca-9b5a-a839f0f166be',
  'drama':         'b9af3a63-f058-46de-a9a0-e0c13906197a',
  'sci-fi':        '256c8bd9-4904-4360-bf4f-508a76d67183',
  'sports':        '69964a64-2f90-4d33-beeb-f3ed2875eb4c',
  'psychological': '3b60b75c-a2d7-4860-ab56-05f391bb889c',
  'slice of life': 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9',
  'adventure':     '87cc87cd-a395-47af-b27a-93258283bbc6',
};

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  createParticles();
  setupNav();
  setupSearch();
  setupGenreFilter();
  setupTypeFilter();
  setupPagination();
  setupModal();
  setupReader();
  document.getElementById('clear-history-btn').addEventListener('click', clearHistory);
  loadTrending();
});

/* ════════════════════════════
   PARTICLES
════════════════════════════ */
function createParticles() {
  const container = document.getElementById('particles');
  const colors = ['rgba(139,0,0,0.6)', 'rgba(201,168,76,0.4)', 'rgba(180,30,30,0.5)'];
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 3 + 1;
    p.style.cssText = `
      width: ${size}px; height: ${size}px;
      left: ${Math.random() * 100}%;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      animation-duration: ${Math.random() * 20 + 15}s;
      animation-delay: ${Math.random() * -20}s;
    `;
    container.appendChild(p);
  }
}

/* ════════════════════════════
   NAV
════════════════════════════ */
function setupNav() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      showSection(link.dataset.section);
    });
  });
  document.getElementById('nav-search-btn').addEventListener('click', () => {
    const q = document.getElementById('nav-search-input').value.trim();
    if (q) {
      document.getElementById('search-input').value = q;
      currentQuery = q;
      currentPage = 1;
      showSection('search');
      searchMangaDex();
    }
  });
  document.getElementById('nav-search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('nav-search-btn').click();
  });
}

function showSection(name) {
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.section === name);
  });

  const homeEl     = document.getElementById('section-home');
  const trendingEl = document.getElementById('section-trending');
  const searchEl   = document.getElementById('section-search');
  const favEl      = document.getElementById('section-favorites');
  const histEl     = document.getElementById('section-history');

  [searchEl, favEl, histEl].forEach(el => el.classList.add('hidden-section'));
  homeEl.style.display     = 'none';
  trendingEl.style.display = 'none';

  if (name === 'home') {
    homeEl.style.display     = 'flex';
    trendingEl.style.display = 'block';
  } else if (name === 'search') {
    searchEl.classList.remove('hidden-section');
    searchMangaDex();
  } else if (name === 'favorites') {
    favEl.classList.remove('hidden-section');
    renderFavorites();
  } else if (name === 'history') {
    histEl.classList.remove('hidden-section');
    renderHistory();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ════════════════════════════
   TRENDING (MangaDex)
════════════════════════════ */
async function loadTrending() {
  try {
    const params = new URLSearchParams();
    params.append('limit', 18);
    params.append('offset', 0);
    params.append('includes[]', 'cover_art');
    params.append('order[followedCount]', 'desc');
    params.append('contentRating[]', 'safe');
    params.append('contentRating[]', 'suggestive');
    const data = await fetchMDex(`/manga?${params}`);
    renderTrending(data.data || []);
  } catch (err) {
    console.error('Trending error:', err);
    document.getElementById('trending-grid').innerHTML =
      '<p style="color:var(--text-dim);grid-column:1/-1;text-align:center">No se pudo cargar el trending. Intenta de nuevo.</p>';
  }
}

function renderTrending(list) {
  const grid = document.getElementById('trending-grid');
  grid.innerHTML = '';
  list.forEach((item, i) => {
    const title     = item.attributes.title.en
                   || Object.values(item.attributes.title)[0]
                   || 'Sin título';
    const coverRel  = item.relationships?.find(r => r.type === 'cover_art');
    const coverFile = coverRel?.attributes?.fileName;
    const cover     = coverFile ? proxyCover(item.id, coverFile) : '';
    const type      = item.attributes.originalLanguage === 'ko' ? 'Manhwa'
                    : item.attributes.originalLanguage === 'zh' ? 'Manhua' : 'Manga';
    const card = buildCard({
      id:     item.id,
      title,
      cover,
      score:  '—',
      type,
      rank:   `#${i + 1}`,
      source: 'mangadex',
      raw:    item,
    });
    grid.appendChild(card);
  });
}

/* ════════════════════════════
   SEARCH / BROWSE (MangaDex)
════════════════════════════ */
function setupSearch() {
  document.getElementById('search-btn').addEventListener('click', () => {
    currentQuery = document.getElementById('search-input').value.trim();
    currentPage = 1;
    searchMangaDex();
  });
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('search-btn').click();
  });
}

async function searchMangaDex() {
  if (isLoading) return;
  isLoading = true;

  const grid  = document.getElementById('search-grid');
  const empty = document.getElementById('search-empty');
  const pag   = document.getElementById('pagination');

  grid.innerHTML  = Array(12).fill('<div class="skeleton-card"></div>').join('');
  empty.style.display = 'none';
  pag.style.display   = 'none';

  try {
    const limit  = 24;
    const offset = (currentPage - 1) * limit;

    const params = new URLSearchParams();
    params.append('limit', limit);
    params.append('offset', offset);
    params.append('includes[]', 'cover_art');
    params.append('order[followedCount]', 'desc');
    params.append('contentRating[]', 'safe');
    params.append('contentRating[]', 'suggestive');
    params.append('availableTranslatedLanguage[]', 'es');
    params.append('availableTranslatedLanguage[]', 'en');

    if (currentQuery) params.append('title', currentQuery);
    if (currentGenre && GENRE_MAP[currentGenre]) {
      params.append('includedTags[]', GENRE_MAP[currentGenre]);
    }
    if (currentType) {
      const langMap = { manga: 'ja', manhwa: 'ko', manhua: 'zh' };
      if (langMap[currentType]) params.append('originalLanguage[]', langMap[currentType]);
    }

    const data = await fetchMDex(`/manga?${params}`);
    const list = data.data || [];
    totalPages = Math.ceil((data.total || 0) / limit) || 1;

    grid.innerHTML = '';
    if (!list.length) {
      empty.style.display = 'block';
      isLoading = false;
      return;
    }

    list.forEach(manga => {
      const title     = manga.attributes.title.en
                     || Object.values(manga.attributes.title)[0]
                     || 'Sin título';
      const coverRel  = manga.relationships?.find(r => r.type === 'cover_art');
      const coverFile = coverRel?.attributes?.fileName;
      const cover     = coverFile ? proxyCover(manga.id, coverFile) : '';
      const type      = manga.attributes.originalLanguage === 'ko' ? 'Manhwa'
                      : manga.attributes.originalLanguage === 'zh' ? 'Manhua' : 'Manga';
      const tags      = (manga.attributes.tags || [])
        .map(t => t.attributes?.name?.en || '')
        .filter(Boolean);

      const card = buildCard({
        id: manga.id, title, cover, score: '—', type,
        source: 'mangadex', tags, raw: manga,
      });
      grid.appendChild(card);
    });

    pag.style.display = 'flex';
    document.getElementById('page-info').textContent = `Página ${currentPage} / ${totalPages}`;
    document.getElementById('prev-btn').disabled = currentPage <= 1;
    document.getElementById('next-btn').disabled = currentPage >= totalPages;

  } catch (err) {
    console.error('MangaDex error:', err);
    grid.innerHTML = '<p style="color:var(--text-dim);grid-column:1/-1;text-align:center">Error al conectar con MangaDex. Intenta de nuevo.</p>';
  }

  isLoading = false;
}

/* ════════════════════════════
   GENRE & TYPE FILTERS
════════════════════════════ */
function setupGenreFilter() {
  document.getElementById('genre-bar').addEventListener('click', e => {
    const pill = e.target.closest('.genre-pill');
    if (!pill) return;
    document.querySelectorAll('.genre-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentGenre = pill.dataset.genre;
    currentPage  = 1;
    searchMangaDex();
  });
}

function setupTypeFilter() {
  document.getElementById('section-search').addEventListener('click', e => {
    const btn = e.target.closest('.type-btn');
    if (!btn) return;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentType = btn.dataset.type;
    currentPage = 1;
    searchMangaDex();
  });
}

/* ════════════════════════════
   PAGINATION
════════════════════════════ */
function setupPagination() {
  document.getElementById('prev-btn').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; searchMangaDex(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
  document.getElementById('next-btn').addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; searchMangaDex(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
}

/* ════════════════════════════
   CARD BUILDER
════════════════════════════ */
function buildCard({ id, title, cover, score, type, rank, source, tags, raw }) {
  const isFav = favorites.some(f => f.id === id);
  const card = document.createElement('div');
  card.className = 'manga-card';
  card.innerHTML = `
    <div class="card-cover-wrap">
      <img class="card-cover" src="${cover || ''}" alt="${escHtml(title)}"
           onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22300%22><rect fill=%22%230d0d18%22 width=%22200%22 height=%22300%22/><text x=%2250%25%22 y=%2252%25%22 fill=%22%23555%22 text-anchor=%22middle%22 font-size=%2224%22>📖</text></svg>'" />
      ${rank ? `<span class="card-rank">${rank}</span>` : ''}
      ${score !== '—' ? `<span class="card-score">⭐ ${score}</span>` : ''}
      <button class="card-fav-btn ${isFav ? 'active' : ''}" data-id="${id}" title="${isFav ? 'Quitar favorito' : 'Agregar a favoritos'}">
        ${isFav ? '★' : '☆'}
      </button>
    </div>
    <div class="card-info">
      <div class="card-title">${escHtml(title)}</div>
      <div class="card-type">${type}</div>
    </div>
  `;

  card.addEventListener('click', e => {
    if (e.target.closest('.card-fav-btn')) return;
    openModal({ id, title, cover, score, type, source, tags, raw });
  });
  card.querySelector('.card-fav-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleFavorite({ id, title, cover, type }, card.querySelector('.card-fav-btn'));
  });
  return card;
}

/* ════════════════════════════
   MODAL
════════════════════════════ */
function setupModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('reader-overlay').classList.contains('open')) {
        closeReader();
      } else {
        closeModal();
      }
    }
  });
}

async function openModal({ id, title, cover, score, type, source, tags, raw }) {
  addToHistory({ id, title, cover, type });

  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  overlay.classList.add('open');

  content.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-dim)">
    <div style="font-size:2rem;margin-bottom:1rem">⚔️</div>
    <p>Cargando detalles...</p>
  </div>`;

  let synopsis = '', genres = tags || [], authors = '';
  let status = '', chapters = '', volumes = '', url = '';
  let mdexId = null;

  if (source === 'jikan' && raw?.mal_id) {
    try {
      await sleep(400);
      const res  = await fetch(`${JIKAN}/manga/${raw.mal_id}/full`);
      const data = await res.json();
      const m = data.data || raw;
      synopsis = m.synopsis || '';
      genres   = (m.genres || []).map(g => g.name);
      authors  = (m.authors || []).map(a => a.name).join(', ');
      status   = m.status || '';
      chapters = m.chapters || '?';
      volumes  = m.volumes  || '?';
      score    = m.score ? m.score.toFixed(1) : score;
      url      = m.url || '';
      cover    = m.images?.jpg?.large_image_url || cover;
    } catch(e) {}
  } else if (source === 'mangadex') {
    mdexId = id;
    if (!raw.attributes) {
      try {
        const data = await fetchMDex(`/manga/${id}?includes[]=author&includes[]=artist`);
        if (data.data) raw = data.data;
      } catch(e) {}
    }
    const attrs = raw.attributes || {};
    synopsis = attrs.description?.en || Object.values(attrs.description || {})[0] || '';
    genres   = (attrs.tags || []).map(t => t.attributes?.name?.en).filter(Boolean);
    status   = attrs.status || '';
    chapters = attrs.lastChapter || '?';
    const authorRel = (raw.relationships || []).filter(r => r.type === 'author' || r.type === 'artist');
    authors = authorRel.map(r => r.attributes?.name || '').filter(Boolean).join(', ');
  }

  const isFav = favorites.some(f => f.id === id);
  const canRead = source === 'mangadex' || mdexId;

  content.innerHTML = `
    <div class="modal-hero">
      <img class="modal-cover" src="${cover}" alt="${escHtml(title)}"
           onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22300%22><rect fill=%22%230d0d18%22 width=%22200%22 height=%22300%22/><text x=%2250%25%22 y=%2252%25%22 fill=%22%23444%22 text-anchor=%22middle%22 font-size=%2240%22>📖</text></svg>'" />
      <div class="modal-meta">
        <h2 class="modal-title">${escHtml(title)}</h2>
        <div class="modal-badges">
          <span class="modal-badge type">${type}</span>
          ${status ? `<span class="modal-badge">${capitalizeFirst(status)}</span>` : ''}
        </div>
        ${score !== '—' ? `
          <div class="modal-score-big">⭐ ${score}</div>
          <div class="modal-score-label">PUNTUACIÓN MAL</div>
        ` : ''}
        <div class="modal-info-row">
          ${authors  ? `<div class="modal-info-item"><strong>Autor:</strong> ${escHtml(authors)}</div>` : ''}
          ${chapters ? `<div class="modal-info-item"><strong>Capítulos:</strong> ${chapters}</div>` : ''}
          ${volumes  ? `<div class="modal-info-item"><strong>Volúmenes:</strong> ${volumes}</div>` : ''}
        </div>
      </div>
    </div>

    ${genres.length ? `
      <div class="modal-section-title">Géneros</div>
      <div class="modal-genres">
        ${genres.map(g => `<span class="modal-genre-tag">${escHtml(g)}</span>`).join('')}
      </div>
    ` : ''}

    ${synopsis ? `
      <div class="modal-section-title">Sinopsis</div>
      <p class="modal-synopsis">${escHtml(synopsis.slice(0, 900))}${synopsis.length > 900 ? '...' : ''}</p>
    ` : ''}

    <div class="modal-actions">
      <button class="modal-btn-fav ${isFav ? 'active' : ''}" id="modal-fav-btn">
        ${isFav ? '★ En favoritos' : '☆ Agregar a favoritos'}
      </button>
      ${canRead ? `<button class="modal-btn-read" id="modal-read-btn">📖 Leer ahora</button>` : ''}
      ${url ? `<a class="modal-btn-ext" href="${url}" target="_blank" rel="noopener">MAL ↗</a>` : ''}
    </div>
  `;

  document.getElementById('modal-fav-btn').addEventListener('click', () => {
    toggleFavorite({ id, title, cover, type }, document.getElementById('modal-fav-btn'), true);
  });

  if (canRead) {
    document.getElementById('modal-read-btn').addEventListener('click', () => {
      closeModal();
      openReader(mdexId || id, title);
    });
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

/* ════════════════════════════
   READER
════════════════════════════ */
function setupReader() {
  document.getElementById('reader-close').addEventListener('click', closeReader);
  document.getElementById('reader-prev-page').addEventListener('click', readerPrevPage);
  document.getElementById('reader-next-page').addEventListener('click', readerNextPage);
  document.getElementById('reader-prev-chap').addEventListener('click', () => loadChapter(readerChapterIdx - 1));
  document.getElementById('reader-next-chap').addEventListener('click', () => loadChapter(readerChapterIdx + 1));
  document.getElementById('reader-chapter-select').addEventListener('change', e => {
    loadChapter(parseInt(e.target.value));
  });

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (!document.getElementById('reader-overlay').classList.contains('open')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') readerNextPage();
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   readerPrevPage();
  });

  // Click en imagen para avanzar
  document.getElementById('reader-img').addEventListener('click', readerNextPage);
}

async function openReader(mangaId, title) {
  readerMangaId  = mangaId;
  readerChapters = [];
  readerPages    = [];

  const overlay = document.getElementById('reader-overlay');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  document.getElementById('reader-title').textContent = title;
  document.getElementById('reader-status').textContent = 'Cargando capítulos...';
  document.getElementById('reader-img').src = '';
  document.getElementById('reader-img').style.display = 'none';
  document.getElementById('reader-loading').style.display = 'flex';

  try {
    // Fetch capítulos en español primero, luego inglés
    const params = new URLSearchParams();
    params.append('manga', mangaId);
    params.append('translatedLanguage[]', 'es');
    params.append('translatedLanguage[]', 'en');
    params.append('order[chapter]', 'asc');
    params.append('limit', '100');

    const data = await fetchMDex(`/chapter?${params}`);
    let chapters = data.data || [];

    // Preferir capítulos en español si existen
    const esChaps = chapters.filter(c => c.attributes.translatedLanguage === 'es');
    if (esChaps.length > 0) {
      // Mezclar: usar es si existe para ese número, si no usar en
      const chapMap = {};
      chapters.forEach(c => {
        const num = c.attributes.chapter || '0';
        if (!chapMap[num] || c.attributes.translatedLanguage === 'es') {
          chapMap[num] = c;
        }
      });
      chapters = Object.values(chapMap).sort((a, b) => {
        return parseFloat(a.attributes.chapter || 0) - parseFloat(b.attributes.chapter || 0);
      });
    }

    if (!chapters.length) {
      document.getElementById('reader-status').textContent = 'No hay capítulos disponibles.';
      document.getElementById('reader-loading').style.display = 'none';
      return;
    }

    readerChapters = chapters;

    // Llenar selector de capítulos
    const select = document.getElementById('reader-chapter-select');
    select.innerHTML = chapters.map((c, i) => {
      const num  = c.attributes.chapter ? `Cap. ${c.attributes.chapter}` : `Cap. ${i + 1}`;
      const lang = c.attributes.translatedLanguage === 'es' ? '🇪🇸' : '🇬🇧';
      return `<option value="${i}">${lang} ${num}</option>`;
    }).join('');

    await loadChapter(0);

  } catch(err) {
    console.error('Reader error:', err);
    document.getElementById('reader-status').textContent = 'Error al cargar capítulos.';
    document.getElementById('reader-loading').style.display = 'none';
  }
}

async function loadChapter(idx) {
  if (idx < 0 || idx >= readerChapters.length) return;
  readerChapterIdx = idx;
  readerPageIdx    = 0;

  document.getElementById('reader-img').style.display = 'none';
  document.getElementById('reader-loading').style.display = 'flex';
  document.getElementById('reader-status').textContent = 'Cargando páginas...';
  document.getElementById('reader-chapter-select').value = idx;

  const chap = readerChapters[idx];

  try {
    // Fetch directo al endpoint at-home (tiene CORS abierto)
    const res  = await fetch(`https://api.mangadex.org/at-home/server/${chap.id}`);
    const data = await res.json();
    const baseUrl  = data.baseUrl;
    const hash     = data.chapter?.hash;
    const pages    = data.chapter?.data || [];

    if (!pages.length) {
      document.getElementById('reader-status').textContent = 'Este capítulo no tiene páginas disponibles.';
      document.getElementById('reader-loading').style.display = 'none';
      return;
    }

    readerPages = pages.map(p => `${baseUrl}/data/${hash}/${p}`);

    document.getElementById('reader-prev-chap').disabled = idx <= 0;
    document.getElementById('reader-next-chap').disabled = idx >= readerChapters.length - 1;

    showReaderPage(0);

  } catch(err) {
    console.error('Chapter load error:', err);
    document.getElementById('reader-status').textContent = 'Error al cargar las páginas.';
    document.getElementById('reader-loading').style.display = 'none';
  }
}

function showReaderPage(idx) {
  if (idx < 0 || idx >= readerPages.length) return;
  readerPageIdx = idx;

  const img     = document.getElementById('reader-img');
  const loading = document.getElementById('reader-loading');
  const chap    = readerChapters[readerChapterIdx];
  const chapNum = chap.attributes.chapter ? `Cap. ${chap.attributes.chapter}` : `Cap. ${readerChapterIdx + 1}`;

  loading.style.display = 'flex';
  img.style.display     = 'none';

  img.onload = () => {
    loading.style.display = 'none';
    img.style.display     = 'block';
  };
  img.onerror = () => {
    loading.style.display = 'none';
    img.style.display     = 'block';
    img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect fill="%230d0d18" width="400" height="600"/><text x="50%" y="50%" fill="%23555" text-anchor="middle" font-size="20">Error al cargar imagen</text></svg>';
  };
  img.src = readerPages[idx];

  document.getElementById('reader-page-info').textContent =
    `${chapNum}  •  Pág. ${idx + 1} / ${readerPages.length}`;
  document.getElementById('reader-prev-page').disabled = idx <= 0 && readerChapterIdx <= 0;
  document.getElementById('reader-next-page').disabled = idx >= readerPages.length - 1 && readerChapterIdx >= readerChapters.length - 1;

  // Scroll al inicio de la imagen
  document.getElementById('reader-img-wrap').scrollTop = 0;
}

function readerNextPage() {
  if (readerPageIdx < readerPages.length - 1) {
    showReaderPage(readerPageIdx + 1);
  } else if (readerChapterIdx < readerChapters.length - 1) {
    loadChapter(readerChapterIdx + 1);
  }
}

function readerPrevPage() {
  if (readerPageIdx > 0) {
    showReaderPage(readerPageIdx - 1);
  } else if (readerChapterIdx > 0) {
    loadChapter(readerChapterIdx - 1);
  }
}

function closeReader() {
  document.getElementById('reader-overlay').classList.remove('open');
  document.body.style.overflow = '';
  readerPages    = [];
  readerChapters = [];
}

/* ════════════════════════════
   FAVORITES
════════════════════════════ */
function toggleFavorite(item, btn, isModal = false) {
  const idx = favorites.findIndex(f => f.id === item.id);
  if (idx > -1) {
    favorites.splice(idx, 1);
    btn.classList.remove('active');
    btn.textContent = isModal ? '☆ Agregar a favoritos' : '☆';
    if (!isModal) btn.title = 'Agregar a favoritos';
    showToast('Eliminado de favoritos');
  } else {
    favorites.push({ ...item, addedAt: Date.now() });
    btn.classList.add('active');
    btn.textContent = isModal ? '★ En favoritos' : '★';
    if (!isModal) btn.title = 'Quitar favorito';
    showToast('¡Agregado a favoritos! ★');
  }
  localStorage.setItem('km_favorites', JSON.stringify(favorites));
}

function renderFavorites() {
  const grid  = document.getElementById('favorites-grid');
  const empty = document.getElementById('fav-empty');
  grid.innerHTML = '';
  if (!favorites.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  favorites.forEach(item => {
    const card = buildCard({
      id: item.id, title: item.title, cover: item.cover,
      score: '—', type: item.type || '',
      source: item.id.startsWith('jikan-') ? 'jikan' : 'mangadex',
      raw: { id: item.id },
    });
    grid.appendChild(card);
  });
}

/* ════════════════════════════
   HISTORY
════════════════════════════ */
function addToHistory(item) {
  history = history.filter(h => h.id !== item.id);
  history.unshift({ ...item, viewedAt: Date.now() });
  if (history.length > 50) history = history.slice(0, 50);
  localStorage.setItem('km_history', JSON.stringify(history));
}

function renderHistory() {
  const list  = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  list.innerHTML = '';
  if (!history.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  history.forEach(item => {
    const div  = document.createElement('div');
    div.className = 'history-item';
    const date = new Date(item.viewedAt).toLocaleDateString('es-PE', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    div.innerHTML = `
      <img class="history-thumb" src="${item.cover || ''}" alt="${escHtml(item.title)}"
           onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2254%22 height=%2278%22><rect fill=%22%230d0d18%22 width=%2254%22 height=%2278%22/><text x=%2250%25%22 y=%2255%25%22 fill=%22%23444%22 text-anchor=%22middle%22 font-size=%2218%22>📖</text></svg>'" />
      <div class="history-info">
        <div class="history-title">${escHtml(item.title)}</div>
        <div class="history-meta">${item.type || 'Manga'}</div>
        <div class="history-date">${date}</div>
      </div>
      <button class="history-remove" data-id="${item.id}" title="Eliminar">✕</button>
    `;
    div.addEventListener('click', e => {
      if (e.target.closest('.history-remove')) return;
      const src = item.id.startsWith('jikan-') ? 'jikan' : 'mangadex';
      openModal({ id: item.id, title: item.title, cover: item.cover, type: item.type, score: '—', source: src, raw: { id: item.id } });
    });
    div.querySelector('.history-remove').addEventListener('click', e => {
      e.stopPropagation();
      history = history.filter(h => h.id !== item.id);
      localStorage.setItem('km_history', JSON.stringify(history));
      div.remove();
      if (!history.length) empty.style.display = 'block';
    });
    list.appendChild(div);
  });
}

function clearHistory() {
  history = [];
  localStorage.setItem('km_history', JSON.stringify(history));
  renderHistory();
  showToast('Historial limpiado');
}

/* ════════════════════════════
   TOAST
════════════════════════════ */
let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

/* ════════════════════════════
   HELPERS
════════════════════════════ */
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function capitalizeFirst(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Initial show ──
showSection('home');
