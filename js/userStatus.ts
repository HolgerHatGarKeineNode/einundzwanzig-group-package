/**
 * NIP-38-Status lesen — die **unreine** Hälfte: Ableitung aus dem Repository, Warm-
 * Loader und Live-Abo. Alles Rechnende steht in `userStatusData.ts` und ist dort unter
 * `node --test` geprüft; hier liegt nur Netz, Store und Gating.
 *
 * ── Zwei Ebenen Gating, und `'unknown'` ist keine der beiden Antworten ─────────
 *
 * **Ebene 1 — gibt es die Fläche?** `hasWorkspace()` entscheidet synchron aus der
 * Konfiguration ({@link isStatusRelay}). Kein NIP-11 im kritischen Pfad, also kein
 * Mount-Rennen. Status ist ein Workspace-Feature: der zooid-Arm sieht davon nichts,
 * und zwar ohne dass irgendwo ein zweiter Zweig dafür nötig wäre.
 *
 * **Ebene 2 — spricht der Relay Buzz?** `deriveSpaceKind(url)` aus `spaceCaps.ts`,
 * dreiwertig. Solange `'unknown'` gilt, liefert {@link deriveUserStatuses} eine LEERE
 * Tabelle und der Warm-Loader schickt **nichts** — die Fläche entscheidet in diesem
 * Zustand nichts, sie wartet (und zeigt einen Skeleton, siehe `chat-row.blade.php`).
 * Ein `false` an dieser Stelle wäre genau die Falle, die `spaceCaps.ts` auflöst.
 *
 * ── Warum die Tabelle eine eigene Ableitung ist ────────────────────────────────
 *
 * Der Status könnte auch in `profilesByPubkey` mitlaufen. Er tut es bewusst nicht:
 * das kollidierte mit dem kind-0-Riegel für den Workspace (`js/core.ts:223-228`) und
 * vermischte zwei völlig verschiedene Lebensdauern — ein Profil gilt bis zur
 * Änderung, ein Status bis zum Abend.
 *
 * ── Die Uhr ist eine Quelle wie jede andere ────────────────────────────────────
 *
 * Verfall hängt an `now`, nicht an eintreffenden Events. Ohne den {@link expiryTicker}
 * bliebe ein abgelaufener Status stehen, bis zufällig ein anderes 30315 hereinkommt —
 * bei einem stillen Relay also den ganzen Abend. Der Ticker hängt als dritte Quelle im
 * `derived` und läuft nur, solange jemand die Tabelle abonniert hat.
 */
import { derived, readable, type Readable } from 'svelte/store'
import { load, request } from '@welshman/net'
import { throttled } from '@welshman/store'
import type { Filter } from '@welshman/util'
import { deriveEventsForUrl } from './repository'
import { WORKSPACE_URL, deriveSpaceKind, hasWorkspace, type SpaceKind } from './spaceCaps.ts'
import { STATUS_D_GENERAL, USER_STATUS, foldUserStatuses, type UserStatus } from './userStatusData.ts'

export type { UserStatus } from './userStatusData.ts'
export { statusFingerprint } from './userStatusData.ts'

/** Leere Tabelle als geteilte Instanz — ein neues `Map` je Emit bustete jeden Cache. */
const EMPTY: ReadonlyMap<string, UserStatus> = new Map()

const HEX64 = /^[0-9a-f]{64}$/

/** Sekunden seit Epoch. Lokal statt aus `readState.ts` — das zöge IndexedDB herein. */
const nowSec = (): number => Math.floor(Date.now() / 1000)

/**
 * Liest dieser Relay Statuse? Ebene 1 des Gatings: **synchron**, ohne Netz.
 * Ausschließlich der konfigurierte Workspace — der aktive Space kann dieselbe URL
 * sein (`setActiveSpaceEphemeral(WORKSPACE_URL)`), dann greift es auch dort.
 */
export const isStatusRelay = (url: string): boolean => hasWorkspace() && url !== '' && url === WORKSPACE_URL

/**
 * Der eine Filter, den beide Richtungen teilen. `#d` ist Pflicht: ohne ihn kämen
 * `music`-Statuse (NIP-38) mit, die wir nicht anzeigen — und der Relay muss mehr
 * ausliefern, als wir je brauchen.
 */
