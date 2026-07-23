/**
 * Lesestand — Ungelesen-Wasserzeichen pro Raum und pro Thread.
 *
 * Format exakt nach `docs/plans/2026-07-22T2222-benachrichtigungen-ungelesen/
 * datenmodell-ungelesen.md` (Key-Raum, Grow-only-Max-Merge, Prune-Verhalten), aber in
 * dieser Phase (P3) **rein lokal**: es verlässt kein einziges Event das Gerät. Der
 * Publish-Pfad (kind 30078, nip44-self-verschlüsselt, an die Outbox) ist P6 und hier
 * bewusst NICHT gebaut — deshalb steht `READ_STATE_D` schon hier, aber kein
 * `publishThunk`. Das Format ist ab Tag 1 richtig; P6 ist dann ein Schalter, kein Umbau.
 *
 * Wasserzeichen = **Wall-Clock des lesenden Geräts**, nicht `created_at` des jüngsten
 * Events. `created_at` ist autorgesetzt (NIP-01): EIN Event mit `created_at = now + 1y`
 * quittiert sonst alles bis 2027 als gelesen. Genau das tut der Altcode
 * (`bridge.ts markRead()`), und genau das endet hier.
 *
 * Die reinen Funktionen oben ziehen weder welshman noch Browser-Globals — sie laufen
 * unter `node --test` (siehe `readState.test.ts`, Muster `roomCategories.ts`). Alles
 * Unreine (IndexedDB, localStorage, BroadcastChannel) liegt darunter und ist fail-soft:
 * ein Speicherfehler darf nie einen Chat-Flow brechen, er kostet höchstens Lesestand.
 */
import { get, writable, type Readable } from 'svelte/store'
import { pubkey } from '@welshman/app'

/** NIP-78-`d`-Tag des (erst in P6 publizierten) kind-30078. Hier nur die Format-Zusage. */
export const READ_STATE_D = 'einundzwanzig/read-state/v1'

/**
 * Flacher Key-Raum:
 *   'all'             globales Wasserzeichen („alles gelesen")
 *   `r:${url}|${h}`   Raum (url = normalisierte Space-Relay-URL, h = NIP-29-Group-ID)
 *   `t:${rootId}`     Thread (rootId = 64-hex Event-ID der Wurzel, NIP-22 `E`)
 */
export type ReadKey = 'all' | `r:${string}|${string}` | `t:${string}`

/** key → Unix-Sekunden (Wall-Clock des Geräts, das gelesen hat). */
export type ReadState = Record<string, number>

export const ALL_KEY: ReadKey = 'all'

export const roomKey = (url: string, h: string): ReadKey => `r:${url}|${h}`
export const threadKey = (rootId: string): ReadKey => `t:${rootId}`

/** Obergrenze der Karte; hält das (spätere) 30078 klein und die IDB bounded. */
export const READ_STATE_CAP = 500

const nowSec = (): number => Math.floor(Date.now() / 1000)

// ── Reine Funktionen (node-testbar) ────────────────────────────────────────

/**
 * Grow-only-Max-Merge (CvRDT). Kommutativ, assoziativ, idempotent → die Reihenfolge,
 * in der lokaler Spiegel, Zweit-Tab und (ab P6) das Relay-Event zusammenkommen, ist
 * egal. Ein „letztes Event gewinnt"-Replaceable ist damit unschädlich, solange vor
 * jedem Schreiben gemergt wird.
 */
export function mergeReadState(a: ReadState, b: ReadState): ReadState {
    const out: ReadState = { ...a }
    for (const [key, ts] of Object.entries(b)) {
        const prev = out[key]
        if (prev === undefined || ts > prev) {
            out[key] = ts
        }
    }
    return out
}

/**
 * Zwei Schritte, in dieser Reihenfolge:
 *   1. von `all` dominierte Keys (`ts <= all`) fallen raus — sie tragen keine
 *      Information mehr, weil {@link roomWatermark}/{@link threadWatermark} ohnehin
 *      auf `all` zurückfallen;
 *   2. was übrig bleibt, wird hart auf die `cap` jüngsten Keys gekappt.
 *
 * `all` selbst ist von beidem ausgenommen und überlebt immer — es ist der Boden, gegen
 * den alles andere gemessen wird. Verlust durch die Kappung geht immer in die Richtung
 * „zu wenig gelesen" (der Raum fällt auf `all` zurück), nie in „fälschlich gelesen".
 */
