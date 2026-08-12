/**
 * Longform-Artikel (P7) — die welshman-Seite: Quelle, Ableitungen, Nachladen.
 *
 * Gegenstück zum reinen `longform.ts` (Tag-Extraktion, Markdown, `naddr`) — dieselbe
 * Aufteilung wie `pins.ts`/`roomPins.ts`. Alles, was ein Relay, den `repository` oder
 * einen Store braucht, steht hier; alles, was unter `node --test` prüfbar sein muss, dort.
 *
 * ── Die Quelle ist NICHT der Space-Relay ────────────────────────────────────────────
 *
 * Artikel liegen auf dem öffentlichen Vereins-Relay (`config('group.board_relay_url')`,
 * per `window.__nostrBoard` in die Insel gereicht), nicht auf dem zooid/Buzz-Space. Das
 * ist die erste Fläche des Clients mit einer **dritten** Relay-Quelle, und deshalb steht
 * hier überall ein **explizites** `relays: [BOARD_URL]` — genau wie `buzzAdmin.ts:127` es
 * vormacht. `core.ts:150-151` setzt nur Defaults für den Router; wer sich darauf verließe,
 * fragte den falschen Relay.
 *
 * Der `repository` ist geteilt: die Artikel landen im selben Store wie Raum-Nachrichten.
 * Die Ableitungen unten binden deshalb konsequent über {@link deriveEventsForUrl} an die
 * **Herkunfts-URL** (via `tracker`) — ein reiner `{kinds:[30023]}`-Filter über den
 * gesamten Store würde auch Artikel einsammeln, die über eine andere Fläche hereinkamen.
 *
 * ── Der Relay ist der Kurationsfilter ──────────────────────────────────────────────
 *
 * `restricted_writes: true` (NIP-11, am 2026-08-12 nachgemessen; nostr-rs-relay 0.10.0,
 * kein `auth_required`, Lesen frei). Wer dort schreiben darf, ist kuratiert — ein
 * `{kinds:[30023], limit:N}` genügt also, und es braucht **keine** Autorenliste.
 *
 * **Und es darf ausdrücklich nicht mehr gefiltert werden.** Kein `#t` (nur 22 der 99
 * Artikel tragen `t`-Tags — der Filter verlöre 77), und schon gar nicht auf das
 * `d`-Muster: 67 der 99 heißen `draft-<ts>` und sind trotzdem publiziert (Begründung bei
 * `LONGFORM_DRAFT` in `longform.ts`).
 */
import { displayProfileByPubkey, profilesByPubkey } from '@welshman/app'
import { load } from '@welshman/net'
import { throttled } from '@welshman/store'
import { normalizeRelayUrl, type Filter, type TrustedEvent } from '@welshman/util'
import { derived, readable, type Readable } from 'svelte/store'
import { proxifyImage } from './core'
import {
    LONGFORM,
    articleSnippet,
    decodeArticleNaddr,
    naddrForArticle,
    readArticleTags,
    renderArticleHtml,
    type ArticleAddress,
} from './longform'
import { warmProfiles } from './profiles'
import { deriveEventsForUrl } from './repository'

/**
 * Die Board-Relay-URL, normalisiert — `''`, wenn keine konfiguriert ist.
 *
 * Bewusst direkt aus `globalThis` gelesen, wie `WORKSPACE` in `core.ts:157-160`: der Host
 * schreibt sie im `<head>` vor dem Insel-Boot, ein E2E-Lauf kann sie per
 * `addInitScript` vorbesetzen (das `??` im Head-Partial lässt den Test gewinnen).
 *
 * Leer heißt: die Fläche zeigt ihren Leerzustand und schickt **keinen** REQ. Ein
 * Default-Relay im Code wäre hier falsch — er machte aus einer fehlenden Konfiguration
 * eine stille Verbindung ins öffentliche Internet.
 */
export const BOARD_URL = ((): string => {
    const raw = (globalThis as { __nostrBoard?: string }).__nostrBoard

    return raw ? normalizeRelayUrl(raw) : ''
})()

