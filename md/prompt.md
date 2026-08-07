You are a senior Vanilla JavaScript developer.

I already have a working personal TV tracking website built with:

* HTML
* CSS
* Vanilla JavaScript
* IndexedDB
* TVMaze API
* GitHub Pages

The existing project already displays shows, seasons, episodes, posters, ratings, progress, search, filters, sorting, and cached TVMaze metadata.

Do not rebuild the project from scratch.

Do not migrate it to React, Vue, Next.js, TypeScript, Supabase, Firebase, or any backend.

Do not introduce a complex enterprise architecture.

Work directly on my existing files and improve them gradually.

The goal is to turn the current archive-style website into a practical personal replacement for TV Time while preserving its current design and functionality.

## Main rules

1. Keep the current HTML, CSS, and JavaScript stack.
2. Keep GitHub Pages compatibility.
3. Keep the application usable without internet.
4. Use IndexedDB for all persistent application data.
5. Use TVMaze only when internet is available.
6. Existing local data must remain available when TVMaze fails.
7. Do not remove a working feature unless it is replaced with a better working implementation.
8. Avoid unnecessary abstractions and excessive folder structures.
9. Prefer small, understandable changes.
10. Explain every important modification.
11. Show complete content only for files that need to change.
12. Do not regenerate unrelated files.
13. Implement one phase at a time.
14. After completing each phase, stop and provide testing instructions.

## Existing data

The project currently contains a large `SHOWS_DATA` array imported from a TV Time backup.

Each show may contain:

* `uuid`
* `tvdb`
* `title`
* `status`
* `fav`
* `created`
* `seasons`

Each season may contain:

* `n`
* `sp`
* `eps`

Each episode may contain:

* `n`
* `name`
* `w`
* `wa`
* `sp`

Meaning:

* `n`: season or episode number
* `sp`: special season or episode
* `w`: watched
* `wa`: watched date

Preserve all existing watched states, watched dates, favorites, IDs, and imported information.

## Critical Specials rule

Special episodes must remain visible in a separate Specials section, but they must never affect:

* Main progress
* Watched count
* Unwatched count
* Continue Watching
* Airing
* Backlog
* Up to Date
* Completed
* Next episode
* Remaining episode count

A season or episode is special when:

* `season.sp === true`
* `episode.sp === true`
* season number is `0`

Implement this rule in shared helper functions instead of repeating conditions throughout the code.

## Two local profiles

Add exactly two local profiles.

Each profile must independently store:

* Watched episodes
* Watched dates
* Favorites
* Personal show status
* Notes
* Ratings
* Continue Watching
* History
* Settings

Shared show, season, episode, poster, and TVMaze metadata should not be duplicated for each profile.

Add a simple profile selection page when the app starts.

No real online authentication is required.

An optional local PIN may be added later, but it must not block the initial implementation.

## IndexedDB improvement

Currently IndexedDB is mainly used as a TVMaze cache.

Expand it carefully so it stores:

* Profiles
* Shared shows
* Shared seasons and episodes
* Profile-specific show settings
* Profile-specific watched progress
* Watch history
* Application settings
* TVMaze cache

Do not immediately delete the existing database or overwrite existing data.

Create a migration/import process that copies the current `SHOWS_DATA` into IndexedDB on the first run.

Add a flag such as:

`legacyDataImported: true`

This import must run only once.

Use transactions for large writes.

## Dynamic show statuses

Do not use the old imported `status` field as the current truth.

Keep it only as legacy information.

Calculate the active profile’s status dynamically:

### Not Started

No released regular episode has been watched.

### Continue Watching

At least one released regular episode has been watched and another released regular episode remains unwatched.

### Up to Date

All currently released regular episodes are watched, but the show is still running or has future episodes.

### Backlog

One or more already released regular episodes remain unwatched.

### Completed

TVMaze reports that the show ended and all released regular episodes are watched.

### Upcoming

There are no released regular episodes yet, but future regular episodes exist.

Future and special episodes must not incorrectly create backlog.

## TVMaze synchronization

Keep the existing TVMaze request queue, throttling, retry, and IndexedDB cache ideas.

Improve the TVMaze integration so it can:

* Find a show through its TVDB ID
* Save the TVMaze show ID
* Fetch complete show metadata
* Fetch seasons and episodes
* Detect newly added regular episodes
* Update air dates
* Update official show status
* Preserve local watched information
* Avoid duplicate episodes
* Work safely when offline

Never delete existing local episodes or progress merely because an API request failed.

When synchronizing episodes, match them primarily by TVMaze episode ID.

