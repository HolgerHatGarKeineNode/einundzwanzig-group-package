/**
 * `$store.roomPins` — angepinnte Nachrichten eines Raums (P6b).
 *
 * Die reine Logik (Kinds, Kollisionsschutz, Dedup, Rechte, Lösch-Kommandos) liegt in
 * `pins.ts` und ist dort ohne Browser testbar. Hier steht nur, was zwingend welshman
 * braucht: Lesen über den Tracker, Signieren, Senden — und das **Nachprüfen der Wirkung**.
 *
 * ── Warum ein Store und keine Insel ─────────────────────────────────────────────────
 *
 * P4/P5/P6a haben je eine eigene `Alpine.data`-Insel bekommen, und das war dort richtig:
 * Palette, Darstellungs-Schalter und Suche sind je EINE Fläche mit eigenem Lebenszyklus.
 * Der Pin ist das nicht. Er wird an **zwei** Stellen gebraucht, die im DOM weit
 * auseinanderliegen und einander nicht sehen:
 *
 *  1. die **Pin-Leiste** über dem Verlauf, und
 *  2. der Eintrag „Anpinnen"/„Loslösen" im **Nachrichten-Menü**, das innerhalb von
 *     `nostrRoomChat` liegt.
 *
 * Mit zwei Inseln bräuchte (2) einen eigenen Schalter „ist diese Nachricht gepinnt?" —
 * also eine zweite Wahrheit neben (1), die beim Pinnen von einem anderen Gerät still
 * falsch würde. Genau diesen Fehler beschreibt `roomSearch.ts` für `aria-expanded` und
 * löst ihn dort mit einer Meldung; hier ist der Zustand aber kein Ja/Nein, sondern eine
 * Menge, die sich laufend ändert. Ein `Alpine.store` ist das kleinere Übel und das
 * etablierte Muster im Repo (`$store.viewport`, `$store.unread`, `$store.authGate`).
 *
 * **In `nostrRoomChat` entsteht dadurch kein einziges neues Feld.** Das Markup liest
 * `$store.roomPins.*` und reicht die bereits vorhandenen `menuFor`, `isAdmin` und
 * `joined` hinein — lesender Gebrauch bestehender Fähigkeiten, wie P6a es mit
 * `scrollToMessage` hält.
 *
 * ── `OK true` ist kein Erfolgsnachweis ──────────────────────────────────────────────
 *
 * Der Client wartet nach jedem Publish nicht auf die Quittung, sondern auf die
 * **Wirkung** — die neue 39005 (zooid) bzw. das Verschwinden des 40004 (Buzz).
 * Begründung und Roh-Frames: {@link pinStateReached} in `pins.ts`. `waitForPublishError`
 * bleibt trotzdem davor geschaltet: es liefert die **wörtliche Begründung des Relays**,
 * und die ist bei einer Ablehnung die einzige ehrliche Information, die wir haben.
 *
 * ── Was das Netz angeht ─────────────────────────────────────────────────────────────
 *
 * Anders als die Suche (P6a) fragt diese Fläche sehr wohl ein Relay — sie muss:
 * eine gepinnte Nachricht kann älter sein als das geladene Fenster. Geladen wird
 * gezielt per `ids`-Filter und nur für Pins, die im Repository fehlen.
 */

import { pubkey, repository } from '@welshman/app'
import { load, request } from '@welshman/net'
import { makeEvent, type Filter, type TrustedEvent } from '@welshman/util'
import { publishThunk } from '@welshman/app'
import { derived, get, type Readable } from 'svelte/store'
import { activeSpace, deriveUserInRoom } from './groups'
import { deriveUserIsSpaceAdmin } from './members'
import { spaceIsBuzz } from './buzzAdmin'
import { deriveEventsForUrl } from './repository'
import { bodyWithoutQuote, fullTimeLabel } from './feeds'
import { displayProfileByPubkey } from '@welshman/app'
import { waitForPublishError } from './publishResult'
import { t } from './i18n'
import {
    BUZZ_PIN,
    ZOOID_PIN_LIST,
    ZOOID_PUT_PINS,
    buzzPinEntries,
    buzzUnpinCommands,
    foreignPinTags,
    isAlreadyGoneError,
    isZooidPinList,
    mayPin,
    mayUnpin,
    olderDuplicatePinIds,
    pinStateReached,
    pinnedIdsFromList,
    putPinsTags,
    type PinEventLike,
} from './pins'

