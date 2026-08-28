/**
 * Lesestand über Nostr abgleichen (P6) — kind 30078 (NIP-78), `d`-Tag
 * {@link READ_STATE_D}, Inhalt **nip44-self-verschlüsselt**, an die **Outbox-Relays des
 * Users UND den aktiven Space** ({@link syncRelays} begründet, warum beides). Gelesen
 * wird aus demselben Satz — ein zweiter Schreibweg, aus dem niemand liest, hülfe nur
 * halb. Das Event ist adressierbar, jedes Publish ersetzt das vorige — jedes Relay hält
 * genau eins.
 *
 * Warum ein eigenes Modul und nicht in `readState.ts`: dort liegen die reinen Funktionen,
 * die unter `node --test` laufen. Der Netz-Pfad zieht `@welshman/net` + Router + Signer;
 * er hängt hier und wird von `initReadState()` **dynamisch** nachgeladen.
 *
 * Fail-soft wie der Rest des Lesestands: kein Netz, kein Signer, ein ablehnendes Relay —
 * nichts davon darf einen Chat-Flow oder den Boot brechen. Der lokale Stand trägt weiter,
 * es kostet höchstens Konvergenz. Deshalb gibt es hier keine Fehler nach außen, nur eine
 * einmalige Konsolen-Warnung.
 *
 * **Größe:** die publizierte Karte ist separat gedeckelt (`PUBLISHED_READ_STATE_CAP`,
 * dort stehen die gemessenen Byte-Zahlen). Ungedeckelt wären es 76 548 B `content` —
 * über der 64-KB-Grenze, die verbreitete Relays setzen. Die **Anzahl** der Events ist
 * dagegen unkritisch: kind 30078 ist adressierbar, zooid ersetzt statt anzuhängen
 * (`zooid/events.go:353`), also genau ein Event pro Nutzer und Relay.
 *
 * **Bewusste Grenze (Kappung + synthetisches `all`):** publiziert wird die lokale Karte
 * NACH Prune. Ein Gerät, das gerade erst geseedet hat, hat die vom Seed dominierten
 * Fremd-Keys lokal weggeworfen (`readState.ts pruneReadState`) und publiziert eine
 * dünnere Karte, als das Relay hatte — ein *drittes*, frisches Gerät sieht diese Räume
 * dann wieder als ungelesen. Die Richtung ist die konservative („zu wenig gelesen", nie
 * „fälschlich gelesen"), und die Alternative wäre, den Prune auszuhebeln, der die Karte
 * überhaupt erst klein hält. Bestehende Geräte verlieren nichts: bei ihnen ist der Merge
 * grow-only.
 */
import { get } from 'svelte/store'
import { pubkey, nip44EncryptToSelf, ensurePlaintext } from './welshmanSession.ts'
import { publishThunk, waitForThunkCompletion } from './welshmanApp.ts'
import { load, PublishStatus } from '@welshman/net'
import { Router } from '@welshman/router'
import { isRelayUrl, makeEvent, normalizeRelayUrl, type TrustedEvent } from '@welshman/util'
import { APP_DATA } from './welshmanKinds.ts'
import { getTagValue } from './welshmanTags.ts'
// Die relativen Importe tragen ABSICHTLICH ihre `.ts`-Endung (siehe `unread.ts`): Nodes
// ESM-Auflösung kennt keine extensionslosen Pfade — ohne sie liefe `node --test
// readStateSync.test.ts` in ERR_MODULE_NOT_FOUND.
import {
    READ_STATE_D,
    getBootstrapAll,
    mergeReadState,
    mergeRemoteReadState,
    nowSec,
    publishableReadState,
    readState,
    readStateReady,
    sanitizeReadState,
    type ReadState,
} from './readState.ts'

/**
 * Drossel des Publishs: **30 s**, Fenster ab der ersten Änderung (kein Zurücksetzen bei
 * weiteren Änderungen, sonst könnte Dauer-Aktivität den Publish beliebig verschieben).
 *
 * Die Zahl: der lokale IDB-Flush läuft alle 2 s (`readState.ts FLUSH_DELAY_MS`) — der
 * Netz-Pfad ist um den Faktor 15 gröber, weil er ungleich teurer ist. Ein Publish kostet
 * eine Signatur (bei NIP-46/Amber ein Relay-Roundtrip, kein lokaler Aufruf) plus einen
 * Write je Outbox-Relay. Eine typische Lese-Session — Raum auf, scrollen, zurück,
 * nächster Raum — erzeugt 3–6 Wasserzeichen und landet so in EINEM Event statt in sechs;
 * weil kind 30078 adressierbar ist, wären die fünf anderen ohnehin sofort überschrieben.
 * Der Preis ist eine bis zu 30 s alte Karte auf dem Zweitgerät — deutlich unter der Zeit,
 * die ein Gerätewechsel braucht.
 */
