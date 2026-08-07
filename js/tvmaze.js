const DB_NAME = 'tvtime_archive_db';
const STORE_NAME = 'tvmaze_cache';
const API_MIN_INTERVAL_MS = 650;
const RETRY_DELAY_MS = 6000;
const TVMAZE_RESOLVER_VERSION = 2;
const EPISODE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

let dbInstance = null;
let tvmazeCache = {};
let tvmazeCacheLoaded = false;
let requestChain = Promise.resolve();
let lastApiRequestAt = 0;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function idbOpen() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
            reject(new Error('IndexedDB unavailable'));
            return;
        }

        const request = indexedDB.open(DB_NAME);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'tvdbId' });
            if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('profile_data')) db.createObjectStore('profile_data', { keyPath: 'profileId' });
            if (!db.objectStoreNames.contains('app_meta')) db.createObjectStore('app_meta', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getDb() {
    if (!dbInstance) dbInstance = await idbOpen();
    return dbInstance;
}

async function idbGetAll() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

async function idbPut(tvdbId, value) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put({ tvdbId, ...value });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

async function idbClearAll() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

async function loadCacheFromDB() {
    tvmazeCache = {};
    try {
        const rows = await idbGetAll();
        rows.forEach(row => {
            const { tvdbId, ...data } = row;
            tvmazeCache[tvdbId] = data;
        });
    } catch (error) {
        console.warn('IndexedDB unavailable, TVMaze cache will not persist across reloads:', error);
    } finally {
        tvmazeCacheLoaded = true;
    }
}

async function saveTvmazeCache(tvdbId, data) {
    if (!tvdbId) return;
    const next = { ...(tvmazeCache[tvdbId] || {}), ...(data || {}) };
    tvmazeCache[tvdbId] = next;
    try {
        await idbPut(tvdbId, next);
    } catch (error) {
        console.warn('IndexedDB write failed:', error);
    }
}

async function clearTvmazeCache() {
    enrichRunId++;
    tvmazeCache = {};
    tvmazeCacheLoaded = true;
    try {
        await idbClearAll();
    } catch (error) {
        console.warn('IndexedDB clear failed:', error);
    }
}

async function fetchTvmazeJsonNow(url, retries = 2) {
    let attempt = 0;
    while (attempt <= retries) {
        const wait = Math.max(0, lastApiRequestAt + API_MIN_INTERVAL_MS - Date.now());
        if (wait) await delay(wait);
        lastApiRequestAt = Date.now();

        let response;
        try {
            response = await fetch(url, { headers: { Accept: 'application/json' } });
        } catch (error) {
            if (attempt >= retries) throw error;
            attempt++;
            await delay(RETRY_DELAY_MS);
            continue;
        }

        if (response.status === 429) {
            if (attempt >= retries) {
                const error = new Error('TVMaze rate limit reached.');
                error.status = 429;
                throw error;
            }
            attempt++;
            await delay(RETRY_DELAY_MS);
            continue;
        }

        if (!response.ok) {
            const error = new Error(`TVMaze request failed (${response.status}).`);
            error.status = response.status;
            throw error;
        }

        return response.json();
    }

    throw new Error('TVMaze request failed.');
}

function fetchTvmazeJson(url, options = {}) {
    const retries = Number(options.retries ?? 2);
    const task = requestChain
        .catch(() => undefined)
        .then(() => fetchTvmazeJsonNow(url, retries));
    requestChain = task;
    return task;
}

function stripHtml(html) {
    if (!html) return '';
    const temporary = document.createElement('div');
    temporary.innerHTML = html;
    return (temporary.textContent || temporary.innerText || '').trim();
}

function mapTvmazeShow(raw) {
    return {
        notFound: false,
        resolverVersion: TVMAZE_RESOLVER_VERSION,
        fetchedAt: Date.now(),
        image: raw?.image ? (raw.image.medium || raw.image.original) : null,
        summary: stripHtml(raw?.summary),
        genres: raw?.genres || [],
        network: (raw?.network && raw.network.name) || (raw?.webChannel && raw.webChannel.name) || null,
        premiered: raw?.premiered ? raw.premiered.slice(0, 4) : null,
        rating: raw?.rating ? raw.rating.average : null,
        runtime: raw?.averageRuntime || raw?.runtime || null,
        officialStatus: raw?.status || null,
        mazeId: raw?.id || null,
        tvmazeUrl: raw?.url || null
    };
}

function createTvmazeCacheEntry(rawShow, seasons) {
    return {
        ...mapTvmazeShow(rawShow),
        seasons: Array.isArray(seasons) ? seasons : [],
        episodesFetchedAt: Date.now(),
        resolverVersion: TVMAZE_RESOLVER_VERSION,
        notFound: false
    };
}

function isTvmazeSpecialEpisode(episode) {
    const seasonNumber = Number(episode?.season ?? 0);
    const type = String(episode?.type ?? '').trim().toLowerCase();
    const title = String(episode?.name ?? '').trim();
    const titleLooksSpecial = window.hasSpecialEpisodeTitle
        ? window.hasSpecialEpisodeTitle(title)
        : /(?:^|[\s:–—-])(special|making[\s-]?of|behind the scenes|bonus|recap|aftershow|after show|inside the episode|extras?)(?:$|[\s:–—-])/i.test(title);

    return seasonNumber === 0 ||
        Boolean(episode?.special ?? episode?.is_special) ||
        (type && type !== 'regular') ||
        titleLooksSpecial;
}

function mapTvmazeEpisodes(rawEpisodes) {
    const grouped = new Map();

    (Array.isArray(rawEpisodes) ? rawEpisodes : []).forEach(episode => {
        const seasonNumber = Number(episode?.season ?? 0);
        if (seasonNumber <= 0 || isTvmazeSpecialEpisode(episode)) return;
        if (!grouped.has(seasonNumber)) grouped.set(seasonNumber, []);

        const fallbackNumber = grouped.get(seasonNumber).length + 1;
        const episodeNumber = episode?.number == null ? fallbackNumber : Number(episode.number);

        grouped.get(seasonNumber).push({
            n: episodeNumber,
            name: episode?.name || `Episode ${episodeNumber}`,
            w: false,
            wa: null,
            sp: false,
            special: false,
            type: episode?.type || 'regular',
            id: { tvmaze: episode?.id ?? null },
            airdate: episode?.airdate || null,
            runtime: Number(episode?.runtime || 0) || null
        });
    });

    return [...grouped.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([number, episodes]) => ({
            n: number,
            sp: false,
            eps: episodes.sort((a, b) => Number(a.n) - Number(b.n))
        }));
}

function normalizeSearchTitle(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\(\s*(19|20)\d{2}\s*\)\s*$/g, '')
        .replace(/&/g, ' and ')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function extractTitleYear(value) {
    const match = String(value || '').match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : null;
}

function selectTvmazeSearchMatch(results, tvdbId, title) {
    const candidates = (Array.isArray(results) ? results : [])
        .map(result => ({ result, show: result?.show }))
        .filter(item => item.show);

    const targetTvdb = Number(tvdbId) || null;
    const exactExternal = targetTvdb
        ? candidates.find(item => Number(item.show?.externals?.thetvdb) === targetTvdb)
        : null;
    if (exactExternal) return exactExternal.show;

    const queryTitle = normalizeSearchTitle(title);
    const queryYear = extractTitleYear(title);
    let best = null;

    candidates.forEach(item => {
        const candidateTitle = normalizeSearchTitle(item.show.name);
        const candidateYear = item.show?.premiered ? String(item.show.premiered).slice(0, 4) : null;
        let score = Number(item.result?.score || 0) * 100;

        if (candidateTitle === queryTitle) score += 500;
        else if (candidateTitle && queryTitle && (candidateTitle.includes(queryTitle) || queryTitle.includes(candidateTitle))) score += 180;

        if (queryYear && candidateYear === queryYear) score += 100;
        else if (queryYear && candidateYear && candidateYear !== queryYear) score -= 80;

        if (!best || score > best.score) best = { show: item.show, score, exactTitle: candidateTitle === queryTitle };
    });

    if (!best) return null;
    if (best.exactTitle || best.score >= 220) return best.show;
    return null;
}

async function searchTvmazeShow(title, tvdbId) {
    const query = String(title || '').trim();
    if (!query) return null;
    const results = await fetchTvmazeJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
    return selectTvmazeSearchMatch(results, tvdbId, query);
}

async function fetchTvmazeEpisodes(mazeId) {
    const rawEpisodes = await fetchTvmazeJson(`https://api.tvmaze.com/shows/${encodeURIComponent(mazeId)}/episodes`);
    return mapTvmazeEpisodes(rawEpisodes);
}

async function fetchTvmazeShowWithEpisodes(tvdbId, title) {
    const rawShow = await searchTvmazeShow(title, tvdbId);
    if (!rawShow) throw new Error('Show not found on TVMaze by title or TVDB ID.');
    const seasons = await fetchTvmazeEpisodes(rawShow.id);
    return { rawShow, seasons };
}

async function fetchTvmazeEnrichment(show) {
    const cached = tvmazeCache[show.tvdb] || null;
    let rawShow = null;
    let mazeId = cached?.notFound ? null : cached?.mazeId;

    if (!mazeId) {
        rawShow = await searchTvmazeShow(show.title, show.tvdb);
        if (!rawShow) return null;
        mazeId = rawShow.id;
    }

    try {
        const seasons = await fetchTvmazeEpisodes(mazeId);
        const cacheEntry = rawShow
            ? createTvmazeCacheEntry(rawShow, seasons)
            : {
                ...cached,
                notFound: false,
                resolverVersion: TVMAZE_RESOLVER_VERSION,
                fetchedAt: cached?.fetchedAt || Date.now(),
                seasons,
                episodesFetchedAt: Date.now()
            };
        return { rawShow, seasons, cacheEntry };
    } catch (error) {
        // A cached TVMaze ID can become stale. Resolve it again by title once.
        if (!rawShow && error?.status === 404) {
            rawShow = await searchTvmazeShow(show.title, show.tvdb);
            if (!rawShow) return null;
            const seasons = await fetchTvmazeEpisodes(rawShow.id);
            return { rawShow, seasons, cacheEntry: createTvmazeCacheEntry(rawShow, seasons) };
        }
        throw error;
    }
}

function episodeStableId(episode) {
    const value = episode?.id;
    if (value && typeof value === 'object') return value.tvmaze ?? value.tvdb ?? value.imdb ?? null;
    return value ?? null;
}

function mergeEpisodeIds(remoteEpisode, localEpisode) {
    const localId = localEpisode?.id && typeof localEpisode.id === 'object'
        ? localEpisode.id
        : (localEpisode?.id != null ? { tvmaze: localEpisode.id } : {});
    const remoteId = remoteEpisode?.id && typeof remoteEpisode.id === 'object'
        ? remoteEpisode.id
        : (remoteEpisode?.id != null ? { tvmaze: remoteEpisode.id } : {});
    return { ...localId, ...remoteId };
}

function normalizeEpisodeTitle(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findExistingEpisode(remoteEpisode, existingEpisodes, usedEpisodes) {
    const remoteId = episodeStableId(remoteEpisode);
    if (remoteId != null) {
        const byId = existingEpisodes.find(item =>
            !usedEpisodes.has(item) && String(episodeStableId(item)) === String(remoteId)
        );
        if (byId) return byId;
    }

    const byNumber = existingEpisodes.find(item =>
        !usedEpisodes.has(item) && Number(item.n) === Number(remoteEpisode.n)
    );
    if (byNumber) return byNumber;

    const remoteTitle = normalizeEpisodeTitle(remoteEpisode.name);
    if (remoteTitle) {
        const byTitle = existingEpisodes.find(item =>
            !usedEpisodes.has(item) && normalizeEpisodeTitle(item.name) === remoteTitle
        );
        if (byTitle) return byTitle;
    }

    if (remoteEpisode.airdate) {
        return existingEpisodes.find(item =>
            !usedEpisodes.has(item) && item.airdate === remoteEpisode.airdate
        ) || null;
    }

    return null;
}

function mergeTvmazeEpisodesIntoShow(show, remoteSeasons) {
    const isSpecial = (episode, season) => window.isSpecialEpisode
        ? window.isSpecialEpisode(episode, season, show)
        : Boolean(season?.sp || Number(season?.n) === 0 || episode?.sp || episode?.special);

    const isWatched = episode => window.episodeIsWatched
        ? window.episodeIsWatched(episode)
        : Boolean(episode?.w || episode?.is_watched);

    const watchedAt = episode => window.episodeWatchedAt
        ? window.episodeWatchedAt(episode)
        : (episode?.wa || episode?.watched_at || null);

    const existingSeasons = (Array.isArray(show?.seasons) ? show.seasons : [])
        .filter(season => !season?.sp && Number(season?.n) !== 0);
    const existingSeasonMap = new Map(existingSeasons.map(season => [Number(season.n), season]));
    const mergedSeasonMap = new Map();
    let newRegularEpisodes = 0;

    (Array.isArray(remoteSeasons) ? remoteSeasons : [])
        .filter(remoteSeason => !remoteSeason?.sp && Number(remoteSeason?.n) !== 0)
        .forEach(remoteSeason => {
            const seasonNumber = Number(remoteSeason.n);
            const existingSeason = existingSeasonMap.get(seasonNumber);
            const allExistingEpisodes = Array.isArray(existingSeason?.eps) ? existingSeason.eps : [];
            const existingEpisodes = allExistingEpisodes.filter(episode => !isSpecial(episode, existingSeason));
            const contaminatedEpisodes = allExistingEpisodes.filter(episode => isSpecial(episode, existingSeason));
            const remoteEpisodes = (Array.isArray(remoteSeason.eps) ? remoteSeason.eps : [])
                .filter(episode => !isSpecial(episode, remoteSeason));
            const usedEpisodes = new Set();
            const mergedEpisodes = [];

            remoteEpisodes.forEach(remoteEpisode => {
                const existing = findExistingEpisode(remoteEpisode, existingEpisodes, usedEpisodes);
                if (existing) usedEpisodes.add(existing);

                const recovery = !existing
                    ? contaminatedEpisodes.find(item => Number(item.n) === Number(remoteEpisode.n))
                    : null;
                const watchSource = existing || recovery;
                if (!watchSource) newRegularEpisodes++;

                const watched = isWatched(watchSource);
                mergedEpisodes.push({
                    ...(watchSource || {}),
                    ...remoteEpisode,
                    id: mergeEpisodeIds(remoteEpisode, watchSource),
                    w: watched,
                    wa: watchedAt(watchSource),
                    watched_count: Number(watchSource?.watched_count ?? (watched ? 1 : 0)),
                    rewatch_count: Number(watchSource?.rewatch_count ?? 0),
                    sp: false,
                    special: false,
                    is_special: false,
                    type: remoteEpisode.type || 'regular'
                });
            });

            // Preserve unmatched local records so imported history can never be deleted.
            existingEpisodes.forEach(existing => {
                if (!usedEpisodes.has(existing)) mergedEpisodes.push(existing);
            });

            mergedEpisodes.sort((a, b) => Number(a.n) - Number(b.n));
            mergedSeasonMap.set(seasonNumber, {
                ...(existingSeason || {}),
                ...remoteSeason,
                n: seasonNumber,
                sp: false,
                eps: mergedEpisodes
            });
        });

    existingSeasons.forEach(existingSeason => {
        const number = Number(existingSeason.n);
        if (!mergedSeasonMap.has(number)) mergedSeasonMap.set(number, existingSeason);
    });

    show.seasons = [...mergedSeasonMap.values()]
        .filter(season => !season?.sp && Number(season?.n) !== 0)
        .map(season => {
            const cleanSeason = {
                ...season,
                sp: false,
                eps: (Array.isArray(season.eps) ? season.eps : []).filter(episode => !isSpecial(episode, season))
            };
            cleanSeason.eps = window.canonicalRegularEpisodes
                ? window.canonicalRegularEpisodes(cleanSeason, show)
                : cleanSeason.eps;
            return cleanSeason;
        })
        .sort((a, b) => Number(a.n) - Number(b.n));

    show._noEpisodeData = show.seasons.length === 0;
    return { newRegularEpisodes };
}

function applyEnrichment(idx, refreshAll = true) {
    const show = SHOWS_DATA[idx];
    if (!show) return;

    const cached = tvmazeCache[show.tvdb];
    const card = document.querySelector(`.show-card[data-idx="${idx}"]`);

    if (card && cached?.image) {
        const poster = card.querySelector('.poster-fake');
        if (poster && !poster.querySelector('img')) {
            const image = document.createElement('img');
            image.src = cached.image;
            image.alt = '';
            image.loading = 'lazy';
            image.className = 'poster-img';
            poster.prepend(image);
            poster.classList.add('has-image');
        }

        if (cached.network && !card.querySelector('.show-network')) {
            const network = document.createElement('div');
            network.className = 'show-network';
            network.textContent = cached.network + (cached.premiered ? ` · ${cached.premiered}` : '');
            card.querySelector('.show-title')?.insertAdjacentElement('afterend', network);
        }

        if (cached.rating && !card.querySelector('.rating-badge')) {
            const badge = document.createElement('div');
            badge.className = 'rating-badge';
            badge.innerHTML = `<i class="bi bi-star-fill"></i>${cached.rating}`;
            poster?.appendChild(badge);
        }
    }

    const panel = document.getElementById(`panel-${idx}`);
    const about = panel?.querySelector('.about-block');
    if (about) fillAboutBlock(about, show);

    if (refreshAll) {
        renderStats();
        render();
    }
}

let enrichQueue = [];
let enrichTotal = 0;
let enrichDone = 0;
let queueRunning = false;
let enrichRunId = 0;
let enrichmentDirty = false;

function showEnrichBar() {
    document.getElementById('enrichBar')?.classList.remove('hidden');
}

function updateEnrichBar() {
    const safeDone = Math.min(enrichDone, enrichTotal);
    const count = document.getElementById('enrichCount');
    const fill = document.getElementById('enrichFill');
    if (count) count.textContent = `${safeDone} / ${enrichTotal}`;
    if (fill) fill.style.width = `${enrichTotal ? Math.round((safeDone / enrichTotal) * 100) : 0}%`;
}

async function finishEnrichment(runId = enrichRunId) {
    if (runId !== enrichRunId) return;
    queueRunning = false;

    if (enrichmentDirty && window.TVTimeProfiles) {
        try {
            await window.TVTimeProfiles.saveActiveData();
        } catch (error) {
            console.warn('Could not persist TVMaze episode metadata:', error);
        }
    }

    if (runId !== enrichRunId) return;
    renderStats();
    render();

    const bar = document.getElementById('enrichBar');
    if (bar) setTimeout(() => bar.classList.add('hidden'), 900);
}

async function processQueue(runId = enrichRunId) {
    if (runId !== enrichRunId) return;

    if (enrichQueue.length === 0) {
        await finishEnrichment(runId);
        return;
    }

    queueRunning = true;
    const idx = enrichQueue.shift();
    const show = SHOWS_DATA[idx];

    if (!show?.tvdb) {
        enrichDone++;
        updateEnrichBar();
        setTimeout(() => processQueue(runId), 0);
        return;
    }

    try {
        const result = await fetchTvmazeEnrichment(show);
        if (!result) {
            await saveTvmazeCache(show.tvdb, {
                notFound: true,
                resolverVersion: TVMAZE_RESOLVER_VERSION,
                fetchedAt: Date.now(),
                lastAttemptAt: Date.now(),
                seasons: []
            });
        } else {
            await saveTvmazeCache(show.tvdb, result.cacheEntry);
            mergeTvmazeEpisodesIntoShow(show, result.seasons);
            enrichmentDirty = true;
            applyEnrichment(idx, false);
        }
    } catch (error) {
        console.warn(`TVMaze enrichment failed for "${show.title}":`, error);
    }

    if (runId !== enrichRunId) return;

    enrichDone = Math.min(enrichDone + 1, enrichTotal);
    updateEnrichBar();

    if (enrichDone % 6 === 0 || enrichQueue.length === 0) {
        renderStats();
        render();
    }

    setTimeout(() => processQueue(runId), 0);
}

function cacheNeedsRefresh(cache) {
    if (!cache) return true;

    const now = Date.now();
    if (cache.notFound) {
        const attemptedAt = Number(cache.lastAttemptAt || cache.fetchedAt || 0);
        return Number(cache.resolverVersion || 0) < TVMAZE_RESOLVER_VERSION ||
            !attemptedAt ||
            now - attemptedAt >= NOT_FOUND_RETRY_MS;
    }

    if (!cache.mazeId || !Array.isArray(cache.seasons)) return true;
    const fetchedAt = Number(cache.episodesFetchedAt || 0);
    return !fetchedAt || now - fetchedAt >= EPISODE_CACHE_MAX_AGE_MS;
}

function initEnrichment() {
    if (!tvmazeCacheLoaded) return;

    enrichRunId++;
    const runId = enrichRunId;
    enrichQueue = [];
    queueRunning = false;
    enrichmentDirty = false;

    const eligible = SHOWS_DATA
        .map((show, idx) => ({ show, idx }))
        .filter(item => item.show?.tvdb && !window.isSpecialShow?.(item.show));

    eligible.forEach(({ show, idx }) => {
        const cache = tvmazeCache[show.tvdb];

        if (cache && !cache.notFound && Array.isArray(cache.seasons) && cache.seasons.length) {
            mergeTvmazeEpisodesIntoShow(show, cache.seasons);
            enrichmentDirty = true;
            applyEnrichment(idx, false);
        }

        if (cacheNeedsRefresh(cache)) enrichQueue.push(idx);
    });

    enrichTotal = eligible.length;
    enrichDone = Math.max(0, enrichTotal - enrichQueue.length);
    updateEnrichBar();

    renderStats();
    render();

    if (enrichQueue.length === 0) {
        if (enrichTotal) showEnrichBar();
        finishEnrichment(runId);
        return;
    }

    showEnrichBar();
    processQueue(runId);
}
