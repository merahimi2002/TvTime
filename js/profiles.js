const SHOWS_DATA = [];

(function () {
  'use strict';

  const DB_NAME = 'tvtime_archive_db';
  const DB_VERSION = 7;
  const INTERNAL_SCHEMA_VERSION = 6;
  const PROFILE_STORE = 'profiles';
  const DATA_STORE = 'profile_data';
  const META_STORE = 'app_meta';
  const SNAPSHOT_STORE = 'recovery_snapshots';
  const SNAPSHOT_LIMIT = 20;
  let suppressAutoSnapshot = false;
  const ACTIVE_KEY = 'tvtime_active_profile';
  const REMOVED_PROFILE_IDS = new Set(['farshad']);

  const DEFAULT_PROFILES = [
    { id: 'ebi', name: 'Ebi', icon: 'E', folderPath: 'db/Ebi', latestPath: 'db/Ebi/latest.json', backupPath: 'db/Ebi/Ebi-backup.json', originalPath: 'db/Ebi/original.json', legacyId: 'mohammad' },
    { id: 'dobby', name: 'Dobby', icon: 'D', folderPath: 'db/Dobby', latestPath: 'db/Dobby/latest.json', backupPath: 'db/Dobby/Dobby-backup.json', originalPath: 'db/Dobby/original.json', legacyId: 'user2' }
  ];

  let dbPromise = null;
  let activeProfile = null;
  let activeSpecialRegistry = new Map();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('tvmaze_cache')) db.createObjectStore('tvmaze_cache', { keyPath: 'tvdbId' });
        if (!db.objectStoreNames.contains(PROFILE_STORE)) db.createObjectStore(PROFILE_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE, { keyPath: 'profileId' });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
          const snapshots = db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
          snapshots.createIndex('profileId', 'profileId', { unique: false });
          snapshots.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Database upgrade is blocked. Close other tabs and reload.'));
    });
    return dbPromise;
  }

  async function transaction(storeName, mode, action) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) {
        const error = new Error(`Required database store \"${storeName}\" is missing. Close other open tabs of this site, then reload the page.`);
        window.TVTimeErrors?.show(error.message, { title: 'Database upgrade required', type: 'error', duration: 9000 });
        reject(error);
        return;
      }
      let tx;
      let store;
      try {
        tx = db.transaction(storeName, mode);
        store = tx.objectStore(storeName);
      } catch (error) {
        window.TVTimeErrors?.show(error.message || 'Could not start a database transaction.', { title: 'Database error', type: 'error' });
        reject(error);
        return;
      }
      let request;
      try { request = action(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(request && 'result' in request ? request.result : undefined);
      tx.onerror = () => reject(tx.error || (request && request.error));
      tx.onabort = () => reject(tx.error || new Error('Database transaction aborted'));
    });
  }

  const put = (storeName, value) => transaction(storeName, 'readwrite', store => store.put(value));
  const get = (storeName, key) => transaction(storeName, 'readonly', store => store.get(key));
  const getAll = storeName => transaction(storeName, 'readonly', store => store.getAll());
  const remove = (storeName, key) => transaction(storeName, 'readwrite', store => store.delete(key));

  async function purgeRemovedProfiles() {
    for (const profileId of REMOVED_PROFILE_IDS) {
      await remove(PROFILE_STORE, profileId);
      await remove(DATA_STORE, profileId);
    }

    const snapshots = await getAll(SNAPSHOT_STORE);
    for (const snapshot of snapshots) {
      if (REMOVED_PROFILE_IDS.has(snapshot.profileId)) await remove(SNAPSHOT_STORE, snapshot.id);
    }

    const metadata = await getAll(META_STORE);
    for (const row of metadata) {
      const profileId = row?.profileId || String(row?.key || '').split(':')[1];
      if (REMOVED_PROFILE_IDS.has(profileId)) await remove(META_STORE, row.key);
    }

    if (REMOVED_PROFILE_IDS.has(localStorage.getItem(ACTIVE_KEY))) localStorage.removeItem(ACTIVE_KEY);
  }

  async function fetchJson(path, optional = false) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      if (optional && response.status === 404) return null;
      throw new Error(`Could not load ${path} (${response.status}).`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error(`${path} must contain a JSON array.`);
    return {
      shows: data,
      path,
      lastModified: response.headers.get('last-modified') || null
    };
  }

  async function loadPreferredJson(profile) {
    // latest.json points to a dated backup, allowing every backup file to remain archived.
    try {
      const latestResponse = await fetch(profile.latestPath, { cache: 'no-store' });
      if (latestResponse.ok) {
        const latest = await latestResponse.json();
        const fileName = typeof latest?.file === 'string' ? latest.file.trim() : '';
        if (fileName && !fileName.includes('/') && !fileName.includes('\\')) {
          const datedBackup = await fetchJson(`${profile.folderPath}/${fileName}`, true);
          if (datedBackup) return datedBackup;
        }
      }
    } catch (error) {
      console.warn('Could not read latest backup pointer:', error);
    }

    // Compatibility fallback for older installations that still use a fixed
    // <Profile>-backup.json file, then fall back to the immutable original file.
    const legacyBackup = await fetchJson(profile.backupPath, true);
    if (legacyBackup) return legacyBackup;
    return fetchJson(profile.originalPath, false);
  }

  async function ensureProfiles() {
    for (const profile of DEFAULT_PROFILES) await put(PROFILE_STORE, profile);
  }

  async function ensureProfileData(profile) {
    let record = await get(DATA_STORE, profile.id);
    const fileSource = await loadPreferredJson(profile);
    const originalSource = fileSource.path === profile.originalPath
      ? fileSource
      : await fetchJson(profile.originalPath, true);
    activeSpecialRegistry = buildSpecialRegistry([
      ...(originalSource?.shows || []),
      ...(fileSource.shows || [])
    ]);

    if (record) {
      // IndexedDB is the active working copy. Never overwrite local additions on refresh.
      // Migrate old flat records in place without touching the source JSON files.
      let migrated = migrateRecord(record, profile.id);
      migrated.shows = normalizeShowsWithRegistry(migrated.shows || [], activeSpecialRegistry);
      const sourceShows = normalizeShowsWithRegistry(fileSource.shows || [], activeSpecialRegistry);

      // Recover old broken records that kept the show list but lost every episode array.
      // Normal records and local additions remain untouched.
      if (countEpisodes(migrated.shows) === 0 && countEpisodes(sourceShows) > 0) {
        migrated = {
          ...migrated,
          shows: clone(sourceShows),
          recoveredFromSource: fileSource.path,
          updatedAt: new Date().toISOString()
        };
      }

      await put(DATA_STORE, migrated);
      return migrated;
    }

    // Preserve data created by the previous profile names when upgrading.
    const legacy = profile.legacyId ? await get(DATA_STORE, profile.legacyId) : null;
    const shows = legacy && Array.isArray(legacy.shows) ? legacy.shows : fileSource.shows;
    record = {
      profileId: profile.id,
      schemaVersion: INTERNAL_SCHEMA_VERSION,
      shows: clone(normalizeShowsWithRegistry(shows, activeSpecialRegistry)),
      updatedAt: new Date().toISOString(),
      sourcePath: legacy ? 'indexeddb:legacy' : fileSource.path,
      sourceLastModified: legacy ? null : fileSource.lastModified
    };
    await put(DATA_STORE, record);
    return record;
  }

  function flagIsTrue(value) {
    if (value === true || value === 1) return true;
    return ['true', '1', 'yes', 'special'].includes(String(value ?? '').trim().toLowerCase());
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

  function episodeIsExplicitSpecial(episode, season) {
    const seasonNumber = Number(season?.n ?? season?.number ?? season?.season ?? 0);
    const seasonLabel = String(season?.name ?? season?.title ?? '').trim().toLowerCase();
    const seasonIsSpecial = seasonNumber === 0 || flagIsTrue(season?.sp) || flagIsTrue(season?.special) ||
      flagIsTrue(season?.is_special) || flagIsTrue(season?.is_specials) || /^(specials?|extras?)$/.test(seasonLabel);
    if (seasonIsSpecial) return true;

    const type = String(episode?.type ?? episode?.episodeType ?? episode?.episode_type ?? '').trim().toLowerCase();
    const specialFields = ['sp', 'special', 'is_special', 'isSpecial'];
    const hasExplicitSpecialField = specialFields.some(field => Object.prototype.hasOwnProperty.call(episode || {}, field));
    const explicitSpecial = specialFields.some(field => flagIsTrue(episode?.[field]));
    return explicitSpecial || (type && !['regular', 'standard', 'episode'].includes(type)) ||
      (!hasExplicitSpecialField && hasSpecialEpisodeTitle(episode?.name ?? episode?.title ?? ''));
  }

  function collectSpecialMetadata(show) {
    const keys = new Set(Array.isArray(show?._specialEpisodeKeys) ? show._specialEpisodeKeys : []);
    const ids = new Set(Array.isArray(show?._specialEpisodeIds) ? show._specialEpisodeIds.map(String) : []);

    (Array.isArray(show?.seasons) ? show.seasons : []).forEach(season => {
      const seasonNumber = Number(season?.n ?? season?.number ?? season?.season ?? 0);
      if (seasonNumber === 0 || flagIsTrue(season?.sp) || flagIsTrue(season?.special) || flagIsTrue(season?.is_special) || flagIsTrue(season?.is_specials)) return;
      const episodes = Array.isArray(season?.eps) ? season.eps : (Array.isArray(season?.episodes) ? season.episodes : []);
      episodes.forEach(episode => {
        if (!episodeIsExplicitSpecial(episode, season)) return;
        const titleKey = normalizeEpisodeTitleKey(episode?.name ?? episode?.title ?? '');
        if (titleKey) keys.add(`${seasonNumber}|${titleKey}`);
        episodeIdTokens(episode).forEach(id => ids.add(id));
      });
    });

    return { keys: [...keys].sort(), ids: [...ids].sort() };
  }

  function showRegistryKeys(show) {
    const info = show?.info && typeof show.info === 'object' ? show.info : {};
    const id = show?.id && typeof show.id === 'object' ? show.id : {};
    const tvdb = info.tvdbId ?? info.tvdb ?? show?.tvdb ?? id.tvdb ?? null;
    const title = normalizeEpisodeTitleKey(show?.title ?? info.title ?? '');
    const keys = [];
    if (tvdb !== null && tvdb !== undefined && tvdb !== '') keys.push(`tvdb:${tvdb}`);
    if (title) keys.push(`title:${title}`);
    return keys;
  }

  function buildSpecialRegistry(shows) {
    const registry = new Map();
    (Array.isArray(shows) ? shows : []).forEach(show => {
      const metadata = collectSpecialMetadata(show);
      showRegistryKeys(show).forEach(key => {
        const current = registry.get(key) || { keys: [], ids: [] };
        registry.set(key, {
          keys: [...new Set([...(current.keys || []), ...(metadata.keys || [])])],
          ids: [...new Set([...(current.ids || []), ...(metadata.ids || [])].map(String))]
        });
      });
    });
    return registry;
  }

  function specialMetadataForShow(show, registry = activeSpecialRegistry) {
    for (const key of showRegistryKeys(show)) {
      if (registry?.has(key)) return registry.get(key);
    }
    return collectSpecialMetadata(show);
  }

  function episodeMatchesSpecialMetadata(episode, season, metadata) {
    if (episodeIsExplicitSpecial(episode, season)) return true;
    if (!metadata) return false;
    if (episodeIdTokens(episode).some(id => metadata.ids?.includes(String(id)))) return true;
    const seasonNumber = Number(season?.n ?? season?.number ?? season?.season ?? 0);
    const titleKey = normalizeEpisodeTitleKey(episode?.name ?? episode?.title ?? '');
    return Boolean(titleKey && metadata.keys?.includes(`${seasonNumber}|${titleKey}`));
  }

  function sanitizeShowWithSpecialMetadata(show, metadata) {
    const cleanSeasons = (Array.isArray(show?.seasons) ? show.seasons : [])
      .filter(season => Number(season?.n ?? season?.number ?? 0) !== 0 && !flagIsTrue(season?.sp) && !flagIsTrue(season?.is_specials))
      .map(season => ({
        ...season,
        sp: false,
        is_specials: false,
        eps: (Array.isArray(season?.eps) ? season.eps : []).filter(episode => !episodeMatchesSpecialMetadata(episode, season, metadata))
      }));

    return {
      ...show,
      seasons: cleanSeasons,
      _specialEpisodeKeys: [...new Set(metadata?.keys || [])],
      _specialEpisodeIds: [...new Set((metadata?.ids || []).map(String))]
    };
  }

  function applySpecialRegistry(shows, registry = activeSpecialRegistry) {
    return (Array.isArray(shows) ? shows : []).map(show => sanitizeShowWithSpecialMetadata(show, specialMetadataForShow(show, registry)));
  }

  function normalizeEpisode(ep) {
    if (!ep || typeof ep !== 'object') return null;
    const rawId = ep.id;
    const id = rawId && typeof rawId === 'object' ? rawId : {};
    const episodeName = ep.name ?? ep.title ?? '';
    const type = String(ep.type ?? ep.episodeType ?? ep.episode_type ?? '').trim().toLowerCase();
    const watched = Boolean(ep.w || ep.is_watched);
    const specialFields = ['sp', 'special', 'is_special', 'isSpecial'];
    const hasExplicitSpecialField = specialFields.some(field => Object.prototype.hasOwnProperty.call(ep, field));
    const explicitSpecial = specialFields.some(field => flagIsTrue(ep[field]));
    return {
      ...ep,
      id: {
        tvmaze: id.tvmaze ?? (typeof rawId === 'number' ? rawId : ep.tvmaze ?? null),
        tvdb: id.tvdb ?? ep.tvdb ?? null,
        imdb: id.imdb ?? ep.imdb ?? null
      },
      n: ep.n ?? ep.number ?? 0,
      name: episodeName,
      sp: explicitSpecial || (type && !['regular', 'standard', 'episode'].includes(type)) ||
        (!hasExplicitSpecialField && hasSpecialEpisodeTitle(episodeName)),
      w: watched,
      wa: ep.wa || ep.watched_at || null,
      airdate: ep.airdate ?? null,
      runtime: Number(ep.runtime ?? 0) || null,
      type: ep.type ?? ep.episodeType ?? ep.episode_type ?? null,
      rewatch_count: Number(ep.rewatch_count ?? 0),
      watched_count: Number(ep.watched_count ?? (watched ? 1 : 0))
    };
  }

  function normalizeSeason(season) {
    if (!season || typeof season !== 'object') return null;
    const episodes = Array.isArray(season.eps) ? season.eps : (Array.isArray(season.episodes) ? season.episodes : []);
    const seasonNumber = Number(season.n ?? season.number ?? season.season ?? 0);
    const seasonLabel = String(season.name ?? season.title ?? '').trim().toLowerCase();
    const seasonIsSpecial = seasonNumber === 0 || flagIsTrue(season.sp) || flagIsTrue(season.special) ||
      flagIsTrue(season.is_special) || flagIsTrue(season.is_specials) || /^(specials?|extras?)$/.test(seasonLabel);
    if (seasonIsSpecial) return null;

    const normalizedEpisodes = episodes.map(normalizeEpisode).filter(ep => ep && !ep.sp);
    const deduped = new Map();
    normalizedEpisodes.forEach((ep, index) => {
      const stableId = ep?.id?.tvdb ?? ep?.id?.imdb ?? null;
      const number = Number(ep.n ?? 0);
      const key = number > 0 ? `n:${number}` : (stableId != null ? `id:${stableId}` : `i:${index}`);
      const current = deduped.get(key);
      if (!current) { deduped.set(key, ep); return; }
      const preferred = ep.w && !current.w ? ep : current;
      const other = preferred === ep ? current : ep;
      deduped.set(key, {
        ...other, ...preferred,
        w: Boolean(current.w || ep.w),
        wa: current.wa || ep.wa || null,
        watched_count: Math.max(Number(current.watched_count || 0), Number(ep.watched_count || 0), (current.w || ep.w) ? 1 : 0),
        rewatch_count: Math.max(Number(current.rewatch_count || 0), Number(ep.rewatch_count || 0)),
        sp: false, special: false, is_special: false
      });
    });

    return { ...season, n: seasonNumber, sp: false, is_specials: false, eps: [...deduped.values()].sort((a, b) => Number(a.n) - Number(b.n)) };
  }

  function normalizeShow(show) {
    if (!show || typeof show !== 'object') return null;

    // Phase 15 internal model. Legacy top-level aliases are intentionally kept
    // so the existing UI can continue working while later phases move to the
    // nested model one feature at a time.
    const info = show.info && typeof show.info === 'object' ? show.info : {};
    const user = show.user && typeof show.user === 'object' ? show.user : {};
    const progress = show.progress && typeof show.progress === 'object' ? show.progress : {};
    const id = show.id && typeof show.id === 'object' ? show.id : {};

    const tvdb = info.tvdbId ?? info.tvdb ?? show.tvdb ?? id.tvdb ?? null;
    const imdb = info.imdbId ?? info.imdb ?? show.imdb ?? id.imdb ?? null;
    const title = show.title ?? info.title ?? 'Untitled';
    const favorite = Boolean(show.fav ?? show.is_favorite ?? user.favorite);
    const watchLater = Boolean(show.is_watch_later ?? show.watch_later ?? user.watchLater ?? show.status === 'watch_later');
    const specialMetadata = collectSpecialMetadata(show);
    const seasons = (Array.isArray(show.seasons) ? show.seasons : [])
      .map(normalizeSeason)
      .filter(season => season && !season.sp && Number(season.n) !== 0)
      .map(season => ({
        ...season,
        eps: season.eps.filter(ep => ep && !episodeMatchesSpecialMetadata(ep, season, specialMetadata))
      }));
    const status = watchLater ? 'watch_later' : (show.status ?? progress.status ?? 'not_started_yet');

    const normalizedInfo = {
      ...info,
      tvdbId: tvdb,
      imdbId: imdb,
      title,
      createdAt: info.createdAt ?? show.created_at ?? null,
      officialStatus: info.officialStatus ?? show.officialStatus ?? null,
      runtime: Number(info.runtime ?? show.runtime ?? 0) || null
    };

    const normalizedUser = {
      ...user,
      favorite,
      watchLater,
      rating: user.rating ?? null,
      notes: user.notes ?? '',
      tags: Array.isArray(user.tags) ? user.tags : []
    };

    const normalizedProgress = {
      ...progress,
      status,
      lastWatchedEpisode: progress.lastWatchedEpisode ?? null,
      watchedEpisodes: Number(progress.watchedEpisodes ?? 0),
      percent: Number(progress.percent ?? 0)
    };

    return {
      ...show,
      schemaVersion: INTERNAL_SCHEMA_VERSION,
      info: normalizedInfo,
      user: normalizedUser,
      progress: normalizedProgress,
      seasons,

      // Compatibility aliases used by the current rendering and action code.
      tvdb,
      imdb,
      title,
      officialStatus: normalizedInfo.officialStatus,
      runtime: normalizedInfo.runtime,
      fav: favorite,
      is_favorite: favorite,
      is_watch_later: watchLater,
      status,
      _specialEpisodeKeys: specialMetadata.keys,
      _specialEpisodeIds: specialMetadata.ids
    };
  }

  function normalizeShows(shows) {
    if (!Array.isArray(shows)) return [];
    return shows.map(normalizeShow).filter(Boolean);
  }

  function normalizeShowsWithRegistry(shows, registry = activeSpecialRegistry) {
    return applySpecialRegistry(normalizeShows(shows), registry);
  }

  function migrateRecord(record, profileId) {
    const sourceVersion = Number(record?.schemaVersion ?? 1);
    const shows = normalizeShows(Array.isArray(record?.shows) ? record.shows : []);

    return {
      ...record,
      profileId,
      schemaVersion: INTERNAL_SCHEMA_VERSION,
      migratedFromSchemaVersion: sourceVersion < INTERNAL_SCHEMA_VERSION ? sourceVersion : (record?.migratedFromSchemaVersion ?? null),
      shows,
      updatedAt: record?.updatedAt ?? new Date().toISOString()
    };
  }

  function toCanonicalJson(shows) {
    return normalizeShowsWithRegistry(shows).map(show => ({
      uuid: show.uuid ?? null,
      id: {
        tvdb: show.tvdb ?? show.id?.tvdb ?? null,
        imdb: show.imdb ?? show.id?.imdb ?? null
      },
      created_at: show.created_at ?? show.info?.createdAt ?? null,
      title: show.title,
      officialStatus: show.officialStatus ?? show.info?.officialStatus ?? null,
      runtime: Number(show.runtime ?? show.info?.runtime ?? 0) || null,
      status: show.is_watch_later ? 'watch_later' : (show.status ?? 'not_started_yet'),
      is_watch_later: Boolean(show.is_watch_later),
      is_favorite: Boolean(show.fav),
      _noEpisodeData: Boolean(show._noEpisodeData),
      seasons: show.seasons.map(season => ({
        number: season.n,
        is_specials: Boolean(season.sp),
        episodes: season.eps.map(ep => ({
          id: {
            tvmaze: ep.id?.tvmaze ?? (typeof ep.id === 'number' ? ep.id : ep.tvmaze ?? null),
            tvdb: ep.id?.tvdb ?? ep.tvdb ?? null,
            imdb: ep.id?.imdb ?? ep.imdb ?? null
          },
          number: ep.n,
          name: ep.name ?? '',
          special: Boolean(ep.sp),
          type: ep.type ?? null,
          airdate: ep.airdate ?? null,
          runtime: Number(ep.runtime ?? 0) || null,
          is_watched: Boolean(ep.w || ep.is_watched),
          watched_at: ep.wa || ep.watched_at || null,
          rewatch_count: Number(ep.rewatch_count ?? 0),
          watched_count: Number(ep.watched_count ?? ((ep.w || ep.is_watched) ? 1 : 0))
        }))
      }))
    }));
  }

  function replaceRuntimeData(shows) {
    SHOWS_DATA.splice(0, SHOWS_DATA.length, ...clone(normalizeShowsWithRegistry(shows)));
  }

  async function loadProfile(profileId) {
    const profile = DEFAULT_PROFILES.find(item => item.id === profileId);
    if (!profile) throw new Error('Profile not found.');

    const record = await ensureProfileData(profile);
    activeProfile = profile;
    localStorage.setItem(ACTIVE_KEY, profileId);
    replaceRuntimeData(record.shows || []);
    updateProfileUI();
    hideSelector();
    window.dispatchEvent(new CustomEvent('tvtime:profile-changed', { detail: clone(profile) }));
    return profile;
  }

  function countEpisodes(shows) {
    return normalizeShowsWithRegistry(shows).reduce((total, show) => total + show.seasons.reduce((seasonTotal, season) => seasonTotal + season.eps.length, 0), 0);
  }

  function approximateBytes(value) {
    try { return new Blob([JSON.stringify(value)]).size; }
    catch (_) { return JSON.stringify(value).length; }
  }

  async function listSnapshots(profileId = activeProfile?.id) {
    if (!profileId) return [];
    const all = await getAll(SNAPSHOT_STORE);
    return all
      .filter(item => item.profileId === profileId)
      .map(item => {
        const shows = normalizeShowsWithRegistry(item.shows || []);
        return {
          ...item,
          shows,
          showCount: shows.length,
          episodeCount: countEpisodes(shows),
          sizeBytes: approximateBytes(shows)
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function enforceSnapshotRetention(profileId) {
    const snapshots = await listSnapshots(profileId);
    for (const snapshot of snapshots.slice(SNAPSHOT_LIMIT)) await remove(SNAPSHOT_STORE, snapshot.id);
  }

  async function createSnapshot(options = {}) {
    if (!activeProfile) throw new Error('Select a profile first.');
    const persisted = options.shows ? { shows: options.shows } : await get(DATA_STORE, activeProfile.id);
    const shows = clone(normalizeShowsWithRegistry(persisted?.shows || SHOWS_DATA));
    const createdAt = new Date().toISOString();
    const snapshot = {
      id: `${activeProfile.id}-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      profileId: activeProfile.id,
      profileName: activeProfile.name,
      createdAt,
      type: options.type === 'manual' ? 'manual' : 'auto',
      label: String(options.label || '').trim().slice(0, 80),
      schemaVersion: INTERNAL_SCHEMA_VERSION,
      showCount: shows.length,
      episodeCount: countEpisodes(shows),
      sizeBytes: approximateBytes(shows),
      shows
    };
    await put(SNAPSHOT_STORE, snapshot);
    await enforceSnapshotRetention(activeProfile.id);
    window.dispatchEvent(new CustomEvent('tvtime:snapshots-changed'));
    return clone(snapshot);
  }

  function profileMetaKey(name, profileId = activeProfile?.id) {
    return `profile:${profileId || 'default'}:${name}`;
  }

  async function getProfileMeta(name, fallback = null, profileId = activeProfile?.id) {
    if (!profileId) return fallback;
    const row = await get(META_STORE, profileMetaKey(name, profileId));
    return row && Object.prototype.hasOwnProperty.call(row, 'value') ? clone(row.value) : fallback;
  }

  async function setProfileMeta(name, value, profileId = activeProfile?.id) {
    if (!profileId) return;
    await put(META_STORE, {
      key: profileMetaKey(name, profileId),
      profileId,
      name,
      value: clone(value),
      updatedAt: new Date().toISOString()
    });
  }

  async function saveActiveData() {
    if (!activeProfile) return;
    const previous = await get(DATA_STORE, activeProfile.id);
    if (!suppressAutoSnapshot && previous?.shows) {
      const previousJson = JSON.stringify(toCanonicalJson(previous.shows));
      const nextJson = JSON.stringify(toCanonicalJson(SHOWS_DATA));
      if (previousJson !== nextJson) await createSnapshot({ type: 'auto', label: 'Before change', shows: previous.shows });
    }
    await put(DATA_STORE, {
      profileId: activeProfile.id,
      schemaVersion: INTERNAL_SCHEMA_VERSION,
      shows: clone(normalizeShowsWithRegistry(SHOWS_DATA)),
      updatedAt: new Date().toISOString()
    });
  }

  async function restoreSnapshot(snapshotId) {
    if (!activeProfile) throw new Error('Select a profile first.');
    const snapshot = await get(SNAPSHOT_STORE, snapshotId);
    if (!snapshot || snapshot.profileId !== activeProfile.id) throw new Error('Snapshot not found for this profile.');
    await createSnapshot({ type: 'auto', label: 'Before restore' });
    suppressAutoSnapshot = true;
    try {
      replaceRuntimeData(snapshot.shows || []);
      await put(DATA_STORE, {
        profileId: activeProfile.id,
        schemaVersion: INTERNAL_SCHEMA_VERSION,
        shows: clone(normalizeShowsWithRegistry(snapshot.shows || [])),
        updatedAt: new Date().toISOString(),
        restoredFrom: snapshot.id
      });
    } finally { suppressAutoSnapshot = false; }
    window.dispatchEvent(new CustomEvent('tvtime:data-restored', { detail: { snapshotId } }));
    return clone(snapshot);
  }

  async function deleteSnapshot(snapshotId) {
    const snapshot = await get(SNAPSHOT_STORE, snapshotId);
    if (!snapshot || snapshot.profileId !== activeProfile?.id) throw new Error('Snapshot not found.');
    await remove(SNAPSHOT_STORE, snapshotId);
    window.dispatchEvent(new CustomEvent('tvtime:snapshots-changed'));
  }

  function downloadJsonFile(fileName, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function createBackupTimestamp(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }

  function backupActiveProfile() {
    if (!activeProfile) throw new Error('Select a profile first.');

    const fileName = `${activeProfile.name}-backup-${createBackupTimestamp()}.json`;
    const backupData = toCanonicalJson(SHOWS_DATA);

    // The dated backup is the actual TV Time-compatible data file.
    downloadJsonFile(fileName, backupData);

    // latest.json is a small pointer used by db/<Profile>/latest.json on next load.
    // A short delay prevents browsers from ignoring the second automatic download.
    setTimeout(() => downloadJsonFile('latest.json', { file: fileName }), 250);

    window.TVTimeErrors?.success?.(`Backup created: ${fileName}. Copy it together with latest.json into ${activeProfile.folderPath}.`, {
      title: 'Backup downloaded',
      duration: 9000
    });

    return fileName;
  }

  function showSelector() {
    document.getElementById('profileSelector')?.classList.remove('d-none');
  }

  function hideSelector() {
    document.getElementById('profileSelector')?.classList.add('d-none');
  }

  function updateProfileUI() {
    const name = document.getElementById('activeProfileName');
    const icon = document.getElementById('activeProfileIcon');
    if (name) name.textContent = activeProfile ? activeProfile.name : 'Select profile';
    if (icon) icon.textContent = activeProfile ? activeProfile.icon : '?';
  }

  function bindUI() {
    document.querySelectorAll('[data-profile-id]').forEach(button => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await loadProfile(button.dataset.profileId); }
        catch (error) { alert(error.message); }
        finally { button.disabled = false; }
      });
    });

    document.getElementById('switchProfileBtn')?.addEventListener('click', showSelector);


  }

  async function start() {
    await openDB();
    await purgeRemovedProfiles();
    await ensureProfiles();
    bindUI();

    let saved = localStorage.getItem(ACTIVE_KEY);
    if (saved === 'mohammad') saved = 'ebi';
    if (saved === 'user2') saved = 'dobby';

    if (saved && DEFAULT_PROFILES.some(profile => profile.id === saved)) await loadProfile(saved);
    else showSelector();
  }

  window.TVTimeProfiles = {
    start,
    loadProfile,
    saveActiveData,
    backupActiveProfile,
    showSelector,
    getActiveProfile: () => activeProfile ? clone(activeProfile) : null,
    getSchemaVersion: () => INTERNAL_SCHEMA_VERSION,
    normalizeShows: shows => clone(normalizeShows(shows)),
    toCanonicalJson: shows => clone(toCanonicalJson(shows)),
    createSnapshot,
    listSnapshots,
    restoreSnapshot,
    deleteSnapshot,
    getDatabaseRecord: async () => activeProfile ? clone(await get(DATA_STORE, activeProfile.id)) : null,
    getProfileMeta,
    setProfileMeta,
    getSnapshotLimit: () => SNAPSHOT_LIMIT
  };
})();