export const statusFilters = (): Filter[] => [{ kinds: [USER_STATUS], '#d': [STATUS_D_GENERAL] }]

/**
 * Grober Takt, in dem der Verfall neu bewertet wird: **60 s**. Feiner brächte nichts
 * (ein Status ist keine Stoppuhr), gröber ließe einen abgelaufenen Status spürbar
 * stehen. Kostet je Tick einen Fold über wenige Dutzend Events.
 */
export const EXPIRY_TICK_MS = 60_000

/** Tickt, solange jemand zuhört — und nur dann (`readable` stoppt beim letzten Abmelden). */
const expiryTicker: Readable<number> = readable(0, (set) => {
    const timer = setInterval(() => set(Date.now()), EXPIRY_TICK_MS)
    return () => clearInterval(timer)
})

const storesByUrl = new Map<string, Readable<ReadonlyMap<string, UserStatus>>>()

/**
 * Die Statustabelle eines Relays, reaktiv: `pubkey → {text, emoji, updatedAt}`.
 * Abgelaufene, überalterte und gelöschte Statuse fehlen darin ganz — die Oberfläche
 * bekommt nur, was sie zeigen darf.
 *
 * Ein Store je URL (wie `deriveSpaceKind`): vier Konsumenten (Chat, Thread, Directory,
 * Profilkarte) teilen sich damit eine Repository-Abfrage statt vier zu fahren.
 * `throttled(300, …)` wie in `longformFeed.ts` (`deriveArticles`) — beim Kaltstart tröpfeln die
 * 30315 einzeln herein.
 */
export const deriveUserStatuses = (url: string): Readable<ReadonlyMap<string, UserStatus>> => {
    if (!isStatusRelay(url)) {
        return readable(EMPTY)
    }
    let store = storesByUrl.get(url)
    if (!store) {
        store = derived(
            [deriveSpaceKind(url), throttled(300, deriveEventsForUrl(url, statusFilters())), expiryTicker],
            ([kind, events]: [SpaceKind, unknown, number]) =>
                kind === 'buzz' ? foldUserStatuses(events as Parameters<typeof foldUserStatuses>[0], nowSec()) : EMPTY,
        )
        storesByUrl.set(url, store)
    }
    return store
}

/** Der Status EINES Pubkeys — für die Profilkarte, die nur einen braucht. */
export const deriveUserStatus = (url: string, pubkey: string): Readable<UserStatus | undefined> =>
    derived(deriveUserStatuses(url), (table) => table.get(pubkey))

/**
 * „Warten" als eigener, sichtbarer Zustand: `true`, solange im Workspace-Arm die
 * Relay-Art noch `'unknown'` ist.
 *
 * **Das ist die einzige Stelle, an der `'unknown'` zu einer UI-Aussage wird.** Eine
 * Fläche, die stattdessen `deriveUserStatuses` allein liest, kann „hat keinen Status"
 * nicht von „weiß es noch nicht" unterscheiden — beides ist eine leere Tabelle. Genau
 * diese Verwechslung ist die Falle aus `spaceCaps.ts`, nur eine Ebene höher. Außerhalb
 * des Workspace-Arms konstant `false`: dort gibt es nichts zu erwarten.
 */
export const deriveStatusPending = (url: string): Readable<boolean> =>
    isStatusRelay(url) ? derived(deriveSpaceKind(url), (kind) => kind === 'unknown') : readable(false)

// ── Warm-Loader ──────────────────────────────────────────────────────────────

/**
 * Sammelfenster des Warm-Loaders: **250 ms**. Der Chat ruft ihn bei jedem
 * Ableitungsdurchlauf mit der ganzen sichtbaren Autorenliste; ohne Fenster ginge je
 * Durchlauf ein REQ raus, obwohl sich die Liste kaum ändert.
 */
export const WARM_DEBOUNCE_MS = 250

/**
 * Autoren je REQ. Buzz Desktop nimmt dieselbe Form (`authors` + `#d` + `limit =
 * Autorenzahl`, `desktop/src/features/user-status/hooks.ts:64-70`), nur ungechunkt.
 * 100 ist die Grenze, die auch `warmProfiles` (`profiles.ts:30`) fährt.
 */
export const AUTHOR_CHUNK = 100

