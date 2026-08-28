/**
 * Fassade: der globale App-Kontext aus `@welshman/app`.
 *
 * **Warum diese Datei existiert.** In 0.8.16 sind Repository, Tracker, Relay-Infos,
 * Profile und das Publizieren freistehende Module-Globals. In 0.9.5 hängt all das an
 * einer App-Instanz (`createApp`, Plugins über `app.use(X)`); **jedes** Symbol, das
 * dieses Paket heute aus `@welshman/app` importiert, ist dort weg — gemessen mit
 * `scripts/welshman-bruchflaeche.mjs`: 43 von 43. Diese Datei ist die eine Stelle, an
 * der P3 aus Globals eine Instanz macht, statt in 30 Dateien gleichzeitig.
 *
 * **Reine Durchreiche, keine Interpretation.** Kein Cache, keine Vorverarbeitung,
 * keine Umbenennung. Was hier steht, ist dasselbe Objekt wie vorher.
 *
 * **Was hier NICHT steht, und warum:**
 * - `appContext` — das ist Boot-Verdrahtung und bleibt in `js/core.ts`. Eine Fassade,
 *   über die jeder den globalen Kontext umschreiben kann, wäre keine.
 * - `loadZapperForPubkey` / `notifyZapper` — nur `js/zaps.ts` benutzt sie, und diese
 *   Fläche ist bis 0.9.6 eingefroren (Upstream-Bug im Zapper-Gate).
 * - `Router` aus `@welshman/router` und `netContext` aus `@welshman/net`. Beide sind
 *   in 0.9.5 nicht umbenannt, sondern **ersatzlos weg**: der Router wird zur
 *   RelaySelection-DSL mit asynchronem `resolve()`, die Kontext-Objekte werden zur
 *   `createApp`-Konfiguration. Eine Durchreiche hier würde eine Ein-Datei-Migration
 *   vortäuschen, die es nicht gibt — die Aufrufstellen ändern sich wirklich.
 *
 * **Identität und Signieren stehen nicht hier, sondern in `js/welshmanSession.ts`.**
 *
 * **Diese Datei importiert ausschließlich `@welshman/app`.**
 */

// Speicher und Herkunft (Event → Relay)
export { repository, tracker } from '@welshman/app'

// Relays: Stores, Leser, Lader, NIP-86-Management
export {
    relaysByUrl,
    getRelay,
    getRelaysByUrl,
    deriveRelay,
    loadRelay,
    forceLoadRelay,
    manageRelay,
    loadBlockedRelayList,
} from '@welshman/app'

// Profile (kind 0) und NIP-05-Handles
export {
    profilesByPubkey,
    getProfile,
    deriveProfile,
    loadProfile,
    userProfile,
    loadUserProfile,
    handlesByNip05,
    displayNip05,
    deriveHandleForPubkey,
    loadHandleForPubkey,
} from '@welshman/app'

// Publizieren (optimistische Thunks)
export { publishThunk, waitForThunkCompletion } from '@welshman/app'

// Tag-Bau mit App-Wissen (Relay-Hints aus dem Tracker)
export { tagEvent, tagEventForComment, tagEventForReaction } from '@welshman/app'

// Nutzerdaten- und Outbox-Lader (`js/groups.ts`)
export { makeUserData, makeOutboxLoader } from '@welshman/app'

// Zapper-Store (die Zap-Fläche selbst bleibt in `js/zaps.ts`)
export { zappersByLnurl, getZapper } from '@welshman/app'