/** Eine Zeile der Pin-Leiste. `text` ist leer, solange die Nachricht noch nicht da ist. */
export type PinnedEntry = {
    id: string
    text: string
    name: string
    time: string
    /** Wer den Pin gesetzt hat (Buzz). Auf zooid leer — die Liste kennt keinen Autor. */
    pinnedBy: string
    /** Ist die Nachricht selbst schon geladen? Sonst steht in der Leiste ein Platzhalter. */
    resolved: boolean
}

type RoomPinsStore = {
    h: string
    url: string
    isBuzz: boolean
    entries: PinnedEntry[]
    /** Darf der eingeloggte Nutzer in diesem Raum überhaupt pinnen? */
    canPin: boolean
    /** Läuft gerade ein Pin/Unpin? (Doppelklick-Sperre) */
    busy: boolean
    /** Wörtliche Begründung des Relays, '' = keine. */
    error: string
    /** Ist die Leiste eingeklappt? (Nutzer-Entscheidung, nur für diese Sitzung) */
    collapsed: boolean
    mount(h: string): void
    unmount(h?: string): void
    isPinned(id: string): boolean
    canUnpin(id: string): boolean
    toggle(id: string): Promise<void>
    dismissError(): void
}

/**
 * Wie lange auf die **Wirkung** gewartet wird, nachdem der Relay das Kommando
 * angenommen hat.
 *
 * Bei zooid kommt die neue 39005 gemessen **vor** dem `OK` des 9010 — der Normalfall
 * ist also, dass die Wirkung schon da ist, wenn wir zu warten anfangen. Diese Grenze
 * fängt nur den Fall ab, in dem der Relay das Kommando quittiert und nichts tut (die
 * `created_at`-Falle). Sie liegt bewusst unter `PUBLISH_VERDICT_TIMEOUT_MS` (20 s):
 * hier ist bereits ein Verdikt da, es fehlt nur die Folge.
 */
const EFFECT_TIMEOUT_MS = 6_000

const noop = (): void => {}

/** Ereignis → Zeile der Leiste. Fehlt die Nachricht noch, bleibt der Text leer. */
const toEntry = (id: string, pinnedBy: string, event: TrustedEvent | undefined): PinnedEntry => ({
    id,
    text: event ? bodyWithoutQuote(event) : '',
    name: event ? displayProfileByPubkey(event.pubkey) : '',
    time: event ? fullTimeLabel(event.created_at) : '',
    pinnedBy,
    resolved: Boolean(event),
})

/**
 * Die Pin-Quelle eines Raums, **an die Herkunfts-URL gebunden**.
 *
 * `deriveEventsForUrl` (`repository.ts:20`) filtert über den `tracker` auf genau dieses
 * Relay. Das ist hier keine Stilfrage: `kind 39005` ist bei zooid die Pin-Liste und bei
 * Buzz die Thread-Zusammenfassung, und ein Filter ohne Relay-Bindung trifft **beide**
 * (gemessen). Der zweite Riegel ist {@link isZooidPinList} unten.
 */
const derivePinSource = (url: string, h: string, isBuzz: boolean): Readable<PinEventLike[]> =>
    derived(deriveEventsForUrl(url, pinFilters(h, isBuzz)), (events) => events as unknown as PinEventLike[])

/**
 * Der Filter je Relay-Art — **eine Matrix, keine Zeile**.
 *
 * Die beiden Formen sind nicht ineinander überführbar: zooid trägt die Raum-Zuordnung im
 * `d` eines adressierbaren Events, Buzz im `h` regulärer Events. Ein gemeinsamer Filter
 * `{kinds:[39005,40004]}` wäre auf beiden Relays falsch — auf zooid zöge er nichts
 * Zusätzliches, auf Buzz aber **jede Thread-Zusammenfassung** des Kanals mit (kind 39005
 * ist dort `KIND_THREAD_SUMMARY`). Deshalb entscheidet die Relay-Art, was überhaupt
 * gefragt wird, und nicht erst, was mit der Antwort geschieht.
 */
const pinFilters = (h: string, isBuzz: boolean): Filter[] =>
    isBuzz ? [{ kinds: [BUZZ_PIN], '#h': [h] }] : [{ kinds: [ZOOID_PIN_LIST], '#d': [h] }]