export const PUBLISH_DEBOUNCE_MS = 30_000

/**
 * Mindestpause zwischen zwei **Ladevorgängen** des Fremdstands: **30 s**, bewusst
 * derselbe Wert wie {@link PUBLISH_DEBOUNCE_MS} — und zwar nicht aus Symmetrie-Ästhetik,
 * sondern weil er die Schranke der Gegenseite ist. Ein anderes Gerät schiebt sein
 * Wasserzeichen frühestens nach seiner eigenen 30-s-Drossel auf die Relays; öfter zu
 * laden kann per Konstruktion nichts Neues finden, es kostet nur eine REQ je Relay
 * (Outbox + Space) plus eine nip44-Entschlüsselung.
 *
 * Der Fall, den die Pause abwehrt: ein Nutzer, der im Minutentakt zwischen Apps wechselt,
 * erzeugte sonst je Wechsel einen Relay-Roundtrip. Der Preis ist im schlechtesten Fall
 * eine um 30 s verzögerte Badge-Aktualisierung — unter der Zeit, die der Publish auf der
 * anderen Seite ohnehin schon gekostet hat.
 */
export const RELOAD_MIN_INTERVAL_MS = 30_000

/** Ein Relay-Ergebnis: `ok=false` trägt den Relay-Grund. Form wie `profiles.ts:132`. */
export type RelayPublishResult = { url: string; ok: boolean; reason: string }

/**
 * thunk-Results → flache Per-Relay-Liste. **Nie First-Failure:** in diesem Projekt gilt
 * „≥ 1 akzeptierendes Relay = gespeichert" (`profiles.ts summarizePublishResults`, gleiche
 * Regel, gleiche Form). Bewusst dupliziert statt importiert: `./profiles` zieht `./core`
 * und damit den kompletten App-Boot (IndexedDB, welshman-Kontext) — dieses Modul wäre
 * dann nicht mehr unter `node --test` ladbar. Sieben Zeilen zu spiegeln ist der kleinere
 * Preis als ein untestbarer Sync (dasselbe Argument wie `unread.ts` für `CHAT_THREAD`).
 */
export const summarizeReadStatePublish = (
    results: Record<string, { relay: string; status: string; detail?: string }>,
): RelayPublishResult[] =>
    Object.values(results).map((r) => ({
        url: r.relay,
        ok: r.status === PublishStatus.Success,
        reason: r.status === PublishStatus.Success ? '' : r.detail || r.status,
    }))

/**
 * Karte → kanonisches JSON (Keys sortiert). Der Vergleich „habe ich das schon
 * publiziert?" läuft über diesen String; ohne feste Reihenfolge hinge er an der
 * Einfüge-Reihenfolge des Objekts und publizierte dieselbe Karte erneut.
 */
export const readStateJson = (state: ReadState): string => {
    const sorted: ReadState = {}
    for (const key of Object.keys(state).sort()) {
        sorted[key] = state[key]
    }
    return JSON.stringify(sorted)
}

/**
 * Entschlüsselter Event-Inhalt → Karte. **Wirft nie**: ein fremdes, kaputtes oder
 * halb-entschlüsseltes Event darf den Sync nicht abbrechen und schon gar nicht den
 * Store vergiften — {@link sanitizeReadState} wirft alles weg, was keine positive,
 * endliche Zahl unter einem plausibel kurzen Key ist.
 *
 * Arrays fallen hier zusätzlich raus, bevor sie `sanitizeReadState` erreichen: ein
 * `[1,2,3]` ist für `Object.entries` ein Objekt mit den Keys `"0"/"1"/"2"` und käme als
 * drei gültige Wasserzeichen durch. Schaden richtete das keinen an (die Keys gehören zu
 * keinem Raum), aber es belegte Plätze unter `READ_STATE_CAP`.
 *
 * `ceiling` reicht bis zu `sanitizeReadState` durch: ein empfangener Wert `> nowSec()`
 * (fehlgestellte Uhr eines eigenen Geräts) wird auf die eigene Wall-Clock gedeckelt,
 * damit die geladene Karte identisch zu der ist, die {@link mergeRemoteReadState} in den
 * Store schreibt — sonst wiche `lastPublishedJson` ab und löste einen überflüssigen
 * Nachhol-Publish aus. Default `Infinity` = node-testbar ohne Uhr.
 */
