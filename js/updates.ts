/**
 * Benachrichtigungs-Zeilen (P4) — die **Liste**, nicht der Punkt.
 *
 * Geschwister-Modul zu `unread.ts`: dieselben zwei Quellen, dieselbe Drosselung, aber die
 * Projektion liefert ZEILEN statt Flags.
 *
 *     repository (Events, url-gescopt über den tracker)  ─┐
 *     readState  (Wasserzeichen, Wall-Clock)             ─┴─> throttled(300) ─> UpdateItem[]
 *
 * Damit kann die Liste nie gegen den Punkt oder den Feed divergieren — alle drei lesen
 * dieselbe `repository` und dieselbe Wasserzeichen-Karte.
 *
 * `UpdateItem` ist der **verbindliche Vertrag zur Oberfläche**: Blade-View und
 * Alpine-Insel werden gegen diese Feldnamen gebaut. Jede Zeile ist fertig gerechnet —
 * inklusive `href` mit `?from=updates` und deutschem `timeLabel`. Die View navigiert und
 * kürzt (`line-clamp`), sie rechnet nicht.
 *
 * **Warum hier dupliziert statt importiert wird** (drei Symbole, je gemessen):
 *   • `CHAT_THREAD = 10` und {@link updatesCommentRootId} stehen wörtlich auch in
 *     `feeds.ts` — `feeds.ts` zieht über `./core` den kompletten App-Boot (welshman-
 *     Kontext, IndexedDB) mit und ist unter `node --test` nicht ladbar.
 *   • `mentionPubkeys` aus `interactions.ts` ist rein, das MODUL aber nicht ladbar:
 *     `node --experimental-strip-types -e "import('./js/interactions.ts')"` endet in
 *     `ERR_MODULE_NOT_FOUND: Cannot find module '…/js/relayCaps'` (extensionslose
 *     relative Importe kennt Nodes ESM-Auflösung nicht). Gemessen 2026-07-23.
 *   • `readState.ts`s Boot-Gate (`readStateBooted`) ist modul-privat und `unread.ts`
 *     gehört in dieser Phase einem anderen Arbeitsstrang — es wird hier nachgebaut,
 *     nicht angefasst.
 * `QUOTE_PREFIX` kommt dagegen ECHT aus `./polls.ts`: das Modul importiert nur
 * `@welshman/lib`/`@welshman/util` und keinen relativen Pfad, ist also node-ladbar.
 *
 * Die relativen Importe tragen absichtlich ihre `.ts`-Endung (Begründung siehe
 * `unread.ts`): ohne sie liefe `node --test updates.test.ts` in ERR_MODULE_NOT_FOUND.
 */
import { derived, writable, type Readable } from 'svelte/store'
import { throttled } from '@welshman/store'
import { profilesByPubkey, pubkey } from '@welshman/app'
import {
    COMMENT,
    MESSAGE,
    POLL,
    ZAP_GOAL,
    displayProfile,
    displayPubkey,
    getTagValue,
    type Profile,
    type TrustedEvent,
} from '@welshman/util'
import * as nip19 from 'nostr-tools/nip19'
import { deriveEventsForUrl } from './repository.ts'
import { QUOTE_PREFIX } from './polls.ts'
import {
    readState,
    readStateReady,
    roomWatermark,
    threadKey,
    threadWatermark,
    type ReadState,
} from './readState.ts'

/** Lotus' In-Chat-Thread (NIP-29 Group Chat Threading, kind 10). Siehe Modul-Docstring. */
const CHAT_THREAD = 10

/**
 * Wie lange eine GELESENE Zeile in der Liste bleibt (§3.4): 24 h.
 *
 * „Die Liste ist ein Verlauf, keine Inbox, die sich leert" — wer eine Meldung gerade
 * gelesen hat, soll sie noch wiederfinden (Nielsen: Erkennen statt Erinnern). Ungelesene
 * Zeilen kennen diese Grenze NICHT; sie stehen, bis sie gelesen sind (die harte Grenze ist
 * dann das Cache-Fenster, 300 Ereignisse/Raum, 30 Tage — `storage.ts`).
 */
export const UPDATES_RETENTION_SEC = 24 * 60 * 60

export type UpdateType = 'message' | 'mention' | 'thread'
export type UpdateBucket = 'today' | 'yesterday' | 'week' | 'older'

/** Eine Zeile in `/updates`. Feldnamen sind eingefroren — die View bindet direkt daran. */
export type UpdateItem = {
    /** Stabil über Emits hinweg (`x-for :key`): `message:${h}` · `thread:${rootId}` · `mention:${eventId}`. */
    key: string
    type: UpdateType
    /** ① Kontextzeile: Raumname, bei Thread „Raumname · Thread". */
    context: string
    /** ② „Alice · 3 neue Nachrichten" / „Bob hat dich erwähnt" / „2 neue Antworten". */
    title: string
    /** ③ Rohtext des jüngsten Ereignisses — KEIN Markup, KEIN Kürzen (das macht `line-clamp`). */
    snippet: string
    /** ④ „vor 12 Min" (deutsch, relativ). */
    timeLabel: string
    /** Avatar-URL des jüngsten Autors ('' erlaubt). */
    picture: string
    /** Anzeigename des jüngsten Autors (Fallback: gekürzter npub). */
    authorName: string
    /** Jüngster Autor. */
    pubkey: string
    /** Raum-`h`. */
    h: string
    /** Thread-Root, '' bei `type === 'message'`. */
    rootId: string
    /** FERTIGES Ziel inkl. `?from=updates`. */
    href: string
    /**
     * Unix-Sekunden der jüngsten Aktivität — der Sortierschlüssel. Gegen die Zukunft
     * gedeckelt (siehe `sortTs`), damit ein autorgesetztes `created_at` die Reihenfolge
     * nicht kapern kann; `timeLabel` zeigt weiterhin die rohe Behauptung.
     */
    ts: number
    bucket: UpdateBucket
    /** Hinter dem Wasserzeichen? */
    unread: boolean
    /** Zahl aggregierter Ereignisse. In P4 NICHT gerendert (Zahlen sind P6), aber getragen. */
    count: number
    /**
     * Ziel nicht adressierbar (Raum ohne Namen) → Zeile bleibt stehen, Ziel deaktiviert
     * (§8 „verwaist"). Eine nur nicht gecachte Thread-Wurzel zählt NICHT dazu — siehe
     * die Begründung an der Berechnung.
     */
    orphan: boolean
}

