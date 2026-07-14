/**
 * M3 P0 — Lokale Persistenz der welshman-`repository` (Kaltstart-Cache).
 *
 * Die welshman-`repository`/`tracker` sind reine In-Memory-Singletons; jeder
 * Kaltstart (Mobile-App-Start UND Web-Reload) lädt alle Events neu vom member-
 * only-Relay hinter NIP-42-AUTH — das sind die ~13 s. Dieser Modul spiegelt die
 * gecachten Events VOR dem ersten Raum-`setup()` in die `repository` zurück →
 * der bestehende Warm-Pfad malt instant, nur Deltas gehen übers Netz.
 *
 * Portiert schlank aus `flotilla/src/app/storage.ts`, aber gegen ROHE IndexedDB
 * (Muster `secure-storage.ts`) statt der `idb`-Dependency — keine neue Dep.
 *
 * ponytail: iOS-WKWebView läuft mit `WKWebsiteDataStore.nonPersistent()` (vendored,
 * gitignorierte NativePHP-Shell) → IndexedDB dort ephemer, Cache pro Kaltstart weg.
 * Scope von M3 ist Web + Android. Upgrade-Pfad für iOS-Durability: NativePHP-Flag
 * für `WKWebsiteDataStore.default()` ODER nativer On-Device-SQLite-Bridge-Cache.
 */
import { pubkey, repository, tracker } from '@welshman/app'
import { on, batch } from '@welshman/lib'
import {
    verifiedSymbol,
    PROFILE,
    FOLLOWS,
    DELETE,
    MESSAGE,
    POLL,
    ZAP_GOAL,
    MUTES,
    RELAYS,
    RELAY_MEMBERS,
    APP_DATA,
    ROOM_META,
    ROOM_ADMINS,
    ROOM_MEMBERS,
    type TrustedEvent,
} from '@welshman/util'
import type { RepositoryUpdate } from '@welshman/net'

const DB_NAME = 'einundzwanzig-cache'
const DB_VERSION = 1

type StoreName = 'events' | 'tracker' | 'meta'

/** id→relays-Zeile im `tracker`-Store (Set ist nicht structured-clone-freundlich). */
type TrackerItem = { id: string; relays: string[] }

/**
 * §4.1 Whitelist — was gecacht wird: Chat (MESSAGE=9, der 13-s-Treiber) +
 * bounded Control-Plane (Profile/Follows/Relays/Room-Meta/Member-Listen) +
 * kind 5 (DELETE, zwingend — sonst reappearen gelöschte Nachrichten). §4.2 raus:
 * Ephemeral/AUTH/Reaktionen/Zaps/Kommentare (kein `#h`, laden lazy nach dem Paint).
 *
 * ponytail: nur MESSAGE wächst unbegrenzt → Per-Raum-Cap + Alters-Backstop folgt
 * in P2 (§4.3). Bis dahin lädt/persistiert der Filter alles Whitelisted ungekappt.
 */
const PERSIST_KINDS = new Set<number>([
    MESSAGE,
    DELETE,
    POLL,
    ZAP_GOAL,
    PROFILE,
    FOLLOWS,
    MUTES,
    RELAYS,
    RELAY_MEMBERS,
    APP_DATA,
    ROOM_META,
    ROOM_ADMINS,
    ROOM_MEMBERS,
])

export function shouldPersistEvent(event: TrustedEvent): boolean {
    return PERSIST_KINDS.has(event.kind)
}

/**
 * §4.3 Pruning — NUR kind 9 wächst unbegrenzt (Control-Plane ist replaceable → selbst-
 * bounded, kein Cap). Per-Raum die neuesten N behalten + Alters-Backstop als harte
 * Obergrenze (fängt zugleich tombstone-lose Relay-Purges, §6). Kein LRU-Framework.
 */
const MSG_CAP_PER_ROOM = 300
const MSG_MAX_AGE_SEC = 30 * 24 * 60 * 60 // 30 Tage

const nowSec = (): number => Math.floor(Date.now() / 1000)

