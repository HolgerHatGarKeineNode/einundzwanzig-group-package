/**
 * Store-über-Repository-Layer — portiert aus dem Referenz-Client (`src/app/repository.ts`)
 * (nur die für M3/Directory nötigen Ableitungen).
 *
 * `deriveRelaySignedEvents` ist der Kern des Space-Directorys: es filtert Events
 * auf `pubkey === relay.self` — nur der Relay selbst signiert die autoritative
 * Mitglieder-/Rollenliste (13534/33534). `relay.self` stammt aus NIP-11
 * (`deriveRelay` → HTTP-Fetch). Solange NIP-11 nicht geladen ist, ist
 * `relay.self === undefined` und der Filter liefert leer — das ist das bekannte
 * „No members"-Flackern (Instabilität A). Die Insel gated deshalb auf
 * `relaySelfReady` statt blind die leere Liste zu rendern (siehe members.ts).
 */
import { derived, type Readable } from 'svelte/store'
import { deriveArray, deriveEventsByIdForUrl } from '@welshman/store'
import { deriveRelay, repository, tracker } from '@welshman/app'
import { filter, spec } from '@welshman/lib'
import type { Filter, TrustedEvent } from '@welshman/util'

/** Alle Events eines Space-Relays (nach Herkunft via tracker) zu einem Filter. */
export const deriveEventsForUrl = (url: string, filters: Filter[] = [{}]): Readable<TrustedEvent[]> =>
    deriveArray(deriveEventsByIdForUrl({ url, tracker, repository, filters }))

/** Nur die relay-signierten Events (`pubkey === relay.self`) eines Space. */
export const deriveRelaySignedEvents = (url: string, filters: Filter[] = [{}]): Readable<TrustedEvent[]> =>
    derived([deriveRelay(url), deriveEventsForUrl(url, filters)], ([relay, events]) =>
        filter(spec({ pubkey: relay?.self }), events),
    )

/**
 * Fix A: ist `relay.self` (NIP-11) bereits aufgelöst? `deriveRelay` triggert den
 * NIP-11-Fetch selbst; hier wird nur reaktiv gemeldet, ob `self` schon da ist,
 * damit die UI bis dahin einen Skeleton statt „keine Mitglieder" zeigt.
 */
export const deriveRelaySelfReady = (url: string): Readable<boolean> =>
    derived(deriveRelay(url), (relay) => Boolean(relay?.self))