export const parseReadStateContent = (plaintext: string | undefined, ceiling = Infinity): ReadState => {
    if (!plaintext) {
        return {}
    }
    try {
        const parsed: unknown = JSON.parse(plaintext)
        return Array.isArray(parsed) ? {} : sanitizeReadState(parsed, ceiling)
    } catch {
        return {} // kein JSON (fremdes Format, fehlgeschlagene Entschlüsselung)
    }
}

/**
 * Zielrelays des Lesestands: **Outbox UND aktiver Space**, dedupliziert.
 *
 * Warum der Space-Relay dazugehört: mit Nur-Outbox wäre das Feature für jeden Nutzer
 * **ohne kind-10002 still inaktiv** — `Router.FromUser()` fällt bewusst auf NICHTS
 * zurück (Policy `addNoFallbacks`, `@welshman/router/dist/index.js:124`), es gäbe also
 * weder Publish noch Laden und keinerlei Meldung darüber. Für eine Zusage
 * „Lesestand über Geräte hinweg" ist das kein tragbarer Zustand. Der Space-Relay ist
 * member-gegatet, und der Inhalt ist ohnehin nip44-self-verschlüsselt — er sieht einen
 * Blob, keine Raum-IDs.
 *
 * Rein und node-testbar; die unreine Hälfte (aktive Space-URL besorgen) steht unten.
 * Gefiltert wird mit `isRelayUrl` (lässt `ws://localhost:…` bewusst durch — der
 * Test-zooid ist im E2E der Space-Relay) und normalisiert, damit ein Space, der auch in
 * der NIP-65-Liste steht, nicht zweimal angeschrieben wird.
 */
export const syncRelays = (outbox: readonly string[], space: string): string[] => {
    const out: string[] = []
    for (const url of [...outbox, space]) {
        if (typeof url !== 'string' || url === '' || !isRelayUrl(url)) {
            continue
        }
        let normalized = url
        try {
            normalized = normalizeRelayUrl(url)
        } catch {
            // `normalizeRelayUrl` zieht eine fremde URL-Bibliothek — eine Exoten-URL
            // darf den ganzen Satz nicht kippen; dann eben unnormalisiert.
        }
        if (!out.includes(normalized)) {
            out.push(normalized)
        }
    }
    return out
}

/**
 * Darf jetzt nachgeladen werden? Rein, damit die beiden Riegel unter `node --test`
 * prüfbar sind — die unreine Hälfte ist {@link refreshRemoteReadState}.
 *
 * Riegel 1 — **Mindestpause** ({@link RELOAD_MIN_INTERVAL_MS}): ein App-Wechsel im
 * Sekundentakt darf keine REQ-Flut auslösen.
 *
 * Riegel 2 — **kein Laden über einem noch nicht publizierten lokalen Stand**
 * (`publishPending` = ein Publish ist eingeplant oder gerade unterwegs). Das ist der
 * Riegel, der das Rückgängig von `markAllRead` schützt: der Merge ist grow-only, ein
 * Nachladen könnte ein zurückgenommenes `all` also nur wieder ANHEBEN, nie senken.
 * Solange der Publish der zurückgenommenen Karte aussteht, liegt auf den Relays noch der
 * alte, höhere Wert — er käme postwendend zurück und machte das Rückgängig zunichte.
 * Nach dem Publish trägt das Relay die gesenkte Karte (kind 30078 ist adressierbar, das
 * Event wird ERSETZT, `zooid/events.go:353`) und das Nachladen ist wieder harmlos.
 * Verzögern kostet ≤ 30 s Konvergenz; die Reihenfolge „erst schreiben, dann lesen" ist
 * ohnehin die, die eine Divergenz auflöst statt sie zu verewigen.
 *
 * Verhungern kann das Laden dadurch nicht: `schedulePublish` setzt seinen Timer nur nach
 * einer echten Änderung, und ein dauerhaft ablehnendes Relay löst bewusst keinen
 * Dauer-Retry aus (siehe `finally` in {@link publishReadState}).
 */