export function pruneReadState(state: ReadState, cap = READ_STATE_CAP): ReadState {
    const all = state[ALL_KEY]
    const floor = all ?? 0
    const kept = Object.entries(state).filter(([key, ts]) => key !== ALL_KEY && ts > floor)
    if (kept.length > cap) {
        kept.sort((a, b) => b[1] - a[1]) // jüngste zuerst
        kept.length = cap
    }
    const out: ReadState = {}
    if (all !== undefined) {
        out[ALL_KEY] = all
    }
    for (const [key, ts] of kept) {
        out[key] = ts
    }
    return out
}

/**
 * Effektives Raum-Wasserzeichen.
 *
 * **Raum und Thread sind NICHT hierarchisch gekoppelt — das ist Absicht, nicht eine
 * vergessene Vereinfachung.** Flotilla matcht per Pfad-Präfix
 * (`flotilla/src/app/notifications.ts:191-203`), dort quittiert Raum-Lesen alles
 * darunter mit. Bei uns leben Thread-Kommentare (kind 1111) NICHT im Raum-Feed
 * (`feeds.ts` zieht sie über einen eigenen, `#h`-losen Filter) — wer den Raum bis unten
 * liest, hat die Kommentare also nachweislich NICHT gesehen. Ein „vereinfachtes"
 * `roomWatermark` als Boden für Threads würde ungelesene Antworten stumm schalten.
 * Nur `all` dominiert beides.
 */
export const roomWatermark = (state: ReadState, url: string, h: string): number =>
    Math.max(state[ALL_KEY] ?? 0, state[roomKey(url, h)] ?? 0)

/** Effektives Thread-Wasserzeichen. Siehe {@link roomWatermark} zur Nicht-Kopplung. */
export const threadWatermark = (state: ReadState, rootId: string): number =>
    Math.max(state[ALL_KEY] ?? 0, state[threadKey(rootId)] ?? 0)

/** Präfix des Alt-Lesestands aus `feeds.ts` (`room:lastread:${url}:${h}`, localStorage). */
export const LEGACY_LASTREAD_PREFIX = 'room:lastread:'

export const isLegacyLastReadKey = (key: string): boolean => key.startsWith(LEGACY_LASTREAD_PREFIX)

/**
 * Alt-Lesestand → neuer Key-Raum. Rein: nimmt die localStorage-Paare (Fremdschlüssel
 * werden ignoriert) und liefert die neuen `r:${url}|${h}`-Keys; die unreine Hülle
 * {@link readLegacyLastRead} liest/löscht den Speicher.
 *
 * Semantik-Wechsel dabei bewusst: der Altwert ist ein `created_at`, der neue eine
 * Wall-Clock — beide sind Unix-Sekunden derselben Größenordnung. Zusammengeführt wird
 * mit `Math.max`, weil das die konservative Richtung ist: im Zweifel gilt zu viel als
 * gelesen, nie entsteht ein Fehl-Badge. Ein einmal zu weit gesetztes Wasserzeichen
 * kostet höchstens eine verpasste Meldung; ein zu niedriges meldet dauerhaft falsch.
 */
export function migrateLegacyLastRead(entries: Iterable<readonly [string, unknown]>): ReadState {
    const out: ReadState = {}
    for (const [key, raw] of entries) {
        if (!isLegacyLastReadKey(key)) {
            continue
        }
        const rest = key.slice(LEGACY_LASTREAD_PREFIX.length)
        // Die URL enthält selbst Doppelpunkte (`wss://…`), die Gruppen-ID nicht
        // → am LETZTEN Doppelpunkt trennen, nicht am ersten.
        const cut = rest.lastIndexOf(':')
        if (cut <= 0 || cut === rest.length - 1) {
            continue
        }
        const ts = Number(raw)
        if (!Number.isFinite(ts) || ts <= 0) {
            continue
        }
        const target = roomKey(rest.slice(0, cut), rest.slice(cut + 1))
        out[target] = Math.max(out[target] ?? 0, Math.floor(ts))
    }
    return out
}

/**
 * Was muss geschrieben, was gelöscht werden, um `snapshot` wiederherzustellen?
 *
 * Rein und damit node-testbar — die unreine Hülle ist {@link restoreReadState}. Die
 * Momentaufnahme wird durch {@link sanitizeReadState} gedreht: sie kommt aus einem
 * Alpine-Puffer, ist also potenziell ein Proxy mit fremden Werten und darf so weder in
 * den Store noch in die IndexedDB (`structuredClone` eines Proxys endet in
 * `DataCloneError`).
 *
 * `removed` = alles, was der aktuelle Stand hat und die Momentaufnahme nicht. Genau
 * diese Keys müssen AUCH aus der IDB, sonst stünden sie beim nächsten Start wieder da
 * und das Rückgängig wäre nach einem Reload verschwunden.
 */
