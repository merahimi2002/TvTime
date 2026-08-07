const STATUS_LABEL = {
    not_started: "Not Started",
    watching: "Watching",
    up_to_date: "Up to Date",
    completed: "Completed",
    watch_later: "Watch Later"
};

const PALETTE = [
    ["#ff5470", "#ff8a5b"], ["#5fb0ff", "#7d5fff"], ["#33d69f", "#1fa8ff"],
    ["#a78bfa", "#ff5470"], ["#ffb84d", "#ff5470"], ["#37c9c1", "#5fb0ff"],
    ["#ff8a5b", "#a78bfa"], ["#5fd6a3", "#5fb0ff"]
];

function toFa(n) { return n.toLocaleString('en-US'); }

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function flagIsTrue(value) {
    if (value === true || value === 1) return true;
    const normalized = String(value ?? '').trim().toLowerCase();
    return ['true', '1', 'yes', 'special'].includes(normalized);
}

function hasSpecialEpisodeTitle(value) {
    const title = String(value ?? '').trim().toLowerCase();
    if (!title) return false;
    return /^(?:making[\s-]?of|behind[\s-]?the[\s-]?scenes|inside[\s-]?the[\s-]?episode|official[\s-]?aftershow|aftershow|after[\s-]?show|bonus[\s-]?features?|featurettes?|webisodes?|deleted[\s-]?scenes?|get[\s-]?to[\s-]?know|(?:cast|actors?|stars?)[\s-]+react(?:s|ion)?[\s-]?to|how\s+.+\s+(?:was|were)\s+(?:made|filmed))(?:$|[\s:–—|()\-])/i.test(title);
}