/**
 * Gibt die zu VERWERFENDEN kind-9-event-ids zurück: pro Raum (`#h`) alles jenseits der
 * neuesten `cap`, plus alles älter als `maxAgeSec`. Control-Plane bleibt unangetastet.
 * Reine Funktion (now/Cap injizierbar) → deterministisch node-testbar.
 */
export function messagesToPrune(
    events: TrustedEvent[],
    now: number,
    cap = MSG_CAP_PER_ROOM,
    maxAgeSec = MSG_MAX_AGE_SEC,
): string[] {
    const cutoff = now - maxAgeSec
    const byRoom = new Map<string, TrustedEvent[]>()
    const drop: string[] = []
    for (const event of events) {
        if (event.kind !== MESSAGE) {
            continue
        }
        if (event.created_at < cutoff) {
            drop.push(event.id)
            continue
        }
        const h = event.tags.find((tag) => tag[0] === 'h')?.[1]
        if (!h) {
            continue // kind-9 ohne #h ist nicht pro Raum kappbar → in Ruhe lassen
        }
        const arr = byRoom.get(h)
        if (arr) {
            arr.push(event)
        } else {
            byRoom.set(h, [event])
        }
    }
    for (const arr of byRoom.values()) {
        if (arr.length <= cap) {
            continue
        }
        arr.sort((a, b) => b.created_at - a.created_at) // neueste zuerst
        for (const event of arr.slice(cap)) {
            drop.push(event.id)
        }
    }
    return drop
}

// ── Rohe IndexedDB (Muster secure-storage.ts) ──────────────────────────────
//
// P4 Robustheit: ALLE IDB-Zugriffe sind fail-soft. Bei Quota/Eviction/Privacy-Mode/
// fehlendem IndexedDB (iOS-nonPersistent-WebView reagiert nicht so, aber ein
// gesperrter/voller Store schon) degradiert jeder Helfer still — Reads → leer,
// Writes → No-op — statt zu rejecten. So kann KEIN Storage-Fehler (weder am Boot
// noch im Live-Sync als unhandled rejection) je den Chat brechen: er fällt auf das
// heutige reine Relay-Laden zurück. Der Fehler wird EINMAL geloggt (kein Spam).

let dbPromise: Promise<IDBDatabase> | null = null
let storageWarned = false

function onStorageError(error: unknown): void {
    if (!storageWarned) {
        storageWarned = true
        console.warn('[cache] IndexedDB nicht verfügbar → Fallback auf reines Relay-Laden', error)
    }
}

function connect(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION)
            req.onupgradeneeded = () => {
                const db = req.result
                db.createObjectStore('events', { keyPath: 'id' })
                db.createObjectStore('tracker', { keyPath: 'id' })
                db.createObjectStore('meta', { keyPath: 'key' })
            }
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
    }
    return dbPromise
}

async function getAll<T>(store: StoreName): Promise<T[]> {
    try {
        const db = await connect()
        return await new Promise<T[]>((resolve, reject) => {
            const req = db.transaction(store, 'readonly').objectStore(store).getAll()
            req.onsuccess = () => resolve(req.result as T[])
            req.onerror = () => reject(req.error)
        })
    } catch (error) {
        onStorageError(error)
        return []
    }
}