export function readStateRestorePlan(current: ReadState, snapshot: ReadState): { next: ReadState; removed: string[] } {
    const next = sanitizeReadState(snapshot)
    return { next, removed: Object.keys(current).filter((key) => next[key] === undefined) }
}

/**
 * Fremde Karte (Zweit-Tab per BroadcastChannel; ab P6 der entschlüsselte 30078-Inhalt)
 * auf die eigene Form zurechtstutzen: nur endliche positive Zahlen unter plausibel
 * kurzen Keys überleben. Nichts davon darf ungeprüft in den Store — ein `NaN` würde
 * jeden späteren `Math.max` vergiften.
 */
export function sanitizeReadState(input: unknown): ReadState {
    const out: ReadState = {}
    if (!input || typeof input !== 'object') {
        return out
    }
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (key.length === 0 || key.length > 256) {
            continue
        }
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            continue
        }
        out[key] = Math.floor(value)
    }
    return out
}

// ── Lokaler Spiegel: EIGENE IndexedDB pro pubkey ───────────────────────────
//
// Die Spezifikation sah einen zusätzlichen Objectstore in der BESTEHENDEN pubkey-DB
// aus `storage.ts` vor. Am Host-Chromium nachgemessen (2026-07-23) — das geht nicht:
//   • Ein zweites `open(name, 1)` feuert `onupgradeneeded` NICHT
//     (`{upgraded:false, stores:["events"]}`) → ohne Versionssprung kein neuer Store.
//   • Ein `open(name, 2)` bei OFFENER v1-Verbindung endet in `onblocked`
//     (`{blocked:true}`) und löst sich nie auf. `storage.ts` hält seine Verbindung
//     für die gesamte Sitzung offen und behandelt kein `versionchange` → der Upgrade
//     würde im selben Tab gegen den Cache verklemmen.
// Deshalb eine eigene DB `einundzwanzig-readstate-<pubkey>`: gleiche Isolations-Zusage
// (eine DB pro Account, Gast öffnet keine), aber kein Versions-Tanz mit dem Cache.
//
// Zeilen statt einer Gesamtkarte (`{key, ts}` mit keyPath `key`), damit zwei Tabs sich
// nicht gegenseitig überschreiben: geschrieben wird nur, was sich geändert hat.

const DB_PREFIX = 'einundzwanzig-readstate-'
const DB_VERSION = 1
const STORE = 'readstate'

/** Lokal wird sofort quittiert, aber höchstens alle 2 s in die IDB durchgereicht. */
const FLUSH_DELAY_MS = 2000

type ReadRow = { key: string; ts: number }

let dbName: string | null = null // erst nach Login gesetzt; Gast = null → alles No-op
let dbPromise: Promise<IDBDatabase> | null = null
let storageWarned = false

function onStorageError(error: unknown): void {
    if (!storageWarned) {
        storageWarned = true
        console.warn('[readstate] lokaler Spiegel nicht verfügbar — Lesestand bleibt flüchtig', error)
    }
}

function connect(): Promise<IDBDatabase> {
    if (!dbName) {
        return Promise.reject(new Error('readstate: kein pubkey'))
    }
    if (!dbPromise) {
        const name = dbName
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(name, DB_VERSION)
            req.onupgradeneeded = () => {
                req.result.createObjectStore(STORE, { keyPath: 'key' })
            }
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
    }
    return dbPromise
}

async function readRows(): Promise<ReadState> {
    const out: ReadState = {}
    try {
        const db = await connect()
        const rows = await new Promise<ReadRow[]>((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
            req.onsuccess = () => resolve(req.result as ReadRow[])
            req.onerror = () => reject(req.error)
        })
        for (const row of rows) {
            if (typeof row?.key === 'string' && typeof row?.ts === 'number' && Number.isFinite(row.ts)) {
                out[row.key] = row.ts
            }
        }
    } catch (error) {
        onStorageError(error)
    }
    return out
}

