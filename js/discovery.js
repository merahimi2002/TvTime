/* Phase 19 — Smart Add + Explore */
(() => {
  const API = 'https://api.tvmaze.com';
  const CACHE_KEY = 'tvtime_explore_cache_v1';
  let smartTimer = null;
  let selectedSmartShow = null;
  let lastExploreSignature = '';
  let exploreRefreshSeed = 0;

  const esc = value => escapeHtml(String(value ?? ''));
  const showYear = show => show?.premiered ? show.premiered.slice(0, 4) : '—';
  const imageOf = show => show?.image?.medium || show?.image?.original || '';
  const tvdbOf = show => Number(show?.externals?.thetvdb || 0) || null;
  const exists = show => SHOWS_DATA.some(item =>
    (tvdbOf(show) && Number(item.tvdb) === tvdbOf(show)) ||
    String(item.title || '').toLowerCase() === String(show?.name || '').toLowerCase()
  );

  function selectedPreview(show) {
    const preview = document.getElementById('smartAddPreview');
    if (!preview) return;
    if (!show) {
      preview.classList.add('d-none');
      preview.innerHTML = '';
      return;
    }
    preview.innerHTML = `
      ${imageOf(show) ? `<img src="${esc(imageOf(show))}" alt="">` : '<div class="smart-preview-placeholder">TV</div>'}
      <div><strong>${esc(show.name)}</strong><span>${esc(showYear(show))} · ${esc(show.status || 'Unknown')}</span><small>${esc((show.genres || []).join(' · ') || 'No genres')}</small></div>`;
    preview.classList.remove('d-none');
  }

  function chooseSmartShow(show) {
    selectedSmartShow = show;
    const title = document.getElementById('newShowTitle');
    const tvdb = document.getElementById('newShowTvdb');
    if (title) title.value = show.name || '';
    if (tvdb) tvdb.value = tvdbOf(show) || '';
    document.getElementById('smartAddResults')?.classList.add('d-none');
    selectedPreview(show);
  }

  function renderSmartResults(results) {
    const box = document.getElementById('smartAddResults');
    if (!box) return;
    if (!results.length) {
      box.innerHTML = '<div class="smart-add-empty">No matching show found.</div>';
      box.classList.remove('d-none');
      return;
    }
    box.innerHTML = results.slice(0, 8).map((entry, index) => {
      const show = entry.show;
      return `<button type="button" class="smart-add-result" data-smart-index="${index}">
        ${imageOf(show) ? `<img src="${esc(imageOf(show))}" alt="">` : '<span class="smart-result-placeholder">TV</span>'}
        <span><strong>${esc(show.name)}</strong><small>${esc(showYear(show))} · ${esc(show.status || 'Unknown')} · TVDB ${esc(tvdbOf(show) || 'N/A')}</small></span>
      </button>`;
    }).join('');
    box._results = results.slice(0, 8);
    box.classList.remove('d-none');
  }

  async function smartSearch(query) {
    const response = await fetch(`${API}/search/shows?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error(`TVMaze search failed (${response.status})`);
    return response.json();
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function pickExploreShows(shows, count = 6) {
    const valid = shows.filter(show => show?.image && show?.name);
    let picked = shuffle(valid).slice(0, count);
    let signature = picked.map(show => show.id).sort((a, b) => a - b).join('-');

    // Avoid showing exactly the same six cards after Refresh when possible.
    for (let attempt = 0; attempt < 4 && signature === lastExploreSignature && valid.length > count; attempt++) {
      picked = shuffle(valid).slice(0, count);
      signature = picked.map(show => show.id).sort((a, b) => a - b).join('-');
    }
    lastExploreSignature = signature;
    return picked;
  }

  async function loadExplore(query = '', forceRefresh = false) {
    const grid = document.getElementById('exploreGrid');
    const status = document.getElementById('exploreStatus');
    if (!grid) return;
    grid.innerHTML = '<div class="explore-loading"><span class="spin"></span> Loading TVMaze…</div>';
    try {
      let shows;
      if (query.trim()) {
        const results = await smartSearch(query.trim());
        shows = results.map(item => item.show).filter(Boolean).slice(0, 6);
        if (status) status.textContent = `Search results for “${query.trim()}”`;
      } else {
        // TVMaze show index is paginated. A new page + shuffle makes Refresh truly change suggestions.
        const page = forceRefresh ? Math.floor(Math.random() * 20) : (exploreRefreshSeed % 20);
        exploreRefreshSeed += 1;
        const response = await fetch(`${API}/shows?page=${page}&_=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`TVMaze explore failed (${response.status})`);
        const pageShows = await response.json();
        shows = pickExploreShows(pageShows, 6);
        localStorage.setItem(CACHE_KEY, JSON.stringify(shows));
        if (status) status.textContent = forceRefresh ? 'Fresh TVMaze suggestions' : 'Explore TVMaze shows';
      }
      renderExplore(shows);
    } catch (error) {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      if (cached.length && !query.trim()) {
        const cachedShows = forceRefresh ? pickExploreShows(cached, 6) : cached.slice(0, 6);
        if (status) status.textContent = 'Offline — showing cached Explore results';
        renderExplore(cachedShows);
      } else {
        grid.innerHTML = '<div class="dashboard-empty"><i class="bi bi-wifi-off"></i>Connect to the internet to search TVMaze.</div>';
        if (status) status.textContent = 'TVMaze is unavailable';
      }
    }
  }

  function renderExplore(shows) {
    const grid = document.getElementById('exploreGrid');
    if (!grid) return;
    const visibleShows = shows.slice(0, 6);
    if (!visibleShows.length) {
      grid.innerHTML = '<div class="dashboard-empty">No shows found.</div>';
      return;
    }
    grid._shows = visibleShows;
    grid.innerHTML = visibleShows.map((show, index) => {
      const added = exists(show);
      const rating = show?.rating?.average;
      const [c1, c2] = colorFor(show.name || 'TV');
      const hasImage = !!imageOf(show);
      return `<div class="explore-col">
        <article class="show-card explore-show-card">
          <div class="poster-fake ${hasImage ? 'has-image' : ''}" style="background:linear-gradient(150deg, ${c1}, ${c2});">
            ${hasImage ? `<img src="${esc(imageOf(show))}" alt="${esc(show.name)}" loading="lazy" class="poster-img">` : ''}
            <div class="status-badge st-${String(show.status || '').toLowerCase() === 'ended' ? 'completed' : 'not_started'}">${esc(show.status || 'Unknown')}</div>
            <span class="poster-initial" style="position:relative;z-index:1;">${esc(initials(show.name || 'TV'))}</span>
          </div>
          <div class="show-body">
            ${rating ? `<div class="rating-badge"><i class="bi bi-star-fill"></i>${esc(rating)}</div>` : ''}
            <div class="show-title">${esc(show.name)}</div>
            <div class="show-network">${esc(showYear(show))}${show.network?.name ? ` &middot; ${esc(show.network.name)}` : ''}</div>
            <div class="ep-count">${esc((show.genres || []).slice(0, 3).join(' · ') || 'Series')}</div>
            <button class="btn ${added ? 'btn-outline-secondary' : 'btn-success'} explore-add-btn" type="button" data-explore-add="${index}" ${added ? 'disabled' : ''}>
              <i class="bi ${added ? 'bi-check2' : 'bi-plus-lg'}"></i> ${added ? 'Added' : 'Add Show'}
            </button>
          </div>
        </article>
      </div>`;
    }).join('');
  }

  async function addExploreShow(show, button) {
    const tvdb = tvdbOf(show);
    if (!tvdb) {
      alert('This TVMaze result does not include a TVDB ID, so it cannot be added yet.');
      return;
    }
    if (exists(show)) return;
    const old = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spin" style="width:11px;height:11px"></span> Adding…';
    try {
      const result = await fetchTvmazeShowWithEpisodes(tvdb, show.name);
      await saveTvmazeCache(tvdb, createTvmazeCacheEntry(result.rawShow, result.seasons));
      SHOWS_DATA.push({
        uuid: crypto.randomUUID ? crypto.randomUUID() : `show-${Date.now()}`,
        id: { tvdb, imdb: result.rawShow?.externals?.imdb || null },
        tvdb,
        imdb: result.rawShow?.externals?.imdb || null,
        created_at: new Date().toISOString(),
        title: result.rawShow?.name || show.name,
        status: 'not_started_yet',
        is_watch_later: false,
        fav: false,
        is_favorite: false,
        _noEpisodeData: result.seasons.length === 0,
        seasons: result.seasons
      });
      await persistAndRefresh();
      render();
      button.className = 'btn btn-outline-secondary explore-add-btn';
      button.innerHTML = '<i class="bi bi-check2"></i> Added';
      initEnrichment();
    } catch (error) {
      button.disabled = false;
      button.innerHTML = old;
      alert(error.message || 'Could not add this show.');
    }
  }

  document.getElementById('newShowTitle')?.addEventListener('input', event => {
    selectedSmartShow = null;
    selectedPreview(null);
    const query = event.target.value.trim();
    clearTimeout(smartTimer);
    if (query.length < 2) {
      document.getElementById('smartAddResults')?.classList.add('d-none');
      return;
    }
    smartTimer = setTimeout(async () => {
      try { renderSmartResults(await smartSearch(query)); }
      catch { renderSmartResults([]); }
    }, 350);
  });

  document.getElementById('smartAddResults')?.addEventListener('click', event => {
    const button = event.target.closest('[data-smart-index]');
    const box = document.getElementById('smartAddResults');
    if (!button || !box?._results) return;
    chooseSmartShow(box._results[Number(button.dataset.smartIndex)].show);
  });

  document.getElementById('exploreGrid')?.addEventListener('click', event => {
    const button = event.target.closest('[data-explore-add]');
    const grid = document.getElementById('exploreGrid');
    if (!button || !grid?._shows) return;
    addExploreShow(grid._shows[Number(button.dataset.exploreAdd)], button);
  });

  const exploreSearch = () => loadExplore(document.getElementById('exploreSearchInput')?.value || '');
  document.getElementById('exploreSearchBtn')?.addEventListener('click', exploreSearch);
  document.getElementById('exploreSearchInput')?.addEventListener('keydown', event => { if (event.key === 'Enter') exploreSearch(); });
  document.getElementById('refreshExploreBtn')?.addEventListener('click', () => {
    const input = document.getElementById('exploreSearchInput');
    if (input) input.value = '';
    loadExplore('', true);
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.smart-add-field')) document.getElementById('smartAddResults')?.classList.add('d-none');
  });

  window.addEventListener('tvtime:profile-changed', () => loadExplore(document.getElementById('exploreSearchInput')?.value || ''));
  window.addEventListener('DOMContentLoaded', () => loadExplore());
})();
