/**
 * Nostr-Referenzen im Nachrichtentext — die reine Logik hinter Zitat- und Profilkarte (P5).
 *
 * Bewusst OHNE welshman-Importe (gleiches Prinzip wie `chatLinks.ts` und
 * `interactions.ts mentionPubkeys`), damit Auswahl-, Prioritäts- und Klickziel-Regeln unter
 * `node --test` ohne Browser- oder Store-Runtime prüfbar sind. Einzige Abhängigkeit ist
 * `nostr-tools/nip19`.
 *
 * ── Nur `nostr:`-präfixierte Referenzen — eine gewollte Grenze ────────────────────────
 * welshmans `parse()` erkennt bech32 AUSSCHLIESSLICH mit `nostr:`-Präfix: in
 * `@welshman/content` `parser.js:77` (`parseEvent`) und `:152` (`parseProfile`) steht die
 * Gruppe `(nostr:)` OHNE `?`, ist also Pflicht. Nacktes `note1…`/`nevent1…`/`npub1…` und
 * sogar `@npub1…` bleiben dort reiner Text (an `0.8.16` gemessen, `p5-recon.md` §1.4).
 *
 * Dieses Modul folgt dem: eine nackte Kennung erzeugt KEINE Karte. Das ist keine Lücke,
 * sondern die Entscheidung — NIP-21 (`nostr:`) ist die Schreibweise, die Clients tatsächlich
 * erzeugen, und eine Regex auf nackte bech32-Zeichenketten fischt zuverlässig Hex-Blobs und
 * Code-Token mit ein (derselbe Ärger, gegen den `chatLinks.ts isPlausibleUrl` gebaut werden
 * musste). Wer diese Grenze verschieben will, verschiebt sie hier — nicht durch einen
 * Zusatz-Sonderfall an der Aufrufstelle.
 *
 * ── Genau EINE Referenz je Nachricht ─────────────────────────────────────────────────
 * {@link firstNostrRef} liefert höchstens eine — ein Ereignis schlägt dabei IMMER ein
 * Profil, unabhängig von der Position im Text. Ein Zitat ist Kontext; mehrere Karten
 * zerfasern den Verlauf.
 */
import * as nip19 from 'nostr-tools/nip19'

/**
 * Suchmuster für NIP-21-Referenzen, längenbegrenzt je Kennungsart.
 *
 * Die Grenzen sind GEMESSEN, keine geschätzten Konstanten (`nip19.noteEncode`/`npubEncode`/
 * `neventEncode`/`nprofileEncode`, 2026-08-11): `note1` und `npub1` sind mit 63 Zeichen fix
 * (5 Zeichen Präfix + 52 Daten + 6 Prüfsumme), der Datenteil also exakt 58. Die TLV-Formen
 * wachsen mit ihren Relay-Hints — `nevent1` maß 68 Zeichen (nur id) bis 247 (vier Relays +
 * Autor + Kind), `nprofile1` 70 bis 156; ihr Datenteil beginnt bei 61. Die Obergrenze 512
 * lässt Raum für ungewöhnlich lange Relay-URLs (ein 200-Zeichen-Host ergab 479) und deckelt
 * zugleich, wie viel Text ein einzelnes Token beanspruchen darf.
 *
 * `(?![0-9a-z])` ist kein Zierrat, sondern dieselbe Grenze wie in `updates.ts npubPattern`:
 * ohne sie würde aus `nostr:note1<58 Zeichen><weitere Zeichen>` ein Präfix herausgeschnitten
 * und zu einer garantiert fehlschlagenden — also teuren — Dekodierung geschickt.
 *
 * Modul-global und `g`: {@link String.prototype.matchAll} arbeitet auf einer Kopie, `lastIndex`
 * wird dabei nicht geteilt (Muster `updates.ts NPROFILE_MENTION`). Auf diesem Muster darf
 * deshalb nie `.test()`/`.exec()` laufen — das würde `lastIndex` fortschreiben.
 */
const REF_TOKEN = /nostr:(note1[0-9a-z]{58}|npub1[0-9a-z]{58}|nevent1[0-9a-z]{60,512}|nprofile1[0-9a-z]{60,512})(?![0-9a-z])/g