/** `true` = wirklich geschrieben. Nur dann darf der Altbestand gelöscht werden. */
async function writeRows(rows: ReadRow[]): Promise<boolean> {
    if (rows.length === 0) {
        return true
    }
    try {
        const db = await connect()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite')
            const store = tx.objectStore(STORE)
            for (const row of rows) {
                store.put(row)
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
        return true
    } catch (error) {
        onStorageError(error)
        return false
    }
}

async function deleteRows(keys: string[]): Promise<void> {
    if (!dbName || keys.length === 0) {
        return
    }
    try {
        const db = await connect()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite')
            const store = tx.objectStore(STORE)
            for (const key of keys) {
                store.delete(key)
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (error) {
        onStorageError(error)
    }
}

function deleteDb(name: string): Promise<void> {
    return new Promise((resolve) => {
        try {
            const req = indexedDB.deleteDatabase(name)
            req.onsuccess = () => resolve()
            req.onerror = () => resolve()
            req.onblocked = () => resolve()
        } catch {
            resolve()
        }
    })
}

// ── Alt-Lesestand aus localStorage (unreine Hülle) ─────────────────────────

/** Rohe `room:lastread:*`-Paare + ihre Original-Keys (zum späteren Löschen). */
function readLegacyLastRead(): { state: ReadState; keys: string[] } {
    const keys: string[] = []
    const entries: [string, string | null][] = []
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && isLegacyLastReadKey(key)) {
                keys.push(key)
                entries.push([key, localStorage.getItem(key)])
            }
        }
    } catch (error) {
        onStorageError(error) // Private-Mode/Quota → keine Migration, kein Fehler
    }
    return { state: migrateLegacyLastRead(entries), keys }
}

function dropLegacyLastRead(keys: string[]): void {
    try {
        for (const key of keys) {
            localStorage.removeItem(key)
        }
    } catch {
        // Nicht löschbar ist folgenlos: die Migration ist idempotent (Math.max).
    }
}

// ── Zwei-Tab-Sync ──────────────────────────────────────────────────────────
//
// Der Kanalname trägt den pubkey. Ohne ihn läge er pro ORIGIN, und zwei Tabs mit
// verschiedenen Accounts würden sich gegenseitig Raum-/Thread-IDs in den Store kippen
// — dieselbe Cross-Account-Spur, die `storage.ts` mit einer DB pro pubkey vermeidet.

export const READ_STATE_CHANNEL = 'e21:read-state'

let channel: BroadcastChannel | null = null

function openChannel(pk: string): void {
    // In alten WebViews fehlt BroadcastChannel → nur verzögerte Konvergenz (jeder Tab
    // sieht seinen eigenen Stand, die IDB gleicht beim nächsten Start ab), kein Fehler.
    if (channel || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
        return
    }
    try {
        channel = new BroadcastChannel(`${READ_STATE_CHANNEL}:${pk}`)
        channel.onmessage = (event: MessageEvent) => {
            const data = event.data as { state?: unknown; reset?: boolean } | null
            const patch = sanitizeReadState(data?.state)
            // `reset` = Rückgängig (siehe restoreReadState): ERSETZEN statt mergen. Ein
            // Merge wäre hier wirkungslos — die Momentaufnahme ist überall kleiner oder
            // gleich, `Math.max` behielte jeden Wert. Der Geschwister-Tab zeigte den Raum
            // dann weiter als gelesen an, obwohl der Nutzer das gerade zurückgenommen hat.
            if (data?.reset === true) {
                state.set(patch)
                return
            }
            if (Object.keys(patch).length === 0) {
                return
            }
            // Nur mergen: der sendende Tab hat schon persistiert, beide teilen die DB.
            // Kein Echo zurück → keine Schleife.
            state.update((current) => mergeReadState(current, patch))
        }
    } catch (error) {
        console.warn('[readstate] BroadcastChannel nicht verfügbar — Tabs konvergieren verzögert', error)
    }
}

function broadcast(patch: ReadState, reset = false): void {
    try {
        channel?.postMessage({ state: patch, reset })
    } catch (error) {
        console.warn('[readstate] BroadcastChannel-Sendung fehlgeschlagen', error)
    }
}

// ── Store + Schreibpfad ────────────────────────────────────────────────────

const state = writable<ReadState>({})

/** Die gemergte Wasserzeichen-Karte. Einzige Wahrheitsquelle für „ungelesen". */
export const readState: Readable<ReadState> = { subscribe: state.subscribe }

const dirty = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

