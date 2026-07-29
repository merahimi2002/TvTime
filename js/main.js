const STATUS_LABEL = {
    up_to_date: "Watched",
    continuing: "Airing",
    watch_later: "Watch Later",
    not_started_yet: "Not Started"
};

const PALETTE = [
    ["#ff5470", "#ff8a5b"], ["#5fb0ff", "#7d5fff"], ["#33d69f", "#1fa8ff"],
    ["#a78bfa", "#ff5470"], ["#ffb84d", "#ff5470"], ["#37c9c1", "#5fb0ff"],
    ["#ff8a5b", "#a78bfa"], ["#5fd6a3", "#5fb0ff"]
];

function toFa(n) { return n.toLocaleString('en-US'); }

function showStats(show) {
    let total = 0, watched = 0, lastWatched = null;
    show.seasons.forEach(se => {
        se.eps.forEach(ep => {
            total++;
            if (ep.w) {
                watched++;
                if (ep.wa && (!lastWatched || ep.wa > lastWatched)) lastWatched = ep.wa;
            }
        });
    });
    return { total, watched, pct: total ? Math.round(watched / total * 100) : 0, lastWatched };
}

function colorFor(title) {
    let h = 0;
    for (let i = 0; i < title.length; i++) h = title.charCodeAt(i) + ((h << 5) - h);
    return PALETTE[Math.abs(h) % PALETTE.length];
}

