/* Local episode center modal. No background or manual sync. */
function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function collectNormalEpisodes() {
    const rows = [];
    SHOWS_DATA.forEach((show, showIdx) => {
        if (window.isSpecialShow?.(show)) return;
        (Array.isArray(show.seasons) ? show.seasons : []).forEach((season, seasonIdx) => {
            if (season.sp || season.is_specials || Number(season.n ?? season.number) === 0) return;
            const episodes = window.canonicalRegularEpisodes ? window.canonicalRegularEpisodes(season, show) : (season.eps || []);
            episodes.forEach(episode => {
                if (window.isSpecialEpisode?.(episode, season, show) || !episode.airdate) return;
                const episodeIdx = (season.eps || []).indexOf(episode);
                rows.push({ show, showIdx, season, seasonIdx, episode, episodeIdx });
            });
        });
    });
    return rows;
}
window.collectNormalEpisodes = collectNormalEpisodes;

function formatEpisodeCode(item) {
    return `S${String(item.season.n).padStart(2, '0')}E${String(item.episode.n).padStart(2, '0')}`;
}

function episodeOverviewItems(mode) {
    const today = new Date(); today.setHours(0,0,0,0);
    const end = new Date(today); end.setDate(today.getDate() + 7);
    return collectNormalEpisodes().filter(item => {
        const aired = new Date(`${item.episode.airdate}T00:00:00`);
        if (mode === 'upcoming') return aired > today && aired <= end;
        return !item.episode.w && aired <= today;
    }).sort((a,b) => mode === 'upcoming'
        ? String(a.episode.airdate).localeCompare(String(b.episode.airdate))
        : String(b.episode.airdate).localeCompare(String(a.episode.airdate)));
}

function renderEpisodeOverview(mode = 'new') {
    const list = document.getElementById('episodeOverviewList');
    const title = document.getElementById('episodeOverviewTitle');
    if (!list || !title) return;
    const items = episodeOverviewItems(mode);
    title.textContent = mode === 'upcoming' ? 'Upcoming This Week' : 'New Episodes';
    document.querySelectorAll('[data-episode-overview-tab]').forEach(button => button.classList.toggle('active', button.dataset.episodeOverviewTab === mode));
    list.innerHTML = items.length ? items.map(item => `
      <button class="episode-overview-item" type="button" data-overview-episode="${item.showIdx}-${item.seasonIdx}-${item.episodeIdx}">
        <span><strong>${escapeHtml(item.show.title)}</strong><small>${formatEpisodeCode(item)} · ${escapeHtml(item.episode.name || 'Episode')}</small></span>
        <time>${escapeHtml(item.episode.airdate)}</time>
      </button>`).join('') : `<div class="dashboard-empty"><i class="bi ${mode === 'upcoming' ? 'bi-calendar2-check' : 'bi-check2-circle'}"></i>${mode === 'upcoming' ? 'No episodes scheduled in the next 7 days.' : 'You are caught up.'}</div>`;
}

window.openEpisodeOverview = function(mode = 'new') {
    const modal = document.getElementById('episodeOverviewModal');
    if (!modal) return;
    modal.hidden = false;
    modal.classList.remove('d-none');
    document.body.classList.add('season-modal-open');
    renderEpisodeOverview(mode);
};

function closeEpisodeOverview() {
    const modal = document.getElementById('episodeOverviewModal');
    if (!modal) return;
    modal.hidden = true;
    modal.classList.add('d-none');
    document.body.classList.remove('season-modal-open');
}

document.querySelectorAll('[data-close-episode-overview]').forEach(button => button.addEventListener('click', closeEpisodeOverview));
document.querySelectorAll('[data-episode-overview-tab]').forEach(button => button.addEventListener('click', () => renderEpisodeOverview(button.dataset.episodeOverviewTab)));
document.getElementById('episodeOverviewModal')?.addEventListener('click', event => { if (event.target.id === 'episodeOverviewModal') closeEpisodeOverview(); });
document.getElementById('episodeOverviewList')?.addEventListener('click', event => {
    const button = event.target.closest('[data-overview-episode]');
    if (!button) return;
    const [showIdx, seasonIdx] = button.dataset.overviewEpisode.split('-').map(Number);
    closeEpisodeOverview();
    window.openSeasonModal?.(showIdx, seasonIdx);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeEpisodeOverview(); });

function renderPhase17() {
    if (!document.getElementById('episodeOverviewModal')?.hidden) {
        const active = document.querySelector('[data-episode-overview-tab].active')?.dataset.episodeOverviewTab || 'new';
        renderEpisodeOverview(active);
    }
}