async function flush(): Promise<boolean> {
    if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
    }
    if (!dbName || dirty.size === 0) {
        return true
    }
    const keys = Array.from(dirty)
    dirty.clear()
    const current = get(state)
    const rows: ReadRow[] = []
    for (const key of keys) {
        const ts = current[key]
        if (ts !== undefined) {
            rows.push({ key, ts })
        }
    }
    return writeRows(rows)
}

function scheduleFlush(): void {
    if (!dbName || flushTimer) {
        return
    }
    flushTimer = setTimeout(() => {
        flushTimer = null
        void flush()
    }, FLUSH_DELAY_MS)
}

/**
 * Ein Wasserzeichen setzen. **Monoton:** geschrieben wird `Math.max(alt, ts)` — eine
 * rückwärts laufende Uhr (Zeitzonen-/NTP-Sprung, manuell gestellte Systemzeit) kann
 * einen bereits gelesenen Raum nie wieder auf ungelesen ziehen.
 *
 * P3: lokal mergen → an die Geschwister-Tabs → fertig. Es wird NICHTS publiziert;
 * der 30078-Pfad an die Outbox-Relays ist P6.
 */
export function setRead(key: ReadKey, ts: number = nowSec()): void {
    if (!Number.isFinite(ts) || ts <= 0) {
        return
    }
    const current = get(state)
    const next = Math.max(current[key] ?? 0, Math.floor(ts))
    if (current[key] === next) {
        return
    }
    state.set({ ...current, [key]: next })
    dirty.add(key)
    scheduleFlush()
    broadcast({ [key]: next })
}

/**
 * „Alles gelesen": setzt das globale Wasserzeichen und wirft die dadurch dominierten
 * Einzel-Keys weg — lokal wie in der IDB. Danach ist die Karte wieder klein.
 */
export function markAllRead(ts: number = nowSec()): void {
    setRead(ALL_KEY, ts)
    const before = get(state)
    const after = pruneReadState(before)
    const removed = Object.keys(before).filter((key) => !(key in after))
    if (removed.length === 0) {
        return
    }
    for (const key of removed) {
        dirty.delete(key)
    }
    state.set(after)
    void deleteRows(removed)
}

/**
 * Momentaufnahme der Karte — der Puffer, den {@link markAllRead} braucht, um
 * rückgängig gemacht werden zu können (§8 „Randzustände", 10-Sekunden-Frist).
 *
 * Eigene Kopie: der Aufrufer hält sie über mehrere Sekunden, während {@link setRead}
 * weiterläuft.
 */
export const snapshotReadState = (): ReadState => ({ ...get(state) })

/**
 * Eine Momentaufnahme WIEDERHERSTELLEN — die einzige Stelle, die die Monotonie von
 * {@link setRead} bewusst durchbricht.
 *
 * **Warum das nötig ist:** `setRead` schreibt `Math.max(alt, neu)`, damit eine rückwärts
 * laufende Uhr nichts kaputt macht. Genau diese Eigenschaft macht ein „Rückgängig" per
 * Zurückschreiben der alten Werte aber wirkungslos: das `all`-Wasserzeichen, das
 * {@link markAllRead} gerade auf „jetzt" gehoben hat, bliebe stehen — und `all`
 * dominiert jeden Raum- und Thread-Key. Ein Rückgängig, das nichts rückgängig macht, ist
 * schlimmer als keins. Hier wird deshalb ersetzt statt gemerged, inklusive der Keys, die
 * `markAllRead` als dominiert weggeworfen hat.
 *
 * **Warum das die Isolationszusage nicht verletzt:** geschrieben wird über denselben
 * Pfad wie jedes andere Wasserzeichen — `dbName` ist die DB DES eingeloggten pubkey
 * (`einundzwanzig-readstate-<pubkey>`), als Gast ist sie `null` und alles bleibt
 * flüchtig. Es entsteht kein zweiter Schreibweg und kein Weg an der Kontotrennung
 * vorbei; nur die Richtung des Wertes ist eine andere.
 *
 * **Grenze, offen benannt:** die Uhr geht dabei zurück. Wer in einem Geschwister-Tab in
 * denselben zehn Sekunden etwas gelesen hat, verliert dieses Wasserzeichen mit — in die
 * Richtung „zu wenig gelesen", also mit einer Meldung zu viel statt einer zu wenig. Das
 * ist die konservative Richtung und zugleich die, die der Nutzer gerade angefordert hat.
 */