/** Wie viele Artikel der Bestands-Load höchstens holt. */
export const ARTICLE_LOAD_LIMIT = 200

/** Eine Zeile der Artikelliste. Reiner Anzeigezustand — kein Markdown, kein HTML. */
export type ArticleRow = {
    /** Event-Id — nur als `:key` der Liste. Sie wechselt bei jeder Änderung des Artikels. */
    id: string
    /** `naddr` (NIP-19) — die portable Kennung in der URL. `''`, wenn das `d` fehlt. */
    naddr: string
    title: string
    /** `summary`-Tag, sonst eine Fließtext-Vorschau aus dem Artikel selbst. */
    teaser: string
    /**
     * Titelbild, ROH wie im Tag — `''`, wenn keins gesetzt ist.
     *
     * Der Bild-Proxy läuft erst in der Oberfläche (`$img(row.image, 'msg')`), wie bei
     * `room.picture` in `room-tile.blade.php:21` und `space.banner` in
     * `⚡spaces.blade.php:189`. Der Grund ist nicht Geschmack: `x-group::nostr-avatar`
     * proxifiziert seinen Wert SELBST — ein hier schon proxifizierter Wert liefe durch
     * den Proxy zweimal und käme als 404 zurück.
     */
    image: string
    authorName: string
    /** Avatar des Autors, ROH — `x-group::nostr-avatar` proxifiziert selbst. */
    authorPicture: string
    /** Erstveröffentlichung in Sekunden (`published_at`, sonst `created_at`). */
    publishedAt: number
    dateLabel: string
    topics: string[]
}

/** Die Vollansicht: eine {@link ArticleRow} plus dem gerenderten Artikeltext. */
export type ArticleView = ArticleRow & {
    /** Der gerenderte Artikel. Entsteht ausschließlich über `renderArticleHtml`. */
    html: string
}

/**
 * Datum einer Artikelzeile.
 *
 * Ohne Uhrzeit: ein Artikel ist ein Tagesdatum, keine Minute. `de-DE` ist an dieser
 * Stelle bewusst dieselbe bekannte Grobheit wie in `feeds.ts:274` — die Formatierung
 * hängt dort wie hier an einer festen Locale statt an der gewählten Sprache. Das ist ein
 * eigener, bereits notierter Auftrag (offene Frage 10 des Plans) und wird hier nicht
 * nebenbei anders gelöst, sonst gäbe es zwei Wahrheiten über dasselbe Format.
 */
const dateLabel = (ts: number): string =>
    new Date(ts * 1000).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })

/** Filter des Bestands — bewusst nur Kind und Limit (siehe Modulkopf). */
const listFilters = (limit: number): Filter[] => [{ kinds: [LONGFORM], limit }]

/**
 * Filter für GENAU einen Artikel: Autor + `d`.
 *
 * Nötig für den kalten Direkteinstieg (geteilter Link, Reload, Lesezeichen) — dann liegt
 * im `repository` noch nichts. Ein `ids`-Filter ginge nicht: der `naddr` trägt die
 * Adresse, nicht die Event-Id, und die wechselt bei einem ersetzbaren Event mit jeder
 * Überarbeitung.
 */
const addressFilters = (address: ArticleAddress): Filter[] => [
    { kinds: [LONGFORM], authors: [address.pubkey], '#d': [address.identifier] },
]

/** Event → Listenzeile. Der einzige Ort, an dem aus einem 30023 Anzeigezustand wird. */
const toRow = (event: TrustedEvent, picture: string): ArticleRow => {
    const tags = readArticleTags(event.tags, event.created_at)

    return {
        id: event.id,
        naddr: tags.identifier ? naddrForArticle(event.pubkey, tags.identifier, BOARD_URL ? [BOARD_URL] : []) : '',
        title: tags.title,
        teaser: tags.summary || articleSnippet(event.content),
        image: tags.image,
        authorName: displayProfileByPubkey(event.pubkey),
        authorPicture: picture,
        publishedAt: tags.publishedAt,
        dateLabel: dateLabel(tags.publishedAt),
        topics: tags.topics,
    }
}

