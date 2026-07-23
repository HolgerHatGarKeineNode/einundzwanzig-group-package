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
import { pubkey, publishThunk, waitForThunkCompletion, nip44EncryptToSelf, ensurePlaintext } from '@welshman/app'
import { load, PublishStatus } from '@welshman/net'
import { Router } from '@welshman/router'
import { APP_DATA, getTagValue, isRelayUrl, makeEvent, normalizeRelayUrl, type TrustedEvent } from '@welshman/util'
// Die relativen Importe tragen ABSICHTLICH ihre `.ts`-Endung (siehe `unread.ts`): Nodes
// ESM-Auflösung kennt keine extensionslosen Pfade — ohne sie liefe `node --test
// readStateSync.test.ts` in ERR_MODULE_NOT_FOUND.
import {
    READ_STATE_D,
    getBootstrapAll,
    mergeReadState,
    mergeRemoteReadState,
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
 */
export const parseReadStateContent = (plaintext: string | undefined): ReadState => {
    if (!plaintext) {
        return {}
    }
    try {
        const parsed: unknown = JSON.parse(plaintext)
        return Array.isArray(parsed) ? {} : sanitizeReadState(parsed)
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

// ── Netz ───────────────────────────────────────────────────────────────────

let started = false
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<RelayPublishResult[]> | null = null
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
 * Die aktive Space-URL — **dynamisch** importiert, aus einem harten Grund: `js/groups.ts`
 * ist unter `node --test` nicht ladbar (extensionslose relative Importe, dazu ein
 * `localStorage`-Zugriff beim Modul-Eval). Ein statischer Import risse die Tests dieses
 * Moduls mit. Gleiches Muster wie `readState.ts` bei `./session`.
 *
 * Kein Space, kaputter Import, kein Browser ⇒ leerer String; {@link syncRelays} wirft ihn
 * weg und der Sync läuft mit der Outbox allein weiter.
 */
const spaceRelay = async (): Promise<string> => {
    try {
        const { activeSpace } = await import('./groups')
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
        out = mergeReadState(out, parseReadStateContent(plaintext))
    }
    return out
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
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    void publishReadState()
                }
            })
        }
    })()
}