export type UpdateInput = {
    /** Normalisierte Space-Relay-URL — Teil des Raum-Schlüssels UND Relay-Hint im `nevent`. */
    url: string
    /** `h` der BEIGETRETENEN Räume (relay-signierte 39002). */
    joined: readonly string[]
    /** Timeline-Events des Space (kind 9/1068/9041), bereits url-gescopt. Zugleich die Quelle, aus der Thread-Wurzeln aufgelöst werden. */
    events: readonly TrustedEvent[]
    /** Kommentare des Space (kind 1111 + Lotus' kind 10), bereits url-gescopt. */
    comments: readonly TrustedEvent[]
    state: ReadState
    /** Eigener pubkey. Leer (Gast) ⇒ leere Liste. */
    me: string
    /** `h` → Raumname. Fehlt der Schlüssel, ist die Zeile verwaist (§8). */
    roomNames: Readonly<Record<string, string>>
    /** pubkey → Profil (Name/Avatar). Form von `profilesByPubkey`. */
    profiles: ReadonlyMap<string, Profile>
    /** Unix-Sekunden. Kommt von außen — die Ableitung ruft NIE selbst `Date.now()`. */
    now: number
}

// ── Reine Helfer (node-testbar) ────────────────────────────────────────────

/** Kanonische Event-ID nach NIP-01: 64 Hex-Zeichen, klein geschrieben. */
const HEX64 = /^[0-9a-f]{64}$/

/**
 * Thread-Wurzel eines Kommentars, format-übergreifend: unsere kind-1111 tragen
 * `["E", rootId]` (NIP-22, uppercase), Lotus' kind-10 tragen `["e", rootId, relay, "root"]`
 * (NIP-29, Marker). Gleiche Regel wie `feeds.ts commentRootId` — hier eigenständig.
 *
 * **Anders als dort wird der Wert hier geprüft, und das ist die eigentliche Pointe:**
 * P4 reicht diesen rohen Tag-Wert als Erstes an `nip19.neventEncode` durch (der Deep-Link
 * wird gebaut, OHNE dass die Wurzel im Cache aufgelöst sein muss). `neventEncode` wirft bei
 * Nicht-Hex oder ungerader Länge — gemessen 2026-07-23:
 * `neventEncode({id:'nicht-hex'}) → Input string must contain hex characters in even length`.
 * Ein solcher Wurf verlässt den `derived`-Callback und bricht svelte 5.56.4s globale
 * `subscriber_queue` dauerhaft: ein danach gesetzter, völlig unabhängiger `writable`
 * erreicht seine Subscriber nicht mehr (eigenständig nachgemessen). Ein einziges
 * Fremd-Event mit krummem `E`-Tag — jedes Raum-Mitglied kann es publizieren, zooid prüft
 * Tag-Werte nicht — legte damit den gesamten welshman→Alpine-Zustand des Tabs still.
 *
 * Groß geschriebene Hex-Werte werden **normalisiert, nicht verworfen**: der `nevent` wäre
 * identisch (bech32 kodiert die Bytes, gemessen: `A×64` und `a×64` ergeben denselben
 * String), aber der rohe Wert würde als Gruppierungsschlüssel denselben Thread in zwei
 * Zeilen spalten und passte nicht zum byte-genauen `#E`-Filter am Relay.
 *
 * Ein nicht kanonischer Wert liefert '' — die Aufrufstelle verwirft den Kommentar dann
 * (`if (!rootId) continue`). Ohne gültige Wurzel gibt es weder eine Gruppe noch ein Ziel;
 * eine Zeile „irgendein Thread, kein Link" wäre für niemanden brauchbar.
 */
export const updatesCommentRootId = (event: TrustedEvent): string => {
    const raw = getTagValue('E', event.tags) ?? event.tags.find((t) => t[0] === 'e' && t[3] === 'root')?.[1] ?? ''
    const id = raw.toLowerCase()
    return HEX64.test(id) ? id : ''
}

/**
 * `nostr:nprofile…`-Mentions (NIP-27). **Nur nprofile** — `npub` braucht keinen Parser,
 * siehe {@link updatesMentionsPubkey}. Die Längenschranken sind gemessen: ein `nprofile`
 * ohne Relay-Hints ist 70 Zeichen lang, mit zwei Hints 155; alles jenseits von 512 ist
 * kein Profil-Zeiger mehr, sondern Füllmaterial.
 */
const NPROFILE_MENTION = /nostr:(nprofile1[0-9a-z]{60,500})/g

/**
 * Wie viele `nprofile`-Token pro Text höchstens dekodiert werden.
 *
 * Ein Deckel ist nötig, weil jeder fehlschlagende `nip19.decode` einen Error samt Stack
 * erzeugt — das ist der teure Teil, nicht das Suchen. Er kostet in der Sache fast nichts:
 * unser eigener Verfasser fügt Erwähnungen als `nostr:<npub>` ein (`bridge.ts:4112`), die
 * gar nicht dekodiert werden; `nprofile` kommt nur aus fremden Clients, und wer jenseits
 * des 32. `nprofile` in EINEM Text erwähnt wird, ist nicht mehr adressiert, sondern
 * mitgeschleppt.
 */