/**
 * Der gerenderte Artikeltext, gemerkt je Event-Id.
 *
 * Ein Artikel ist im Median 3 679 Zeichen groß, der größte 245 875 (davon 243 230 in
 * einem einzigen eingebetteten base64-Bild). Ohne diesen Merker liefe der Renderer bei
 * JEDEM Emit der Ableitung erneut — und die Ableitung hängt an den Profilen, die
 * asynchron nachtröpfeln. Die Id ist als Schlüssel korrekt, weil sie sich bei jeder
 * Überarbeitung des Artikels mitändert: eine neue Fassung bekommt zwangsläufig einen
 * neuen Eintrag, ein Veralten ist ausgeschlossen. Dasselbe Muster wie `htmlCache` in
 * `feeds.ts:216`.
 */
const htmlCache = new Map<string, string>()

const renderCached = (event: TrustedEvent): string => {
    let html = htmlCache.get(event.id)
    if (html === undefined) {
        html = renderArticleHtml(event.content, (url) => proxifyImage(url, 'full'))
        htmlCache.set(event.id, html)
    }

    return html
}

/**
 * Die Artikelliste des Board-Relays, absteigend nach Erstveröffentlichung.
 *
 * **Reaktiv über zwei Quellen**, und beide sind nötig: die Events (sie kommen nach dem
 * `load` herein) und die Profile (Autorname und Avatar treffen später ein, oft deutlich
 * später — die zwölf Autoren stehen auf ihren eigenen Relays). Ein einmaliges Auslesen
 * beim Mount ist genau der Fehler, der P6b zurückgeworfen hat; hier läuft deshalb alles
 * über `.subscribe()` bzw. `derived`, nichts über einen Schnappschuss.
 *
 * `throttled(300, …)` an beiden Eingängen wie in `members.ts:170` und `feeds.ts:1763`:
 * die Profil-Karte feuert pro eingehendem kind-0.
 */
export const deriveArticles = (): Readable<ArticleRow[]> =>
    derived(
        [
            throttled(300, deriveEventsForUrl(BOARD_URL, listFilters(ARTICLE_LOAD_LIMIT))),
            throttled(300, profilesByPubkey),
        ],
        ([events, $profiles]) =>
            (events as TrustedEvent[])
                .map((event) => toRow(event, $profiles.get(event.pubkey)?.picture ?? ''))
                .sort((a, b) => b.publishedAt - a.publishedAt),
    )

/**
 * Ein einzelner Artikel, adressiert über seinen `naddr` — `null`, solange er nicht da ist.
 *
 * `null` heißt „noch nicht geladen ODER gibt es nicht"; die Unterscheidung trifft die
 * Insel über ihren eigenen Ladezustand, nicht diese Ableitung. Ein unlesbarer oder
 * fremder `naddr` (anderes Kind, kaputtes bech32) liefert dauerhaft `null`, ohne dass je
 * ein REQ rausgeht — {@link decodeArticleNaddr} fängt das ab.
 */
export const deriveArticle = (naddr: string): Readable<ArticleView | null> => {
    const address = decodeArticleNaddr(naddr)
    if (!address || !BOARD_URL) {
        return readable<ArticleView | null>(null)
    }

    return derived(
        [
            throttled(300, deriveEventsForUrl(BOARD_URL, addressFilters(address))),
            throttled(300, profilesByPubkey),
        ],
        ([events, $profiles]) => {
            // Ersetzbares Event: bei mehreren Fassungen im Store gewinnt die jüngste
            // `created_at` — dieselbe Regel, die auch der Relay anwendet.
            const newest = (events as TrustedEvent[]).reduce<TrustedEvent | null>(
                (best, event) => (!best || event.created_at > best.created_at ? event : best),
                null,
            )
            if (!newest) {
                return null
            }

            return { ...toRow(newest, $profiles.get(newest.pubkey)?.picture ?? ''), html: renderCached(newest) }
        },
    )
}