function initials(title) {
    const words = title.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

function buildCard(show, idx) {
    const st = showStats(show);
    const [c1, c2] = colorFor(show.title);
    const statusCls = "st-" + show.status;
    const statusText = STATUS_LABEL[show.status] || show.status;
    const cached = show.tvdb ? tvmazeCache[show.tvdb] : null;
    const hasImage = !!(cached && cached.image);

    const col = document.createElement('div');
    col.className = "col-12 col-sm-6 col-md-4 col-lg-3 col-xxl-2";
    col.innerHTML = `
    <div class="show-card" data-idx="${idx}">
      <div class="poster-fake ${hasImage ? 'has-image' : ''}" style="background:linear-gradient(150deg, ${c1}, ${c2});">
        ${hasImage ? `<img src="${cached.image}" alt="" loading="lazy" class="poster-img">` : ''}
        ${show.fav ? '<div class="fav-badge"><i class="bi bi-star-fill"></i></div>' : ''}
        <div class="status-badge ${statusCls}">${statusText}</div>
        <span class="poster-initial" style="position:relative;z-index:1;">${initials(show.title)}</span>
      </div>
      <div class="show-body">
        ${cached && cached.rating ? `<div class="rating-badge"><i class="bi bi-star-fill"></i>${cached.rating}</div>` : ''}
        <div class="show-title">${show.title}</div>
        ${cached && cached.network ? `<div class="show-network">${cached.network}${cached.premiered ? ' &middot; ' + cached.premiered : ''}</div>` : ''}
        <div class="ep-count">${toFa(st.watched)} / ${toFa(st.total)} episodes</div>
        <div class="progress"><div class="progress-bar" role="progressbar" style="width:${st.pct}%"></div></div>
        <button class="expand-btn" data-toggle="${idx}">
          <i class="bi bi-chevron-down"></i> Show Seasons
        </button>
      </div>
      <div class="detail-panel" id="panel-${idx}"></div>
    </div>
  `;
    return col;
}

function fillAboutBlock(el, show) {
    const cached = show.tvdb ? tvmazeCache[show.tvdb] : null;

    if (!show.tvdb) {
        el.innerHTML = `<div class="about-loading" style="color:var(--txt-2);"><i class="bi bi-info-circle"></i> No TVDB id on file for this show &mdash; can't look it up on TVMaze.</div>`;
        return;
    }
    if (!cached) {
        el.innerHTML = `<div class="about-loading"><span class="spin"></span> Fetching info from TVMaze&hellip;</div>`;
        return;
    }
    if (cached.notFound) {
        el.innerHTML = `<div class="about-loading" style="color:var(--txt-2);"><i class="bi bi-slash-circle"></i> Not found on TVMaze.</div>`;
        return;
    }

    const genres = (cached.genres || []).map(g => `<span class="genre-badge">${g}</span>`).join('');
    const metaBits = [];
    if (cached.network) metaBits.push(`<span><i class="bi bi-broadcast"></i> ${cached.network}</span>`);
    if (cached.premiered) metaBits.push(`<span><i class="bi bi-calendar3"></i> ${cached.premiered}</span>`);
    if (cached.runtime) metaBits.push(`<span><i class="bi bi-clock"></i> ${cached.runtime} min</span>`);
    if (cached.rating) metaBits.push(`<span><i class="bi bi-star-fill" style="color:#ffd15c;"></i> ${cached.rating}</span>`);
    if (cached.officialStatus) metaBits.push(`<span><i class="bi bi-broadcast-pin"></i> ${cached.officialStatus}</span>`);

    el.innerHTML = `
    ${genres ? `<div>${genres}</div>` : ''}
    <div class="about-meta">${metaBits.join('')}</div>
    ${cached.summary ? `<div class="about-summary">${cached.summary}</div>` : ''}
  `;
}

function buildSeasonPanel(show, idx) {
    const panel = document.getElementById(`panel-${idx}`);
    if (panel.dataset.built) return;
    panel.dataset.built = "1";

    const about = document.createElement('div');
    about.className = "about-block";
    panel.appendChild(about);
    fillAboutBlock(about, show);

    show.seasons.forEach((se, sIdx) => {
        const watched = se.eps.filter(e => e.w).length;
        const total = se.eps.length;
        const pct = total ? Math.round(watched / total * 100) : 0;
        const label = se.sp ? "Specials" : `Season ${toFa(se.n)}`;

        const seasonWrap = document.createElement('div');
        seasonWrap.innerHTML = `
      <div class="season-head" data-season-toggle="${idx}-${sIdx}">
        <span><i class="bi bi-chevron-right small me-1 rot-icon"></i>${label}</span>
        <span class="d-flex align-items-center gap-2">
          <span class="ep-count">${toFa(watched)}/${toFa(total)}</span>
          <span class="season-progress-mini progress"><span class="progress-bar" style="display:block;width:${pct}%;height:100%;border-radius:99px;background:var(--ok);"></span></span>
        </span>
      </div>
      <div class="ep-list" id="eplist-${idx}-${sIdx}"></div>
    `;
        panel.appendChild(seasonWrap);

        const epList = seasonWrap.querySelector(`#eplist-${idx}-${sIdx}`);
        se.eps.forEach(ep => {
            const row = document.createElement('div');
            row.className = "ep-row";
            const dateStr = ep.wa ? ep.wa.split(' ')[0] : '';
            row.innerHTML = `
        <span class="ep-dot ${ep.w ? 'watched' : 'unwatched'}"></span>
        <span class="num" style="color:var(--txt-2); min-width:22px;">${toFa(ep.n)}</span>
        <span class="ep-name ${ep.w ? '' : 'unwatched-text'}">${ep.name || 'Untitled'}</span>
        <span class="ep-date">${dateStr}</span>
      `;
            epList.appendChild(row);
        });
    });
}

// ---------- TVMaze enrichment (https://api.tvmaze.com) ----------
// Free, no API key needed. Their docs ask for ~20 req / 10s max, so we
// throttle to one request every 600ms (well under that). Results are
// cached in IndexedDB so a page reload never re-fetches known shows.
const DB_NAME = 'tvtime_archive_db';
const DB_VERSION = 1;
const STORE_NAME = 'tvmaze_cache';
const RATE_DELAY_MS = 600;
const RETRY_DELAY_MS = 6000;

let dbInstance = null;
function idbOpen() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'tvdbId' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function getDb() {
    if (!dbInstance) dbInstance = await idbOpen();
    return dbInstance;
}
async function idbGetAll() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}
async function idbPut(tvdbId, value) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(Object.assign({ tvdbId }, value));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
async function idbClearAll() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

