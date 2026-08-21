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
import { load } from '@welshman/net'
import { throttled } from '@welshman/store'
import { normalizeRelayUrl, type Filter, type TrustedEvent } from '@welshman/util'
import { displayProfileByPubkey, profilesByPubkey } from './spaceProfiles.ts'
import { derived, readable, type Readable } from 'svelte/store'
import { proxifyImage } from './core'
import { formatRelativeDate, formatTimestamp } from './locale'
import {
    LONGFORM,
    buildArticleAuthor,
    buildArticleRow,
    decodeArticleNaddr,
    readingTime,
    relativeDateParts,
    renderArticleHtml,
    type ArticleAddress,
    type ArticleAuthor,
    type ArticleRow,
} from './longform'
import { warmProfiles } from './profiles'
import { deriveEventsForUrl } from './repository'
import { handlesByNip05 } from '@welshman/app'
import { sanitizeUrl } from '@braintree/sanitize-url'
import { verifiedNip05, warmHandles } from './handles'

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

/**
 * Eine Zeile der Artikelliste — **der Typ wohnt seit P1 im reinen `longform.ts`** und
 * wird hier nur durchgereicht.
 *
 * Der Umzug ist keine Kosmetik: `toRow` war der Kernbeweis dieser Fläche und lag in einem
 * Modul, das sich unter `node --test` nicht importieren lässt (gemessen 2026-08-20: 13
 * endungslose relative Importe in der Kette ab hier, und danach bootet `session.ts` beim
 * Import ein `localStorage`, das es in node nicht gibt). Die Adresse des Typs bleibt
 * absichtlich diese hier, damit `bridge.ts` unverändert bleibt.
 */
export type { ArticleRow } from './longform'

/** Die Vollansicht: eine {@link ArticleRow} plus dem gerenderten Artikeltext. */
export type ArticleView = ArticleRow & {
    /** Der gerenderte Artikel. Entsteht ausschließlich über `renderArticleHtml`. */
    html: string
    /**
     * Der Autor als Karte (P3) — Bio, Website, NIP-05, Lightning.
     *
     * **Nur hier und nicht in {@link ArticleRow}.** Die Liste zeigt 104 Zeilen und
     * braucht davon Name und Avatar; die trägt die Zeile längst. Bio und
     * Lightning-Adresse für 104 Autoren-Objekte zu bauen, von denen 103 nie zu sehen
     * sind, wäre Arbeit bei jedem Emit für nichts — und `deriveArticles` emittiert für
     * jedes eintreffende kind-0.
     */
    author: ArticleAuthor
}

/**
 * Datum einer Artikelzeile, **absolut**.
 *
 * Ohne Uhrzeit: ein Artikel ist ein Tagesdatum, keine Minute. Die Sprache kommt seit P3
 * aus `locale.ts` (also aus `<html lang>` und damit aus `app()->getLocale()`), genau wie
 * beim Tagestrenner des Verlaufs in `feeds.ts` — EIN Mechanismus für dasselbe Format,
 * damit es nicht zwei Wahrheiten darüber gibt. Die Feldwahl selbst bleibt hier gesetzt.
 */