export async function restoreReadState(snapshot: ReadState): Promise<void> {
    const { next, removed } = readStateRestorePlan(get(state), snapshot)
    for (const key of removed) {
        dirty.delete(key)
    }
    state.set(next)
    for (const key of Object.keys(next)) {
        dirty.add(key)
    }
    broadcast(next, true)
    await deleteRows(removed)
    await flush()
}

// ── Boot ───────────────────────────────────────────────────────────────────

let flushHooksInstalled = false

function installFlushHooks(): void {
    if (flushHooksInstalled || typeof document === 'undefined') {
        return
    }
    flushHooksInstalled = true
    // Ein geschlossener Tab darf das Quittieren der letzten zwei Sekunden nicht fressen.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            void flush()
        }
    })
}

let started = false

/** Aufgelöst = Lesestand geladen (oder fail-soft aufgegeben). Muster: `storageReady`. */
export let readStateReady: Promise<void> = Promise.resolve()

/**
 * Idempotenter Boot-Einstieg. Öffnet die DB DES eingeloggten pubkey, merged den
 * lokalen Spiegel mit dem migrierten Altbestand und startet den Zwei-Tab-Sync.
 * Gast (kein pubkey): keine DB, kein Schreiben, kein Löschen des Altbestands.
 */
export function initReadState(): void {
    if (started) {
        return
    }
    started = true
    readStateReady = (async () => {
        try {
            // Dynamischer Import wie in `storage.ts`: `session.ts` bindet beim Modul-Eval
            // localStorage — so bleiben die reinen Funktionen oben node-testbar.
            const { authReady } = await import('./session')
            await authReady
            const pk = pubkey.get()
            if (!pk) {
                return
            }
            dbName = DB_PREFIX + pk
            const stored = await readRows()
            const legacy = readLegacyLastRead()
            let merged = mergeReadState(stored, legacy.state)
            for (const key of Object.keys(legacy.state)) {
                dirty.add(key)
            }
            if (Object.keys(merged).length === 0) {
                // Frischer Account: OHNE Wasserzeichen gälte jede der bis zu 300 gecachten
                // Nachrichten als ungelesen. „Ab jetzt zählen" ist der einzige sinnvolle
                // Startwert. Bewusst NUR wenn gar nichts vorliegt: wer einen Altbestand
                // mitbringt, behielte sonst zwar ein aufgeräumtes, aber komplett
                // quittiertes Konto — die gerade migrierten Raum-Keys wären wertlos.
                merged = { [ALL_KEY]: nowSec() }
                dirty.add(ALL_KEY)
            }
            // Prune wirft Keys aus dem Speicher — sie müssen AUCH aus der IDB, sonst wächst
            // die Tabelle unbegrenzt weiter (jeder je geöffnete Thread bliebe für immer
            // liegen) und `readRows()` läse den Ballast bei jedem Start mit. Genau das
            // behauptet READ_STATE_CAP; ohne diese Zeilen wäre die Behauptung falsch.
            const pruned = pruneReadState(merged)
            const dropped = Object.keys(merged).filter((key) => !(key in pruned))
            state.set(pruned)
            if (dropped.length > 0) {
                for (const key of dropped) {
                    dirty.delete(key)
                }
                void deleteRows(dropped)
            }
            openChannel(pk)
            installFlushHooks()
            // Erst wenn der Altbestand nachweislich in der IDB liegt, darf er weg.
            if (await flush()) {
                dropLegacyLastRead(legacy.keys)
            }
        } catch (error) {
            console.warn('[readstate] Init fehlgeschlagen — Lesestand bleibt flüchtig', error)
        }
    })()
}

/**
 * Abmelden: Lesestand-DB des aktuellen Accounts ganz löschen und den Store leeren
 * (Privacy-Hygiene wie `clearCache()`; die Raum-/Thread-IDs darin sind eine
 * Aktivitätsspur). `deleteDatabase` statt `clear()`, damit der pubkey nicht über
 * `indexedDB.databases()` am Gerät enumerierbar bleibt.
 */
export async function clearReadState(): Promise<void> {
    if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
    }
    dirty.clear()
    state.set({})
    channel?.close()
    channel = null
    const name = dbName
    if (!name) {
        return
    }
    dbName = null
    try {
        ;(await dbPromise)?.close()
    } catch {
        // Verbindung evtl. schon fehlerhaft — sie wird ohnehin gleich gelöscht.
    }
    dbPromise = null
    await deleteDb(name)
}