/**
 * Wie viele Token je Klasse (Ereignis / Profil) höchstens dekodiert werden.
 *
 * Der Deckel schützt nicht vor dem Suchen, sondern vor dem Dekodieren: jeder fehlschlagende
 * `nip19.decode` erzeugt einen Error samt Stack, und das ist der teure Teil —
 * `updates.ts:188-197` trägt denselben Deckel aus demselben Grund (dort gemessen: ein Text
 * aus Attrappen kostete ~700× so viel wie normaler Text).
 *
 * Hier reicht ein KLEINER Deckel, weil nur die ERSTE gültige Referenz gesucht wird und die
 * Schleife beim ersten Treffer abbricht — im Normalfall wird also genau einmal dekodiert.
 * Acht fehlschlagende Dekodierungen vor der ersten gültigen Referenz sind kein Nutzertext
 * mehr, sondern eine Attrappe.
 */
export const REF_DECODE_CAP = 8

/** Zeichen, ab der eine Kennung im Leerzustand gekürzt angezeigt wird. */
const ENTITY_DISPLAY_LEN = 16

/** Referenz auf ein Ereignis (`note1`/`nevent1`) — beide landen bewusst in EINEM Typ. */
export type NostrEventRef = {
    kind: 'event'
    /** Hex-Event-ID. */
    id: string
    /** bech32 OHNE `nostr:`, unverändert wie geschrieben — Bauteil des Deep-Links. */
    entity: string
    /** Relay-Hints aus dem TLV; `note1` trägt nie welche (leeres Array). */
    relays: string[]
    /** Autor aus dem TLV; `''`, wenn der Zeiger keinen trägt (`note1` nie). */
    author: string
}

/** Referenz auf ein Profil (`npub1`/`nprofile1`) — ebenfalls EIN Typ für beide Formen. */
export type NostrProfileRef = {
    kind: 'profile'
    /** Hex-Pubkey. Absichtlich hex und nicht npub: `open-profile` erwartet hex. */
    pubkey: string
    entity: string
    relays: string[]
}

export type NostrRef = NostrEventRef | NostrProfileRef

const decodeEventToken = (entity: string): NostrEventRef | null => {
    try {
        const decoded = nip19.decode(entity)
        if (decoded.type === 'note') {
            return { kind: 'event', id: decoded.data, entity, relays: [], author: '' }
        }
        if (decoded.type === 'nevent') {
            return {
                kind: 'event',
                id: decoded.data.id,
                entity,
                relays: decoded.data.relays ?? [],
                author: decoded.data.author ?? '',
            }
        }
    } catch {
        // Kaputte Prüfsumme / gekürztes Token — keine Referenz, kein Fehler.
    }
    return null
}

const decodeProfileToken = (entity: string): NostrProfileRef | null => {
    try {
        const decoded = nip19.decode(entity)
        if (decoded.type === 'npub') {
            return { kind: 'profile', pubkey: decoded.data, entity, relays: [] }
        }
        if (decoded.type === 'nprofile') {
            return { kind: 'profile', pubkey: decoded.data.pubkey, entity, relays: decoded.data.relays ?? [] }
        }
    } catch {
        // wie oben
    }
    return null
}

/** Ist das Token eine Ereignis-Kennung? Am Präfix erkennbar, ohne zu dekodieren. */
const isEventToken = (token: string): boolean => token.startsWith('note1') || token.startsWith('nevent1')

/**
 * Die erste qualifizierende Referenz eines Nachrichtentexts — oder `null`.
 *
 * **Priorität: Ereignis vor Profil, unabhängig von der Position.** Steht ein `npub` vor einem
 * `nevent`, gewinnt trotzdem das `nevent`: eine Zitatkarte trägt mehr Kontext als ein
 * Namens-Chip, und zwei Karten sind ausgeschlossen.
 *
 * Die Zweiteilung (erst alle Ereignis-Token, dann alle Profil-Token) ist zugleich die
 * billige Umsetzung dieser Priorität: die Klasse steht am Präfix fest, ohne zu dekodieren —
 * gibt es ein gültiges Ereignis, wird kein einziges Profil-Token angefasst.
 *
 * Der Aufrufer übergibt den Text OHNE vorangestelltes Reply-Zitat
 * (`feeds.ts bodyWithoutQuote`), sonst erzeugte jede Antwort eine Karte für ihr eigenes,
 * bereits als Vorschau gerendertes Zitat.
 */
