/**
 * Adapter: die NIP-11-Relay-Beschreibung — **unter ihrem 0.9.5-Namen**.
 *
 * ── Welche 0.9.5-API diese Datei vorwegnimmt ─────────────────────────────────────
 * Der Typ heißt in 0.8.16 `RelayProfile` (`@welshman/util`) und in 0.9.5 **`RelayInfo`**
 * (`@welshman/domain`). Die Feldmenge ist dieselbe — Feld für Feld verglichen: `icon`,
 * `banner`, `name`, `self`, `pubkey`, `contact`, `software`, `version`, `negentropy`,
 * `description`, `supported_nips`, `privacy_policy`, `terms_of_service`, `limitation`,
 * `redirect_to`. Deshalb ist die Umbenennung hier vollständig und ohne Risiko.
 *
 * ── Was in P3 daraus entfällt ────────────────────────────────────────────────────
 * Die ganze Datei: der Import zeigt dann auf `@welshman/domain`. Keine Aufrufstelle
 * muss angefasst werden.
 *
 * Daneben stellt 0.9.5 eine `Relay`-**Klasse** (URL + Info + `hasNip()`/`display()`).
 * Die ist hier NICHT nachgebildet: `js/relayCaps.ts` löst dieselben Fragen absichtlich
 * welshman-frei, damit es ohne Runtime unter `node --test` läuft (steht so in seinem
 * Kopf), und der Plan hat den Tausch geprüft und verworfen.
 *
 * Das `ManagementMethod`-Enum von 0.8.16 steht bewusst nicht mehr hier: in 0.9.5 ist
 * eine NIP-86-Methode ein schlichter String hinter `ManagementApi` — siehe
 * `js/welshmanApp.ts`.
 *
 * **Diese Datei importiert ausschließlich `@welshman/util`.**
 */
export type { RelayProfile as RelayInfo } from '@welshman/util'