export const shouldReloadRemote = (
    now: number,
    lastLoadAt: number,
    publishPending: boolean,
    minInterval = RELOAD_MIN_INTERVAL_MS,
): boolean => !publishPending && now - lastLoadAt >= minInterval

// ── Netz ───────────────────────────────────────────────────────────────────

let started = false
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<RelayPublishResult[]> | null = null
/** `Date.now()` des letzten Ladeversuchs (0 = noch nie), Basis der Mindestpause. */
let lastRemoteLoadAt = 0
/** Kanonisches JSON dessen, was die Relays nachweislich schon haben. */
let lastPublishedJson = ''
let warned = false

const warnOnce = (error: unknown): void => {
    if (!warned) {
        warned = true
        console.warn('[readstate] Sync fehlgeschlagen — der lokale Lesestand trägt weiter', error)
    }
}

/** Outbox = die Schreib-Relays des Users (NIP-65). Ohne kind-10002 leer, siehe {@link syncRelays}. */
const outboxRelays = (): string[] => Router.get().FromUser().getUrls()

/**
 * Die aktive Space-URL — **dynamisch** importiert: `js/groups.ts` bootet beim Import den
 * halben App-Graphen (welshman-Kontext, Raum-Abos, Push-Zustand). Ein statischer Import
 * zöge das in jeden Test dieses Moduls. Gleiches Muster wie `readState.ts` bei
 * `./session.ts`.
 *
 * Bis P2 des Plans `js-insel-testbar-machen` stand hier ein härterer Grund — `groups.ts`
 * sei unter `node --test` überhaupt nicht ladbar (endungslose Importe, dazu ein
 * `localStorage`-Zugriff beim Modul-Eval). Beides ist behoben; der Import bleibt trotzdem
 * dynamisch, weil der Boot-Aufwand steht.
 *
 * Kein Space, kaputter Import, kein Browser ⇒ leerer String; {@link syncRelays} wirft ihn
 * weg und der Sync läuft mit der Outbox allein weiter.
 */
const spaceRelay = async (): Promise<string> => {
    try {
        const { activeSpace } = await import('./groups.ts')
        return get(activeSpace) || ''
    } catch {
        return ''
    }
}

/** Ziel beider Richtungen (Publish wie Laden) — sonst hülfe der zweite Schreibweg nur halb. */
const targetRelays = async (): Promise<string[]> => syncRelays(outboxRelays(), await spaceRelay())

/** Was dieses Gerät publizieren darf — ohne den synthetischen `all`-Startwert. */
const payload = (): ReadState => publishableReadState(get(readState), getBootstrapAll())

/**
 * Den publizierten Lesestand von den Outbox-Relays holen.
 *
 * **Alle Fundstellen werden gemergt, nicht die jüngste genommen.** Die Karte ist ein
 * Grow-only-Max-Register: zwei Relays mit auseinandergelaufenen Kopien tragen beide
 * gültige Information, und „jüngstes `created_at` gewinnt" würde die ältere Hälfte
 * wegwerfen. Der Merge heilt die Divergenz zusätzlich — der anschließende Nachhol-Publish
 * schreibt die vereinigte Karte an beide zurück.
 *
 * Riegel pro Zeile (nicht nur ein `try` außen herum): Autor, Kind und `d`-Tag werden
 * einzeln geprüft, und eine fehlschlagende Entschlüsselung überspringt genau dieses
 * Event statt den ganzen Lauf. Ein Relay, das auf einen `authors`-Filter etwas Fremdes
 * zurückgibt, ist damit folgenlos.
 */
export const loadRemoteReadState = async (): Promise<ReadState> => {
    const pk = pubkey.get()
    const relays = await targetRelays()
    if (!pk || relays.length === 0) {
        return {}
    }
    const events: TrustedEvent[] = await load({
        relays,
        filters: [{ kinds: [APP_DATA], authors: [pk], '#d': [READ_STATE_D], limit: 1 }],
    })
    let out: ReadState = {}
    for (const event of events) {
        if (event.pubkey !== pk || event.kind !== APP_DATA || getTagValue('d', event.tags) !== READ_STATE_D) {
            continue
        }
        let plaintext: string | undefined
        try {
            plaintext = await ensurePlaintext(event)
        } catch {
            continue // fremder Schlüssel/kaputter Payload → dieses Event überspringen
        }
        out = mergeReadState(out, parseReadStateContent(plaintext, nowSec()))
    }
    return out
}