For legacy episodes without a TVMaze ID, match using:

1. Season number and episode number
2. Normalized title
3. Air date when available

Any uncertain match must preserve the old episode rather than delete progress.

## Required features

Improve the current project with these features in order.

### Phase 1 — IndexedDB and profiles

* Create two profiles
* Add profile-selection screen
* Import current `SHOWS_DATA` into IndexedDB once
* Keep the existing website working
* Store watched state independently for each profile
* Persist the active profile

### Phase 2 — Episode editing

* Make episode rows clickable
* Mark episode watched
* Mark episode unwatched
* Store watched date
* Update progress instantly
* Add “mark season watched”
* Add “mark season unwatched”
* Ask for confirmation before bulk changes
* Keep Specials separate

### Phase 3 — Dynamic sections

Add:

* Continue Watching
* Up to Date
* Backlog
* Not Started
* Completed
* Recently Watched

Continue Watching must show the first released unwatched regular episode after the user has started the show.

### Phase 4 — TVMaze episode sync

* Fetch complete episode lists
* Add newly released episodes
* Detect future episodes
* Update official status
* Add manual sync button
* Show sync progress
* Show last sync time
* Keep existing data when offline

### Phase 5 — Upcoming and calendar

Add:

* Today
* This Week
* Upcoming Episodes
* Simple chronological calendar

Use cached episode data so upcoming information remains visible offline.

### Phase 6 — Backup and restore

Add JSON:

* Full backup
* Single-profile backup
* Export
* Import
* Merge
* Replace
* Validation
* Automatic safety backup before restore

The backup must contain both shared metadata and profile-specific data.

### Phase 7 — PWA

Add:

* `manifest.webmanifest`
* `service-worker.js`
* Offline app shell
* Installable PWA
* Cache versioning
* Update notification
* Online/offline indicator

The website must open offline after its first successful online load.

## Code organization

Do not create dozens of files.

Use a simple structure similar to:

```text
index.html
styles/
  style.css
js/
  app.js
  db.js
  tvmaze.js
  profiles.js
  tracker.js
  ui.js
  backup.js
  utils.js
manifest.webmanifest
service-worker.js
```

Suggested responsibilities:

### `db.js`

* Open IndexedDB
* Database upgrades
* Object stores
* Read/write helpers
* Transactions
* Initial legacy import

### `tvmaze.js`

* API calls
* Queue
* Rate limiting
* Retry
* Mapping and synchronization

### `profiles.js`

* Profile creation
* Active profile
* Profile switching
* Profile settings

### `tracker.js`

* Watched/unwatched operations
* Progress
* Dynamic statuses
* Continue Watching
* Specials rules

### `ui.js`

* Cards
* Seasons
* Episodes
* Filters
* Modals
* Toasts
* Rendering

### `backup.js`

* Export
* Import
* Validation
* Merge
* Restore

### `utils.js`

* Dates
* Escaping
* Debounce
* Normalization
* Shared helpers

This is a guideline, not a requirement. Do not split a small piece of code into a separate file without a useful reason.

## UI requirements

Preserve the current visual identity as much as possible.

Improve it only where needed.

Add:

* Profile switcher
* Clear watched/unwatched controls
* Confirmation modal
* Toast messages
* Sync status
* Offline badge
* Loading state
* Error state
* Empty state

Do not redesign the whole website unless explicitly requested.

All essential controls must work on mobile and must not depend only on hover.

## Safety requirements

* Never use raw external HTML from TVMaze directly.
* Convert summaries to safe text.
* Validate imported JSON.
* Never execute imported data.
* Never silently erase progress.
* Before destructive restore or reset, create a safety backup.
* If a migration fails, keep the old data untouched and show an understandable error.

## Performance requirements

* Do not render every episode on initial page load.
* Build season episode lists only when opened.
* Debounce search.
* Use IndexedDB indexes where useful.
* Use batch transactions for imports and sync.
* Avoid refetching cached TVMaze data unnecessarily.
* Avoid rerendering the entire page after a single episode changes when a local UI update is sufficient.

## Working method

Start by examining all existing files.

Before changing code, provide:

1. A short summary of how the current project works
2. Existing strengths
3. Existing problems
4. Files that need modification
5. A simple phased improvement plan

Then implement only Phase 1.

For Phase 1:

* Keep changes minimal
* Preserve the current page
* Add IndexedDB storage for shared data and profile progress
* Add two profile selection
* Import existing `SHOWS_DATA` once
* Provide complete updated files
* Explain how to test
* Stop after Phase 1

Do not start later phases until requested.
