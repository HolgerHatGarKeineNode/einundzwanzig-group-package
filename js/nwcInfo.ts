/**
 * Stored NWC wallet info ↔ `@getalby/sdk` client options — the pure half of
 * `wallet.ts`, kept apart because `wallet.ts` pulls the welshman session on import.
 *
 * **Why this exists: two shapes are on disk.** Up to `@getalby/sdk` 6 the client took
 * a single `relayUrl`; since 7 it takes `relayUrls: string[]` and ignores `relayUrl`
 * completely (a client built from an old record has `relayUrls === undefined` and
 * cannot reach the wallet). Every wallet connected before the update is stored as
 * the old `client.options` and must keep working without a reconnect. welshman's
 * `NWCInfo` type and the wallet page still read `relayUrl`, so new records carry
 * both fields.
 */
import type { NWCInfo } from '@welshman/util'

/** What is stored: welshman's `NWCInfo`, plus the relay list of sdk 7+ when present. */
export type StoredNwcInfo = NWCInfo & { relayUrls?: string[] }

/** The subset of `NWCClient` options this package passes in. */
export type NwcClientOptions = { relayUrls: string[]; walletPubkey: string; secret?: string; lud16?: string }

/**
 * Client options from a stored record, old or new. `relayUrls` wins when it is a
 * non-empty list; otherwise the single legacy `relayUrl` becomes a one-entry list.
 * An empty result means the record names no relay at all — the caller refuses it
 * instead of building a client that silently talks to nobody.
 *
 * The rest of the record passes through untouched, as before the update.
 * `nostrWalletConnectUrl` is dropped: given that field, the client re-parses the URL,
 * and sdk 8+ rejects URLs it used to accept (non-hex secret) — the decoded fields
 * next to it are what the wallet has been working with.
 */
export const nwcClientOptions = (info: StoredNwcInfo): NwcClientOptions => {
    const { relayUrl, relayUrls, nostrWalletConnectUrl, ...rest } = info
    const relays = Array.isArray(relayUrls) && relayUrls.length > 0 ? relayUrls : relayUrl ? [relayUrl] : []
    return { ...rest, relayUrls: relays }
}

/**
 * The record to store for a freshly connected client: its options as they are, plus
 * `relayUrl` = the first relay, which welshman's `NWCInfo` and the wallet page read.
 */
export const storedNwcInfo = <T extends { relayUrls: string[] }>(options: T): StoredNwcInfo =>
    ({ ...options, relayUrl: options.relayUrls[0] ?? '' }) as unknown as StoredNwcInfo
