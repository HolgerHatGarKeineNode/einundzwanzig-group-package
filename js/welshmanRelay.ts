/**
 * Adapter: Relay-Typen aus `@welshman/util` (NIP-11, NIP-86).
 *
 * **Warum diese Datei existiert.** `RelayProfile` (die NIP-11-Antwort) und
 * `ManagementMethod` (das NIP-86-Methoden-Enum) verschwinden in 0.9.5 aus
 * `@welshman/util`; dort liegt die Relay-Beschreibung in einer `Relay`-Klasse.
 *
 * **Reine Durchreiche.** Die Stores und Lader zu Relays (`relaysByUrl`, `deriveRelay`,
 * `manageRelay`, …) kommen aus `@welshman/app` und stehen in `js/welshmanApp.ts` — die
 * Trennung folgt dem Quellpaket, siehe `js/welshmanTags.ts`.
 *
 * **Diese Datei importiert ausschließlich `@welshman/util`.**
 */
export type { RelayProfile } from '@welshman/util'
export { ManagementMethod } from '@welshman/util'