/**
 * Den Fremdstand NACHLADEN und einmergen — der Rückweg zum `hidden`-Publish.
 *
 * Ohne ihn lief {@link loadRemoteReadState} genau einmal pro Boot: wer am Laptop las,
 * sah das Badge am Handy stehen, bis die App komplett neu startete — ein Wechsel in den
 * Vordergrund reichte nicht (am Gerät gemessen 2026-07-27).
 *
 * Fail-soft und **nie senkend**: {@link mergeRemoteReadState} ist ein Grow-only-Max über
 * {@link mergeReadState} und deckelt jeden empfangenen Wert auf `nowSec()`.
 *
 * `lastPublishedJson` wird hier BEWUSST nicht angefasst, anders als beim Erstlauf in
 * {@link initReadStateSync}. Dort ist die Aussage „das haben die Relays schon" korrekt,
 * weil vorher nichts publiziert wurde. Hier wäre sie riskant: ein Ladevorgang, der
 * (Netz-Hickser, Relay antwortet nicht) leer zurückkommt, setzte den gemerkten Stand auf
 * `{}` zurück und löste einen überflüssigen Voll-Publish aus. Hebt der Merge den lokalen
 * Stand dagegen wirklich an, feuert ohnehin die `readState`-Subscription und der
 * Nachhol-Publish schreibt die vereinigte Karte an alle Relays zurück — genau die
 * Selbstheilung, die {@link loadRemoteReadState} beschreibt.
 */
export const refreshRemoteReadState = async (): Promise<void> => {
    if (!shouldReloadRemote(Date.now(), lastRemoteLoadAt, timer !== null || inFlight !== null)) {
        return
    }
    // VOR dem `await` gesetzt: sonst liefe die Pause erst ab dem Ende des Ladevorgangs,
    // und zwei schnelle Vordergrund-Wechsel öffneten zwei REQs nebeneinander.
    lastRemoteLoadAt = Date.now()
    try {
        mergeRemoteReadState(await loadRemoteReadState())
    } catch (error) {
        warnOnce(error)
    }
}

/**
 * Den aktuellen Lesestand publizieren, wenn er sich seit dem letzten erfolgreichen
 * Publish geändert hat. Gibt die **Per-Relay**-Ergebnisse zurück (leer = nichts zu tun
 * oder fail-soft abgebrochen); ein einzelnes ablehnendes Relay ist kein Fehlschlag,
 * gemerkt wird der Stand, sobald **mindestens eins** akzeptiert hat.
 *
 * Ein zweiter Aufruf während eines laufenden Publishs startet kein zweites Event,
 * sondern hängt sich an das laufende: kind 30078 ist adressierbar, zwei überlappende
 * Publishes könnten sich am Relay in falscher Reihenfolge überschreiben.
 */
export const publishReadState = async (): Promise<RelayPublishResult[]> => {
    if (timer) {
        clearTimeout(timer)
        timer = null
    }
    if (inFlight) {
        return inFlight
    }
    const map = payload()
    const json = readStateJson(map)
    if (Object.keys(map).length === 0 || json === lastPublishedJson || !pubkey.get()) {
        return []
    }
    inFlight = (async () => {
        try {
            // Die Relayliste wird HIER geholt, nicht vor `inFlight`: die aktive Space-URL
            // kommt aus einem dynamischen Import und ist damit asynchron. Leer (weder
            // kind-10002 noch Space) ⇒ nichts zu senden, fail-soft wie überall.
            const relays = await targetRelays()
            if (relays.length === 0) {
                return []
            }
            const content = await nip44EncryptToSelf(json)
            const thunk = publishThunk({ event: makeEvent(APP_DATA, { content, tags: [['d', READ_STATE_D]] }), relays })
            await waitForThunkCompletion(thunk)
            const results = summarizeReadStatePublish(thunk.results)
            if (results.some((r) => r.ok)) {
                lastPublishedJson = json
            }
            return results
        } catch (error) {
            // Kein Signer (Gast/abgemeldet), kein Netz, Verschlüsselung abgelehnt:
            // `publishThunk` wirft synchron ohne aktiven Signer. Alles fail-soft.
            warnOnce(error)
            return []
        } finally {
            inFlight = null
            // Was sich WÄHREND dieses Publishs geändert hat, hat `schedulePublish`
            // verworfen (es startet nichts neben einem laufenden Publish). Ohne diese
            // Zeile bliebe es liegen, bis der Nutzer das nächste Mal etwas liest.
            //
            // Verglichen wird gegen die eben gesendete Karte, NICHT gegen den zuletzt
            // bestätigten Stand: sonst schöbe ein dauerhaft ablehnendes Relay einen
            // Retry alle 30 s nach — endlos, auch ohne dass jemand etwas liest. Ein
            // fehlgeschlagenes Publish wird bewusst nicht wiederholt; es holt der
            // Nachhol-Publish beim nächsten Start nach ({@link initReadStateSync}).
            if (readStateJson(payload()) !== json) {
                schedulePublish()
            }
        }
    })()
    return inFlight
}