export const firstNostrRef = (body: string): NostrRef | null => {
    const eventTokens: string[] = []
    const profileTokens: string[] = []
    for (const [, token] of body.matchAll(REF_TOKEN)) {
        const bucket = isEventToken(token) ? eventTokens : profileTokens
        if (bucket.length < REF_DECODE_CAP) {
            bucket.push(token)
        }
        if (eventTokens.length >= REF_DECODE_CAP && profileTokens.length >= REF_DECODE_CAP) {
            break
        }
    }
    for (const token of eventTokens) {
        const ref = decodeEventToken(token)
        if (ref) {
            return ref
        }
    }
    for (const token of profileTokens) {
        const ref = decodeProfileToken(token)
        if (ref) {
            return ref
        }
    }
    return null
}

/**
 * Gekürzte Kennung für den Leerzustand („das Ereignis kenne ich (noch) nicht, aber DAS ist
 * gemeint"). 16 Zeichen + Auslassung ist exakt welshmans eigene Entity-Darstellung
 * (`@welshman/content` `render.js:46`) — dieselbe Konvention wie der njump-Link, den ein
 * unbehandeltes Zitat im Fließtext erzeugt.
 */
export const shortenEntity = (entity: string): string =>
    entity.length > ENTITY_DISPLAY_LEN ? `${entity.slice(0, ENTITY_DISPLAY_LEN)}…` : entity

/**
 * Ersetzt NIP-21-Token IM Vorschautext durch ihre gekürzte Kennung — die Umsetzung von
 * „nie geschachtelt".
 *
 * Eine Karte zeigt einen Ausschnitt des zitierten Ereignisses. Enthält dieser Ausschnitt
 * selbst eine Referenz, entsteht daraus KEINE zweite Karte (es gibt nur eine je Nachricht,
 * und sie wird aus dem äußeren Text gebaut) — wohl aber eine 63 bis 512 Zeichen lange
 * bech32-Wurst, die die ganze Vorschau auffräße. Gekürzt bleibt sie lesbar und als Kennung
 * erkennbar.
 */
export const withShortRefTokens = (text: string): string =>
    text.replace(REF_TOKEN, (_match, token: string) => shortenEntity(token))

/**
 * Pfad des Thread-Deep-Links zu einer Ereignis-Referenz (ohne `?from=`/`?space=` — die
 * hängt der Aufrufer mit `withOrigin`/`withSpace` an, wie `bridge.ts threadHref`).
 *
 * `refRoom` ist der Raum des zitierten Ereignisses, sofern bekannt (sein `h`-Tag), sonst
 * leer. **Der Rückfall auf den aktuellen Raum ist Absicht und kein Notnagel:** die Route
 * `/rooms/{h}/thread/{nevent}` (`routes/group.php:40`) benutzt `{h}` für die umgebende
 * Raumansicht, während der Thread-Inhalt per ID geladen wird — `bridge.ts:3714-3721`
 * dekodiert den `nevent` ausschließlich zur Wurzel-ID und ruft `openThread`, das mit
 * `{ids:[rootId]}` lädt. Ein unbekannter Raum macht den Link also nicht kaputt; er lässt
 * den Nutzer nur dort stehen, wo er ohnehin war.
 */
export const refThreadPath = (entity: string, refRoom: string, currentRoom: string): string =>
    `/rooms/${encodeURIComponent(refRoom || currentRoom)}/thread/${entity}`

/** Wohin ein Klick auf die Zitatkarte führt. */
export type RefClickTarget = 'scroll' | 'thread'

/**
 * Klickziel einer Zitatkarte — die Drei-Fälle-Regel in einer Zeile.
 *
 * `scroll` (Sprung im Verlauf) NUR, wenn das Ereignis aufgelöst UND nachweislich im
 * geladenen Fenster ist. In jedem anderen Fall — fremder Raum, unbekannt, oder derselbe
 * Raum außerhalb des geladenen Fensters — führt der Klick auf den Deep-Link.
 *
 * **Warum das Fenster das Kriterium ist und nicht die Raumzugehörigkeit:**
 * `bridge.ts scrollToMessage` sucht `#msg-{id}` im DOM und kehrt wortlos zurück, wenn der
 * Knoten fehlt (`bridge.ts:4106-4108`). Der Verlauf lädt seitenweise nach, ein Zitat auf
 * eine ältere Nachricht DESSELBEN Raums ist also regelmäßig nicht im DOM — „gleicher Raum"
 * als Kriterium ergäbe genau dort einen Knopf, der nichts tut.
 */
export const refClickTarget = (resolved: boolean, inWindow: boolean): RefClickTarget =>
    resolved && inWindow ? 'scroll' : 'thread'