function normalizeEpisodeTitleKey(value) {
    return String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function episodeIdTokens(episode) {
    const rawId = episode?.id;
    const id = rawId && typeof rawId === 'object' ? rawId : {};
    return [
        id.tvdb ?? episode?.tvdb ?? null,
        id.imdb ?? episode?.imdb ?? null,
        id.tvmaze ?? episode?.tvmaze ?? (typeof rawId === 'number' ? rawId : null)
    ].filter(value => value !== null && value !== undefined && value !== '').map(value => String(value));
}

function isSpecialSeason(season) {
    if (!season || typeof season !== 'object') return false;
    const number = Number(season.n ?? season.number ?? season.season ?? -1);
    const label = String(season.name ?? season.title ?? '').trim().toLowerCase();
    return number === 0 ||
        flagIsTrue(season.sp) ||
        flagIsTrue(season.special) ||
        flagIsTrue(season.is_special) ||
        flagIsTrue(season.is_specials) ||
        /^(specials?|extras?)$/.test(label);
}

function isSpecialEpisode(episode, season = null, show = null) {
    if (!episode || typeof episode !== 'object') return false;
    const episodeType = String(episode.type ?? episode.episodeType ?? episode.episode_type ?? '').trim().toLowerCase();
    const episodeName = episode.name ?? episode.title ?? '';
    const specialFields = ['sp', 'special', 'is_special', 'isSpecial'];
    const hasExplicitSpecialField = specialFields.some(field => Object.prototype.hasOwnProperty.call(episode, field));
    const explicitSpecial = Boolean(
        isSpecialSeason(season) ||
        specialFields.some(field => flagIsTrue(episode[field])) ||
        (episodeType && !['regular', 'standard', 'episode'].includes(episodeType)) ||
        (!hasExplicitSpecialField && hasSpecialEpisodeTitle(episodeName))
    );
    if (explicitSpecial) return true;

    const excludedIds = Array.isArray(show?._specialEpisodeIds) ? show._specialEpisodeIds : [];
    if (excludedIds.length && episodeIdTokens(episode).some(id => excludedIds.includes(String(id)))) return true;

    const seasonNumber = Number(season?.n ?? season?.number ?? season?.season ?? 0);
    const titleKey = normalizeEpisodeTitleKey(episodeName);
    const excludedKeys = Array.isArray(show?._specialEpisodeKeys) ? show._specialEpisodeKeys : [];
    return Boolean(titleKey && excludedKeys.includes(`${seasonNumber}|${titleKey}`));
}

function isSpecialShow(show) {
    const title = String(show?.title ?? show?.name ?? '').trim().toLowerCase();
    if (!title) return false;
    return /(?:^|[\s:–—|()\-])(the\s+)?making[\s-]?of(?:$|[\s:–—|()\-])|behind[\s-]?the[\s-]?scenes|inside[\s-]?the[\s-]?episode|official[\s-]?aftershow|after[\s-]?show|bonus[\s-]?features?|featurettes?/i.test(title);
}

window.hasSpecialEpisodeTitle = hasSpecialEpisodeTitle;
window.isSpecialEpisode = isSpecialEpisode;
window.isSpecialSeason = isSpecialSeason;
window.isSpecialShow = isSpecialShow;

function episodeIsWatched(episode) {
    return Boolean(episode?.w || episode?.is_watched);
}

function episodeWatchedAt(episode) {
    return episode?.wa || episode?.watched_at || null;
}

window.episodeIsWatched = episodeIsWatched;
window.episodeWatchedAt = episodeWatchedAt;

function canonicalRegularEpisodes(season, show = null) {
    if (!season || isSpecialSeason(season)) return [];
    const episodes = (Array.isArray(season.eps) ? season.eps : []).filter(ep => !isSpecialEpisode(ep, season, show));
    const byKey = new Map();

    episodes.forEach((ep, index) => {
        const number = Number(ep.n ?? ep.number ?? 0);
        const stableId = ep?.id && typeof ep.id === 'object'
            ? (ep.id.tvmaze ?? ep.id.tvdb ?? ep.id.imdb ?? null)
            : (ep?.id ?? null);
        const key = number > 0 ? `n:${number}` : (stableId != null ? `id:${stableId}` : `i:${index}`);
        const current = byKey.get(key);

        if (!current) {
            byKey.set(key, {
                ...ep,
                w: episodeIsWatched(ep),
                wa: episodeWatchedAt(ep),
                watched_count: Number(ep.watched_count ?? (episodeIsWatched(ep) ? 1 : 0)),
                rewatch_count: Number(ep.rewatch_count ?? 0)
            });
            return;
        }

        const currentScore = (episodeIsWatched(current) ? 100 : 0) + (episodeWatchedAt(current) ? 20 : 0) + (current.airdate ? 5 : 0) + (current.name ? 1 : 0);
        const nextScore = (episodeIsWatched(ep) ? 100 : 0) + (episodeWatchedAt(ep) ? 20 : 0) + (ep.airdate ? 5 : 0) + (ep.name ? 1 : 0);
        const preferred = nextScore > currentScore ? ep : current;
        const other = preferred === ep ? current : ep;
        const watched = episodeIsWatched(current) || episodeIsWatched(ep);

        byKey.set(key, {
            ...other,
            ...preferred,
            w: watched,
            wa: episodeWatchedAt(current) || episodeWatchedAt(ep),
            watched_count: Math.max(Number(current.watched_count || 0), Number(ep.watched_count || 0), watched ? 1 : 0),
            rewatch_count: Math.max(Number(current.rewatch_count || 0), Number(ep.rewatch_count || 0)),
            sp: false,
            special: false,
            is_special: false
        });
    });

    return [...byKey.values()].sort((a, b) => Number(a.n ?? a.number ?? 0) - Number(b.n ?? b.number ?? 0));
}

window.canonicalRegularEpisodes = canonicalRegularEpisodes;

function watchedRuntimeMinutes(show) {
    if (isSpecialShow(show)) return 0;
    const cached = show?.tvdb ? tvmazeCache[show.tvdb] : null;
    const fallbackRuntime = Number(show?.runtime ?? cached?.runtime ?? 0) || 0;
    let minutes = 0;
    (Array.isArray(show?.seasons) ? show.seasons : []).forEach(season => {
        canonicalRegularEpisodes(season, show).forEach(ep => {
            if (!episodeIsWatched(ep)) return;
            const runtime = Number(ep.runtime ?? fallbackRuntime) || 0;
            const watches = Math.max(1, Number(ep.watched_count || 0), 1 + Number(ep.rewatch_count || 0));
            minutes += runtime * watches;
        });
    });
    return minutes;
}

function totalWatchedRuntimeMinutes(shows = SHOWS_DATA) {
    return (Array.isArray(shows) ? shows : []).reduce((sum, show) => sum + watchedRuntimeMinutes(show), 0);
}

function formatWatchedDuration(totalMinutes) {
    let remaining = Math.max(0, Math.floor(Number(totalMinutes) || 0));
    const monthMinutes = 30 * 24 * 60;
    const dayMinutes = 24 * 60;
    const months = Math.floor(remaining / monthMinutes); remaining %= monthMinutes;
    const days = Math.floor(remaining / dayMinutes); remaining %= dayMinutes;
    const hours = Math.floor(remaining / 60);
    const minutes = remaining % 60;
    return `${toFa(months)}mo ${toFa(days)}d ${toFa(hours)}h ${toFa(minutes)}m`;
}

window.totalWatchedRuntimeMinutes = totalWatchedRuntimeMinutes;
window.formatWatchedDuration = formatWatchedDuration;

function showStats(show) {
    if (isSpecialShow(show)) return { total: 0, watched: 0, pct: 0, lastWatched: null };
    let total = 0, watched = 0, lastWatched = null;
    const seasons = Array.isArray(show?.seasons) ? show.seasons : [];

    seasons.forEach(season => {
        canonicalRegularEpisodes(season, show).forEach(episode => {
            total++;
            if (!episodeIsWatched(episode)) return;
            watched++;
            const watchedAt = episodeWatchedAt(episode);
            if (watchedAt && (!lastWatched || watchedAt > lastWatched)) lastWatched = watchedAt;
        });
    });

    return { total, watched, pct: total ? Math.round(watched / total * 100) : 0, lastWatched };
}

function isReleasedEpisode(ep) {
    // An episode without a confirmed air date must never push a show into Watching.
    if (!ep?.airdate) return false;
    return ep.airdate <= new Date().toISOString().slice(0, 10);
}

function isShowOfficiallyEnded(show) {
    const cached = show?.tvdb ? tvmazeCache[show.tvdb] : null;
    const sourceStatus = cached?.officialStatus ?? show?.officialStatus ?? show?.status ?? '';
    const normalized = String(sourceStatus).trim().toLowerCase();
    return ['ended', 'finished', 'completed', 'canceled', 'cancelled'].includes(normalized);
}

function normalizedImportedStatus(show) {
    const raw = String(show?.status ?? show?.progress?.status ?? '').trim().toLowerCase();
    if (['watch_later', 'watch later'].includes(raw)) return 'watch_later';
    if (['watching', 'continuing', 'in_progress', 'in progress'].includes(raw)) return 'watching';
    if (['completed', 'complete', 'finished', 'ended'].includes(raw)) return 'completed';
    if (['up_to_date', 'up to date', 'caught_up', 'caught up'].includes(raw)) return 'up_to_date';
    if (['not_started', 'not_started_yet', 'not started', 'not started yet'].includes(raw)) return 'not_started';
    return '';
}

function derivedShowState(show) {
    if (isSpecialShow(show)) return { status: 'not_started', total: 0, watched: 0, officiallyEnded: false, excluded: true };

    let releasedTotal = 0;
    let releasedWatched = 0;
    const allStats = showStats(show);
    const importedStatus = normalizedImportedStatus(show);
    const officiallyEnded = isShowOfficiallyEnded(show);

    (Array.isArray(show?.seasons) ? show.seasons : []).forEach(season => {
        canonicalRegularEpisodes(season, show).forEach(episode => {
            if (!isReleasedEpisode(episode)) return;
            releasedTotal++;
            if (episodeIsWatched(episode)) releasedWatched++;
        });
    });

    let status;
    if (Boolean(show?.is_watch_later) || importedStatus === 'watch_later') {
        status = 'watch_later';
    } else if (releasedTotal > 0) {
        if (releasedWatched === 0) status = 'not_started';
        else if (releasedWatched < releasedTotal) status = 'watching';
        else if (officiallyEnded) status = 'completed';
        else status = 'up_to_date';
    } else if (importedStatus) {
        // Imported status can be contaminated by unwatched Specials. Recalculate it
        // from regular episodes first, then use the imported value only as a hint.
        if (allStats.watched === 0) status = 'not_started';
        else if (allStats.watched < allStats.total) status = 'watching';
        else if (officiallyEnded || importedStatus === 'completed') status = 'completed';
        else status = 'up_to_date';
    } else if (allStats.watched === 0) {
        status = 'not_started';
    } else if (allStats.watched < allStats.total) {
        status = 'watching';
    } else if (officiallyEnded) {
        status = 'completed';
    } else {
        status = 'up_to_date';
    }

    return {
        status,
        total: releasedTotal || allStats.total,
        watched: releasedTotal ? releasedWatched : allStats.watched,
        officiallyEnded
    };
}

function showMatchesStatus(show, status) {
    if (status === 'all') return true;
    return derivedShowState(show).status === status;
}

function renderFilterCounts() {
    const counts = {
        all: SHOWS_DATA.filter(show => !isSpecialShow(show)).length,
        not_started: 0,
        completed: 0,
        watching: 0,
        up_to_date: 0,
        watch_later: 0,
        favorite: SHOWS_DATA.filter(show => !isSpecialShow(show) && Boolean(show.fav ?? show.is_favorite)).length
    };

    SHOWS_DATA.forEach(show => {
        if (isSpecialShow(show)) return;
        counts[derivedShowState(show).status]++;
    });

    document.querySelectorAll('#filterChips .filter-chip').forEach(chip => {
        const key = chip.dataset.fav ? 'favorite' : chip.dataset.status;
        const count = chip.querySelector('.filter-count');
        if (count && Object.prototype.hasOwnProperty.call(counts, key)) {
            count.textContent = toFa(counts[key]);
        }
    });
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
    const derived = derivedShowState(show);
    const badgeState = derived.status;
    const statusCls = "st-" + badgeState;
    const statusText = STATUS_LABEL[badgeState] || badgeState;
    const cached = show.tvdb ? tvmazeCache[show.tvdb] : null;
    const hasImage = !!(cached && cached.image);

    const col = document.createElement('div');
    col.className = "col-12 col-sm-6 col-md-4 col-lg-3 col-xxl-2";
    col.innerHTML = `
    <div class="show-card" data-idx="${idx}">
      <div class="poster-fake ${hasImage ? 'has-image' : ''}" style="background:linear-gradient(150deg, ${c1}, ${c2});">
        ${hasImage ? `<img src="${cached.image}" alt="" loading="lazy" class="poster-img">` : ''}
        <button class="delete-show-btn" type="button" data-delete-show="${idx}" aria-label="Delete ${escapeHtml(show.title)}" title="Delete show"><i class="bi bi-trash3"></i></button>
        <button class="fav-badge ${show.fav ? 'active' : ''}" type="button" data-favorite-toggle="${idx}" aria-label="${show.fav ? 'Remove from favorites' : 'Add to favorites'}" title="${show.fav ? 'Remove from favorites' : 'Add to favorites'}"><i class="bi ${show.fav ? 'bi-star-fill' : 'bi-star'}"></i></button>
        <button class="watch-later-badge ${show.is_watch_later ? 'active' : ''}" type="button" data-watch-later-toggle="${idx}" aria-label="${show.is_watch_later ? 'Remove from Watch Later' : 'Add to Watch Later'}" title="${show.is_watch_later ? 'Remove from Watch Later' : 'Add to Watch Later'}"><i class="bi ${show.is_watch_later ? 'bi-clock-fill' : 'bi-clock'}"></i></button>
        <div class="status-badge ${statusCls}">${statusText}</div>
        <span class="poster-initial" style="position:relative;z-index:1;">${initials(show.title)}</span>
      </div>
      <div class="show-body">
        ${cached && cached.rating ? `<div class="rating-badge"><i class="bi bi-star-fill"></i>${cached.rating}</div>` : ''}
        <div class="show-title">${escapeHtml(show.title)}</div>
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
    if (!panel || panel.dataset.built) return;
    panel.dataset.built = "1";

    const about = document.createElement('div');
    about.className = "about-block";
    panel.appendChild(about);
    fillAboutBlock(about, show);

    const seasons = Array.isArray(show?.seasons) ? show.seasons : [];
    seasons.forEach((se, sIdx) => {
        const episodes = Array.isArray(se?.eps) ? se.eps : [];
        const normalEpisodes = episodes.filter(ep => !isSpecialEpisode(ep, se, show));
        const watched = normalEpisodes.filter(e => e.w).length;
        const total = normalEpisodes.length;
        const pct = total ? Math.round(watched / total * 100) : 0;
        const allWatched = total > 0 && watched === total;
        const label = se.sp ? "Specials" : `Season ${toFa(se.n)}`;

        const seasonWrap = document.createElement('div');
        seasonWrap.className = 'season-summary-card';
        seasonWrap.dataset.seasonCard = `${idx}-${sIdx}`;
        seasonWrap.innerHTML = `
          <button class="season-open-area" type="button" data-season-open="${idx}-${sIdx}" aria-label="Open ${escapeHtml(label)} episodes">
            <span class="season-summary-title">${escapeHtml(label)}</span>
            <span class="season-summary-progress">
              <span class="ep-count">${toFa(watched)}/${toFa(total)}</span>
              <span class="season-progress-mini progress"><span class="progress-bar" style="display:block;width:${pct}%;height:100%;border-radius:99px;background:var(--ok);"></span></span>
            </span>
          </button>
          <div class="season-summary-actions">
            <button class="season-check-btn ${allWatched ? 'is-complete' : ''}" type="button" data-season-check="${idx}-${sIdx}" aria-pressed="${allWatched}" title="${allWatched ? 'Mark season unwatched' : 'Mark season watched'}">
              <i class="bi ${allWatched ? 'bi-check-circle-fill' : 'bi-circle'}"></i>
            </button>
            <button class="season-modal-btn" type="button" data-season-open="${idx}-${sIdx}" aria-label="Open ${escapeHtml(label)}">
              <i class="bi bi-chevron-right"></i>
            </button>
          </div>`;
        panel.appendChild(seasonWrap);
    });
}

// ---------- TVMaze enrichment (https://api.tvmaze.com) ----------
// Free, no API key needed. Their docs ask for ~20 req / 10s max, so we
// throttle to one request every 600ms (well under that). Results are
// cached in IndexedDB so a page reload never re-fetches known shows.
