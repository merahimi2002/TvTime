let activeSeasonModal = null;

function seasonModalElements() {
    return {
        modal: document.getElementById('seasonEpisodesModal'),
        title: document.getElementById('seasonModalShowTitle'),
        subtitle: document.getElementById('seasonModalSeasonTitle'),
        count: document.getElementById('seasonModalCount'),
        bar: document.getElementById('seasonModalProgressBar'),
        percent: document.getElementById('seasonModalPercent'),
        list: document.getElementById('seasonModalEpisodeList'),
        bulk: document.getElementById('seasonModalBulkToggle')
    };
}

function episodeDisplayDate(ep) {
    return ep?.airdate || (ep?.wa ? String(ep.wa).slice(0, 10) : '');
}

function renderSeasonModal() {
    if (!activeSeasonModal) return;
    const { idx, sIdx } = activeSeasonModal;
    const show = SHOWS_DATA[idx];
    const season = show?.seasons?.[sIdx];
    if (!show || !season) return closeSeasonModal();

    const episodes = Array.isArray(season.eps) ? season.eps : [];
    const normalEpisodes = episodes.filter(ep => !(window.isSpecialEpisode ? window.isSpecialEpisode(ep, season, show) : ep.sp));
    const watched = normalEpisodes.filter(ep => ep.w).length;
    const total = normalEpisodes.length;
    const pct = total ? Math.round(watched / total * 100) : 0;
    const allWatched = total > 0 && watched === total;
    const label = season.sp ? 'Specials' : `Season ${toFa(season.n)}`;
    const els = seasonModalElements();

    els.title.textContent = show.title;
    els.subtitle.textContent = label;
    els.count.textContent = `${toFa(watched)} / ${toFa(total)}`;
    els.percent.textContent = `${toFa(pct)}%`;
    els.bar.style.width = `${pct}%`;
    els.bulk.disabled = total === 0;
    els.bulk.dataset.seasonModalBulk = `${idx}-${sIdx}`;
    els.bulk.innerHTML = allWatched
        ? '<i class="bi bi-circle"></i> Mark all unwatched'
        : '<i class="bi bi-check2-all"></i> Mark all watched';

    els.list.innerHTML = episodes.length ? episodes.map((ep, eIdx) => {
        const special = window.isSpecialEpisode ? window.isSpecialEpisode(ep, season, show) : Boolean(ep.sp);
        const previousNormal = episodes.slice(0, eIdx).filter(item => !(window.isSpecialEpisode ? window.isSpecialEpisode(item, season, show) : item.sp));
        const nextUnwatched = !special && !ep.w && previousNormal.every(item => item.w);
        return `<button class="season-episode-card ${ep.w ? 'is-watched' : 'is-unwatched'} ${nextUnwatched ? 'is-next' : ''}" type="button" data-modal-episode-toggle="${idx}-${sIdx}-${eIdx}" aria-pressed="${ep.w}">
          <span class="season-episode-check"><i class="bi ${ep.w ? 'bi-check-circle-fill' : 'bi-circle'}"></i></span>
          <span class="season-episode-number">${toFa(ep.n)}</span>
          <span class="season-episode-copy">
            <strong>${escapeHtml(ep.name || 'Untitled')}${special ? ' <span class="episode-special-badge">Special</span>' : ''}</strong>
            <small>${escapeHtml(episodeDisplayDate(ep))}${ep.runtime ? ` · ${toFa(ep.runtime)} min` : ''}</small>
          </span>
          <span class="season-episode-state">${ep.w ? 'Watched' : 'Mark watched'}</span>
        </button>`;
    }).join('') : '<div class="season-modal-empty"><i class="bi bi-inbox"></i><span>No episodes available for this season.</span></div>';

    requestAnimationFrame(() => {
        const next = els.list.querySelector('.season-episode-card.is-next');
        next?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
}

function openSeasonModal(idx, sIdx) {
    activeSeasonModal = { idx, sIdx };
    renderSeasonModal();
    const modal = seasonModalElements().modal;
    modal.classList.remove('d-none');
    modal.removeAttribute('hidden');
    document.body.classList.add('season-modal-open');
}

function closeSeasonModal() {
    const modal = seasonModalElements().modal;
    modal?.classList.add('d-none');
    modal?.setAttribute('hidden', '');
    document.body.classList.remove('season-modal-open');
    activeSeasonModal = null;
}

async function toggleWholeSeason(idx, sIdx) {
    const show = SHOWS_DATA[idx];
    const season = show?.seasons?.[sIdx];
    if (!season) return;
    const episodes = Array.isArray(season.eps) ? season.eps : [];
    const normalEpisodes = episodes.filter(ep => !(window.isSpecialEpisode ? window.isSpecialEpisode(ep, season, show) : ep.sp));
    if (!normalEpisodes.length) return;
    const shouldWatch = !normalEpisodes.every(ep => ep.w);
    const now = new Date().toISOString();
    normalEpisodes.forEach(ep => {
        ep.w = shouldWatch;
        ep.is_watched = shouldWatch;
        ep.wa = shouldWatch ? now : null;
        ep.watched_at = ep.wa;
        ep.watched_count = shouldWatch ? Math.max(1, Number(ep.watched_count || 0)) : 0;
    });
    await persistAndRefresh();
    render();
    if (activeSeasonModal?.idx === idx && activeSeasonModal?.sIdx === sIdx) renderSeasonModal();
}

window.openSeasonModal = openSeasonModal;
window.closeSeasonModal = closeSeasonModal;
window.toggleWholeSeason = toggleWholeSeason;
window.refreshActiveSeasonModal = renderSeasonModal;

document.getElementById('seasonEpisodesModal')?.addEventListener('click', async event => {
    if (event.target.id === 'seasonEpisodesModal' || event.target.closest('[data-close-season-modal]')) {
        closeSeasonModal();
        return;
    }
    const episode = event.target.closest('[data-modal-episode-toggle]');
    if (episode) {
        const [idx, sIdx, eIdx] = episode.dataset.modalEpisodeToggle.split('-').map(Number);
        await toggleEpisode(idx, sIdx, eIdx);
        return;
    }
    const bulk = event.target.closest('[data-season-modal-bulk]');
    if (bulk) {
        const [idx, sIdx] = bulk.dataset.seasonModalBulk.split('-').map(Number);
        await toggleWholeSeason(idx, sIdx);
    }
});