let tvmazeCache = {}; // in-memory mirror keyed by tvdbId -> data object

async function loadCacheFromDB() {
    try {
        const rows = await idbGetAll();
        rows.forEach(row => {
            const { tvdbId } = row;
            const rest = Object.assign({}, row);
            delete rest.tvdbId;
            tvmazeCache[tvdbId] = rest;
        });
    } catch (e) {
        console.warn('IndexedDB unavailable, TVMaze cache will not persist across reloads:', e);
    }
}

async function saveTvmazeCache(tvdbId, data) {
    tvmazeCache[tvdbId] = data;
    try { await idbPut(tvdbId, data); }
    catch (e) { console.warn('IndexedDB write failed:', e); }
}

async function clearTvmazeCache() {
    tvmazeCache = {};
    try { await idbClearAll(); }
    catch (e) { console.warn('IndexedDB clear failed:', e); }
}

function stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').trim();
}

function mapTvmazeShow(raw) {
    return {
        notFound: false,
        fetchedAt: Date.now(),
        image: raw.image ? (raw.image.medium || raw.image.original) : null,
        summary: stripHtml(raw.summary),
        genres: raw.genres || [],
        network: (raw.network && raw.network.name) || (raw.webChannel && raw.webChannel.name) || null,
        premiered: raw.premiered ? raw.premiered.slice(0, 4) : null,
        rating: raw.rating ? raw.rating.average : null,
        runtime: raw.averageRuntime || raw.runtime || null,
        officialStatus: raw.status || null
    };
}

function applyEnrichment(idx) {
    const show = SHOWS_DATA[idx];
    const cached = tvmazeCache[show.tvdb];
    const card = document.querySelector(`.show-card[data-idx="${idx}"]`);
    if (card && cached && cached.image) {
        const posterEl = card.querySelector('.poster-fake');
        if (posterEl && !posterEl.querySelector('img')) {
            const img = document.createElement('img');
            img.src = cached.image;
            img.alt = '';
            img.loading = 'lazy';
            img.className = 'poster-img';
            posterEl.prepend(img);
            posterEl.classList.add('has-image');
        }
        if (cached.network && !card.querySelector('.show-network')) {
            const netEl = document.createElement('div');
            netEl.className = 'show-network';
            netEl.textContent = cached.network + (cached.premiered ? ' \u00b7 ' + cached.premiered : '');
            card.querySelector('.show-title').insertAdjacentElement('afterend', netEl);
        }
        if (cached.rating && !card.querySelector('.rating-badge')) {
            const badge = document.createElement('div');
            badge.className = 'rating-badge';
            badge.innerHTML = `<i class="bi bi-star-fill"></i>${cached.rating}`;
            posterEl.appendChild(badge);
        }
    }
    const panel = document.getElementById(`panel-${idx}`);
    if (panel) {
        const aboutEl = panel.querySelector('.about-block');
        if (aboutEl) fillAboutBlock(aboutEl, show);
    }

    // officialStatus just arrived from TVMaze — if the Running filter is on,
    // this show may need to appear/disappear, so refresh the grid.
    if (currentFilter.official) render();
}

let enrichQueue = [];
let enrichTotal = 0;
let enrichDone = 0;
let queueRunning = false;

function showEnrichBar() {
    document.getElementById('enrichBar').classList.remove('hidden');
}
function updateEnrichBar() {
    document.getElementById('enrichCount').textContent = `${enrichDone} / ${enrichTotal}`;
    const pct = enrichTotal ? Math.round(enrichDone / enrichTotal * 100) : 0;
    document.getElementById('enrichFill').style.width = pct + '%';
}
function finishEnrichment() {
    const bar = document.getElementById('enrichBar');
    setTimeout(() => bar.classList.add('hidden'), 900);
}