export const MENTION_DECODE_CAP = 32

/**
 * Die `nprofile`-Token, die {@link updatesMentionsPubkey} tatsächlich zu dekodieren
 * versucht — längen-vorgefiltert und gedeckelt. Exportiert, damit der Aufwand testbar ist,
 * ohne eine Zeitmessung auf fremder Hardware zu behaupten.
 */
export const updatesMentionCandidates = (content: string): string[] => {
    const out: string[] = []
    for (const [, token] of content.matchAll(NPROFILE_MENTION)) {
        out.push(token)
        if (out.length === MENTION_DECODE_CAP) {
            break
        }
    }
    return out
}

/** `npub1` + 52 Daten- + 6 Prüfzeichen = 63. Gemessen, keine geschätzte Konstante. */
const NPUB_LEN = 63

let npubCachePk = ''
let npubCachePattern: RegExp | null = null

/**
 * Suchmuster für den eigenen `npub`, memoisiert — pro Ableitung wird derselbe Schlüssel
 * hundertfach gebraucht.
 *
 * `(?![0-9a-z])` ist kein Zierrat: ohne die Grenze würde `nostr:<mein npub>xyz` als
 * Erwähnung durchgehen, obwohl es ein anderes (kaputtes) Token ist — ein reines
 * `includes` wäre also fälschungsanfällig. Der `npub` selbst enthält nur `[0-9a-z]`, kann
 * also gefahrlos in ein Muster eingesetzt werden.
 */
const npubPattern = (pk: string): RegExp | null => {
    if (pk !== npubCachePk) {
        npubCachePk = pk
        const npub = pk.length === 64 && /^[0-9a-f]+$/i.test(pk) ? nip19.npubEncode(pk) : ''
        npubCachePattern = npub.length === NPUB_LEN ? new RegExp(`nostr:${npub}(?![0-9a-z])`) : null
    }
    return npubCachePattern
}

/**
 * Erwähnt dieser Text `pk` (NIP-27)? Bewusst NUR der Klartext, **nicht** die `p`-Tags:
 * ein NIP-22-Kommentar trägt den Autor des Parents immer als `P`/`p` — über die Tags wäre
 * jede Antwort auf mich eine „Erwähnung", und die Zeile verlöre ihre Bedeutung. Eine
 * Antwort auf mich meldet sich als Thread-Zeile, nicht als Erwähnung.
 *
 * **Der npub-Fall kommt ohne einen einzigen `decode` aus.** Die naive Fassung (jedes
 * `nostr:npub…`-Token dekodieren und den Schlüssel vergleichen) ist gemessen worden:
 * bei gleicher Bytezahl kostet ein Inhalt aus `nostr:npub1x `-Attrappen gegenüber normalem
 * Text ~700× so viel (64 KB × 50 Ereignisse: 1 ms vs. 691 ms), weil jedes Token einen
 * fehlschlagenden `decode` samt Error-Stack auslöst. Bei 300 ms Drosselung und fünf
 * reaktiven Quellen steht damit der Main-Thread, solange die Ereignisse ungelesen sind.
 * Die Umkehrung kostet nichts: der eigene Schlüssel wird EINMAL kodiert (memoisiert) und
 * als Teilstring gesucht — bech32 ist kanonisch klein geschrieben, ein Treffer ist
 * eindeutig. Attrappen werden dabei nie angefasst.
 *
 * `nprofile` trägt den Schlüssel in einem TLV und lässt sich nicht als Teilstring suchen —
 * dort wird dekodiert, aber nur für längen-plausible Token und höchstens
 * {@link MENTION_DECODE_CAP} mal ({@link updatesMentionCandidates}).
 *
 * Beide Zweige kurzschließen beim ersten Treffer — die Frage hier ist boolesch.
 */
export const updatesMentionsPubkey = (content: string, pk: string): boolean => {
    const pattern = pk ? npubPattern(pk) : null
    if (!pattern) {
        return false
    }
    if (pattern.test(content)) {
        return true
    }
    for (const token of updatesMentionCandidates(content)) {
        try {
            const decoded = nip19.decode(token)
            if (decoded.type === 'nprofile' && decoded.data.pubkey === pk) {
                return true
            }
        } catch {
            // Kaputtes/gekürztes Token — keine Erwähnung, kein Fehler.
        }
    }
    return false
}

/** Rohtext ohne vorangestellten Reply-Quote (Snippet-Basis). Gleiche Regel wie `feeds.ts bodyWithoutQuote`. */
const bodyWithoutQuote = (event: TrustedEvent): string =>
    getTagValue('q', event.tags) ? event.content.replace(QUOTE_PREFIX, '') : event.content

