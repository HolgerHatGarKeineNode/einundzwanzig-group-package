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

import { deriveRelay, pubkey, repository } from '@welshman/app'
import { load, request } from '@welshman/net'
import { throttled } from '@welshman/store'
import { makeEvent, type Filter, type TrustedEvent } from '@welshman/util'
import { publishThunk } from '@welshman/app'
import { displayProfileByPubkey, profilesByPubkey } from './spaceProfiles.ts'
import { derived, get, type Readable } from 'svelte/store'
import { activeSpace, deriveUserInRoom } from './groups.ts'
import { deriveSpaceMembers, deriveUserIsSpaceAdmin } from './members.ts'
import { isBuzzRelay } from './relayCaps.ts'
import { deriveEventsForUrl } from './repository.ts'
import { bodyWithoutQuote, fullTimeLabel } from './feeds.ts'
import { waitForPublishError } from './publishResult.ts'
import { t } from './i18n.ts'
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
} from './pins.ts'

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
 * „Darf der eingeloggte Nutzer in diesem Raum schreiben?" — die Quelle unterscheidet sich
 * je Relay, die Frage nicht.
 *
 * **zooid:** die relay-signierte Raum-Mitgliederliste 39002 (`deriveUserInRoom`).
 * **Buzz:** die relay-signierte **Relay**-Mitgliederliste 13534 (`deriveSpaceMembers`) —
 * dort steht die Antwort, denn Buzz' 39002 führt nur explizit vergebene Kanal-Rollen
 * (am Testrelay: nur der Owner), während jedes Relay-Mitglied in einem offen sichtbaren
 * Kanal schreiben und pinnen darf.
 *
 * Die Relay-Art steckt bewusst **in** dieser Ableitung und nicht im Aufrufer: alle vier
 * Eingaben — Info-Dokument, Raum-Liste, Relay-Liste und der eingeloggte Pubkey — treffen
 * zu unterschiedlichen Zeiten ein, und jede einzelne davon einmal synchron zu lesen war
 * genau der Fehler, der P6b zurückgeworfen hat.
 */