/**
 * Erzeugt den Store **und** einen Binder.
 *
 * **Warum der Binder nötig ist:** `Alpine.store(name, obj)` legt `obj` in einen
 * reaktiven Proxy; die Oberfläche sieht nur diesen Proxy. Eine Closure, die weiter das
 * ROHE Objekt mutiert, ändert damit Werte, von denen Alpine nichts erfährt — die
 * Pin-Leiste bliebe stehen, obwohl die Daten längst da sind. Genau deshalb liest
 * `viewport.ts:79` den Store nach dem Registrieren zurück und schreibt nur noch über
 * das Ergebnis. Hier ist dasselbe nötig, nur an mehr Stellen: `recompute()` läuft aus
 * einer Store-Subscription heraus, also außerhalb jedes Methodenaufrufs, und hätte
 * kein `this`, das der Proxy wäre.
 */
const createStore = (): { store: RoomPinsStore; bind: (reactive: RoomPinsStore) => void } => {
    let unsubSpace: () => void = noop
    let unsubSource: () => void = noop
    let unsubAdmin: () => void = noop
    let unsubMember: () => void = noop
    /** Live-Sub der Pin-Ereignisse; wird beim Raumwechsel abgebrochen. */
    let controller: AbortController | null = null
    /** Roh-Pins, wie sie vom Relay kommen — Grundlage für Lösch-Kommandos. */
    let rawPins: PinEventLike[] = []
    /** Die aktuelle zooid-Pin-Liste (das eine 39005) — Grundlage für „Liste ohne X". */
    let pinList: PinEventLike | null = null
    let isAdmin = false
    let inRoom = false
    /** Ids, die bereits gezielt nachgeladen wurden (kein zweiter REQ je Id). */
    const requested = new Set<string>()
    /**
     * Wie viele Insel-Knoten den Store gerade halten.
     *
     * Normalerweise genau einer. Beim `wire:navigate` auf **denselben** Raum gibt es
     * kurz zwei: der neue Knoten läuft sein `init()`, bevor der alte sein `destroy()`
     * bekommt (`livewire.esm.js`: erst `replaceWith(newBody)`, dann
     * `destroyTree(oldBody)`). Ohne diesen Zähler räumte das späte `destroy()` den
     * gerade aufgebauten Zustand ab — die Raum-Prüfung in `unmount` griffe nicht, weil
     * beide denselben Raum meinen. Die Leiste bliebe dauerhaft leer, und zwar nur bei
     * dieser einen Navigation.
     */
    let mounts = 0

    /**
     * Das Ziel ALLER Schreibzugriffe. Zeigt bis zum {@link bind} auf das rohe Objekt
     * (dann existiert noch keine Oberfläche) und danach auf den reaktiven Proxy.
     */
    let self: RoomPinsStore

    const store: RoomPinsStore = {
        h: '',
        url: '',
        isBuzz: false,
        entries: [],
        canPin: false,
        busy: false,
        error: '',
        collapsed: false,

        mount(h: string): void {
            mounts++
            if (self.h === h && self.url) {
                return
            }
            teardown()
            self.h = h
            unsubSpace = activeSpace.subscribe((url: string) => {
                if (!url) {
                    return
                }
                self.url = url
                self.isBuzz = spaceIsBuzz(url)
                unsubAdmin()
                unsubAdmin = deriveUserIsSpaceAdmin(url).subscribe((admin: boolean) => {
                    isAdmin = admin
                    recomputePermissions()
                })
                unsubMember()
                unsubMember = deriveUserInRoom(url, h).subscribe((member: boolean) => {
                    inRoom = member
                    recomputePermissions()
                })
                unsubSource()
                unsubSource = derivePinSource(url, h, self.isBuzz).subscribe((events: PinEventLike[]) => {
                    rawPins = events
                    recompute()
                })
                // Bestand holen und live weiterhören. Beides gehört HIERHER und nicht in
                // `listenRoom`: dort müsste `feeds.ts` die Relay-Art kennen, um zwischen
                // `#d` (zooid) und `#h` (Buzz) zu wählen — die Weiche säße dann an zwei
                // Stellen. Das Lösen ist davon nicht betroffen: die Lösch-Ereignisse
                // (kind 5 / 9005) tragen `h` und kommen über die bestehende
                // Raum-Subscription (Begründung bei `buzzUnpinCommands`).
                controller?.abort()
                controller = new AbortController()
                void load({ relays: [url], filters: pinFilters(h, self.isBuzz) })
                void request({
                    relays: [url],
                    signal: controller.signal,
                    filters: pinFilters(h, self.isBuzz).map((f) => ({ ...f, limit: 0 })),
                })
            })
        },

        /**
         * Abbau — mit **zwei** Riegeln, weil `wire:navigate` den neuen Body einhängt und
         * den alten erst **danach** abräumt (`livewire.esm.js`:
         * `document.body.replaceWith(newBody)`, dann `Alpine.destroyTree(oldBody)`).
         * Ein bedingungsloses Aufräumen risse in beiden Fällen die gerade aufgebauten
         * Abos wieder ab, und die Pin-Leiste bliebe dauerhaft leer:
         *
         *  1. **Der Zähler** deckt den Wechsel auf **denselben** Raum ab (dort greift die
         *     Raum-Prüfung nicht, weil beide Inseln dasselbe `h` meinen).
         *  2. **`h`** deckt den Wechsel auf einen **anderen** Raum ab: dann hat `mount`
         *     den Store längst auf den neuen umgestellt, und das späte `destroy()` der
         *     alten Insel darf ihn nicht mehr anfassen.
         *
         * Das Argument ist optional, damit `mount` intern ohne es aufräumen kann.
         */
        unmount(h?: string): void {
            mounts = Math.max(0, mounts - 1)
            if (mounts > 0) {
                return
            }
            if (h !== undefined && self.h !== h) {
                return
            }
            teardown()
        },

        isPinned(id: string): boolean {
            return self.entries.some((e) => e.id === id)
        },

        /**
         * Auf zooid identisch zu `canPin`. Auf Buzz darf zusätzlich der **Autor** des
         * Pins lösen, auch ohne Admin-Rolle — sonst böte das Menü einem Mitglied ein
         * „Loslösen" an, das in `invalid: must be event author` endet.
         */
        canUnpin(id: string): boolean {
            const entry = self.entries.find((e) => e.id === id)
            if (!entry) {
                return false
            }
            return mayUnpin(self.isBuzz, isAdmin, inRoom, entry.pinnedBy, get(pubkey) ?? '')
        },

        async toggle(id: string): Promise<void> {
            if (self.busy || !id) {
                return
            }
            const shouldPin = !self.isPinned(id)
            if (shouldPin ? !self.canPin : !self.canUnpin(id)) {
                return
            }
            self.busy = true
            self.error = ''
            try {
                const failure = self.isBuzz ? await buzzToggle(id, shouldPin) : await zooidToggle(id, shouldPin)
                if (failure) {
                    self.error = failure
                    return
                }
                if (!(await waitForEffect(id, shouldPin))) {
                    self.error = t('Das Relay hat den Pin nicht übernommen.')
                }
            } finally {
                self.busy = false
            }
        },

        dismissError(): void {
            self.error = ''
        },
    }

    self = store

    /** Alle Abos lösen und den sichtbaren Zustand zurücksetzen. */
    const teardown = (): void => {
        controller?.abort()
        controller = null
        unsubSource()
        unsubAdmin()
        unsubMember()
        unsubSpace()
        unsubSource = noop
        unsubAdmin = noop
        unsubMember = noop
        unsubSpace = noop
        rawPins = []
        pinList = null
        requested.clear()
        self.h = ''
        self.url = ''
        self.entries = []
        self.canPin = false
        self.busy = false
        self.error = ''
    }

    const recomputePermissions = (): void => {
        self.canPin = mayPin(self.isBuzz, isAdmin, inRoom)
    }

    /** Aus den Roh-Pins die Anzeige-Zeilen bauen und Fehlendes gezielt nachladen. */
    const recompute = (): void => {
        let ids: string[]
        let pinnedByById = new Map<string, string>()

        if (self.isBuzz) {
            const entries = buzzPinEntries(rawPins)
            ids = entries.map((e) => e.targetId)
            pinnedByById = new Map(entries.map((e) => [e.targetId, e.pinnedBy]))
        } else {
            // Zweiter Riegel gegen die 39005-Kollision, unabhängig von der Relay-Bindung
            // oben: eine Buzz-Thread-Zusammenfassung ist kein Pin, auch wenn sie je durch
            // einen Filter ohne `tracker` hierher fände.
            pinList = rawPins.find((e) => isZooidPinList(e)) ?? null
            ids = pinList ? pinnedIdsFromList(pinList, self.h) : []
        }

        self.entries = ids.map((id) =>
            toEntry(id, pinnedByById.get(id) ?? '', repository.getEvent(id) as TrustedEvent | undefined),
        )

        const missing = ids.filter((id) => !repository.getEvent(id) && !requested.has(id))
        if (missing.length > 0 && self.url) {
            missing.forEach((id) => requested.add(id))
            // Gezielt und einmalig: eine gepinnte Nachricht kann älter sein als das
            // geladene Fenster. Ohne diesen Load bliebe die Leiste bei einem alten Pin
            // dauerhaft ein Platzhalter. Das Ergebnis landet im Repository und löst
            // `recompute` über die Ableitung oben erneut aus.
            void load({ relays: [self.url], filters: [{ ids: missing }] })
        }
    }

    /**
     * zooid: **die ganze Liste** neu setzen — es gibt kein „einen hinzufügen".
     *
     * Die neue Liste entsteht aus der aktuell gelesenen 39005; `a`-Tags werden dabei
     * durchgereicht (siehe {@link putPinsTags}), sonst löschte ein Pin auf eine
     * Nachricht stillschweigend jeden gepinnten Artikel.
     */
    const zooidToggle = (id: string, shouldPin: boolean): Promise<string> => {
        const current = pinList ? pinnedIdsFromList(pinList, self.h) : []
        const next = shouldPin ? [...current, id] : current.filter((x) => x !== id)
        return publishPin(ZOOID_PUT_PINS, putPinsTags(self.h, next, foreignPinTags(pinList)))
    }

    /**
     * Buzz: Pinnen ist ein neues `40004`; Lösen ist ein Lösch-Event je Pin-Ereignis —
     * inklusive der verdeckten älteren Duplikate auf dasselbe Ziel, sonst rückte beim
     * nächsten Laden eines nach und der Pin wäre „wieder da".
     */
    const buzzToggle = async (id: string, shouldPin: boolean): Promise<string> => {
        if (shouldPin) {
            return publishPin(BUZZ_PIN, [
                ['h', self.h],
                ['e', id],
            ])
        }
        const entry = buzzPinEntries(rawPins).find((e) => e.targetId === id)
        if (!entry) {
            return ''
        }
        const targets = [entry.pinEventId, ...olderDuplicatePinIds(rawPins, id, entry.pinEventId)]
        const authors = new Map(rawPins.map((e) => [e.id, e.pubkey]))
        const commands = buzzUnpinCommands(self.h, targets, get(pubkey) ?? '', authors)
        for (const command of commands) {
            const failure = await publishPin(command.kind, command.tags)
            // „Ziel nicht gefunden" heißt: schon weg. Das ist der gewünschte Zustand,
            // kein Fehlschlag — und ein Toast lüde hier zum Wiederholen ein, das
            // denselben Fehler erneut erzeugte.
            if (failure && !isAlreadyGoneError(failure)) {
                return failure
            }
        }
        return ''
    }

    /**
     * Signieren und senden. `created_at` kommt vom Signer (`makeEvent` → `now()`) und
     * wird bewusst NICHT selbst gesetzt — Begründung bei {@link pinStateReached}.
     * Der Rückgabewert ist die wörtliche Relay-Begründung, '' = angenommen.
     */
    const publishPin = (kind: number, tags: string[][]): Promise<string> =>
        waitForPublishError(publishThunk({ relays: [self.url], event: makeEvent(kind, { tags }) }))

    /**
     * Auf die **Wirkung** warten statt auf die Quittung.
     *
     * Der Relay kann ein Pin-Kommando mit `OK true` annehmen und nichts tun (gemessen,
     * zwei unabhängige Ursachen — siehe `pins.ts`). Erst wenn die Pin-Liste den
     * gewünschten Zustand zeigt, gilt der Vorgang als erfolgreich.
     */
    const waitForEffect = (id: string, shouldBePinned: boolean): Promise<boolean> =>
        new Promise((resolve) => {
            if (pinStateReached(self.entries.map((e) => e.id), id, shouldBePinned)) {
                resolve(true)
                return
            }
            const started = Date.now()
            const timer = setInterval(() => {
                if (pinStateReached(self.entries.map((e) => e.id), id, shouldBePinned)) {
                    clearInterval(timer)
                    resolve(true)
                } else if (Date.now() - started > EFFECT_TIMEOUT_MS) {
                    clearInterval(timer)
                    resolve(false)
                }
            }, 150)
        })

    return {
        store,
        bind: (reactive: RoomPinsStore): void => {
            self = reactive
        },
    }
}

export function wireRoomPins(Alpine: { store: (name: string, value?: unknown) => unknown }): void {
    if (Alpine.store('roomPins')) {
        return
    }
    const { store, bind } = createStore()
    Alpine.store('roomPins', store)
    // Ab hier schreibt der Store ausschliesslich in den reaktiven Proxy — siehe
    // {@link createStore}. Gleiches Vorgehen wie `viewport.ts:79`.
    bind(Alpine.store('roomPins') as RoomPinsStore)
}