/** Je URL: bereits angefragte Pubkeys — kein zweiter Netzweg für denselben Autor. */
const warmed = new Map<string, Set<string>>()
/** Je URL: was im laufenden Sammelfenster dazugekommen ist. */
const queued = new Map<string, Set<string>>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** Je URL das offene Live-Abo (samt Abbruch-Griff), siehe {@link listenUserStatuses}. */
const listening = new Map<string, AbortController>()

const bucket = (map: Map<string, Set<string>>, url: string): Set<string> => {
    let set = map.get(url)
    if (!set) {
        set = new Set<string>()
        map.set(url, set)
    }
    return set
}

/**
 * Wartet, bis die Relay-Art feststeht, und meldet, ob es Buzz ist.
 *
 * Warum überhaupt warten: beim ersten Ableitungsdurchlauf steht die Weiche auf
 * `'unknown'` (NIP-11 unterwegs). Wer dann „kein Buzz" liest, schickt nie einen
 * REQ und die Statuse erscheinen erst nach einem Reload — die Mount-Falle aus
 * `spaceCaps.ts`, nur eine Ebene tiefer. Der Store läuft garantiert aus dem
 * `'unknown'` heraus (Backoff, danach `'other'`), das Warten endet also immer.
 *
 * Das Abmelden ist zweigeteilt, weil `subscribe` synchron zurückrufen kann: dann ist
 * `unsubscribe` beim Auflösen noch `null` und das Abmelden erledigt die Zeile danach.
 */
const whenSpaceKindKnown = (url: string): Promise<boolean> =>
    new Promise((resolve) => {
        let settled = false
        let unsubscribe: (() => void) | null = null
        unsubscribe = deriveSpaceKind(url).subscribe((kind) => {
            if (settled || kind === 'unknown') {
                return
            }
            settled = true
            resolve(kind === 'buzz')
            unsubscribe?.()
        })
        if (settled) {
            unsubscribe()
        }
    })

/**
 * Bestand der genannten Autoren holen (`load`) und das Live-Abo öffnen (`request`
 * mit `limit:0`) — Muster `warmProfiles`/`warmZappers`: fire-and-forget, je Pubkey
 * einmal, wirft nie.
 *
 * `limit: chunk.length` am `load`: kind 30315 ist ersetzbar, es gibt je Autor genau
 * ein Event — ein höheres Limit lieferte nichts dazu, ein niedrigeres schnitte Autoren
 * ab.
 */
const flush = async (url: string): Promise<void> => {
    const queue = queued.get(url)
    if (!queue || queue.size === 0) {
        return
    }
    const authors = [...queue]
    queue.clear()

    if (!(await whenSpaceKindKnown(url))) {
        return // kein Buzz ⇒ kein 30315; die Pubkeys bleiben als „erledigt" vermerkt
    }

    for (let i = 0; i < authors.length; i += AUTHOR_CHUNK) {
        const chunk = authors.slice(i, i + AUTHOR_CHUNK)
        void load({
            relays: [url],
            filters: [{ kinds: [USER_STATUS], authors: chunk, '#d': [STATUS_D_GENERAL], limit: chunk.length }],
        }).catch(() => {
            // `load` löst auch bei totem Relay auf; das `catch` deckt nur den Ausreißer
            // ab — ein Status, der nicht kommt, ist kein Fehler, sondern kein Status.
        })
    }

    listenUserStatuses(url)
}

/**
 * Wartezeit vor dem erneuten Senden des Live-REQ nach einem Socket-Abriss: **2 s**.
 * Lang genug, dass welshmans eigener Reconnect zuerst greift, kurz genug, dass ein
 * Statuswechsel im Sekundenbereich nachkommt.
 */
export const RELISTEN_DELAY_MS = 2000