const dateLabelAbsolut = (ts: number): string =>
    formatTimestamp(ts, { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Datum einer Artikelzeile **in der LISTE**: relativ für die jüngsten 30 Tage, sonst
 * absolut ({@link relativeDateParts}).
 *
 * ── Warum die Liste und die Vollansicht hier auseinandergehen ────────────────────────
 *
 * Es sind zwei verschiedene Fragen, und deshalb zwei verschiedene Antworten:
 *
 *  · Die **Liste** fragt „was lese ich als Nächstes?". Darauf antwortet „vor 3 Tagen"
 *    besser als „18. August 2026" — die Aussage ist „das ist neu", und die muss man aus
 *    einem Datum sonst erst ausrechnen. Genau dort landet auch der Blick zuerst: die
 *    hervorgehobene Karte ganz oben ist per Definition die jüngste.
 *  · Die **Vollansicht** fragt „wann wurde das geschrieben?". Ein Artikel, den man
 *    gerade liest, zitiert oder weitergibt, braucht sein Datum, nicht seinen Abstand.
 *
 * `deriveArticle` bekommt deshalb weiterhin {@link dateLabelAbsolut} — die Vollansicht
 * (`⚡article.blade.php`, Gegenstand von P3) rendert damit zeichengleich wie vorher.
 *
 * `Date.now()` steht HIER und nicht in `buildArticleRow`: das reine Modul darf keine Uhr
 * kennen, sonst wäre sein Ergebnis nicht mehr reproduzierbar. Es bekommt den fertigen
 * Text über {@link ArticleRowDeps.formatDate}, so wie es auch die Sprache nie selbst
 * nachschlägt.
 *
 * Der Text wird bei jedem Emit neu gebildet und altert deshalb nicht innerhalb einer
 * Sitzung ein — er wird höchstens beim nächsten Emit genauer. Ein Ticker wäre für eine
 * Angabe in Tagen und Wochen Aufwand ohne Gegenwert.
 */
const dateLabelListe = (ts: number): string => {
    const relativ = relativeDateParts(ts, Date.now() / 1000)
    // Zwei Wege zurück ins absolute Datum, und beide sind gewollt: außerhalb der
    // Schwelle (der Normalfall, 89 von 104 Artikeln) und auf einer Laufzeit ohne
    // vollständiges ICU, wo `formatRelativeDate` `null` liefert statt eine fremde
    // Sprache zu raten.
    const label = relativ ? formatRelativeDate(relativ.value, relativ.unit) : null

    return label ?? dateLabelAbsolut(ts)
}

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

/**
 * Die Lesezeit eines Artikels, gemerkt je Event-Id.
 *
 * **Warum das einen Merker braucht.** `readingTime` zählt linear über den Artikeltext.
 * Über den ganzen Bestand gemessen (2026-08-20, 104 Artikel, 1 324 075 Zeichen): **29 ms**.
 * Das wäre einmalig verkraftbar — aber {@link deriveArticles} baut ALLE Zeilen bei jedem
 * Emit neu, und sie emittiert für jedes eintreffende kind-0 der zwölf Autoren. Ohne
 * Merker fielen die 29 ms ein Dutzend Mal an, jedes Mal als ausgelassener Frame.
 *
 * Die Id ist als Schlüssel korrekt, weil sie sich bei jeder Überarbeitung des Artikels
 * mitändert: eine neue Fassung bekommt zwangsläufig einen neuen Eintrag, ein Veralten ist
 * ausgeschlossen. Exakt dieselbe Begründung wie beim {@link htmlCache} darunter.
 */
const readingCache = new Map<string, number>()

const cachedReadingTime = (event: TrustedEvent): number => {
    let minutes = readingCache.get(event.id)
    if (minutes === undefined) {
        minutes = readingTime(event.content)
        readingCache.set(event.id, minutes)
    }

    return minutes
}

/**
 * Event → Listenzeile: die welshman-Seite von {@link buildArticleRow}.
 *
 * Hier steht ausschließlich, WOHER die Anzeigewerte kommen — gebaut wird die Zeile im
 * reinen Modul, und zwar an genau einer Stelle. Was diese Funktion noch entscheiden kann,
 * ist damit auf diese fünf Zuweisungen geschrumpft; alles Fachliche (Feldwahl, `naddr`,
 * Teaser, Datumsfeld, Cover-Verlauf, Podcast-Erkennung) liegt geprüft nebenan.
 */
const toRow = (event: TrustedEvent, picture: string, formatDate = dateLabelAbsolut): ArticleRow =>
    buildArticleRow(event, {
        authorName: displayProfileByPubkey(event.pubkey),
        authorPicture: picture,
        relays: BOARD_URL ? [BOARD_URL] : [],
        formatDate,
        readingMinutes: cachedReadingTime(event),
    })

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
                .map((event) => toRow(event, $profiles.get(event.pubkey)?.picture ?? '', dateLabelListe))
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
            // **Dritter Eingang, und er muss hier stehen.** Der verifizierte NIP-05-Handle
            // trifft NACH dem Artikel ein (`warmHandles` stößt ihn erst an, wenn der Autor
            // bekannt ist). Ohne diesen Eingang rechnete die Ableitung dabei nicht neu, und
            // das Häkchen erschiene nie — genau die Reaktivitäts-Falle, die diese Fläche
            // schon einmal eine Phase gekostet hat (`deriveRoomChat`, siehe Modulkopf).
            throttled(300, handlesByNip05),
        ],
        ([events, $profiles, $handles]) => {
            // Ersetzbares Event: bei mehreren Fassungen im Store gewinnt die jüngste
            // `created_at` — dieselbe Regel, die auch der Relay anwendet.
            const newest = (events as TrustedEvent[]).reduce<TrustedEvent | null>(
                (best, event) => (!best || event.created_at > best.created_at ? event : best),
                null,
            )
            if (!newest) {
                return null
            }

            const profil = $profiles.get(newest.pubkey)
            // Die Website ist Fremdtext aus einem kind 0 und wird deshalb HIER
            // sanitisiert, nicht in der Fläche: `sanitizeUrl` gibt für alles
            // Gefährliche `'about:blank'` zurück, und das ist als `href` sichtbar
            // sinnlos — also fällt es weg. Dieselbe Behandlung wie in der Profilkarte
            // (`bridge.ts`, `nostrProfileCard`), damit es über die Adresse eines Autors
            // nicht zwei Urteile gibt.
            const website = profil?.website ? sanitizeUrl(profil.website) : ''

            return {
                ...toRow(newest, profil?.picture ?? ''),
                html: renderCached(newest),
                author: buildArticleAuthor(newest.pubkey, {
                    name: displayProfileByPubkey(newest.pubkey),
                    picture: profil?.picture ?? '',
                    about: profil?.about ?? '',
                    website: website === 'about:blank' ? '' : website,
                    // **Der Unterschied zwischen „hat keine" und „wissen wir noch nicht".**
                    // Das kind 0 trifft asynchron ein; vor seinem Eintreffen ist `profil`
                    // `undefined`, und jede Aussage über eine Zahlungsadresse wäre
                    // ungedeckt. Genau das stand vorher unter jedem Artikel, bis das
                    // Profil da war.
                    profilBekannt: profil !== undefined,
                    // **Nur das Ja/Nein wandert weiter, nie die Adresse.** Gelesen wird sie
                    // aus der GEMERGTEN Map (`spaceProfiles.ts`) — dieselbe Quelle wie die
                    // Profilkarte, und die Zweitquelle vom Workspace-Relay trägt das Feld
                    // gar nicht erst (Ebene 3 in `zapTargetSources.test.ts`). Hier endet
                    // ihr Weg: `buildArticleAuthor` bekommt einen Wahrheitswert.
                    hatLightning: (profil?.lud16 ?? '') !== '',
                    // **Der VERIFIZIERTE Handle, nie der Rohwert aus kind 0.** Ein
                    // Häkchen neben einem unbestätigten `nip05` wäre eine Behauptung
                    // über eine fremde Domain, die niemand geprüft hat.
                    nip05: verifiedNip05(newest.pubkey, $profiles, $handles),
                }),
            }
        },
    )
}

/**
 * Autoren-Profile wärmen — sonst steht in der Zeile die npub-Kurzform statt des Namens.
 *
 * Seit P3 zusätzlich die NIP-05-Handles: die Autorenkarte der Vollansicht zeigt ein
 * Häkchen, und das entsteht erst, wenn welshman die `.well-known/nostr.json` des
 * Handles geholt und die pubkey darin bestätigt hat. Ohne dieses Anstoßen bliebe es für
 * jeden Autor aus — nicht falsch, aber dauerhaft leer.
 *
 * Beide sind fire-and-forget und deduplizieren selbst; die Liste ruft dasselbe für alle
 * 104 Zeilen auf, die Vollansicht für einen Autor.
 */
const warmAuthors = (events: TrustedEvent[]): void => {
    const pubkeys = events.map((event) => event.pubkey)
    void warmProfiles(pubkeys)
    warmHandles(pubkeys)
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
