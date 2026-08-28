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
import { deriveArray, deriveEventsByIdByUrl, deriveEventsByIdForUrl } from '@welshman/store'
import { app, Relays } from './welshmanApp.ts'
import { filter, spec } from '@welshman/lib'
import { normalizeRelayUrl, type Filter, type TrustedEvent } from '@welshman/util'

/** Alle Events eines Space-Relays (nach Herkunft via tracker) zu einem Filter. */
export const deriveEventsForUrl = (url: string, filters: Filter[] = [{}]): Readable<TrustedEvent[]> =>
    deriveArray(deriveEventsByIdForUrl({ url, tracker: app.tracker, repository: app.repository, filters }))

/**
 * Wie {@link deriveEventsForUrl}, aber über MEHRERE Herkunfts-Relays — dedupliziert über
 * die Event-Id.
 *
 * ── Warum eine zweite Primitive und kein Umbau der ersten ───────────────────────────
 *
 * {@link deriveEventsForUrl} hat **28 Aufrufstellen außerhalb dieser Datei** (gezählt am
 * 2026-08-21 über beide Repos, verteilt auf elf Module), und jede einzelne kommt mit
 * genau einem Relay aus. Sie zu verbreitern hieße, 28 gedeckte Aufrufe für einen einzigen
 * neuen Verbraucher anzufassen. Diese Funktion steht deshalb daneben; die bestehende
 * bleibt Zeichen für Zeichen, wie sie war.
 *
 * ── Warum die Deduplizierung nichts kostet ─────────────────────────────────────────
 *
 * Ein Ereignis, das auf drei Relays liegt, hat **genau eine Id** — es wurde genau einmal
 * signiert. `deriveEventsByIdByUrl` liefert `Map<url, Map<id, event>>`; das Zusammenlegen
 * in EINE `Map<id, event>` ist die Deduplizierung, nicht ein Schritt danach. Der `tracker`
 * führt dabei dasselbe Event unter jeder Herkunft, aus der es hereinkam.
 *
 * ── Die Kaltstart-Kante, ausdrücklich benannt ──────────────────────────────────────
 *
 * Dieser Pfad ist **blind für jedes Ereignis ohne Herkunftszeile im `tracker`**. Das ist
 * ein realer Zustand, kein theoretischer: `js/storage.ts` lädt den `tracker` aus IndexedDB
 * zurück, und welshmans `tracker.load()` leert dabei beide Maps destruktiv. Da `COMMENT`
 * (1111) in `PERSIST_KINDS` steht, 30023 aber bewusst nicht, kann nach einem Reload genau
 * die Mischung vorliegen: Kommentare aus dem Cache, Artikel aus dem Netz. Ein Kommentar
 * ohne Herkunftszeile zählt hier dann **nicht mit** — die Zahl ist zu klein, nie zu groß.
 * Das ist die richtige Richtung für eine Zusage über fremde Ereignisse, aber es ist eine
 * Einschränkung und keine Selbstverständlichkeit.
 *
 * `urls` wird normalisiert, weil der `tracker` normalisierte URLs führt: ein
 * `wss://nos.lol` ohne Schrägstrich fände sonst lautlos nichts.
 */
export const deriveEventsForUrls = (urls: string[], filters: Filter[] = [{}]): Readable<TrustedEvent[]> => {
    const gesucht = urls.map(normalizeRelayUrl)

    return derived(deriveEventsByIdByUrl({ tracker: app.tracker, repository: app.repository, filters }), ($byUrl) => {
        const nachId = new Map<string, TrustedEvent>()
        for (const url of gesucht) {
            const byId = $byUrl.get(url)
            if (byId) {
                for (const [id, event] of byId) {
                    nachId.set(id, event)
                }
            }
        }

        return [...nachId.values()]
    })
}

/** Nur die relay-signierten Events (`pubkey === relay.self`) eines Space. */
export const deriveRelaySignedEvents = (url: string, filters: Filter[] = [{}]): Readable<TrustedEvent[]> =>
    derived([app.use(Relays).one(url), deriveEventsForUrl(url, filters)], ([relay, events]) =>
        filter(spec({ pubkey: relay?.self }), events),
    )

/**
 * Fix A: ist `relay.self` (NIP-11) bereits aufgelöst? `deriveRelay` triggert den
 * NIP-11-Fetch selbst; hier wird nur reaktiv gemeldet, ob `self` schon da ist,
 * damit die UI bis dahin einen Skeleton statt „keine Mitglieder" zeigt.
 */
export const deriveRelaySelfReady = (url: string): Readable<boolean> =>
    derived(app.use(Relays).one(url), (relay) => Boolean(relay?.self))