const schedulePublish = (): void => {
    if (timer || inFlight) {
        return
    }
    timer = setTimeout(() => {
        timer = null
        void publishReadState()
    }, PUBLISH_DEBOUNCE_MS)
}

/**
 * Idempotenter Einstieg, von `initReadState()` dynamisch nachgeladen.
 *
 * Reihenfolge: lokalen Stand abwarten → Fremdstand holen → mergen → EINMAL nachziehen.
 * Der Nachhol-Publish ist die Selbstheilung für alles, was unterwegs verloren ging (ein
 * beim Tab-Schluss abgebrochenes Publish, ein Lauf ganz ohne Netz): er vergleicht die
 * lokale Karte mit dem, was die Relays nachweislich haben, und schickt nur eine
 * Differenz. Ohne ihn bliebe ein verlorenes Publish liegen, bis der Nutzer zufällig das
 * nächste Wasserzeichen setzt.
 */
export function initReadStateSync(): void {
    if (started) {
        return
    }
    started = true
    void (async () => {
        try {
            await readStateReady
            if (!pubkey.get()) {
                return // Gast: nichts zu holen, nichts zu senden
            }
            lastRemoteLoadAt = Date.now()
            const remote = await loadRemoteReadState()
            lastPublishedJson = readStateJson(remote) // das haben die Relays schon
            mergeRemoteReadState(remote)
            await publishReadState()
        } catch (error) {
            warnOnce(error)
        }
        // Jede weitere Änderung (eigenes Lesen, Zweit-Tab per BroadcastChannel) nachziehen.
        //
        // Der `try` INNEN ist Pflicht, nicht Zierde: ein Wurf im Callback eines
        // svelte-Stores reißt die globale `subscriber_queue` (5.56.4) dauerhaft mit —
        // danach bekommt kein einziger `writable` im Tab mehr Updates, auch völlig
        // unbeteiligte. Deshalb darf hier nichts nach außen dringen; der Callback tut
        // ohnehin nur eins: einen Timer setzen.
        try {
            readState.subscribe(() => {
                try {
                    schedulePublish()
                } catch (error) {
                    warnOnce(error)
                }
            })
        } catch (error) {
            warnOnce(error)
        }
        // Ein geschlossener Tab darf die letzten 30 s nicht verschlucken. `hidden` ist
        // der letzte Moment, in dem ein Publish noch starten kann (dieselbe Stelle, an
        // der `readState.ts` seinen IDB-Flush erzwingt).
        //
        // **Offen benannt:** stirbt der Tab, während die Signatur läuft, geht dieses
        // Publish verloren — abwarten kann man einen sterbenden Tab nicht. Der Verlust
        // ist folgenlos, weil er nicht dauerhaft ist: der Nachhol-Publish oben schickt
        // die Differenz beim nächsten Start.
        //
        // Die Gegenrichtung (`visible`) ist der Rückweg: ein am Zweitgerät gesetzter
        // Lesestand kam vorher erst nach einem kompletten Neustart an, weil
        // `loadRemoteReadState()` ein One-Shot aus diesem Init war. Gedrosselt über
        // {@link shouldReloadRemote} — ein Nutzer, der im Sekundentakt zwischen Apps
        // wechselt, darf keine REQ-Flut auslösen.
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    void publishReadState()
                    return
                }
                void refreshRemoteReadState()
            })
        }
    })()
}