async function processQueue() {
    if (enrichQueue.length === 0) {
        queueRunning = false;
        finishEnrichment();
        return;
    }
    queueRunning = true;
    const idx = enrichQueue.shift();
    const show = SHOWS_DATA[idx];
    let delay = RATE_DELAY_MS;

    try {
        const res = await fetch(`https://api.tvmaze.com/lookup/shows?thetvdb=${show.tvdb}`);
        if (res.status === 429) {
            enrichQueue.unshift(idx);
            delay = RETRY_DELAY_MS;
        } else if (res.status === 404) {
            await saveTvmazeCache(show.tvdb, { notFound: true, fetchedAt: Date.now() });
            applyEnrichment(idx);
            enrichDone++;
        } else if (res.ok) {
            const raw = await res.json();
            await saveTvmazeCache(show.tvdb, mapTvmazeShow(raw));
            applyEnrichment(idx);
            enrichDone++;
        } else {
            enrichDone++;
        }
    } catch (err) {
        console.warn('TVMaze lookup failed for', show.title, err);
        enrichDone++;
    }

    updateEnrichBar();
    setTimeout(processQueue, delay);
}

function initEnrichment() {
    SHOWS_DATA.forEach((s, idx) => {
        if (!s.tvdb) return;
        if (tvmazeCache[s.tvdb]) return; // already cached (found or confirmed not-found) — no API call needed
        if (enrichQueue.includes(idx)) return;
        enrichQueue.push(idx);
    });
    enrichTotal = enrichDone + enrichQueue.length;
    if (enrichQueue.length === 0) return;
    showEnrichBar();
    updateEnrichBar();
    if (!queueRunning) processQueue();
}

let currentFilter = { status: 'all', fav: false, search: '', official: '', unwatchedOnly: false };
let currentSort = 'title';

function filteredShows() {
    let list = SHOWS_DATA.filter(s => {
        if (currentFilter.status !== 'all' && s.status !== currentFilter.status) return false;
        if (currentFilter.fav && !s.fav) return false;
        if (currentFilter.official) {
            const cached = s.tvdb ? tvmazeCache[s.tvdb] : null;
            if (!cached || cached.officialStatus !== currentFilter.official) return false;
            if (currentFilter.unwatchedOnly) {
                // specials (se.sp) don't count — only "real" seasons matter here
                const hasUnwatched = s.seasons.some(se => !se.sp && se.eps.some(ep => !ep.w));
                if (!hasUnwatched) return false;
            }
        }
        if (currentFilter.search && !s.title.toLowerCase().includes(currentFilter.search)) return false;
        return true;
    });

    list = list.map(s => ({ show: s, st: showStats(s) }));

    switch (currentSort) {
        case 'progress':
            list.sort((a, b) => b.st.pct - a.st.pct); break;
        case 'episodes':
            list.sort((a, b) => b.st.total - a.st.total); break;
        case 'recent':
            list.sort((a, b) => (b.st.lastWatched || '').localeCompare(a.st.lastWatched || '')); break;
        default:
            list.sort((a, b) => a.show.title.localeCompare(b.show.title, 'en', { sensitivity: 'base' }));
    }
    return list.map(x => x.show);
}

function render() {
    const grid = document.getElementById('grid');
    const empty = document.getElementById('emptyState');
    grid.innerHTML = '';
    const list = filteredShows();

    if (list.length === 0) {
        empty.classList.remove('d-none');
    } else {
        empty.classList.add('d-none');
        list.forEach(show => {
            const idx = SHOWS_DATA.indexOf(show);
            grid.appendChild(buildCard(show, idx));
        });
    }
}