async function bulkPut<T>(store: StoreName, items: T[]): Promise<void> {
    if (items.length === 0) {
        return
    }
    try {
        const db = await connect()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite')
            const os = tx.objectStore(store)
            for (const item of items) {
                os.put(item)
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (error) {
        onStorageError(error)
    }
}

async function bulkDelete(store: StoreName, ids: Iterable<string>): Promise<void> {
    const arr = Array.from(ids)
    if (arr.length === 0) {
        return
    }
    try {
        const db = await connect()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite')
            const os = tx.objectStore(store)
            for (const id of arr) {
                os.delete(id)
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (error) {
        onStorageError(error)
    }
}

async function clearStore(store: StoreName): Promise<void> {
    try {
        const db = await connect()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite')
            tx.objectStore(store).clear()
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (error) {
        onStorageError(error)
    }
}

async function metaGet(key: string): Promise<string | undefined> {
    try {
        const db = await connect()
        return await new Promise<string | undefined>((resolve, reject) => {
            const req = db.transaction('meta', 'readonly').objectStore('meta').get(key)
            req.onsuccess = () => resolve((req.result as { key: string; value: string } | undefined)?.value)
            req.onerror = () => reject(req.error)
        })
    } catch (error) {
        onStorageError(error)
        return undefined
    }
}

const metaSet = (key: string, value: string): Promise<void> => bulkPut('meta', [{ key, value }])

// ── Load (Boot) + Sync (live) ──────────────────────────────────────────────

/**
 * `repository.load()` genau EINMAL am Boot: getAll → `verifiedSymbol` neu setzen
 * (symbol-Property überlebt structured-clone nicht → sonst unnötige Schnorr-Re-
 * Verifikation) → Whitelist-Fremdkörper verwerfen. `load` ist destruktiv (leert
 * alle Indizes zuerst) → MUSS vor dem ersten Insel-`publish` laufen (P1-Gate).
 */
async function loadCachedEvents(): Promise<void> {
    const cached = await getAll<TrustedEvent>('events')
    const keep: TrustedEvent[] = []
    const drop: string[] = []
    for (const event of cached) {
        if (shouldPersistEvent(event)) {
            event[verifiedSymbol] = true
            keep.push(event)
        } else {
            drop.push(event.id)
        }
    }
    // §4.3: gekappte/veraltete Nachrichten weder in die repository laden noch behalten.
    const prune = new Set(messagesToPrune(keep, nowSec()))
    repository.load(keep.filter((event) => !prune.has(event.id)))
    const remove = [...drop, ...prune]
    if (remove.length > 0) {
        void bulkDelete('events', remove)
    }
}

/**
 * Tracker (Event→Relay-Herkunft) zwingend mitladen — sonst rendern die url-
 * gescopten Ableitungen (Raum-Feed) LEER trotz gefülltem Repository. Einträge
 * ohne zugehöriges (geladenes) Event sind stale → verwerfen.
 */
async function loadCachedTracker(): Promise<void> {
    const relaysById = new Map<string, Set<string>>()
    const stale: string[] = []
    for (const { id, relays } of await getAll<TrackerItem>('tracker')) {
        if (!repository.getEvent(id)) {
            stale.push(id)
            continue
        }
        relaysById.set(id, new Set(relays))
    }
    tracker.load(relaysById)
    if (stale.length > 0) {
        void bulkDelete('tracker', stale)
    }
}

/** Inkrementelle Event-Persistenz: `added`→bulkPut (whitelisted), `removed`→bulkDelete. */
function syncEvents(): () => void {
    return on(
        repository,
        'update',
        batch(3000, async (updates: RepositoryUpdate[]) => {
            const add: TrustedEvent[] = []
            const remove = new Set<string>()
            for (const update of updates) {
                for (const event of update.added) {
                    if (shouldPersistEvent(event)) {
                        add.push(event)
                        remove.delete(event.id)
                    }
                }
                for (const id of update.removed) {
                    remove.add(id)
                }
            }
            await bulkPut('events', add)
            await bulkDelete('events', remove)
            // §4.3: nach neuen Nachrichten den (bounded) Store per-Raum kappen. Der
            // events-Store ist durchs Cap selbst begrenzt → getAll bleibt günstig.
            if (add.some((event) => event.kind === MESSAGE)) {
                const prune = messagesToPrune(await getAll<TrustedEvent>('events'), nowSec())
                if (prune.length > 0) {
                    await bulkDelete('events', prune)
                }
            }
        }),
    )
}

/** Inkrementelle Tracker-Persistenz (add/remove/load/clear → events-Store spiegeln). */
function syncTracker(): () => void {
    const persistIds = async (ids: Iterable<string>): Promise<void> => {
        const items: TrackerItem[] = []
        for (const id of ids) {
            const event = repository.getEvent(id)
            if (!event || !shouldPersistEvent(event)) {
                continue
            }
            const relays = Array.from(tracker.getRelays(id))
            if (relays.length > 0) {
                items.push({ id, relays })
            }
        }
        await bulkPut('tracker', items)
    }
    const deleteIds = (ids: Iterable<string>): Promise<void> => bulkDelete('tracker', Array.from(ids))

    const onAdd = batch(3000, (ids: string[]) => void persistIds(ids))
    const onRemove = batch(3000, (ids: string[]) => void deleteIds(ids))
    const onLoad = () => void persistIds(tracker.relaysById.keys())
    const onClear = () => void deleteIds(Array.from(tracker.relaysById.keys()))

    tracker.on('add', onAdd)
    tracker.on('remove', onRemove)
    tracker.on('load', onLoad)
    tracker.on('clear', onClear)

    return () => {
        tracker.off('add', onAdd)
        tracker.off('remove', onRemove)
        tracker.off('load', onLoad)
        tracker.off('clear', onClear)
    }
}

let stopSyncFn: (() => void) | null = null

function startSync(): void {
    if (stopSyncFn) {
        return
    }
    const unEvents = syncEvents()
    const unTracker = syncTracker()
    stopSyncFn = () => {
        unEvents()
        unTracker()
    }
}

// ── Öffentliche API ────────────────────────────────────────────────────────

/**
 * Alle Stores leeren + Live-Sync abmelden (aus `session.ts logout()`, P3).
 *
 * Reihenfolge ist sicherheitsrelevant: ERST die Daten (events/tracker), DANN der
 * `owner`-Marker (meta). Der Logout feuert dies mobil UNGEAWAITED direkt vor
 * `window.location.assign` — wird der Clear vom Reload unterbrochen, darf NIE der
 * Zustand „Daten da + owner weg" zurückbleiben: der würde den Owner-Gate in
 * initStorage aushebeln (`if (owner && owner !== pk)` → owner falsy → kein Clear)
 * und fremde member-only-Räume an den nächsten Account/Gast leaken. Data-first
 * heißt: jeder Teilabbruch ist sicher (owner überlebt → Gate greift beim Re-Login).
 */
export async function clearCache(): Promise<void> {
    stopSyncFn?.()
    stopSyncFn = null
    await Promise.all([clearStore('events'), clearStore('tracker')])
    await clearStore('meta')
}

let started = false

/** Aufgelöst = Boot-Load fertig; wie `authReady` modulweit, einmal ausgewertet. */
export let storageReady: Promise<void> = Promise.resolve()

/**
 * Idempotenter Boot-Einstieg (aus `core.ts`, P1). Lädt den Cache NUR für den
 * eingeloggten, passenden pubkey (Gast lädt nichts; fremder Cache → clear —
 * Multi-Account-Isolation, §4.4). Jeder IDB-Fehler fällt still auf reines Relay-
 * Laden zurück (heutiges Verhalten) — der Chat bricht nie am Cache.
 */
export function initStorage(): void {
    if (started) {
        return
    }
    started = true
    storageReady = (async () => {
        try {
            // Dynamischer Import: `session.ts` bindet beim Modul-Eval localStorage —
            // so bleibt die reine Cache-Logik (shouldPersistEvent) node-/testbar und
            // der (in P1) von `core.ts` gezogene Import zirkelfrei.
            const { authReady } = await import('./session')
            await authReady
            const pk = pubkey.get()
            if (!pk) {
                return // Gast → keinen member-only-Cache laden
            }
            const owner = await metaGet('owner')
            if (owner && owner !== pk) {
                await clearCache() // fremder Cache → weg, bevor wir laden
            }
            await loadCachedEvents()
            await loadCachedTracker()
            await metaSet('owner', pk)
            startSync() // Live-Persistenz erst NACH dem destruktiven load()
        } catch (error) {
            console.warn('[cache] init fehlgeschlagen, Fallback auf Relay-Laden', error)
        }
    })()
}