/**
 * Das Live-Abo: **ein** offenes REQ je URL und Tab, ungefiltert nach Autor.
 *
 * Nicht pro Insel: ein Statuswechsel soll ankommen, egal welche Fläche offen ist, und
 * ein zweites Abo je Raumwechsel kostete nur Subscriptions. Dieselbe Form fährt Buzz
 * Desktop (`relayClientSession.ts:396-402`: `{kinds:[30315], "#d":["general"],
 * limit:0}`). `limit:0` heißt „ab jetzt", kein Backfill — den holt
 * {@link warmUserStatuses}.
 *
 * ── Warum das Abo sich selbst neu aufziehen muss ───────────────────────────────
 *
 * **welshman sendet ein REQ nach einem Socket-Abriss NICHT erneut.** `requestOne`
 * meldet den Abriss nur (`onDisconnect`) und schließt die Subscription bloß bei
 * `autoClose` (`@welshman/net/dist/net/src/request.js:80-88`); ohne das bleibt ein
 * totes Abo bestehen, das nie wieder etwas liefert. Genau deshalb zieht die Rauminsel
 * ihre Live-Subs in `resync()` von Hand neu auf. Ein Abo, das den ganzen Tab überlebt,
 * braucht dieselbe Behandlung — sonst friert die Statusspalte beim ersten
 * Verbindungsabriss ein und **sieht dabei aus wie „niemand ändert seinen Status"**:
 * kein Fehler, keine Meldung, nur dauerhaft veraltete Werte.
 *
 * Neu aufgezogen wird **nur bei Abriss**, nicht bei `CLOSED`: eine Ablehnung des
 * Relays (kein Mitglied, `auth-required`) ist eine Entscheidung, keine Panne — sie in
 * einer Schleife zu wiederholen wäre der Dauer-Retry, den dieses Repo an anderer
 * Stelle bewusst vermeidet (`readStateSync.ts:380-384`).
 */
const listenUserStatuses = (url: string): void => {
    if (listening.has(url)) {
        return
    }
    const controller = new AbortController()
    listening.set(url, controller)

    const rearm = (): void => {
        // Nur, wenn DIESES Abo noch das aktuelle ist — sonst zöge ein spätes
        // Abriss-Ereignis ein bereits laufendes Abo doppelt auf.
        if (listening.get(url) !== controller) {
            return
        }
        listening.delete(url)
        controller.abort()
        setTimeout(() => listenUserStatuses(url), RELISTEN_DELAY_MS)
    }

    void request({
        relays: [url],
        signal: controller.signal,
        filters: [{ kinds: [USER_STATUS], '#d': [STATUS_D_GENERAL], limit: 0 }],
        onDisconnect: rearm,
    }).then(() => {
        // Aufgelöst = die Subscription ist zu (Abbruch oder CLOSED). Den Merker
        // freigeben, damit der nächste Warm-Lauf sie wieder öffnen kann.
        if (listening.get(url) === controller) {
            listening.delete(url)
        }
    })
}

/**
 * Das Live-Abo von außen neu aufziehen — für den App-Vordergrund-Resync der
 * Rauminsel. Ein WebView im Hintergrund verliert seinen Socket, ohne dass ein
 * `onDisconnect` verlässlich durchkommt; dieser Aufruf ist der zweite Riegel neben
 * der Selbstheilung in {@link listenUserStatuses}. No-op außerhalb des Workspace-Arms
 * und solange gar kein Abo offen war.
 */
export const resyncUserStatuses = (url: string): void => {
    if (!isStatusRelay(url)) {
        return
    }
    const open = listening.get(url)
    if (open) {
        listening.delete(url)
        open.abort()
    }
    listenUserStatuses(url)
}

/**
 * Statuse der genannten Pubkeys wärmen — der einzige Netz-Einstieg dieses Moduls.
 *
 * Fire-and-forget, dedupliziert, gedrosselt, gechunkt; ohne Workspace und ohne
 * gültige Hex-Pubkeys passiert gar nichts. Aufrufer: der Chat-Feed (Autoren des
 * Fensters), das Directory (Mitglieder) und die Profilkarte (der eine Geöffnete).
 */
export const warmUserStatuses = (url: string, pubkeys: Iterable<string>): void => {
    if (!isStatusRelay(url)) {
        return
    }
    const seen = bucket(warmed, url)
    const queue = bucket(queued, url)
    let added = false
    for (const pk of pubkeys) {
        if (HEX64.test(pk) && !seen.has(pk)) {
            seen.add(pk)
            queue.add(pk)
            added = true
        }
    }
    if (!added || timers.has(url)) {
        return
    }
    timers.set(
        url,
        setTimeout(() => {
            timers.delete(url)
            void flush(url)
        }, WARM_DEBOUNCE_MS),
    )
}