function renderStats() {
    document.getElementById('topShowCount').textContent = toFa(SHOWS_DATA.length);
    document.getElementById('statTotalShows').textContent = toFa(SHOWS_DATA.length);

    let watchedEp = 0, continuing = 0, fav = 0;
    SHOWS_DATA.forEach(s => {
        const st = showStats(s);
        watchedEp += st.watched;
        if (s.status === 'continuing') continuing++;
        if (s.fav) fav++;
    });
    document.getElementById('statWatchedEp').textContent = toFa(watchedEp);
    document.getElementById('statContinuing').textContent = toFa(continuing);
    document.getElementById('statFav').textContent = toFa(fav);
}

// Event delegation
document.getElementById('grid').addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('[data-toggle]');
    if (toggleBtn) {
        const idx = toggleBtn.dataset.toggle;
        const panel = document.getElementById(`panel-${idx}`);
        const show = SHOWS_DATA[idx];
        buildSeasonPanel(show, idx);
        panel.classList.toggle('open');
        const isOpen = panel.classList.contains('open');
        toggleBtn.innerHTML = isOpen
            ? '<i class="bi bi-chevron-up"></i> Hide Seasons'
            : '<i class="bi bi-chevron-down"></i> Show Seasons';
        return;
    }
    const seasonHead = e.target.closest('[data-season-toggle]');
    if (seasonHead) {
        const key = seasonHead.dataset.seasonToggle;
        const list = document.getElementById(`eplist-${key}`);
        list.classList.toggle('open');
        const icon = seasonHead.querySelector('.rot-icon');
        icon.style.transform = list.classList.contains('open') ? 'rotate(90deg)' : 'rotate(0deg)';
        icon.style.transition = '.15s';
    }
});

document.getElementById('searchInput').addEventListener('input', (e) => {
    currentFilter.search = e.target.value.trim().toLowerCase();
    render();
});

document.getElementById('filterChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;

    if (chip.dataset.fav) {
        chip.classList.toggle('active');
        currentFilter.fav = chip.classList.contains('active');
        render();
        return;
    }

    if (chip.dataset.official) {
        chip.classList.toggle('active');
        currentFilter.official = chip.classList.contains('active') ? chip.dataset.official : '';
        if (!currentFilter.official) {
            // "unwatched only" only makes sense together with Running, so drop it too
            currentFilter.unwatchedOnly = false;
            const unwatchedToggle = document.getElementById('unwatchedToggle');
            if (unwatchedToggle) unwatchedToggle.checked = false;
        }
        render();
        return;
    }

    document.querySelectorAll('.filter-chip[data-status]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter.status = chip.dataset.status;
    render();
});

document.getElementById('unwatchedToggle').addEventListener('change', (e) => {
    currentFilter.unwatchedOnly = e.target.checked;
    if (currentFilter.unwatchedOnly && currentFilter.official !== 'Running') {
        // this toggle only means something combined with Running, so turn it on too
        const runningChip = document.querySelector('.filter-chip[data-official="Running"]');
        if (runningChip) runningChip.classList.add('active');
        currentFilter.official = 'Running';
    }
    render();
});

document.getElementById('sortSelect').addEventListener('change', (e) => {
    currentSort = e.target.value;
    render();
});

document.getElementById('clearCacheBtn').addEventListener('click', async () => {
    const ok = confirm('Clear all locally cached TVMaze data (posters, genres, summaries, ratings)? Everything will be re-fetched from the API again, throttled as before.');
    if (!ok) return;

    const btn = document.getElementById('clearCacheBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" style="width:11px;height:11px;"></span> Clearing…';

    await clearTvmazeCache();
    enrichQueue = [];
    enrichTotal = 0;
    enrichDone = 0;

    render(); // posters/genres/ratings revert to placeholders since cache is now empty
    initEnrichment(); // re-queue everyone, throttled fetch starts again

    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-trash3"></i> Clear cache';
});

async function init() {
    await loadCacheFromDB();
    renderStats();
    render();
    initEnrichment();
}
init();