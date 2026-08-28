/**
 * Adapter: die NIP-11-Relay-Beschreibung — **unter ihrem 0.9.5-Namen**.
 *
 * ── Welche 0.9.5-API diese Datei vorwegnimmt ─────────────────────────────────────
 * Der Typ heißt in 0.8.16 `RelayProfile` (`@welshman/util`) und in 0.9.5 **`RelayInfo`**
 * (`@welshman/domain`).
 *
 * ── Die Feldmengen sind NICHT identisch ──────────────────────────────────────────
 * Hier stand bis zum P1-Review-Gate „Feld für Feld verglichen … deshalb ohne Risiko".
 * Das war in beide Richtungen falsch. Gemessen an den Deklarationen
 * (0.8.16: `util/dist/util/src/Relay.d.ts:8-28`; 0.9.5:
 * `domain/dist/domain/src/other/Relay.d.ts:1-21`):
 *
 * - **`url: string` ist in 0.8.16 ein PFLICHTfeld und fehlt in 0.9.5 ganz.** Dort trägt
 *   die URL die `Relay`-Klasse, nicht die Info.
 * - **`redirect_to?: string` gibt es nur in 0.9.5.** Es ist hier nicht aufgenommen: es
 *   hat keine Aufrufstelle, und Oberfläche ohne Aufrufstelle ist nur eine weitere
 *   Verpflichtung für P3.
 * - Die übrigen 14 Felder (`icon`, `banner`, `name`, `self`, `pubkey`, `contact`,
 *   `software`, `version`, `negentropy`, `description`, `supported_nips`,
 *   `privacy_policy`, `terms_of_service`, `limitation`) stimmen überein.
 *
 * ── Warum der Wegfall von `url` uns trotzdem nicht trifft ────────────────────────
 * Weil kein Aufrufer ihn liest — und das ist hier nicht behauptet, sondern **vom
 * Typecheck-Tor bewiesen**: der Typ unten schneidet `url` mit `Omit` ausdrücklich weg.
 * Läse irgendeine der drei `Map<string, RelayInfo>`-Flächen (`js/groups.ts`,
 * `js/bridge.ts`, `js/palette.ts`) oder sonst jemand `.url` an einem Relay-Profil,
 * wäre `npm run typecheck` rot. Ein Kommentar, der dasselbe nur behauptet, hält
 * niemanden auf; dieser `Omit` schon. Zur Laufzeit ändert sich nichts — die Objekte
 * tragen ihr `url` weiter, es ist nur nicht mehr zugesagt.
 *
 * ── Was der Sprung hier getan hat ────────────────────────────────────────────────
 * Der `Omit` ist durch den echten `RelayInfo` aus `@welshman/domain` ersetzt. Der
 * Typecheck hat dabei bestätigt, was der `Omit` behauptet hatte: **kein Aufrufer liest
 * `.url` an einem Relay-Profil** — sonst wäre er beim Tausch rot geworden.
 *
 * **Und der zweite Teil, der dabei zu beachten war:** in 0.9.5 ist `Relays` ein
 * `LoadableMapPlugin<Relay>` — die Sammlung liefert die **Klasse** `Relay`
 * (URL + Info + `hasNip()`/`display()`), nicht `RelayInfo`. Die drei
 * `Map<string, RelayInfo>`-Signaturen (`js/groups.ts`, `js/bridge.ts`, `js/palette.ts`)
 * treffen dort also `Relay`.
 *
 * Die `Relay`-Klasse ist hier NICHT nachgebildet: `js/relayCaps.ts` löst dieselben
 * Fragen absichtlich welshman-frei, damit es ohne Runtime unter `node --test` läuft
 * (steht so in seinem Kopf), und der Plan hat den Tausch geprüft und verworfen.
 *
 * Das `ManagementMethod`-Enum von 0.8.16 steht bewusst nicht mehr hier: in 0.9.5 ist
 * eine NIP-86-Methode ein schlichter String hinter `ManagementApi` — siehe
 * `js/welshmanApp.ts`.
 *
 * **Diese Datei importiert ausschliesslich `@welshman/domain`.**
 */
/** Das NIP-11-Info-Dokument. Seit dem Sprung der echte Typ aus `@welshman/domain`. */
export type { RelayInfo } from '@welshman/domain'