const startOfLocalDay = (ts: number): number => {
    const d = new Date(ts * 1000)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Kalendarischer Bucket (§3.4). Grenzen sind **lokale Tagesgrenzen**, nicht 24-h-Fenster —
 * dieselbe Rechnung wie `feeds.ts dayLabel`, damit „Heute" in der Liste und im Chat-Verlauf
 * dasselbe bedeutet.
 *
 * `diffDays <= 0` fällt auf `today`: `created_at` ist autorgesetzt (NIP-01) und kann in der
 * Zukunft liegen. Ein Bucket „morgen" gibt es nicht; die Zeile steht dann oben in „Heute".
 */
export const updateBucket = (ts: number, now: number): UpdateBucket => {
    const diffDays = Math.round((startOfLocalDay(now) - startOfLocalDay(ts)) / 86_400_000)
    if (diffDays <= 0) {
        return 'today'
    }
    if (diffDays === 1) {
        return 'yesterday'
    }
    return diffDays < 7 ? 'week' : 'older'
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

/**
 * Datum ohne `toLocaleDateString`. Ausgabe ist identisch zu
 * `toLocaleDateString('de-DE', {day:'numeric', month:'long', year:'numeric'})`, hängt aber
 * nicht an der ICU-Ausstattung der Laufzeit — sonst wäre die Ableitung nur dort testbar,
 * wo Node mit vollem ICU gebaut wurde.
 */
const germanDate = (ts: number): string => {
    const d = new Date(ts * 1000)
    return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * Relatives deutsches Zeit-Label (§3.2 ④). Ohne Fremdbibliothek, rein aus `ts` und `now`.
 *
 * Reihenfolge ist Absicht: unter 24 h gewinnt die relative Angabe, auch wenn der Zeitpunkt
 * kalendarisch schon „gestern" ist — „vor 23 Std" ist präziser als „gestern". Erst jenseits
 * von 24 h wird der Kalender maßgeblich.
 *
 * Zukünftige `created_at` (autorgesetzt) werden auf 0 geklemmt → „gerade eben" statt einer
 * negativen Minutenzahl.
 */
export const updateTimeLabel = (ts: number, now: number): string => {
    const s = Math.max(0, now - ts)
    if (s < 60) {
        return 'gerade eben'
    }
    const m = Math.floor(s / 60)
    if (m < 60) {
        return `vor ${m} Min`
    }
    const h = Math.floor(m / 60)
    if (h < 24) {
        return `vor ${h} Std`
    }
    return updateBucket(ts, now) === 'yesterday' ? 'gestern' : germanDate(ts)
}

/**
 * Effektives Thread-Wasserzeichen **für die Liste**.
 *
 * Hier weicht P4 bewusst von `unread.ts` Regel 4 ab: der Punkt unterdrückt Threads, die man
 * noch nie geöffnet hat (ohne `t:`-Wasserzeichen kein Punkt), und verweist dafür ausdrücklich
 * auf „P4 über die Benachrichtigungs-Liste". Genau die ist das hier — die Unterdrückung darf
 * es also nicht noch einmal geben, sonst hätte die Antwort auf einen fremd eröffneten Thread
 * gar keinen Ort mehr.
 *
 * Ohne `t:`-Wasserzeichen ist der Boden das RAUM-Wasserzeichen, nicht 0 und nicht `all`:
 * ohne diesen Boden meldete jeder je im Space eröffnete Thread beim ersten Start seine ganze
 * Historie. Preis dieser Kopplung, offen benannt: wer einen Raum bis unten liest, quittiert
 * damit auch nie geöffnete Threads dieses Raums — obwohl deren Kommentare (kind 1111, ohne
 * `#h`) im Raum-Feed gar nicht standen (siehe `readState.roomWatermark`). Persönlich
 * Adressiertes geht dabei nicht verloren: eine Erwähnung wird als eigene Zeile mit eigenem
 * Wasserzeichen geführt.
 */
const threadListWatermark = (state: ReadState, url: string, h: string, rootId: string): number =>
    state[threadKey(rootId)] === undefined ? roomWatermark(state, url, h) : threadWatermark(state, rootId)

const newestOf = (events: readonly TrustedEvent[]): TrustedEvent =>
    events.reduce((best, e) => (e.created_at > best.created_at ? e : best))

/**
 * Zugestandener Uhrenversatz, bevor ein `created_at` als „aus der Zukunft" gilt.
 *
 * 60 s — dieselbe Größenordnung wie der Nachbar-Stack (`twenty-one-companion/…/
 * RelayPollWorker.kt` `CLOCK_SKEW_SECONDS = 60`). Die beiden Hälften des Systems sollen
 * nicht verschieden rechnen: was Android als „gerade eben, Uhr etwas vor" durchgehen
 * lässt, muss hier ebenso durchgehen, sonst driften Web- und Push-Meldung auseinander.
 */
export const CLOCK_SKEW_SEC = 60

/**
 * Zählt dieses Ereignis als ungelesen?
 *
 * Zwei Bedingungen, die zweite ist der Deckel gegen die Zukunft: `created_at` ist
 * autorgesetzt (NIP-01) und wird von zooid nicht geprüft — eine falsch gestellte Uhr
 * genügt. Ein Ereignis, das behauptet, noch gar nicht passiert zu sein, kann niemand
 * gelesen haben; es wäre aber auch von KEINEM Wasserzeichen quittierbar, weil
 * `markAllRead` die Wall-Clock schreibt (`readState.markAllRead` → `nowSec()`). Ohne
 * diesen Deckel bliebe „Alles gelesen" wirkungslos: der Knopf verschwindet nicht, die
 * Rückgängig-Leiste erscheint, der Punkt bleibt an — genau die Handlung ohne Wirkung, die
 * die Oberfläche ausschließen will. Das Datenmodell hat es ohnehin zugesagt
 * (`datenmodell-ungelesen.md`: „Zukunftsdatierte Fremd-Events zählen genau einmal und
 * verschwinden beim nächsten Mark-Read") — hier wird die Zusage eingelöst.
 *
 * Ein reiner Deckel `min(created_at, now)` reicht dafür NICHT: `markAllRead` schreibt
 * `all = T`, beim nächsten Emit ist `now = T+1`, der gedeckelte Wert `T+1 > T` — die Zeile
 * wäre nach einer Sekunde wieder ungelesen. Deshalb die durable Form.
 *
 * Die Kehrseite ist bewusst in Kauf genommen und die kleinere: ein real neues Ereignis
 * mit stark vorgehender Uhr wird erst gemeldet, wenn seine eigene Behauptung eingeholt ist
 * — verspätet, nie verloren (das Wasserzeichen wandert ja nur durch Lesen weiter). Das ist
 * dieselbe Abwägung wie in P3: ein Punkt darf zu spät kommen, aber nicht lügen. Der
 * Alltagsfall einer leicht vorgehenden Uhr fällt unter {@link CLOCK_SKEW_SEC} und ist
 * davon gar nicht betroffen.
 */
const isUnread = (createdAt: number, watermark: number, now: number): boolean =>
    createdAt <= now + CLOCK_SKEW_SEC && createdAt > watermark

/**
 * Behauptet dieses Ereignis, noch gar nicht passiert zu sein?
 *
 * **Solche Ereignisse tragen gar nichts bei — sie fliegen beim Eintritt raus.** Der
 * Ungelesen-Deckel in {@link isUnread} allein reicht nicht, und der Sortier-Deckel
 * {@link sortTs} auch nicht: eine Zeile ohne Ungelesenes trägt die GELESENEN Ereignisse
 * der letzten 24 h, und darin lieferte das zukunftsdatierte weiterhin Titel, Snippet,
 * Avatar und — mit `ts = now`, dem größtmöglichen Wert — den ersten Platz der Liste.
 * Gemessen an genau dem Szenario:
 * ```
 * [{h:'raum1', unread:false, ts-now:0,   snippet:'ICH BESETZE DIE ZEILE'},  ← Platz 1
 *  {h:'raum2', unread:false, ts-now:-30, snippet:'echte neue nachricht'}]
 * ```
 * Und es alterte nicht aus: die 24-h-Frist läuft ab dem BEHAUPTETEN Zeitpunkt, bei
 * `+400 Tagen` steht die Zeile über ein Jahr.
 *
 * Die Schwelle ist **dieselbe** wie in {@link isUnread}: was als ungelesen zählen darf,
 * darf auch seine Zeile vertreten — es gibt keinen Zwischenzustand. Damit verschiebt die
 * Regel **kein einziges reales Ereignis**: alles bis {@link CLOCK_SKEW_SEC} vorgehende Uhr
 * ist unberührt, und ein stärker verstelltes Ereignis ist nicht verloren, sondern
 * verspätet — sobald seine eigene Behauptung eingeholt ist, läuft es den normalen Weg
 * (dieselbe Abwägung wie {@link isUnread}). Im Raum selbst ist es die ganze Zeit sichtbar;
 * nur die Benachrichtigungs-Liste, die „was ist NEU" beantwortet, schweigt darüber.
 */
const isFutureDated = (createdAt: number, now: number): boolean => createdAt > now + CLOCK_SKEW_SEC

/**
 * Zeitstempel für **Sortierung und Bucket**, gegen die Zukunft gedeckelt.
 *
 * Was hier ankommt, ist durch {@link isFutureDated} bereits auf höchstens
 * `now + CLOCK_SKEW_SEC` begrenzt — der Deckel hält nur noch diese Toleranz aus der
 * Sortierung heraus, damit `ts <= now` eine Zusage bleibt, auf die sich die Oberfläche
 * verlassen kann. Er ist NICHT das, was das Besetzen der Zeile verhindert; das tut
 * {@link isFutureDated}.
 *
 * `timeLabel` bleibt bewusst am rohen `created_at`: was der Autor behauptet, darf die
 * Zeile anzeigen — die Reihenfolge darf er nicht kapern.
 */
const sortTs = (createdAt: number, now: number): number => Math.min(createdAt, now)

const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
    const list = map.get(key)
    if (list) {
        list.push(value)
    } else {
        map.set(key, [value])
    }
}

const roomHref = (h: string): string => `/rooms/${encodeURIComponent(h)}?from=updates`

/**
 * Thread-Deep-Link — derselbe Weg, den die Startseite heute schon geht
 * (`feeds.ts deriveSpaceThreads`: `nip19.neventEncode({id, relays:[url], author})`), damit es
 * nicht zwei Erzeuger für denselben Pfad gibt. Ohne aufgelöste Wurzel fehlt der `author`-Hint;
 * die Referenz bleibt gültig (NIP-19: `author` ist optional).
 */
const threadHref = (url: string, h: string, rootId: string, rootPubkey: string): string => {
    const nevent = nip19.neventEncode(rootPubkey ? { id: rootId, relays: [url], author: rootPubkey } : { id: rootId, relays: [url] })
    return `/rooms/${encodeURIComponent(h)}/thread/${nevent}?from=updates`
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? `1 ${one}` : `${count} ${many}`)

type RowSpec = {
    type: UpdateType
    h: string
    rootId: string
    /** `author`-Hint für den `nevent`, '' wenn die Wurzel nicht im Cache liegt. */
    rootPubkey: string
    /** Die Ereignisse, die DIESE Zeile trägt (Erwähnung: genau eines). */
    events: readonly TrustedEvent[]
    unread: boolean
}

const buildItem = (input: UpdateInput, spec: RowSpec): UpdateItem => {
    const newest = newestOf(spec.events)
    const count = spec.events.length
    const roomName = input.roomNames[spec.h] ?? ''
    /**
     * **Verwaist = Ziel nicht adressierbar**, nicht „Quelle nicht im Cache".
     *
     * Ausschlaggebend ist allein der Raum: ohne Namen wissen wir nicht, wohin die Zeile
     * führt. Eine Thread-Wurzel, die NICHT im Cache liegt, macht die Zeile ausdrücklich
     * NICHT verwaist — der Cache-Deckel (300 Ereignisse/30 Tage, `storage.ts`) lässt jede
     * Antwort auf einen älteren Thread regulär in diesen Zustand fallen. Das Ziel trägt
     * trotzdem: `feeds.ts loadThread` holt `{ids:[rootId]}` frisch vom Relay und
     * `deriveThread` hält für die noch fehlende Wurzel einen Platzhalter bereit. „Nicht im
     * Cache" ist nicht „gelöscht" — die Zeile als „Nachricht nicht mehr verfügbar" zu
     * deaktivieren wäre eine Falschaussage über einen lebenden Thread.
     *
     * Der Zeileninhalt (Titel, Snippet, Avatar, Zeit) kommt ohnehin aus dem KOMMENTAR, nicht
     * aus der Wurzel; es fehlt also nichts. Dem `nevent` fehlt nur der `author`-Hint, der
     * nach NIP-19 optional ist — die Relay-Hint aus `url` genügt.
     */
    const orphan = roomName === ''
    const authorName = displayProfile(input.profiles.get(newest.pubkey), displayPubkey(newest.pubkey))
    const context = spec.rootId
        ? `${roomName || 'Unbekannter Raum'} · Thread`
        : roomName || 'Unbekannter Raum'
    let title: string
    if (orphan) {
        title = 'Nachricht nicht mehr verfügbar'
    } else if (spec.type === 'mention') {
        title = `${authorName} hat dich erwähnt`
    } else if (spec.type === 'thread') {
        title = spec.unread ? plural(count, 'neue Antwort', 'neue Antworten') : plural(count, 'Antwort', 'Antworten')
    } else {
        title = `${authorName} · ${spec.unread ? plural(count, 'neue Nachricht', 'neue Nachrichten') : plural(count, 'Nachricht', 'Nachrichten')}`
    }
    return {
        key: spec.type === 'mention' ? `mention:${newest.id}` : `${spec.type}:${spec.rootId || spec.h}`,
        type: spec.type,
        context,
        title,
        snippet: bodyWithoutQuote(newest),
        timeLabel: updateTimeLabel(newest.created_at, input.now),
        picture: input.profiles.get(newest.pubkey)?.picture ?? '',
        authorName,
        pubkey: newest.pubkey,
        h: spec.h,
        rootId: spec.rootId,
        href: spec.rootId ? threadHref(input.url, spec.h, spec.rootId, spec.rootPubkey) : roomHref(spec.h),
        ts: sortTs(newest.created_at, input.now),
        bucket: updateBucket(sortTs(newest.created_at, input.now), input.now),
        unread: spec.unread,
        count,
        orphan,
    }
}

/**
 * Der Riegel: baut eine Zeile und fängt dabei **alles**.
 *
 * Die Hex-Prüfung in {@link updatesCommentRootId} schließt den heute bekannten Wurf-Pfad;
 * sie schließt nicht den nächsten. `buildItem` ruft mit `nip19.neventEncode` UND
 * `displayPubkey` (→ `npubEncode`) gleich zwei Kodierer auf, die bei krummen Eingaben
 * werfen, und die Eingaben stammen aus fremden Events. Was ein Wurf hier anrichtet, ist
 * gemessen und steht in {@link updatesCommentRootId}: er killt die globale
 * `subscriber_queue` von svelte und damit den gesamten Store-Zustand des Tabs.
 *
 * Gefangen wird deshalb **pro Zeile**, nicht um die ganze Ableitung: eine kaputte Zeile
 * darf nicht vierzig gute mitreißen. `console.warn` statt stillem Schlucken — ein Ereignis,
 * das hier scheitert, ist ein Befund und soll in `browser-logs` auffindbar sein.
 */
const pushItem = (items: UpdateItem[], input: UpdateInput, spec: RowSpec): void => {
    try {
        items.push(buildItem(input, spec))
    } catch (error) {
        console.warn('[updates] Zeile übersprungen — fehlerhaftes Ereignis', { type: spec.type, h: spec.h, rootId: spec.rootId }, error)
    }
}

const BUCKET_ORDER: Record<UpdateBucket, number> = { today: 0, yesterday: 1, week: 2, older: 3 }
/** Bei GLEICHEM `ts` im selben Bucket gewinnt das persönlichere Ereignis (§3.4). */
const TYPE_ORDER: Record<UpdateType, number> = { mention: 0, message: 1, thread: 1 }

/**
 * Reine Ableitung — kein Store, kein Netz, kein Browser, kein `Date.now()`. Node-testbar.
 *
 * Regeln, jede mit einem Grund:
 *
 * 1. **Scope = nur, wohin deep-gelinkt werden kann.** kind 9/1068/9041 → `/rooms/{h}`,
 *    kind 1111 und Lotus' kind 10 → `/rooms/{h}/thread/{nevent}`. Reaktionen (7) und Zaps
 *    (9735) sind ausgeschlossen — nicht „später", sondern gar nicht: für sie existiert kein
 *    Nachrichten-Anker (`?msg=` gibt es nicht), die Zeile führte ins Leere. Der Scope wird
 *    von den Filtern der Hülle UND hier nicht erweitert.
 * 2. **Aggregation nach §3.3:** `message` pro Raum, `thread` pro Thread-Root, `mention`
 *    je Ereignis — eine Erwähnung ist der Grund, warum jemand die Liste öffnet, und darf
 *    nicht in einer Sammelzeile verschwinden.
 * 3. **Eine Erwähnung erscheint NUR als Erwähnung.** Das Ereignis wird aus der Aggregation
 *    seines Raums/Threads herausgenommen (`continue` vor dem Einsortieren), sonst stünde
 *    dasselbe Ereignis zweimal in der Liste — einmal persönlich, einmal als „+1 Nachricht".
 *    Nebenwirkung, gewollt: ist die Erwähnung das einzige Neue im Raum, gibt es keine
 *    zusätzliche `message`-Zeile.
 * 4. **Eigene Beiträge zählen nie** (`pubkey === me`), **Selbst-Erwähnung zählt nie**
 *    (DV-5) — Letzteres fällt automatisch mit der `me`-Prüfung, weil nur fremde Ereignisse
 *    überhaupt geprüft werden.
 * 5. **Nur beigetretene Räume** (wie `computeUnread` Regel 1). Ein Ereignis ohne
 *    zuordenbaren, beigetretenen Raum wird **übersprungen, nicht als verwaist geführt**:
 *    „verwaist" (Regel 7) heißt „gehört dir, Ziel ist kaputt". Ohne `h` kann niemand sagen,
 *    ob es dir gehört — die Zeile stünde für einen der 83 fremden Meetup-Räume.
 * 6. **`created_at > watermark`**, nicht `>=` (wie `computeUnread` Regel 3) — und nach
 *    oben gegen die Zukunft gedeckelt, siehe {@link isUnread}.
 * 7. **Gelesenes bleibt 24 h** ({@link UPDATES_RETENTION_SEC}) mit `unread: false`.
 * 8. **Sortierung** (§3.4): Bucket, dann `ts` absteigend, dann `mention` vor
 *    `message`/`thread`. Kein globales Vorziehen von Erwähnungen — sonst stünde die
 *    Erwähnung von letzter Woche über der Nachricht von eben.
 * 9. **Thread-Wasserzeichen** siehe {@link threadListWatermark} (bewusste Asymmetrie zu
 *    `unread.ts` Regel 4).
 * 10. **Verwaist** (§8): Raum ohne Namen → `orphan`, Titel „Nachricht nicht mehr
 *     verfügbar", Zeile bleibt stehen. Eine nicht gecachte Thread-Wurzel ist ausdrücklich
 *     NICHT verwaist (Begründung an der Berechnung in `buildItem`).
 * 11. **Zukunftsdatiertes trägt nichts bei** — weder eine Zeile, noch einen Zähler, noch
 *     ein Snippet ({@link isFutureDated}). `created_at` ist autorgesetzt; ohne diese Regel
 *     besetzt ein Fremder die Zeile eines Raums, und zwar über ein Jahr lang.
 *
 * **Welche Ereignisse eine Zeile trägt:** die ungelesenen — und nur wenn es keine gibt, die
 * gelesenen der letzten 24 h. Die beiden Mengen sind damit disjunkt und `count` eindeutig.
 * Das jüngste Ereignis einer Zeile ist zugleich das jüngste des Raums/Threads, solange die
 * Zeile ungelesen ist (gibt es ein Ereignis hinter dem Wasserzeichen, ist das jüngste
 * Ereignis überhaupt eines davon) — außer bei zukunftsdatierten Ereignissen, die nach
 * {@link isUnread} nie zur ungelesenen Menge gehören.
 *
 * **Diese Funktion wirft nicht.** Alle Eingaben stammen aus fremden Events; die
 * Zeilen-Erzeugung läuft deshalb pro Zeile durch den Riegel {@link pushItem}. Ein Wurf aus
 * dieser Ableitung legt nachweislich die gesamte Store-Welt des Tabs lahm (Messung siehe
 * {@link updatesCommentRootId}) — die Kosten eines übersprungenen Eintrags stehen dazu in
 * keinem Verhältnis.
 *
 * Gelöschtes zählt automatisch nicht mit: die Quelle (`repository.query`) schließt
 * kind-5-Tombstones per Default aus, NIP-29-9005-Ziele werden aktiv entfernt.
 */
export function computeUpdates(input: UpdateInput): UpdateItem[] {
    if (!input.me) {
        return []
    }
    const joined = new Set(input.joined)
    const readFloor = input.now - UPDATES_RETENTION_SEC
    const items: UpdateItem[] = []

    // ── Raum-Ereignisse (kind 9/1068/9041) ──
    const roomEvents = new Map<string, TrustedEvent[]>()
    for (const event of input.events) {
        // Regel 1, hier noch einmal hart: die Hülle filtert bereits per Relay-Filter, aber
        // der Scope ist eine Zusage der Ableitung, keine der Aufrufstelle. Eine Reaktion
        // (kind 7) oder ein Zap-Receipt (9735), die versehentlich in die Quelle geraten,
        // erzeugen sonst eine Zeile, deren Ziel es nicht gibt.
        if (event.kind !== MESSAGE && event.kind !== POLL && event.kind !== ZAP_GOAL) {
            continue
        }
        if (event.pubkey === input.me) {
            continue
        }
        const h = getTagValue('h', event.tags) ?? ''
        if (!h || !joined.has(h)) {
            continue // Regel 5
        }
        if (isFutureDated(event.created_at, input.now)) {
            continue // Regel 11: was noch nicht passiert ist, trägt keine Zeile
        }
        const unread = isUnread(event.created_at, roomWatermark(input.state, input.url, h), input.now)
        if (!unread && event.created_at <= readFloor) {
            continue // Regel 7: gelesen und älter als 24 h
        }
        if (updatesMentionsPubkey(bodyWithoutQuote(event), input.me)) {
            pushItem(items, input, { type: 'mention', h, rootId: '', rootPubkey: '', events: [event], unread })
            continue // Regel 3
        }
        push(roomEvents, h, event)
    }
    for (const [h, events] of roomEvents) {
        const watermark = roomWatermark(input.state, input.url, h)
        const fresh = events.filter((e) => isUnread(e.created_at, watermark, input.now))
        pushItem(items, input, {
            type: 'message',
            h,
            rootId: '',
            rootPubkey: '',
            events: fresh.length > 0 ? fresh : events,
            unread: fresh.length > 0,
        })
    }

    // ── Thread-Kommentare (kind 1111 + Lotus' kind 10) ──
    const rootById = new Map(input.events.map((e) => [e.id, e]))
    const threads = new Map<string, { h: string; rootPubkey: string; events: TrustedEvent[] }>()
    for (const comment of input.comments) {
        if (comment.kind !== COMMENT && comment.kind !== CHAT_THREAD) {
            continue // Regel 1 (siehe oben)
        }
        if (comment.pubkey === input.me) {
            continue
        }
        const rootId = updatesCommentRootId(comment)
        if (!rootId) {
            continue
        }
        const root = rootById.get(rootId)
        // `h` bevorzugt aus der WURZEL (autoritativ, wie `feeds.ts deriveSpaceThreads`);
        // ersatzweise aus dem Kommentar selbst — unsere kind-1111 tragen das `h` des Roots
        // additiv (Thread-Interop), flotilla-kompatible tragen keines.
        const h = (root ? getTagValue('h', root.tags) : undefined) ?? getTagValue('h', comment.tags) ?? ''
        if (!h || !joined.has(h)) {
            continue // Regel 5
        }
        if (isFutureDated(comment.created_at, input.now)) {
            continue // Regel 11 (siehe oben)
        }
        const unread = isUnread(comment.created_at, threadListWatermark(input.state, input.url, h, rootId), input.now)
        if (!unread && comment.created_at <= readFloor) {
            continue // Regel 7
        }
        if (updatesMentionsPubkey(bodyWithoutQuote(comment), input.me)) {
            pushItem(items, input, { type: 'mention', h, rootId, rootPubkey: root?.pubkey ?? '', events: [comment], unread })
            continue // Regel 3
        }
        const entry = threads.get(rootId)
        if (entry) {
            entry.events.push(comment)
        } else {
            threads.set(rootId, { h, rootPubkey: root?.pubkey ?? '', events: [comment] })
        }
    }
    for (const [rootId, thread] of threads) {
        const watermark = threadListWatermark(input.state, input.url, thread.h, rootId)
        const fresh = thread.events.filter((e) => isUnread(e.created_at, watermark, input.now))
        pushItem(items, input, {
            type: 'thread',
            h: thread.h,
            rootId,
            rootPubkey: thread.rootPubkey,
            events: fresh.length > 0 ? fresh : thread.events,
            unread: fresh.length > 0,
        })
    }

    return items.sort((a, b) => {
        const bucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]
        if (bucket !== 0) {
            return bucket
        }
        if (a.ts !== b.ts) {
            return b.ts - a.ts
        }
        const type = TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
        // Letzter Tiebreak: der Schlüssel. Ohne ihn hinge die Reihenfolge zweier
        // gleichzeitiger Zeilen an der Map-Iteration und die Liste könnte zwischen zwei
        // Emits springen, obwohl sich nichts geändert hat.
        return type !== 0 ? type : a.key.localeCompare(b.key)
    })
}

// ── Reaktive Hülle ────────────────────────────────────────────────────────

/**
 * Ist der Lesestand geladen? **Solange nicht, bleibt die Liste LEER** — ein leeres
 * `readState` hieße Wasserzeichen 0 und damit „alles neu"; beim Start blitzte eine
 * komplette Fake-Liste auf und schrumpfte dann zusammen. Leer ist der korrekte Zustand für
 * „weiß ich noch nicht" (§3.5 kennt dafür den Lade-Skeleton).
 *
 * Nachbau des gleichnamigen Gates aus `unread.ts` (dort modul-privat, siehe Modul-Docstring).
 * Der Watcher startet absichtlich erst beim ersten {@link deriveUpdates}-Aufruf:
 * `readStateReady` wird von `initReadState()` neu zugewiesen — ein `.then` zur Eval-Zeit
 * hinge an der Platzhalter-Promise und meldete sofort „fertig".
 */
const readStateBooted = writable(false)
let bootWatched = false

const watchReadStateBoot = (): void => {
    if (bootWatched) {
        return
    }
    bootWatched = true
    void readStateReady.then(
        () => readStateBooted.set(true),
        () => readStateBooted.set(true), // fail-soft: aufgegeben ist auch fertig
    )
}

/**
 * Die reaktive Benachrichtigungs-Liste eines Space.
 *
 * `throttled(300, …)` auf den Event-Quellen (DV-6: Liste ≥ 300 ms, Muster
 * `feeds.ts deriveSpaceThreads`): beim Kaltstart streamt der Verlauf Ereignis für Ereignis
 * herein, ungedrosselt fiele die ganze Ableitung pro Nachricht neu an.
 *
 * `now` wird bei JEDEM Emit frisch gelesen. Ohne neuen Emit altern `timeLabel`/`bucket`
 * nicht mit — bei stehendem Space bleibt „vor 12 Min" stehen. Das ist bewusst nicht hier
 * gelöst: ein Minuten-Ticker im Store würde die Liste im Leerlauf neu berechnen; die View
 * kann bei Bedarf selbst neu anstoßen.
 *
 * @param roomNames `h` → Anzeigename der beigetretenen Räume; fehlender Schlüssel ⇒ verwaist.
 */
export const deriveUpdates = (
    url: string,
    joined: Readable<string[]>,
    roomNames: Readable<Record<string, string>>,
): Readable<UpdateItem[]> => {
    watchReadStateBoot()
    return derived(
        [
            throttled(300, deriveEventsForUrl(url, [{ kinds: [MESSAGE, POLL, ZAP_GOAL] }])),
            throttled(300, deriveEventsForUrl(url, [{ kinds: [COMMENT, CHAT_THREAD] }])),
            throttled(300, profilesByPubkey),
            readState,
            joined,
            roomNames,
            pubkey,
            readStateBooted,
        ],
        ([$events, $comments, $profiles, $state, $joined, $roomNames, $me, $booted]) =>
            $booted
                ? computeUpdates({
                      url,
                      joined: $joined as string[],
                      events: $events as TrustedEvent[],
                      comments: $comments as TrustedEvent[],
                      state: $state as ReadState,
                      me: ($me as string | undefined) ?? '',
                      roomNames: $roomNames as Record<string, string>,
                      profiles: $profiles as Map<string, Profile>,
                      now: Math.floor(Date.now() / 1000),
                  })
                : [],
    )
}