/** Autoren-Profile wärmen — sonst steht in der Zeile die npub-Kurzform statt des Namens. */
const warmAuthors = (events: TrustedEvent[]): void => {
    void warmProfiles(events.map((event) => event.pubkey))
}

/**
 * Das Ergebnis eines Ladevorgangs — und zwar mehr als „wie viele Ereignisse".
 *
 * ── Warum `complete` existiert ─────────────────────────────────────────────────────
 *
 * `load()` **wirft nicht**, wenn der Relay unerreichbar ist: es löst nach kurzer Zeit mit
 * einer leeren Liste auf. Ohne dieses Feld wäre „der Relay ist tot" von „der Relay hat
 * nichts" nicht zu unterscheiden — und die Oberfläche sagte „Noch keine Artikel." über
 * einen Relay, mit dem sie nie gesprochen hat.
 *
 * Gemessen (2026-08-12, `load()` direkt aus `@welshman/net`, je ein Lauf):
 *
 * | Fall                              | events | EOSE  | disconnect | Dauer   |
 * |-----------------------------------|--------|-------|------------|---------|
 * | gesunder Relay (Prod-Board)       | 5      | true  | false      |  916 ms |
 * | Relay lebt, AUTH fehlt (zooid)    | 0      | false | false      | 3206 ms |
 * | toter Port (`ws://127.0.0.1:1/`)  | 0      | false | true       |  203 ms |
 * | Host nicht auflösbar              | 0      | false | true       |  205 ms |
 *
 * Deshalb hängt `complete` am **EOSE**, nicht an `onDisconnect`: `disconnect` fängt nur
 * den toten Socket und verpasst genau den Fall, den ein member-only-Relay erzeugt
 * (Verbindung steht, Abfrage wird abgelehnt, kein EOSE). EOSE beantwortet dagegen die
 * Frage, auf die es ankommt — „haben wir eine VOLLSTÄNDIGE Antwort bekommen?".
 */
export type LoadOutcome = {
    /** Hat der Relay die Abfrage vollständig beantwortet (EOSE gesehen)? */
    complete: boolean
    /** Wie viele Ereignisse dabei hereinkamen. */
    count: number
}

/** Nichts gefragt, nichts erfahren — aber auch kein Relay, der schweigt. */
const NOT_ASKED: LoadOutcome = { complete: true, count: 0 }

/**
 * Bestand laden. Einmalig je Aufruf — die Liste selbst bleibt über
 * {@link deriveArticles} reaktiv.
 *
 * Kein `request`/Live-Abo: ein Artikel ist kein Chat. Wer die Seite offen lässt, verpasst
 * höchstens einen neuen Beitrag bis zum nächsten Aufruf, und dafür lohnt keine dauerhaft
 * offene Subscription auf einem dritten Relay.
 */
export const loadArticles = async (signal?: AbortSignal): Promise<LoadOutcome> => {
    if (!BOARD_URL) {
        return NOT_ASKED
    }
    let complete = false
    const events = await load({
        relays: [BOARD_URL],
        filters: listFilters(ARTICLE_LOAD_LIMIT),
        signal,
        onEose: () => {
            complete = true
        },
    })
    warmAuthors(events)

    return { complete, count: events.length }
}

/**
 * Einen einzelnen Artikel nachladen (kalter Direkteinstieg).
 *
 * Ein unlesbarer `naddr` gilt als **vollständig beantwortet mit null Treffern**: da war
 * kein Relay im Spiel, der schweigen könnte — der Link selbst ist kaputt, und genau das
 * darf die Oberfläche dann auch sagen.
 */
export const loadArticle = async (naddr: string, signal?: AbortSignal): Promise<LoadOutcome> => {
    const address = decodeArticleNaddr(naddr)
    if (!address || !BOARD_URL) {
        return NOT_ASKED
    }
    let complete = false
    const events = await load({
        relays: [BOARD_URL],
        filters: addressFilters(address),
        signal,
        onEose: () => {
            complete = true
        },
    })
    warmAuthors(events)

    return { complete, count: events.length }
}