const deriveCanWriteHere = (url: string, h: string): Readable<boolean> =>
    derived(
        [deriveRelay(url), deriveUserInRoom(url, h), deriveSpaceMembers(url), pubkey],
        ([relay, inRoom, members, pk]) =>
            isBuzzRelay((relay as { software?: string } | undefined) ?? undefined)
                ? Boolean(pk && (members as string[]).includes(pk as string))
                : Boolean(inRoom),
    )

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
    /** Abo der Relay-Art (NIP-11). Siehe die Begründung in `mount`. */
    let unsubBuzz: () => void = noop
    /** Abo der Profile — zieht den Autornamen eines alten Pins nach. Siehe `mount`. */
    let unsubProfiles: () => void = noop
    /**
     * Für welche Kombination aus URL, Raum und Relay-Art die Lesequelle gerade aufgezogen
     * ist — `null` = für keine. Siehe {@link armSource}.
     */
    let armedFor: string | null = null
    /** Live-Sub der Pin-Ereignisse; wird beim Raumwechsel abgebrochen. */
    let controller: AbortController | null = null
    /** Roh-Pins, wie sie vom Relay kommen — Grundlage für Lösch-Kommandos. */
    let rawPins: PinEventLike[] = []
    /** Die aktuelle zooid-Pin-Liste (das eine 39005) — Grundlage für „Liste ohne X". */
    let pinList: PinEventLike | null = null
    let isAdmin = false
    /** Darf hier geschrieben werden? Quelle je Relay verschieden — {@link deriveCanWriteHere}. */
    let canWriteHere = false
    /** Ids, die bereits gezielt nachgeladen wurden (kein zweiter REQ je Id). */
    const requested = new Set<string>()
    /**
     * Pin-Ereignisse (`40004`), deren Löschung der Relay **bestätigt** hat.
     *
     * **Warum das nötig ist — gemessen, nicht vermutet:** Ein `kind 5` entfernt das
     * Ziel-Ereignis auf dem Relay (nachgewiesen: die anschliessende `40004`-Abfrage ist
     * leer), aber der lokale welshman-`repository` erfährt davon nicht von selbst. Seine
     * Lösch-Buchführung greift nur, wenn das `kind 5` DORT ankommt und
     * `isDeleted(target)` wahr wird (`@welshman/net/dist/net/src/repository.js:175-181`);
     * unsere Pin-Subscription fragt aber ausschliesslich `{kinds:[40004]}`, und ein
     * gelöschtes Ereignis wird vom Relay nicht noch einmal geschickt. Ergebnis ohne diese
     * Menge, im Browser gemessen: nach dem Klick blieb der Eintrag stehen, `busy` lief
     * 6,6 s in die Wirkungs-Zeitgrenze und der Nutzer bekam
     * „Das Relay hat den Pin nicht übernommen." — obwohl der Pin weg war.
     *
     * Das ist **kein** Rückfall auf „`OK true` heisst Erfolg": die Quittung gehört hier zu
     * einem LÖSCH-Kommando, sie ist also genau die Aussage, die wir brauchen. Und sie ist
     * selbstkorrigierend: hätte der Relay gelogen, brächte der nächste Bestands-`load`
     * den Pin zurück (die Menge unterdrückt nur, was der Relay nicht mehr liefert).
     */
    const confirmedUnpinned = new Set<string>()
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
                unsubAdmin()
                unsubAdmin = deriveUserIsSpaceAdmin(url).subscribe((admin: boolean) => {
                    isAdmin = admin
                    recomputePermissions()
                })
                // „Darf hier überhaupt geschrieben werden?" — und die Antwort steht auf den
                // beiden Relays an **verschiedenen Orten**. Wieder eine Matrix, keine Zeile:
                //
                //  - **zooid** führt die Raum-Mitgliedschaft in der relay-signierten 39002
                //    (`d` = Raum-`h`, `p` = Mitglieder). `deriveUserInRoom` liest genau die.
                //  - **Buzz** tut das NICHT. Am Testrelay nachgemessen enthält die 39002 des
                //    Kanals `welcome` ausschließlich den Owner
                //    (`[["d","a956ca5e-…"],["p","4b3cac49…","","owner"]]`), während das
                //    normale Mitglied `9db3b9da…` dort fehlt — und trotzdem nachweislich
                //    pinnen darf (`OK true` auf sein 40004). Buzz gatet Schreibrechte an der
                //    **Relay**-Mitgliedschaft plus offener Kanal-Sichtbarkeit
                //    (`ingest.rs`, `check_channel_membership`: „member OR open-visibility
                //    channel"), nicht an einer Kanal-Mitgliederliste.
                //
                // Mit `deriveUserInRoom` als Buzz-Signal war `canPin` für jedes normale
                // Mitglied dauerhaft `false` — der Menüpunkt „Anpinnen" erschien nie, obwohl
                // der Pin funktioniert hätte. Dass das Signal auf Buzz nicht trägt, ist
                // unabhängig belegt: derselbe `joined`-Wert hält dort schon den Composer zu
                // (bekannter Befund `buzz-room.spec.ts:429`, älter als P6).
                unsubMember()
                unsubMember = deriveCanWriteHere(url, h).subscribe((may: boolean) => {
                    canWriteHere = may
                    recomputePermissions()
                })
                // Die Relay-Art **reaktiv**, genau wie die beiden Nachbarfelder darüber.
                // `deriveRelay` stößt den NIP-11-Fetch selbst an (`makeDeriveItem` ruft
                // `onDerive` = `loadRelay`, `@welshman/store/dist/store/src/repository.js:264-270`)
                // und meldet erneut, sobald das Dokument da ist.
                //
                // **Hier stand vorher `spaceIsBuzz(url)` — synchron und genau einmal.**
                // Diese Funktion liefert dokumentiert `false`, solange NIP-11 unterwegs
                // ist (`buzzAdmin.ts:73-91`); für ihre übrigen Aufrufer ist das richtig,
                // weil die synchron kurz vor einem Klick fragen. Beim Mount gefragt und
                // nie wieder, blieb die Antwort für die ganze Lebensdauer der Insel bei
                // `false`: auf Buzz schickte `toggle()` dann `kind 9010` (zooid) und
                // erntete `restricted: unknown event kind`, und ein normales Mitglied sah
                // den Menüpunkt gar nicht erst, weil `mayPin(false, isAdmin=false, …)`
                // falsch ist. Dieselbe Begründung steht seit P4 in `bridge.ts` → `nostrSpaces._unsubIsBuzz` (`deriveRelay(url).subscribe`) —
                // dort wurde sie befolgt, hier nicht.
                // Dritte Stelle derselben Bauart, gefunden beim Nachaudit: der Autorname
                // kommt aus `displayProfileByPubkey` und wird in `recompute` **einmal**
                // gelesen. Ein Pin kann aber älter sein als das geladene Fenster — dann
                // lädt die Rauminsel das Profil seines Autors nie, und in der Leiste
                // stünde dauerhaft die npub-Kurzform (`profiles.js:19` fällt darauf
                // zurück). Gedrosselt wie in `feeds.ts:1768`, damit nicht jede
                // Profil-Lieferung der App die Leiste neu baut.
                unsubProfiles()
                unsubProfiles = throttled(300, profilesByPubkey).subscribe(() => {
                    if (self.entries.some((e) => !e.resolved || !e.name)) {
                        recompute()
                    }
                })
                unsubBuzz()
                unsubBuzz = deriveRelay(url).subscribe((relay) => {
                    const isBuzz = isBuzzRelay(relay ?? undefined)
                    self.isBuzz = isBuzz
                    recomputePermissions()
                    armSource(url, h, isBuzz)
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
            return mayUnpin(self.isBuzz, isAdmin, canWriteHere, entry.pinnedBy, get(pubkey) ?? '')
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
        // Das Relay-Art-Abo läuft über DENSELBEN Aufräumer wie die anderen — es ist
        // damit durch BEIDE Riegel aus `unmount` gedeckt (Zähler und Raum-Argument),
        // sonst hinge nach einem Raumwechsel ein Abo an einem Raum, den niemand sieht.
        unsubBuzz()
        unsubProfiles()
        unsubSpace()
        unsubSource = noop
        unsubAdmin = noop
        unsubMember = noop
        unsubBuzz = noop
        unsubProfiles = noop
        unsubSpace = noop
        armedFor = null
        rawPins = []
        pinList = null
        requested.clear()
        confirmedUnpinned.clear()
        self.h = ''
        self.url = ''
        self.entries = []
        self.canPin = false
        self.busy = false
        self.error = ''
    }

    /**
     * Lesequelle, Bestands-Load und Live-Sub auf **eine** Relay-Art aufziehen.
     *
     * Warum das eine eigene Funktion ist und nicht in der `activeSpace`-Subscription
     * bleibt: die Relay-Art vergiftete nicht nur die Rechte, sondern **drei** Dinge —
     * den Lesefilter ({@link derivePinSource}), den einmaligen Bestands-`load` und die
     * Live-`request`. `isBuzz` bloß reaktiv zu machen hätte die Rechte geheilt und den
     * Client weiter auf dem falschen Filter lauschen lassen: die Pin-Leiste bliebe auf
     * Buzz leer, nur eben mit sichtbarem Knopf. Ändert sich die Antwort, wird alles drei
     * neu aufgezogen.
     *
     * `armedFor` verhindert das überflüssige Neuaufziehen bei jeder weiteren Meldung von
     * `deriveRelay` (die feuert auch, wenn sich am Info-Dokument etwas anderes ändert).
     * Verglichen wird der **Schlüssel**, nicht der Wert — sonst käme der allererste Lauf
     * nie durch, weil `isBuzz` dort zufällig dem Anfangswert `false` gleicht.
     */
    const armSource = (url: string, h: string, isBuzz: boolean): void => {
        const key = `${url}|${h}|${isBuzz ? 'buzz' : 'zooid'}`
        if (armedFor === key) {
            return
        }
        armedFor = key
        unsubSource()
        unsubSource = derivePinSource(url, h, isBuzz).subscribe((events: PinEventLike[]) => {
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
        void load({ relays: [url], filters: pinFilters(h, isBuzz) })
        void request({
            relays: [url],
            signal: controller.signal,
            filters: pinFilters(h, isBuzz).map((f) => ({ ...f, limit: 0 })),
        })
    }

    const recomputePermissions = (): void => {
        self.canPin = mayPin(self.isBuzz, isAdmin, canWriteHere)
    }

    /** Aus den Roh-Pins die Anzeige-Zeilen bauen und Fehlendes gezielt nachladen. */
    const recompute = (): void => {
        let ids: string[]
        let pinnedByById = new Map<string, string>()

        const visiblePins = rawPins.filter((e) => !confirmedUnpinned.has(e.id))

        if (self.isBuzz) {
            const entries = buzzPinEntries(visiblePins)
            ids = entries.map((e) => e.targetId)
            pinnedByById = new Map(entries.map((e) => [e.targetId, e.pinnedBy]))
        } else {
            // Zweiter Riegel gegen die 39005-Kollision, unabhängig von der Relay-Bindung
            // oben: eine Buzz-Thread-Zusammenfassung ist kein Pin, auch wenn sie je durch
            // einen Filter ohne `tracker` hierher fände.
            pinList = visiblePins.find((e) => isZooidPinList(e)) ?? null
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
            // dauerhaft ein Platzhalter.
            //
            // **`.then(recompute)` ist nicht optional.** Hier stand, das Ergebnis lande im
            // Repository und löse `recompute` „über die Ableitung oben" erneut aus — das
            // war schlicht falsch: die Ableitung hört auf `{kinds:[39005],'#d':[h]}` bzw.
            // `{kinds:[40004],'#h':[h]}`, und eine nachgeladene **Nachricht** (kind 9 /
            // 40002) passt auf keinen der beiden Filter. Sie feuert also nicht, die Zeile
            // bliebe für immer auf „Nachricht wird geladen…" stehen und ihr Sprung-Knopf
            // abgeschaltet. Dieselbe Klasse Fehler wie die Relay-Art weiter oben: ein Wert
            // trifft später ein und wird nie wieder gelesen. Der `requested`-Wächter
            // verhindert dabei die Endlosschleife — der zweite Durchlauf findet nichts
            // Fehlendes mehr und lädt nicht erneut.
            void load({ relays: [self.url], filters: [{ ids: missing }] }).then(() => recompute())
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
        for (let i = 0; i < commands.length; i++) {
            const failure = await publishPin(commands[i].kind, commands[i].tags)
            // „Ziel nicht gefunden" heißt: schon weg. Das ist der gewünschte Zustand,
            // kein Fehlschlag — und ein Toast lüde hier zum Wiederholen ein, das
            // denselben Fehler erneut erzeugte.
            if (failure && !isAlreadyGoneError(failure)) {
                return failure
            }
            // Bestätigt gelöscht (oder ohnehin schon weg) → lokal ausblenden. Begründung
            // an {@link confirmedUnpinned}.
            confirmedUnpinned.add(targets[i])
        }
        recompute()
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
