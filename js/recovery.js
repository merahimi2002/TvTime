(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let pendingAction = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown date';
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function countEpisodes(shows) {
    return (shows || []).reduce((total, show) => total + (show.seasons || []).reduce((sum, season) => {
      if (window.isSpecialSeason?.(season)) return sum;
      return sum + (season.eps || []).filter(ep => !(window.isSpecialEpisode ? window.isSpecialEpisode(ep, season, show) : (ep.sp || ep.special))).length;
    }, 0), 0);
  }

  function openConfirm(title, message, actionLabel, action, danger = false) {
    pendingAction = action;
    $('recoveryConfirmTitle').textContent = title;
    $('recoveryConfirmText').textContent = message;
    const button = $('recoveryConfirmAction');
    button.textContent = actionLabel;
    button.className = danger ? 'btn btn-danger' : 'btn btn-success';
    const modal = $('recoveryConfirmModal');
    modal.hidden = false;
    modal.classList.remove('d-none');
  }

  function closeConfirm() {
    pendingAction = null;
    const modal = $('recoveryConfirmModal');
    modal.hidden = true;
    modal.classList.add('d-none');
  }

  async function refreshRecovery() {
    if (!window.TVTimeProfiles?.getActiveProfile()) return;
    const profile = window.TVTimeProfiles.getActiveProfile();
    const record = await window.TVTimeProfiles.getDatabaseRecord();
    const snapshots = await window.TVTimeProfiles.listSnapshots();
    const shows = record?.shows || SHOWS_DATA || [];
    const bytes = new Blob([JSON.stringify(shows)]).size;

    $('recoveryProfileName').textContent = profile.name;
    $('recoveryShowCount').textContent = shows.length.toLocaleString('en-US');
    $('recoveryEpisodeCount').textContent = countEpisodes(shows).toLocaleString('en-US');
    $('recoveryStorageSize').textContent = formatBytes(bytes);
    $('recoverySnapshotCount').textContent = snapshots.length.toLocaleString('en-US');
    $('recoveryLatestSnapshot').textContent = snapshots[0] ? formatDate(snapshots[0].createdAt) : 'No snapshots yet';
    $('recoveryRetentionText').textContent = `${snapshots.length} / ${window.TVTimeProfiles.getSnapshotLimit()} retained`;

    const list = $('snapshotHistoryList');
    if (!snapshots.length) {
      list.innerHTML = '<div class="recovery-empty"><i class="bi bi-shield-check"></i><strong>No snapshots yet</strong><span>Create a manual snapshot or make a change to generate an automatic recovery point.</span></div>';
      return;
    }

    list.innerHTML = snapshots.map(snapshot => `
      <article class="snapshot-card" data-snapshot-id="${escapeHtml(snapshot.id)}">
        <div class="snapshot-type ${snapshot.type === 'manual' ? 'manual' : 'auto'}">
          <i class="bi ${snapshot.type === 'manual' ? 'bi-bookmark-star-fill' : 'bi-lightning-charge-fill'}"></i>
        </div>
        <div class="snapshot-main">
          <div class="snapshot-title-row">
            <strong>${escapeHtml(snapshot.label || (snapshot.type === 'manual' ? 'Manual snapshot' : 'Automatic snapshot'))}</strong>
            <span class="snapshot-badge ${snapshot.type === 'manual' ? 'manual' : 'auto'}">${snapshot.type}</span>
          </div>
          <time>${escapeHtml(formatDate(snapshot.createdAt))}</time>
          <div class="snapshot-meta">
            <span><i class="bi bi-collection-play"></i>${Number(snapshot.showCount || 0).toLocaleString('en-US')} shows</span>
            <span><i class="bi bi-film"></i>${Number(snapshot.episodeCount || 0).toLocaleString('en-US')} episodes</span>
            <span><i class="bi bi-device-ssd"></i>${formatBytes(snapshot.sizeBytes)}</span>
          </div>
        </div>
        <div class="snapshot-actions">
          <button class="btn btn-sm btn-outline-light" type="button" data-restore-snapshot="${escapeHtml(snapshot.id)}"><i class="bi bi-arrow-counterclockwise"></i> Restore</button>
          <button class="btn btn-sm btn-outline-danger" type="button" data-delete-snapshot="${escapeHtml(snapshot.id)}" aria-label="Delete snapshot"><i class="bi bi-trash3"></i></button>
        </div>
      </article>`).join('');
  }

  async function createManualSnapshot() {
    const button = $('createSnapshotBtn');
    button.disabled = true;
    try {
      await window.TVTimeProfiles.createSnapshot({ type: 'manual', label: 'Manual recovery point' });
      await refreshRecovery();
    } finally { button.disabled = false; }
  }

  async function downloadBackup() {
    const button = $('downloadRecoveryBackupBtn');
    button.disabled = true;
    try {
      await window.TVTimeProfiles.createSnapshot({ type: 'manual', label: 'Before backup download' });
      window.TVTimeProfiles.backupActiveProfile();
      await refreshRecovery();
    } finally { button.disabled = false; }
  }

  function bind() {
    $('createSnapshotBtn')?.addEventListener('click', createManualSnapshot);
    $('downloadRecoveryBackupBtn')?.addEventListener('click', downloadBackup);
    $('snapshotHistoryList')?.addEventListener('click', event => {
      const restore = event.target.closest('[data-restore-snapshot]');
      if (restore) {
        const id = restore.dataset.restoreSnapshot;
        openConfirm('Restore snapshot?', 'Current profile data will be replaced. A safety snapshot will be created first.', 'Restore', async () => {
          await window.TVTimeProfiles.restoreSnapshot(id);
          renderStats();
          render();
          await refreshRecovery();
          document.getElementById('librarySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return;
      }
      const remove = event.target.closest('[data-delete-snapshot]');
      if (remove) {
        const id = remove.dataset.deleteSnapshot;
        openConfirm('Delete snapshot?', 'This recovery point will be permanently removed.', 'Delete', async () => {
          await window.TVTimeProfiles.deleteSnapshot(id);
          await refreshRecovery();
        }, true);
      }
    });

    document.querySelectorAll('[data-close-recovery-confirm]').forEach(button => button.addEventListener('click', closeConfirm));
    $('recoveryConfirmAction')?.addEventListener('click', async () => {
      const action = pendingAction;
      if (!action) return;
      const button = $('recoveryConfirmAction');
      button.disabled = true;
      try { await action(); closeConfirm(); }
      catch (error) { alert(error.message || 'Recovery operation failed.'); }
      finally { button.disabled = false; }
    });

    window.addEventListener('tvtime:profile-changed', refreshRecovery);
    window.addEventListener('tvtime:snapshots-changed', refreshRecovery);
    window.addEventListener('tvtime:data-restored', refreshRecovery);
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    setTimeout(refreshRecovery, 0);
  });
})();
