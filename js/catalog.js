let currentFilter = { status: 'all', fav: false, search: '' };
let currentSort = 'title';
const LIBRARY_PAGE_SIZE = 24;
let currentPage = 1;

function paginationTokens(totalPages, activePage) {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
    const pages = new Set([1, totalPages, activePage - 1, activePage, activePage + 1]);
    if (activePage <= 4) [2, 3, 4, 5].forEach(page => pages.add(page));
    if (activePage >= totalPages - 3) [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1].forEach(page => pages.add(page));
    const ordered = [...pages].filter(page => page >= 1 && page <= totalPages).sort((a, b) => a - b);
    const tokens = [];
    ordered.forEach((page, index) => {
        if (index && page - ordered[index - 1] > 1) tokens.push('ellipsis');
        tokens.push(page);
    });
    return tokens;
}

function renderLibraryPagination(totalItems) {
    const nav = document.getElementById('libraryPagination');
    const info = document.getElementById('libraryPageInfo');
    const buttons = document.getElementById('libraryPageButtons');
    if (!nav || !info || !buttons) return;

    const totalPages = Math.max(1, Math.ceil(totalItems / LIBRARY_PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    if (totalItems <= LIBRARY_PAGE_SIZE) {
        nav.classList.add('d-none');
        buttons.innerHTML = '';
        info.textContent = '';
        return;
    }

    const start = (currentPage - 1) * LIBRARY_PAGE_SIZE + 1;
    const end = Math.min(totalItems, currentPage * LIBRARY_PAGE_SIZE);
    info.textContent = `Showing ${toFa(start)}–${toFa(end)} of ${toFa(totalItems)} shows`;

    const numberButtons = paginationTokens(totalPages, currentPage).map(token => {
        if (token === 'ellipsis') return '<span class="library-page-ellipsis" aria-hidden="true">…</span>';
        const active = token === currentPage;
        return `<button class="library-page-btn ${active ? 'active' : ''}" type="button" data-library-page="${token}" ${active ? 'aria-current="page"' : ''}>${toFa(token)}</button>`;
    }).join('');

    buttons.innerHTML = `
      <button class="library-page-btn library-page-nav" type="button" data-library-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} aria-label="Previous page"><i class="bi bi-chevron-left"></i></button>
      ${numberButtons}
      <button class="library-page-btn library-page-nav" type="button" data-library-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''} aria-label="Next page"><i class="bi bi-chevron-right"></i></button>`;
    nav.classList.remove('d-none');
}

function filteredShows() {
    let list = SHOWS_DATA.filter(s => {
        if (window.isSpecialShow?.(s)) return false;
        if (!showMatchesStatus(s, currentFilter.status)) return false;
        if (currentFilter.fav && !s.fav) return false;
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
        case 'added':
            list.sort((a, b) => String(b.show.created_at || '').localeCompare(String(a.show.created_at || ''))); break;
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
    renderFilterCounts();
    const totalPages = Math.max(1, Math.ceil(list.length / LIBRARY_PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    if (list.length === 0) {
        empty.classList.remove('d-none');
        renderLibraryPagination(0);
    } else {
        empty.classList.add('d-none');
        const start = (currentPage - 1) * LIBRARY_PAGE_SIZE;
        list.slice(start, start + LIBRARY_PAGE_SIZE).forEach(show => {
            const idx = SHOWS_DATA.indexOf(show);
            grid.appendChild(buildCard(show, idx));
        });
        renderLibraryPagination(list.length);
    }
}

function formatDashboardDate(value) {
    if (!value) return '';
    const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}\s/.test(value)
        ? value.replace(' ', 'T')
        : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function dashboardCard(show) {
    const idx = SHOWS_DATA.indexOf(show);
    const stats = showStats(show);
    const cached = show.tvdb ? tvmazeCache[show.tvdb] : null;
    const [c1, c2] = colorFor(show.title);
    const meta = stats.lastWatched
        ? `Watched ${formatDashboardDate(stats.lastWatched)}`
        : `${toFa(stats.watched)} / ${toFa(stats.total)} episodes`;

    return `
      <button class="dashboard-mini-card" type="button" data-dashboard-show="${idx}" style="background:linear-gradient(150deg,${c1},${c2})" aria-label="Open ${escapeHtml(show.title)}">
        ${cached?.image ? `<img class="dashboard-mini-poster" src="${cached.image}" alt="" loading="lazy">` : `<span class="dashboard-mini-initials">${initials(show.title)}</span>`}
        <span class="dashboard-mini-content">
          <span class="dashboard-mini-title">${escapeHtml(show.title)}</span>
          <span class="dashboard-mini-meta"><span>${meta}</span><span>${toFa(stats.pct)}%</span></span>
          <span class="dashboard-mini-progress"><span style="width:${stats.pct}%"></span></span>
        </span>
      </button>`;
}

function fillDashboardRail(id, shows, emptyText) {
    const rail = document.getElementById(id);
    if (!rail) return;
    rail.innerHTML = shows.length
        ? shows.slice(0, 6).map(dashboardCard).join('')
        : `<div class="dashboard-empty"><i class="bi bi-inbox"></i>${escapeHtml(emptyText)}</div>`;
}


function dashboardEpisodeCard(item, mode = 'new') {
    const idx = item.showIdx;
    const code = `S${String(item.season?.n || 0).padStart(2, '0')}E${String(item.episode?.n || 0).padStart(2, '0')}`;
    const date = item.episode?.airdate ? formatDashboardDate(item.episode.airdate) : '';
    return `<button class="dashboard-episode-card" type="button" data-dashboard-episode="${idx}-${item.seasonIdx}-${item.episodeIdx}" aria-label="Open ${escapeHtml(item.show.title)} ${code}">
      <span class="dashboard-episode-icon"><i class="bi ${mode === 'upcoming' ? 'bi-calendar-event' : 'bi-play-fill'}"></i></span>
      <span class="dashboard-episode-copy"><strong>${escapeHtml(item.show.title)}</strong><small>${code} · ${escapeHtml(item.episode.name || 'Episode')}${date ? ` · ${date}` : ''}</small></span>
    </button>`;
}


function renderDashboard() {
    const allFiltered = SHOWS_DATA.filter(show => !window.isSpecialShow?.(show));
    const watching = allFiltered.filter(show => derivedShowState(show).status === 'watching')
        .sort((a, b) => (showStats(b).lastWatched || '').localeCompare(showStats(a).lastWatched || ''));
    const recentlyWatched = allFiltered.filter(show => showStats(show).lastWatched)
        .sort((a,b) => String(showStats(b).lastWatched).localeCompare(String(showStats(a).lastWatched)));
    const recentlyAdded = [...allFiltered].sort((a, b) => String(b.created_at ?? b.createdAt ?? '').localeCompare(String(a.created_at ?? a.createdAt ?? '')));

    const today = new Date(); today.setHours(0,0,0,0);
    const weekEnd = new Date(today); weekEnd.setDate(today.getDate()+7);
    const normal = typeof collectNormalEpisodes === 'function' ? collectNormalEpisodes() : [];
    const newEpisodes = normal.filter(item => !episodeIsWatched(item.episode) && item.episode.airdate && new Date(item.episode.airdate+'T00:00:00') <= today)
      .sort((a,b) => String(b.episode.airdate).localeCompare(String(a.episode.airdate))).slice(0,6);
    const upcoming = normal.filter(item => item.episode.airdate && new Date(item.episode.airdate+'T00:00:00') > today && new Date(item.episode.airdate+'T00:00:00') <= weekEnd)
      .sort((a,b) => String(a.episode.airdate).localeCompare(String(b.episode.airdate))).slice(0,6);

    fillDashboardRail('continueWatchingRail', watching, 'Nothing in progress. Start a show from your library.');
    fillDashboardRail('recentlyWatchedRail', recentlyWatched, 'Watched episodes will appear here.');
    fillDashboardRail('recentlyAddedRail', recentlyAdded, 'Recently added shows will appear here.');
    const newRail=document.getElementById('newEpisodesRail'); if(newRail) newRail.innerHTML=newEpisodes.length?newEpisodes.map(x=>dashboardEpisodeCard(x,'new')).join(''):'<div class="dashboard-empty"><i class="bi bi-check2-circle"></i>You are caught up.</div>';
    const upRail=document.getElementById('upcomingRail'); if(upRail) upRail.innerHTML=upcoming.length?upcoming.map(x=>dashboardEpisodeCard(x,'upcoming')).join(''):'<div class="dashboard-empty"><i class="bi bi-calendar2-check"></i>No episodes scheduled in the next 7 days.</div>';
    const badge=document.getElementById('dashboardEpisodeBadge'); if(badge) badge.textContent=toFa(newEpisodes.length);
    document.querySelectorAll('[data-episodes-badge]').forEach(el=>{el.textContent=toFa(newEpisodes.length);el.hidden=!newEpisodes.length;});
    const updated = document.getElementById('dashboardUpdated');
    if (updated) updated.textContent = `Updated ${new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
}

function renderStats() {
    const visibleShows = SHOWS_DATA.filter(show => !window.isSpecialShow?.(show));
    const statsByShow = visibleShows.map(show => ({ show, stats: showStats(show) }));
    const watchedShows = statsByShow.filter(item => item.stats.watched > 0).length;
    const watchedEpisodes = statsByShow.reduce((total, item) => total + item.stats.watched, 0);
    const favorites = visibleShows.filter(show => Boolean(show.fav ?? show.is_favorite)).length;

    const showsEl = document.getElementById('statShows');
    if (showsEl) showsEl.textContent = toFa(watchedShows);

    const watchedEl = document.getElementById('statWatchedEp');
    if (watchedEl) watchedEl.textContent = toFa(watchedEpisodes);

    const watchTimeEl = document.getElementById('statWatchTime');
    if (watchTimeEl) watchTimeEl.textContent = formatWatchedDuration(totalWatchedRuntimeMinutes(visibleShows));

    const favoritesEl = document.getElementById('statFav');
    if (favoritesEl) favoritesEl.textContent = toFa(favorites);

    renderDashboard();
    renderPhase17();
}

async function persistAndRefresh() {
    if (window.TVTimeProfiles) await window.TVTimeProfiles.saveActiveData();
    renderStats();
}

function refreshCardProgress(idx) {
    const show = SHOWS_DATA[idx];
    const card = document.querySelector(`.show-card[data-idx="${idx}"]`);
    if (!show || !card) return;
    const st = showStats(show);
    const count = card.querySelector('.show-body .ep-count');
    const bar = card.querySelector('.show-body .progress-bar');
    if (count) count.textContent = `${toFa(st.watched)} / ${toFa(st.total)} episodes`;
    if (bar) bar.style.width = `${st.pct}%`;
}

function refreshSeasonProgress(idx, sIdx) {
    const show = SHOWS_DATA[idx];
    const season = show?.seasons?.[sIdx];
    const panel = document.getElementById(`panel-${idx}`);
    if (!season || !panel) return;
    const episodes = Array.isArray(season.eps) ? season.eps : [];
    const normalEpisodes = window.canonicalRegularEpisodes ? window.canonicalRegularEpisodes(season, show) : episodes.filter(ep => !(window.isSpecialEpisode ? window.isSpecialEpisode(ep, season, show) : ep.sp));
    const watched = normalEpisodes.filter(ep => ep.w).length;
    const pct = normalEpisodes.length ? Math.round(watched / normalEpisodes.length * 100) : 0;
    const head = panel.querySelector(`[data-season-toggle="${idx}-${sIdx}"]`);
    if (head) {
        const count = head.querySelector('.ep-count');
        const bar = head.querySelector('.progress-bar');
        if (count) count.textContent = `${toFa(watched)}/${toFa(normalEpisodes.length)}`;
        if (bar) bar.style.width = `${pct}%`;
    }
}

async function toggleFavorite(idx) {
    const show = SHOWS_DATA[idx];
    if (!show) return;
    show.fav = !show.fav;
    show.is_favorite = show.fav;
    await persistAndRefresh();
    render();
}

async function toggleWatchLater(idx) {
    const show = SHOWS_DATA[idx];
    if (!show) return;
    show.is_watch_later = !Boolean(show.is_watch_later);
    show.status = show.is_watch_later ? 'watch_later' : 'not_started_yet';
    await persistAndRefresh();
    render();
}

async function toggleEpisode(idx, sIdx, eIdx) {
    const show = SHOWS_DATA[idx];
    const season = show?.seasons?.[sIdx];
    const episode = season?.eps?.[eIdx];
    if (!episode || window.isSpecialEpisode?.(episode, season, show)) return;
    episode.w = !episode.w;
    episode.is_watched = episode.w;
    episode.wa = episode.w ? new Date().toISOString() : null;
    episode.watched_at = episode.wa;
    episode.watched_count = episode.w ? Math.max(1, Number(episode.watched_count || 0)) : 0;

    await persistAndRefresh();
    render();

    const row = document.querySelector(`[data-episode-toggle="${idx}-${sIdx}-${eIdx}"]`);
    if (row) {
        row.classList.toggle('is-watched', episode.w);
        row.classList.toggle('is-unwatched', !episode.w);
        row.setAttribute('aria-pressed', episode.w ? 'true' : 'false');
        const control = row.querySelector('.ep-watch-control i');
        const name = row.querySelector('.ep-name');
        const date = row.querySelector('.ep-date');
        const label = row.querySelector('.ep-action-label');
        if (control) control.className = `bi ${episode.w ? 'bi-check-circle-fill' : 'bi-circle'}`;
        if (name) name.classList.toggle('unwatched-text', !episode.w);
        if (date) date.textContent = episode.wa ? episode.wa.slice(0, 10) : '';
        if (label) label.textContent = episode.w ? 'Watched' : 'Mark watched';
    }
    if (window.refreshActiveSeasonModal) window.refreshActiveSeasonModal();
}


let pendingDeleteShowIndex = null;

function openShowModal() {
    const modal = document.getElementById('showManagerModal');
    const form = document.getElementById('addShowForm');
    const error = document.getElementById('addShowError');
    form?.reset();
    if (error) { error.textContent = ''; error.classList.add('d-none'); }
    modal?.classList.remove('d-none');
    modal?.removeAttribute('hidden');
    setTimeout(() => document.getElementById('newShowTitle')?.focus(), 50);
}

function closeShowModal() {
    { const modal = document.getElementById('showManagerModal'); modal?.classList.add('d-none'); modal?.setAttribute('hidden', ''); }
}

function openDeleteShowModal(idx) {
    const show = SHOWS_DATA[idx];
    if (!show) return;
    pendingDeleteShowIndex = idx;
    const text = document.getElementById('deleteShowText');
    if (text) text.textContent = `“${show.title}” and all of its seasons and watched history will be removed from this user.`;
    { const modal = document.getElementById('deleteShowModal'); modal?.classList.remove('d-none'); modal?.removeAttribute('hidden'); }
}

function closeDeleteShowModal() {
    pendingDeleteShowIndex = null;
    { const modal = document.getElementById('deleteShowModal'); modal?.classList.add('d-none'); modal?.setAttribute('hidden', ''); }
}

async function addShowFromForm(event) {
    event.preventDefault();
    const title = document.getElementById('newShowTitle')?.value.trim();
    const tvdbRaw = document.getElementById('newShowTvdb')?.value.trim();
    const status = document.getElementById('newShowStatus')?.value || 'not_started_yet';
    const favorite = Boolean(document.getElementById('newShowFavorite')?.checked);
    const error = document.getElementById('addShowError');
    const tvdb = tvdbRaw ? Number(tvdbRaw) : null;

    if (!title) return;
    const duplicate = SHOWS_DATA.some(show =>
        show.title.toLowerCase() === title.toLowerCase() || (tvdb && Number(show.tvdb) === tvdb)
    );
    if (duplicate) {
        if (error) { error.textContent = 'This show already exists for the active user.'; error.classList.remove('d-none'); }
        return;
    }

    const submitButton = event.submitter || document.querySelector('#addShowForm button[type="submit"]');
    const originalButtonHtml = submitButton?.innerHTML;
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = '<span class="spin" style="width:11px;height:11px;"></span> Fetching episodes…';
    }

    let seasons = [];
    let noEpisodeData = true;
    let fetchedShow = null;
    try {
        if (tvdb) {
            const result = await fetchTvmazeShowWithEpisodes(tvdb, title);
            fetchedShow = result.rawShow;
            seasons = result.seasons;
            noEpisodeData = seasons.length === 0;
            await saveTvmazeCache(tvdb, createTvmazeCacheEntry(fetchedShow, seasons));
        }
    } catch (fetchError) {
        console.warn('Could not fetch TVMaze episodes for new show:', fetchError);
        if (error) {
            error.textContent = `${fetchError.message} The show was added without episode data.`;
            error.classList.remove('d-none');
        }
    }

    SHOWS_DATA.push({
        uuid: crypto.randomUUID ? crypto.randomUUID() : `show-${Date.now()}`,
        id: { tvdb, imdb: fetchedShow?.externals?.imdb || null },
        tvdb,
        imdb: fetchedShow?.externals?.imdb || null,
        created_at: new Date().toISOString(),
        title: fetchedShow?.name || title,
        status,
        is_watch_later: status === 'watch_later',
        fav: favorite,
        is_favorite: favorite,
        _noEpisodeData: noEpisodeData,
        seasons
    });

    await persistAndRefresh();
    if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonHtml;
    }
    closeShowModal();
    currentFilter = { status: 'all', fav: false, search: '' };
    currentPage = 1;
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    document.querySelectorAll('#filterChips .filter-chip').forEach(chip => chip.classList.toggle('active', chip.dataset.status === 'all'));
    render();
    initEnrichment();
}

async function deletePendingShow() {
    if (pendingDeleteShowIndex === null || !SHOWS_DATA[pendingDeleteShowIndex]) return;
    SHOWS_DATA.splice(pendingDeleteShowIndex, 1);
    enrichQueue = [];
    enrichTotal = enrichDone;
    await persistAndRefresh();
    closeDeleteShowModal();
    render();
    initEnrichment();
}

// Event delegation
document.getElementById('grid').addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('[data-delete-show]');
    if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        openDeleteShowModal(Number(deleteBtn.dataset.deleteShow));
        return;
    }

    const favBtn = e.target.closest('[data-favorite-toggle]');
    if (favBtn) {
        e.preventDefault();
        e.stopPropagation();
        await toggleFavorite(Number(favBtn.dataset.favoriteToggle));
        return;
    }

    const watchLaterBtn = e.target.closest('[data-watch-later-toggle]');
    if (watchLaterBtn) {
        e.preventDefault();
        e.stopPropagation();
        await toggleWatchLater(Number(watchLaterBtn.dataset.watchLaterToggle));
        return;
    }

    const epRow = e.target.closest('[data-episode-toggle]');
    if (epRow) {
        const [idx, sIdx, eIdx] = epRow.dataset.episodeToggle.split('-').map(Number);
        await toggleEpisode(idx, sIdx, eIdx);
        return;
    }

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
    const seasonCheck = e.target.closest('[data-season-check]');
    if (seasonCheck) {
        e.preventDefault();
        e.stopPropagation();
        const [idx, sIdx] = seasonCheck.dataset.seasonCheck.split('-').map(Number);
        await window.toggleWholeSeason(idx, sIdx);
        return;
    }

    const seasonOpen = e.target.closest('[data-season-open]');
    if (seasonOpen) {
        e.preventDefault();
        e.stopPropagation();
        const [idx, sIdx] = seasonOpen.dataset.seasonOpen.split('-').map(Number);
        window.openSeasonModal(idx, sIdx);
    }
});

document.getElementById('addShowBtn')?.addEventListener('click', openShowModal);
document.getElementById('addShowForm')?.addEventListener('submit', addShowFromForm);
document.getElementById('confirmDeleteShowBtn')?.addEventListener('click', deletePendingShow);
document.querySelectorAll('[data-close-show-modal]').forEach(button => button.addEventListener('click', closeShowModal));
document.querySelectorAll('[data-close-delete-modal]').forEach(button => button.addEventListener('click', closeDeleteShowModal));
document.getElementById('showManagerModal')?.addEventListener('click', event => { if (event.target.id === 'showManagerModal') closeShowModal(); });
document.getElementById('deleteShowModal')?.addEventListener('click', event => { if (event.target.id === 'deleteShowModal') closeDeleteShowModal(); });
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeShowModal();
    closeDeleteShowModal();
    if (window.closeSeasonModal) window.closeSeasonModal();
});

document.getElementById('searchInput').addEventListener('input', (e) => {
    currentFilter.search = e.target.value.trim().toLowerCase();
    currentPage = 1;
    render();
});

document.getElementById('filterChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;

    if (chip.dataset.fav) {
        chip.classList.toggle('active');
        currentFilter.fav = chip.classList.contains('active');
        currentPage = 1;
        render();
        return;
    }

    document.querySelectorAll('.filter-chip[data-status]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter.status = chip.dataset.status;
    currentPage = 1;
    render();
});


document.getElementById('sortSelect').addEventListener('change', (e) => {
    currentSort = e.target.value;
    currentPage = 1;
    render();
});

document.getElementById('libraryPagination')?.addEventListener('click', event => {
    const button = event.target.closest('[data-library-page]');
    if (!button || button.disabled) return;
    currentPage = Math.max(1, Number(button.dataset.libraryPage) || 1);
    render();
    document.getElementById('librarySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

const clearCacheModal = document.getElementById('clearCacheConfirmModal');

function openClearCacheModal() {
    clearCacheModal.hidden = false;
    clearCacheModal.classList.remove('d-none');
}

function closeClearCacheModal() {
    clearCacheModal.hidden = true;
    clearCacheModal.classList.add('d-none');
}

document.getElementById('clearCacheBtn').addEventListener('click', openClearCacheModal);

document.querySelectorAll('[data-close-cache-confirm]').forEach(button => {
    button.addEventListener('click', closeClearCacheModal);
});

clearCacheModal?.addEventListener('click', event => {
    if (event.target === clearCacheModal) closeClearCacheModal();
});

document.getElementById('clearCacheConfirmAction')?.addEventListener('click', async () => {
    const actionBtn = document.getElementById('clearCacheConfirmAction');
    const topBtn = document.getElementById('clearCacheBtn');
    actionBtn.disabled = true;
    topBtn.disabled = true;
    actionBtn.innerHTML = '<span class="spin" style="width:11px;height:11px;"></span> Creating snapshot…';
    topBtn.innerHTML = '<span class="spin" style="width:11px;height:11px;"></span> Clearing…';

    try {
        await window.TVTimeProfiles.createSnapshot({ type: 'manual', label: 'Before clearing TVMaze cache' });
        actionBtn.innerHTML = '<span class="spin" style="width:11px;height:11px;"></span> Clearing cache…';
        await clearTvmazeCache();
        enrichQueue = [];
        enrichTotal = 0;
        enrichDone = 0;

        closeClearCacheModal();
        render();
        initEnrichment();
        window.TVTimeErrors?.success?.('All TVMaze cache data was cleared. A recovery snapshot was created first.', {
            title: 'Cache cleared',
            duration: 7000
        });
    } catch (error) {
        window.TVTimeErrors?.show?.(error.message || 'Could not clear cached data.', {
            title: 'Clear cache failed',
            type: 'error',
            duration: 8000
        });
    } finally {
        actionBtn.disabled = false;
        actionBtn.innerHTML = 'Create snapshot & clear';
        topBtn.disabled = false;
        topBtn.innerHTML = '<i class="bi bi-trash3"></i> Clear cache';
    }
});

document.getElementById('grid').addEventListener('keydown', async (e) => {
    const epRow = e.target.closest('[data-episode-toggle]');
    if (!epRow || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    const [idx, sIdx, eIdx] = epRow.dataset.episodeToggle.split('-').map(Number);
    await toggleEpisode(idx, sIdx, eIdx);
});

document.getElementById('personalDashboard')?.addEventListener('click', event => {
    const showButton = event.target.closest('[data-dashboard-show]');
    if (showButton) {
        const show = SHOWS_DATA[Number(showButton.dataset.dashboardShow)];
        if (!show) return;
        currentFilter = { status: 'all', fav: false, search: show.title.toLowerCase() };
        currentSort = 'title';
        currentPage = 1;
        const search = document.getElementById('searchInput');
        const sort = document.getElementById('sortSelect');
        if (search) search.value = show.title;
        if (sort) sort.value = 'title';
        document.querySelectorAll('#filterChips .filter-chip').forEach(chip => chip.classList.toggle('active', chip.dataset.status === 'all'));
        render();
        document.querySelector('.Controls')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    const filterButton = event.target.closest('[data-dashboard-filter], [data-dashboard-favorite]');
    if (!filterButton) return;
    currentFilter.search = '';
    currentFilter.fav = filterButton.dataset.dashboardFavorite === 'true';
    currentFilter.status = filterButton.dataset.dashboardFilter || 'all';
    currentSort = filterButton.dataset.dashboardSort || 'title';
    currentPage = 1;
    const search = document.getElementById('searchInput');
    const sort = document.getElementById('sortSelect');
    if (search) search.value = '';
    if (sort && [...sort.options].some(option => option.value === currentSort)) sort.value = currentSort;
    document.querySelectorAll('#filterChips .filter-chip').forEach(chip => {
        const activeStatus = chip.dataset.status === currentFilter.status;
        const activeFavorite = chip.dataset.fav && currentFilter.fav;
        chip.classList.toggle('active', Boolean(activeStatus || activeFavorite));
    });
    render();
    document.querySelector('.Controls')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

window.addEventListener('tvtime:profile-changed', () => {
    currentPage = 1;
    renderStats();
    render();
    initEnrichment();
});

async function init() {
    if (window.TVTimeProfiles) await window.TVTimeProfiles.start();
    await loadCacheFromDB();
    renderStats();
    render();
    initEnrichment();
}


document.getElementById('personalDashboard')?.addEventListener('click', event => {
    const episode = event.target.closest('[data-dashboard-episode]');
    if (episode) {
        const [showIdx, seasonIdx] = episode.dataset.dashboardEpisode.split('-').map(Number);
        window.openSeasonModal?.(showIdx, seasonIdx);
        return;
    }
    const modalButton = event.target.closest('[data-open-episode-modal]');
    if (modalButton) window.openEpisodeOverview?.(modalButton.dataset.openEpisodeModal || 'new');
});
