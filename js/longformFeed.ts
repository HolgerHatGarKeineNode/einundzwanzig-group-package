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
 * vormacht. `core.ts` setzt mit `routerContext.getDefaultRelays` nur Defaults für den
 * Router; wer sich darauf verließe,
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
import { load } from './welshmanNet.ts'
import { throttled } from '@welshman/store'
import { getLnUrl, normalizeRelayUrl, type Filter, type TrustedEvent } from '@welshman/util'
import { COMMENT, REACTION, ZAP_RECEIPT } from './welshmanKinds.ts'
import { type Zapper } from './welshmanZap.ts'
import { displayProfileByPubkey, profilesByPubkey } from './spaceProfiles.ts'
import { derived, readable, type Readable } from 'svelte/store'
import { proxifyImage } from './core.ts'
import { formatRelativeDate, formatTimestamp } from './locale.ts'
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
} from './longform.ts'
import { artikelDesAutors } from './articleAuthor.ts'
import {
    KEINE_METRIKEN,
    artikelAdresse,
    METRIK_LOAD_LIMIT,
    artikelMetrikFilters,
    autorenMitQuittungen,
    berechneArtikelMetriken,
    deckelVerdacht,
    leseRelayListe,
    type ArtikelMetriken,
    type ArticleRowMitMetriken,
} from './articleMetrics.ts'
import {
    ARTIKEL_REAKTION,
    artikelKommentare,
    eigeneReaktion,
    type ArtikelKommentar,
    type EigeneReaktion,
} from './articleWrite.ts'
import { makeComment, makeEventDelete, makeReaction } from './interactions.ts'
import { publishOptimistic } from './publishOptimistic.ts'
import { warmProfiles } from './profiles.ts'
import { deriveEventsForUrl, deriveEventsForUrls } from './repository.ts'
import { app, Handles, Zappers } from './welshmanApp.ts'
import { pubkey } from './welshmanSession.ts'
import { sanitizeUrl } from '@braintree/sanitize-url'
import { verifiedNip05, warmHandles } from './handles.ts'
import { warmZappers } from './zaps.ts'

/**
 * Die Board-Relay-URL, normalisiert — `''`, wenn keine konfiguriert ist.
 *
 * Bewusst direkt aus `globalThis` gelesen, wie `WORKSPACE` in `core.ts`: der Host
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
 * Die Relays, auf denen die **Sozialsignale** zu den Artikeln liegen (P6) — zusätzlich
 * zum Board-Relay.
 *
 * ── Kein Code-Default, aus demselben Grund wie bei {@link BOARD_URL} ───────────────
 *
 * Hier stand zunächst `['wss://nos.lol/', 'wss://relay.damus.io/']` als Literal. **Das
 * war falsch**, und zwar nach der Regel, die `config/group.php` bei `board_relay_url`
 * schon aufgeschrieben hat: ein Default im Code macht aus einer fehlenden Konfiguration
 * eine stille WebSocket-Verbindung ins öffentliche Internet. Für einen E2E-Lauf wäre das
 * nicht bloß unschön — der Relay-Wächter (`tests/e2e/support/fixtures.ts`) ist
 * fail-closed gegen eine Allowlist der eigenen Worker-Ports, und ein Verbindungsversuch
 * zu `nos.lol` machte **jeden** Test rot, der eine Artikelfläche berührt.
 *
 * Die Adressen stehen deshalb in der Konfiguration (`NOSTR_ARTICLE_METRIC_RELAYS`,
 * kommagetrennt) und die empfohlenen Werte in `.env.example`. Leer heißt: nur der Board
 * wird gefragt — die Zähler sind dann kleiner, aber nichts bricht.
 *
 * ── Und was eine leere Liste real kostet ──────────────────────────────────────────
 *
 * Am 2026-08-21 über die Adressen und Event-Ids aller 104 Artikel gemessen (`nak req`,
 * je Relay ALLE Filterformen, danach über die Event-Id dedupliziert):
 *
 * | Kind | Board | nos.lol | damus | Union |
 * |------|-------|---------|-------|-------|
 * | 7    |    64 |     452 |   316 |   465 |
 * | 9735 |     5 |     168 |   127 |   168 |
 * | 1111 |    13 |      61 |    38 |    64 |
 *
 * Der Board allein sieht **14 %** der Reaktionen, **3 %** der Zaps und **20 %** der
 * Kommentare. „0 Zaps" unter einem Artikel, der real 3 000 Sats bekommen hat, wäre keine
 * fehlende Anzeige, sondern eine falsche Aussage.
 *
 * **Und beide Fremdrelays tragen etwas bei, nicht nur eines:** über alle drei Kinds
 * zusammen liefert `nos.lol` 681 der 697 Ereignisse, `damus` 481 — die Union ist 697,
 * also liegen 16 Ereignisse **nicht** auf nos.lol.
 *
 * ── Der Preis, und wo er vollständig steht ────────────────────────────────────────
 *
 * Diese Relays erfahren beim **bloßen Öffnen** einer Artikelfläche IP, User-Agent,
 * Zeitpunkt und **welche Artikel dieser Leser ansieht** — die Vollansicht fragt mit genau
 * einer Adresse. Der **Pubkey** geht nicht hinaus: `core.ts` beantwortet ihre
 * NIP-42-Challenges seit P6 nicht mehr (`darfAuthBekommen` in `articleMetrics.ts`, dort
 * mit Begründung und Messung).
 *
 * **Dazu ein ZWEITER Abfluss, den diese Variable nicht abschaltet:** die Validierung der
 * Zap-Quittungen braucht die LNURL-Metadaten des Autors, geholt per HTTPS von dessen
 * fremdem Wallet-Host. Unvermeidbar, aber an den Bedarf gekoppelt — angefragt werden nur
 * Autoren mit Quittungen ({@link autorenMitQuittungen}, gemessen 6 von 12).
 *
 * Der ganze Handel steht bei `article_relay_urls` in `config/group.php` und in
 * `.env.example` — dort, wo der Betreiber ihn eingeht.
 */
export const SEKUNDAER_RELAYS = ((): string[] => {
    const raw = (globalThis as { __nostrArticleRelays?: string }).__nostrArticleRelays

    return leseRelayListe(raw)
})()

/**
 * Alle Relays, aus denen ein Sozialsignal stammen darf: Board **plus** die
 * konfigurierten Fremdrelays. Leer, solange kein Board konfiguriert ist — dann fragt
 * diese Fläche überhaupt nichts (siehe {@link BOARD_URL}).
 *
 * **Das `Set` ist kein Schönheitsfehler.** `NOSTR_ARTICLE_METRIC_RELAYS` DARF den Board
 * noch einmal nennen, und im E2E tut es das ausdrücklich (`board-fixtures.ts` setzt
 * beide auf denselben Worker-Relay, weil eine fremde Adresse dort den Relay-Wächter
 * bräche). Ohne die Deduplizierung fragte `load()` denselben Relay zweimal — sechs REQs
 * zu viel, ohne ein einziges zusätzliches Ereignis. Beide Seiten sind über
 * `normalizeRelayUrl` gegangen, der Vergleich trägt also.
 */
const metrikRelays = (): string[] => (BOARD_URL ? [...new Set([BOARD_URL, ...SEKUNDAER_RELAYS])] : [])

/**
 * Eine Zeile der Artikelliste — **der Typ wohnt seit P1 im reinen `longform.ts`** und
 * wird hier nur durchgereicht.
 *
 * Der Umzug ist keine Kosmetik: `toRow` war der Kernbeweis dieser Fläche und lag in einem
 * Modul, das damals unter `node --test` nicht importierbar war (gemessen 2026-08-20: 13
 * endungslose relative Importe in der Kette ab hier, und danach ein `localStorage` beim
 * Import von `session.ts`). Beide Barrieren sind seit P1/P2 des Plans
 * `js-insel-testbar-machen` weg — geblieben ist der Boot-Aufwand des Graphen, und damit
 * der Grund, den reinen Typ getrennt zu halten. Die Adresse des Typs bleibt absichtlich
 * diese hier, damit `bridge.ts` unverändert bleibt.
 */
export type { ArticleRow } from './longform.ts'

/** Die Vollansicht: eine {@link ArticleRow} plus dem gerenderten Artikeltext. */
export type ArticleView = ArticleRowMitMetriken & {
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
    /**
     * Die Kommentare (P7) — **render-fertig, chronologisch, flach.**
     *
     * Nur hier und nicht in {@link ArticleRow}, aus demselben Grund wie `author`: die
     * Liste zeigt 104 Zeilen und braucht davon eine Zahl, nicht 64 Texte samt Namen.
     */
    kommentare: KommentarZeile[]
    /**
     * Die **eigene** Reaktion auf diesen Artikel — `null`, wenn es keine gibt (oder
     * niemand angemeldet ist). Trägt die Event-Id, weil der Toggle sie zum Zurücknehmen
     * braucht (kind 5 auf genau diese Id).
     */
    eigeneReaktion: EigeneReaktion
}

/**
 * Ein Kommentar, wie die Fläche ihn zeigt.
 *
 * **`content` bleibt roher Klartext und wird als TEXT gebunden** (`x-text`), nie über
 * `x-html`. Der Artikeltext selbst geht durch `renderArticleHtml` und dessen geprüfte
 * Zusage (`html: false`, keine `x-`/`@`/`:`-Attribute — `articleRenderSicherheit.test.ts`);
 * ein Kommentar ist Fremdtext aus einem beliebigen Relay und bekommt diesen Weg NICHT.
 * Wer hier später Markdown möchte, hat dieselbe Sicherheitsfrage neu zu beantworten.
 *
 * `name` fällt auf die npub-Kurzform zurück (`displayProfileByPubkey`), `zeit` ist
 * relativ wie im Chat — die Kommentare eines Artikels sind über Monate verteilt (Median
 * 57 Tage, gemessen 2026-08-21), ein „vor 2 Monaten" liest sich dort besser als ein Datum.
 */
export type KommentarZeile = ArtikelKommentar & {
    name: string
    picture: string
    zeit: string
    /** Absolut, für das `title`/`datetime` — die relative Angabe allein ist nicht belegbar. */
    zeitIso: string
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
 * Der Filter, mit dem die ABLEITUNG die Sozialsignale aus dem `repository` liest — nicht
 * der, mit dem sie geholt werden.
 *
 * **Die Unterscheidung ist nicht kosmetisch.** Über das Netz stehen sechs getrennte
 * Filter (`artikelMetrikFilters`), weil `nos.lol` und `relay.damus.io` je REQ bei 500
 * Treffern deckeln (NIP-11 `max_limit`, gemessen 2026-08-21) — ein kombinierter REQ verlor
 * dabei 44 Ereignisse. Der `repository` kennt keinen solchen Deckel: dort ist ein einziger
 * Filter über alle drei Kinds richtig, und er spart drei Store-Abonnements.
 *
 * Die **Zuordnung** zum Artikel passiert nicht hier, sondern in `articleMetrics.ts`
 * (`artikelVonEreignis`). Das ist Absicht: ein Store-Filter kann die Adressliste des
 * Bestands nicht kennen — sie entsteht erst aus den geladenen Artikeln, also NACH dem
 * Anlegen der Ableitung. Ein Filter, der beim Mount festgeschrieben wird und danach nie
 * nachzieht, ist genau der Fehler, den diese Fläche schon einmal gemacht hat.
 */
const metrikStoreFilters = (): Filter[] => [{ kinds: [REACTION, ZAP_RECEIPT, COMMENT] }]

/**
 * Aus einem Artikelbestand die drei Tabellen bauen, die {@link berechneArtikelMetriken}
 * braucht: die Adressliste, `Event-Id → Adresse` und `Adresse → Autor`.
 *
 * In EINEM Durchgang, weil `deriveArticles` das bei jedem Emit tut und der Bestand 104
 * Zeilen hat.
 */
const artikelIndex = (events: TrustedEvent[]) => {
    const adressen: string[] = []
    const adresseVonId = new Map<string, string>()
    const autorVonAdresse = new Map<string, string>()
    for (const event of events) {
        // Ein Artikel ohne `d`-Tag hat keine Adresse und kann keine adressierten Signale
        // tragen. Im Bestand gibt es davon null (2026-08-21), aber ein `30023:<pk>:`
        // stünde sonst als gültige Adresse in der Tabelle und sammelte alles ein, was
        // ebenfalls kein `d` hat.
        const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? ''
        if (!identifier) {
            continue
        }
        const adresse = artikelAdresse(event.pubkey, identifier)
        adressen.push(adresse)
        adresseVonId.set(event.id, adresse)
        autorVonAdresse.set(adresse, event.pubkey)
    }

    return { adressen, adresseVonId, autorVonAdresse }
}

/**
 * Der Zapper-Nachschlager für {@link berechneArtikelMetriken}: `pubkey` → LNURL-Metadaten
 * des Autors, oder `undefined`, solange sie fehlen.
 *
 * Der Weg ist derselbe wie im Chat (`feeds.ts`, `memoedToChatMessage`): Profil → `lud16`
 * bzw. `lud06` → `getLnUrl` → welshmans `zappersByLnurl`. **Ohne ihn zählt
 * {@link summiereZaps} null**, weil `zapFromEvent` den Signer der Quittung gegen
 * `zapper.nostrPubkey` prüft — das ist der Anti-Spoof-Riegel und keine Hürde, die man
 * umgeht.
 */
const zapperNachschlag =
    (
        $profiles: Map<string, { lud16?: string; lud06?: string }>,
        $zappers: Map<string, Zapper>,
    ): ((pubkey: string) => Zapper | undefined) =>
    (pubkey: string) => {
        const profil = $profiles.get(pubkey)
        const lnurl = getLnUrl(profil?.lud16 || profil?.lud06 || '')

        return lnurl ? $zappers.get(lnurl) : undefined
    }

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
 * Der Typ {@link ArticleRowMitMetriken} wohnt in `articleMetrics.ts` und wird hier nur
 * weitergereicht — dieselbe Begründung wie bei `ArticleRow` darüber: er muss unter
 * `node --test` ohne den App-Boot erreichbar sein, und diese Datei zieht ihn mit.
 */
export type { ArticleRowMitMetriken } from './articleMetrics.ts'

/** Zeile plus Metriken — `KEINE_METRIKEN`, wenn dieser Artikel kein Signal trägt. */
const mitMetriken = (row: ArticleRow, tabelle: Map<string, ArtikelMetriken>): ArticleRowMitMetriken => ({
    ...row,
    metriken: (row.identifier ? tabelle.get(artikelAdresse(row.pubkey, row.identifier)) : undefined) ?? KEINE_METRIKEN,
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
export const deriveArticles = (): Readable<ArticleRowMitMetriken[]> =>
    derived(
        [
            throttled(300, deriveEventsForUrl(BOARD_URL, listFilters(ARTICLE_LOAD_LIMIT))),
            throttled(300, profilesByPubkey),
            // **Dritter Eingang (P6), und er ist Pflicht, nicht Beiwerk.** Die
            // Sozialsignale kommen von drei Relays und treffen deutlich NACH den Artikeln
            // ein. Ohne diesen Eingang rechnete die Ableitung beim Eintreffen nicht neu und
            // die Zähler blieben für immer aus — die Fläche wäre stumm leer, obwohl die
            // Daten längst im `repository` liegen. Genau dieser Fehler hat
            // `deriveRoomChat`/`deriveThread` schon einmal eine Phase gekostet (Modulkopf).
            throttled(300, deriveEventsForUrls(metrikRelays(), metrikStoreFilters())),
            // **Vierter Eingang, aus demselben Grund.** Ohne aufgelösten Zapper verwirft
            // `zapFromEvent` jede Quittung (Signer-Check), und der Zapper lädt fast immer
            // NACH den 9735 — der Zap-Zähler bliebe sonst dauerhaft auf null stehen,
            // obwohl die Quittungen da sind. Derselbe Eingang steht aus derselben
            // Begründung in `feeds.ts` (`deriveRoomChat`).
            throttled(300, app.use(Zappers).index.$),
        ],
        ([events, $profiles, $sekundaer, $zappers]) => {
            const index = artikelIndex(events as TrustedEvent[])
            // Die Zapper anstoßen — fire-and-forget, dedupliziert selbst. **Nur für die
            // Autoren, deren Artikel wirklich eine Quittung tragen**: jeder Aufruf ist
            // eine HTTPS-Anfrage an einen FREMDEN Wallet-Host, und die geht sonst beim
            // bloßen Öffnen der Liste an alle zwölf. Gemessen halbiert die Kopplung sie
            // auf sechs (Herleitung bei `autorenMitQuittungen`).
            warmZappers(autorenMitQuittungen({ ...index, ereignisse: $sekundaer as TrustedEvent[] }))
            const tabelle = berechneArtikelMetriken({
                ...index,
                ereignisse: $sekundaer as TrustedEvent[],
                zapperVon: zapperNachschlag($profiles, $zappers as Map<string, Zapper>),
            })

            return (events as TrustedEvent[])
                .map((event) => mitMetriken(toRow(event, $profiles.get(event.pubkey)?.picture ?? '', dateLabelListe), tabelle))
                .sort((a, b) => b.publishedAt - a.publishedAt)
        },
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
            throttled(300, app.use(Handles).index.$),
            // **Vierter und fünfter Eingang (P6)** — dieselbe Begründung wie in
            // {@link deriveArticles}: die Sozialsignale und die Zapper treffen NACH dem
            // Artikel ein. Fehlten sie hier, zeigte die Vollansicht dauerhaft keine
            // Zähler, während die Liste sie hat.
            throttled(300, deriveEventsForUrls(metrikRelays(), metrikStoreFilters())),
            throttled(300, app.use(Zappers).index.$),
        ],
        ([events, $profiles, $handles, $sekundaer, $zappers]) => {
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
            // Nur DIESER eine Artikel geht in den Index — die Vollansicht kennt keinen
            // Bestand. Ein `#e`-Signal auf eine andere Fassung desselben Artikels ist damit
            // hier nicht zuordenbar; in der Liste ist es das, weil dort alle geladenen
            // Fassungen in der Tabelle stehen.
            const index = artikelIndex([newest])
            // Auch hier nur bei echtem Bedarf — siehe `autorenMitQuittungen`. Ein Artikel
            // ohne Zaps kontaktiert den Wallet-Host seines Autors gar nicht erst.
            warmZappers(autorenMitQuittungen({ ...index, ereignisse: $sekundaer as TrustedEvent[] }))
            const tabelle = berechneArtikelMetriken({
                ...index,
                ereignisse: $sekundaer as TrustedEvent[],
                zapperVon: zapperNachschlag($profiles, $zappers as Map<string, Zapper>),
            })

            return {
                ...mitMetriken(toRow(newest, profil?.picture ?? ''), tabelle),
                html: renderCached(newest),
                author: buildArticleAuthor(newest.pubkey, {
                    name: displayProfileByPubkey(newest.pubkey),
                    picture: profil?.picture ?? '',
                    // Die Vollansicht zeigt es nicht — die Autorenseite (P4) tut es, und
                    // beide bauen ihre Karte über dieselbe Funktion. Ein zweiter Bauweg
                    // für ein Feld wäre der teurere Preis (Begründung bei `ArticleAuthorDeps`).
                    banner: profil?.banner ?? '',
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
                // **P7 — Kommentare und eigene Reaktion aus DEMSELBEN `$sekundaer`.** Ein
                // eigener Store-Eingang wäre hier nicht nur überflüssig, sondern die
                // bekannte Falle: er müsste im `derived([…])` oben stehen, und ein
                // Reduzierer-Test könnte nicht sehen, wenn er fehlt (siehe
                // `articleMetricsStore.test.ts`). Die kind-1111 und kind-7 liegen bereits
                // in diesem Array — `metrikStoreFilters` holt alle drei Kinds.
                //
                // Diese beiden Felder stehen bewusst HINTER `author` und nicht vor
                // {@link mitMetriken}: dazwischen läge sonst ein Block, der die Bindung
                // von `profil` weiter als 60 Zeilen von seiner Verwendung in
                // `hatLightning` entfernt — und genau so weit schaut die Herkunftssonde
                // in `zapTargetSources.test.ts` zurück. Beim Bauen von P7 einmal
                // ausgelöst (Ebene 2, „die Quelle im Code ist unbekannt"): ein
                // Blockverschub, der einen fremden Sicherheitstest kippt.
                kommentare: artikelKommentare({
                    ereignisse: $sekundaer as TrustedEvent[],
                    adresse: index.adressen[0] ?? '',
                    adresseVonId: index.adresseVonId,
                }).map((k) => ({
                    ...k,
                    name: displayProfileByPubkey(k.pubkey),
                    picture: $profiles.get(k.pubkey)?.picture ?? '',
                    // Relativ wie im Chat — Begründung bei {@link KommentarZeile}.
                    zeit: dateLabelListe(k.createdAt),
                    zeitIso: new Date(k.createdAt * 1000).toISOString(),
                })),
                eigeneReaktion: eigeneReaktion({
                    ereignisse: $sekundaer as TrustedEvent[],
                    adresse: index.adressen[0] ?? '',
                    adresseVonId: index.adresseVonId,
                    // `pubkey.get()` und kein Store-Eingang: die eigene Identität wechselt
                    // nicht mitten in einer Artikelansicht, und ein Anmelden lädt die Seite
                    // ohnehin neu (`loginNsec` → `/spaces`). Ein sechster throttled-Eingang
                    // für einen Wert, der sich nie ändert, kostete jeden Emit mit.
                    meinPubkey: pubkey.get() ?? '',
                }),
            }
        },
    )
}

/**
 * Was die Autorenseite (P4) in einem Zug braucht: die Artikel dieses Autors und seine
 * Karte.
 *
 * **Eine Ableitung, nicht zwei.** Artikel und Autorenkarte hängen an denselben zwei
 * Quellen (den Events und den Profilen); als zwei Ableitungen emittierten sie zu
 * verschiedenen Zeitpunkten, und die Fläche zeigte für einen Moment die Artikel eines
 * Autors unter der Karte eines anderen — bei einem `wire:navigate` von einer Autorenseite
 * zur nächsten genau das, was passiert.
 */
export type AuthorView = {
    /** Die Artikel dieses Autors, absteigend nach Erstveröffentlichung. */
    artikel: ArticleRowMitMetriken[]
    /** Die Autorenkarte — steht IMMER, notfalls mit der npub-Kurzform als Namen. */
    autor: ArticleAuthor
}

/**
 * Die Autorenseite: Artikel eines Autors plus seine Karte.
 *
 * ── Warum hier der VOLLBESTAND gefiltert wird und nicht autorenskopiert geladen ─────
 *
 * Die naheliegende Abfrage wäre `{kinds:[30023], authors:[pubkey]}` — ein eigener,
 * schmaler Filter. Sie steht hier bewusst NICHT, und zwar aus einem Grund, der nichts mit
 * Bequemlichkeit zu tun hat: die **Ableitung** liest den `repository` über
 * {@link listFilters}, also über `{kinds:[30023], limit: ARTICLE_LOAD_LIMIT}`. Ein
 * autorenskopierter LOAD änderte daran nichts — er füllte den Store, aus dem dieselbe
 * Ableitung dann wieder nur die neuesten `ARTICLE_LOAD_LIMIT` Ereignisse sieht. Wer die
 * Seite wirklich vom Bestandsdeckel lösen will, muss **beides** umbauen, Filter und
 * Ableitung, und das ist kein Nebensatz.
 *
 * **Solange der Bestand unter dem Deckel liegt, ist die Auswahl hier vollständig.**
 * Gemessen am 2026-08-20: 104 Artikel bei `ARTICLE_LOAD_LIMIT = 200`.
 *
 * **Und hier steht, woran man merkt, dass das nicht mehr gilt:** sobald der Board-Relay
 * 200 Artikel führt, zeigt diese Seite still einen Ausschnitt — kein Fehler, keine
 * Meldung, nur eine zu kurze Liste und eine zu kleine Zahl daneben. Der Umbau ist dann
 * ein autorenskopierter Filter **in `listFilters` UND in dieser Ableitung**, nicht eine
 * größere Zahl: eine höhere Grenze verschiebt denselben Tag nur.
 *
 * `deriveArticles` wird bewusst nicht wiederverwendet: sie baut ALLE Zeilen (104 ×
 * `buildArticleRow`) bei jedem Emit und emittiert für jedes eintreffende kind 0. Hier
 * wird **zuerst gefiltert und dann gebaut** — für den Autor mit einem Artikel ist das
 * eine Zeile statt 104.
 *
 * Der dritte Eingang (`handlesByNip05`) steht aus demselben Grund hier wie in
 * {@link deriveArticle}: der verifizierte Handle trifft NACH dem Profil ein, und ohne
 * diesen Eingang erschiene das Häkchen nie.
 */
export const deriveAuthorPage = (pubkey: string): Readable<AuthorView> =>
    derived(
        [
            throttled(300, deriveEventsForUrl(BOARD_URL, listFilters(ARTICLE_LOAD_LIMIT))),
            throttled(300, profilesByPubkey),
            throttled(300, app.use(Handles).index.$),
            // **Vierter und fünfter Eingang (P6).** Die Autorenseite rendert dieselbe
            // Karte wie die Liste — ohne diese beiden trüge dieselbe Karte auf zwei
            // Flächen zwei verschiedene Zahlen, und auf dieser hier dauerhaft keine.
            throttled(300, deriveEventsForUrls(metrikRelays(), metrikStoreFilters())),
            throttled(300, app.use(Zappers).index.$),
        ],
        ([events, $profiles, $handles, $sekundaer, $zappers]) => {
            // **Der Kernbeweis von P4, an seiner produktiven Stelle:** gefiltert
            // wird `event.pubkey`. Die Regel selbst liegt geprüft in `articleAuthor.ts`
            // (`artikelDesAutors`) — hier steht kein zweites `filter`, damit es über
            // „welche Artikel gehören diesem Autor" genau eine Wahrheit gibt.
            const eigene = artikelDesAutors(events as TrustedEvent[], pubkey)
            // Der Index steht über dem GANZEN Bestand, nicht nur über `eigene`: ein
            // `#e`-Signal kann auf eine Fassung zeigen, und die Tabelle darf nicht
            // schmaler sein als das, was der Reduzierer zuordnen können muss.
            const index = artikelIndex(events as TrustedEvent[])
            warmZappers(autorenMitQuittungen({ ...index, ereignisse: $sekundaer as TrustedEvent[] }))
            const tabelle = berechneArtikelMetriken({
                ...index,
                ereignisse: $sekundaer as TrustedEvent[],
                zapperVon: zapperNachschlag($profiles, $zappers as Map<string, Zapper>),
            })
            const profil = $profiles.get(pubkey)
            const website = profil?.website ? sanitizeUrl(profil.website) : ''

            return {
                artikel: eigene
                    .map((event) => mitMetriken(toRow(event, profil?.picture ?? '', dateLabelListe), tabelle))
                    .sort((a, b) => b.publishedAt - a.publishedAt),
                // Dieselbe Karte wie unter dem Artikel, gebaut über dieselbe Funktion —
                // inklusive der Dreiwertigkeit des Lightning-Zustands (`profilBekannt`).
                // Solange das kind 0 unterwegs ist, behauptet diese Seite über eine
                // Zahlungsadresse nichts.
                autor: buildArticleAuthor(pubkey, {
                    name: displayProfileByPubkey(pubkey),
                    picture: profil?.picture ?? '',
                    banner: profil?.banner ?? '',
                    about: profil?.about ?? '',
                    website: website === 'about:blank' ? '' : website,
                    profilBekannt: profil !== undefined,
                    hatLightning: (profil?.lud16 ?? '') !== '',
                    nip05: verifiedNip05(pubkey, $profiles, $handles),
                }),
            }
        },
    )

/**
 * Profil und NIP-05-Handle EINES Autors anstoßen.
 *
 * Die Autorenseite braucht das getrennt von {@link warmAuthors}: der dortige Weg holt
 * die Autoren der geladenen ARTIKEL. Ein Autor, den der Bestand (noch) nicht kennt —
 * ein geteilter Link auf jemanden, der hier nie publiziert hat — bekäme sonst nie ein
 * Profil, und die Seite zeigte dauerhaft eine npub-Kurzform über einer leeren Liste
 * statt eines Namens über einer leeren Liste.
 */
export const warmAuthor = (pubkey: string): void => {
    if (pubkey) {
        void warmProfiles([pubkey])
        warmHandles([pubkey])
    }
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
    // Die Sozialsignale hinterher, ohne darauf zu warten (Begründung dort).
    void loadArticleMetrics(events, signal).catch(() => undefined)

    return { complete, count: events.length }
}

/**
 * Die Sozialsignale zu einem Artikelbestand holen — **fire-and-forget, nach den Artikeln**.
 *
 * ── Warum das ein eigener, nachgelagerter Vorgang ist ──────────────────────────────
 *
 * Die Filter brauchen die **Adressen** der Artikel, und die gibt es erst, wenn die Artikel
 * da sind. Ein Vorgriff ist nicht möglich: `#a`-Werte lassen sich nicht raten.
 *
 * ── Warum das Ergebnis niemanden aufhält ───────────────────────────────────────────
 *
 * Die Fläche steht bereits, wenn dieser Aufruf startet: Titel, Teaser, Autor und Datum
 * hängen ausschließlich am 30023. Ein Zähler, der eine Sekunde später erscheint, ist ein
 * Nachtrag; ein Artikel, der eine Sekunde später erscheint, wäre ein Ladezustand. Deshalb
 * gibt diese Funktion **kein** {@link LoadOutcome} zurück und blockiert `loadArticles`
 * nicht: „die Sozialsignale sind unvollständig" ist keine Aussage, die diese Oberfläche
 * treffen kann — sie fragt drei Relays, von denen zwei fremd sind, und ein schweigendes
 * `nos.lol` ist kein Fehler dieser Anwendung.
 *
 * ── Die Zahl der Anfragen, ausgerechnet ────────────────────────────────────────────
 *
 * welshman zerlegt eine Filterliste in **ein REQ je Filter** (belegt in
 * `js/welshmanLoad.test.ts`). Sechs Filter × drei Relays = **18 REQs**. Das ist bewusst
 * unter den 20 gleichzeitigen Abonnements, die `nos.lol` per NIP-11 zusagt
 * (`max_subscriptions: 20`, 2026-08-21) — aber es sind nur sechs davon gegen nos.lol,
 * also bleibt dort Luft. Wer hier einen siebten Filter ergänzt, rechnet das nach.
 */
export const loadArticleMetrics = async (events: TrustedEvent[], signal?: AbortSignal): Promise<number> => {
    const relays = metrikRelays()
    if (relays.length === 0 || events.length === 0) {
        return 0
    }
    const { adressen, adresseVonId } = artikelIndex(events)
    const filters = artikelMetrikFilters({ adressen, ids: [...adresseVonId.keys()] })
    if (filters.length === 0) {
        return 0
    }
    // **Je Filter ein `load`, nicht alle in einem.** Die Zahl der REQs ändert sich davon
    // nicht — welshman zerlegt eine Filterliste ohnehin in ein REQ je Filter je Relay.
    // Was sich ändert, ist die Sichtbarkeit: nur so lässt sich zählen, wie viele
    // Ereignisse EIN REQ geliefert hat, und **der Deckel gilt je REQ.**
    //
    // Der erste Entwurf maß die Gesamtantwort gegen 500 und war damit im Normalbetrieb
    // dauerhaft rot: allein nos.lol liefert über diese 104 Artikel 642 Ereignisse, der
    // größte EINZELFILTER aber nur rund 342. Eine Warnung, die immer feuert, wird nach
    // der zweiten Woche ignoriert — das ist schlechter als keine.
    const proReq = new Map<string, number>()
    const teile = await Promise.all(
        filters.map((filter, nummer) =>
            load({
                relays,
                filters: [filter],
                signal,
                onEvent: (_event, url) => {
                    const schluessel = `${nummer}|${url}`
                    proReq.set(schluessel, (proReq.get(schluessel) ?? 0) + 1)
                },
            }),
        ),
    )
    // Über die Event-Id vereinigen: dasselbe Ereignis kommt aus mehreren REQs zurück.
    const sekundaer = [...new Map(teile.flat().map((event) => [event.id, event])).values()]

    // **Der Deckel meldet sich nicht — also horchen wir hin.** `nos.lol` und
    // `relay.damus.io` kappen jeden REQ bei 500 Treffern (NIP-11 `max_limit`), sagen es
    // aber nicht: sie hören einfach auf. Gemeldet wird je REQ, mit Filter und Relay, damit
    // die Meldung sagt, WO nachzusehen ist. Eine Warnung und kein Wurf: eine gekappte Zahl
    // ist ein Anlass nachzusehen, kein Grund, die Fläche zu nehmen.
    for (const [schluessel, anzahl] of proReq) {
        if (deckelVerdacht(anzahl)) {
            const [nummer, url] = schluessel.split('|')
            console.warn(
                `Sozialsignale: REQ ${nummer} an ${url} lieferte ${anzahl} Ereignisse bei einem Limit von ${METRIK_LOAD_LIMIT} — vermutlich gekappt, die Zähler sind dann zu klein. Filter: ${JSON.stringify(filters[Number(nummer)])}`,
            )
        }
    }
    // Die Autoren der Kommentare wärmen — die Vollansicht zeigt sie in P7 namentlich,
    // und ein Profil, das erst dann geholt wird, kommt zu spät. Die Autoren der ARTIKEL
    // wärmt bereits `warmAuthors`.
    warmProfiles(sekundaer.filter((event) => event.kind === COMMENT).map((event) => event.pubkey))

    return sekundaer.length
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
    // Auch der Direkteinstieg braucht seine Zähler — hier für genau diesen einen
    // Artikel, also mit einer Adresse und einer Id statt 104.
    void loadArticleMetrics(events, signal).catch(() => undefined)

    return { complete, count: events.length }
}

// ── P7: Netz SCHREIBEND ───────────────────────────────────────────────────────────

/**
 * Wohin ein Artikel-Signal geschrieben wird: **ausschließlich auf den Board-Relay.**
 *
 * ── Das ist eine Entscheidung gegen die naheliegende, und sie hat einen Messwert ────
 *
 * Gelesen wird seit P6 aus drei Relays ({@link metrikRelays}) — der Board sieht nur 14 %
 * der Reaktionen und 3 % der Zaps (Tabelle bei {@link SEKUNDAER_RELAYS}). Es liegt also
 * nahe, auch in alle drei zu schreiben: die eigene Reaktion wäre dann dort sichtbar, wo
 * die meisten anderen liegen.
 *
 * **Dagegen steht der Preis, den P6 ausdrücklich nicht bezahlt hat.** Beim LESEN geht
 * der Pubkey des Nutzers nicht an die Fremdrelays hinaus: `darfAuthBekommen`
 * (`articleMetrics.ts`) beantwortet ihre NIP-42-Challenges bewusst nicht. Ein
 * signiertes kind 7 an `nos.lol` übergäbe genau das, was dieser Riegel zurückhält —
 * den Pubkey, dazu Zeitpunkt und die Aussage „diese Person liest diesen Artikel".
 * Einen Riegel beim Lesen zu bauen und ihn beim Schreiben zu überrennen, wäre kein
 * Kompromiss, sondern ein Widerspruch.
 *
 * Der Board reicht für den Zweck: die eigene Reaktion erscheint sofort (optimistisch)
 * und beim nächsten Laden wieder, weil der Board mitgelesen wird. Was sie nicht tut,
 * ist bei Lesern anderer Clients aufzutauchen, die nur `nos.lol` fragen — eine reale,
 * benannte Grenze. Wer sie aufheben will, entscheidet damit zugleich die Frage oben neu.
 *
 * `''` (kein Board konfiguriert) heißt: es gibt hier nichts zu schreiben. Die Fläche
 * zeigt in dem Fall ohnehin ihren Leerzustand, server-seitig gegatet.
 */
export const ARTIKEL_SCHREIB_RELAY = (): string => BOARD_URL

/**
 * Das Artikel-Ereignis zu einer Ansicht — aus dem `repository`, nicht aus der Ansicht.
 *
 * Reaktion und Kommentar brauchen das **vollständige** Ereignis: welshmans
 * `tagEventForReaction`/`tagEventForComment` lesen `kind`, `pubkey`, `id` UND die Tags
 * (aus dem `d`-Tag entsteht die `a`-Adresse). Eine {@link ArticleView} trägt davon nur
 * die Anzeigefelder; ein aus ihr zusammengebautes Pseudo-Ereignis wäre eine zweite,
 * ungeprüfte Übersetzung derselben Daten.
 *
 * `null`, wenn das Ereignis nicht (mehr) im Store liegt — der Aufrufer tut dann nichts,
 * statt auf einem geratenen Ziel zu schreiben.
 */
const artikelEreignis = (id: string): TrustedEvent | null => app.repository.getEvent(id) ?? null

/**
 * Auf einen Artikel reagieren (kind 7, NIP-25) — mit {@link ARTIKEL_REAKTION}.
 *
 * `makeReaction` setzt die Tags selbst: `["k","30023"]`, `["e",id,hint]` und — weil 30023
 * adressierbar ist — `["a","30023:<pubkey>:<d>"]`. Genau über dieses `a` findet der
 * Lesepfad aus P6 die Reaktion wieder; ohne es zählte sie an keinem Artikel mit.
 * Ein `["h",…]` entsteht nicht: `makeReaction` übernimmt es vom Parent, und ein 30023
 * hat keines. Das ist richtig so — ein Artikel ist keine NIP-29-Gruppennachricht.
 *
 * Gibt `''` bei Erfolg, sonst die Relay-Begründung **im Wortlaut des Relays**.
 */
export const reagiereAufArtikel = async (artikelId: string): Promise<string> => {
    const url = ARTIKEL_SCHREIB_RELAY()
    const event = artikelEreignis(artikelId)
    if (!url || !event) {
        return ''
    }

    return publishOptimistic(url, makeReaction(event, ARTIKEL_REAKTION, url))
}

/**
 * Die eigene Reaktion zurücknehmen (kind 5 auf die eigene kind 7, NIP-09).
 *
 * **Hier stand bis P4 des 0.9.5-Sprungs:** `makeEventDelete` setze `created_at` auf
 * `max(jetzt, ziel+1)`, weil das Repository einen Tombstone verwerfe, dessen Zeitstempel
 * nicht echt größer ist als der des Ziels — reagieren und sofort zurücknehmen falle bei
 * Sekundengranularität sonst in dieselbe Sekunde und der Chip bliebe stehen. Das war
 * unter 0.8.16 richtig; **beide Hälften des Satzes sind es nicht mehr.**
 *
 * `makeEventDelete` setzt gar kein `created_at` mehr, und es braucht auch keines:
 * `Repository.isDeletedById` vergleicht in 0.9.5 kein `created_at` — eine Löschung wirkt
 * in derselben Sekunde und sogar eine Sekunde früher datiert (am Paket gemessen, der
 * Implementierungskommentar nennt den Grund: eine id benennt genau ein unveränderliches
 * Event, zu dem es keine neuere Fassung gibt).
 *
 * Die alte Regel überlebt nur für **adressierbare** Ziele (`isDeletedByAddress`, strikt
 * `>`). Diese Stelle kann sie nicht treffen: gelöscht wird eine kind 7, die ist nicht
 * ersetzbar, und `tagEvent` setzt für sie ausschließlich ein `e`-Tag. Die ausführliche
 * Messung steht bei {@link makeEventDelete} in `js/interactions.ts` — dorthin zeigte
 * dieser Absatz schon vorher, nur sagt sie inzwischen das Gegenteil.
 *
 * **Der Relay muss dabei nicht mitspielen, und das steht in der Meldung.** kind 5 ist
 * nach NIP-09 eine Bitte; ob `wss://nostr.einundzwanzig.space` (nostr-rs-relay 0.10.0)
 * sie befolgt, entscheidet er. Lokal verschwindet die Reaktion in jedem Fall — das
 * Repository entfernt sie beim Tombstone selbst.
 */
export const nimmArtikelReaktionZurueck = async (reaktionsId: string): Promise<string> => {
    const url = ARTIKEL_SCHREIB_RELAY()
    const reaktion = app.repository.getEvent(reaktionsId)
    if (!url || !reaktion) {
        return ''
    }

    return publishOptimistic(url, makeEventDelete(reaktion, url))
}

/**
 * Einen Artikel kommentieren (kind 1111, NIP-22).
 *
 * `makeComment` baut über welshmans `tagEventForComment` die Wurzel-Tags `K/P/E` **und**
 * — weil 30023 adressierbar ist — `A`, dazu die Elternteil-Tags `k/p/e/a`. Der Lesepfad
 * aus P6 fragt mit der Union `#A` + `#a`; beide treffen. Ein `h` wird nicht übergeben:
 * ein Artikel liegt in keiner NIP-29-Gruppe, und `makeComment` lässt das Tag dann weg
 * (kein leeres `["h",""]`, das ein Relay in einen falschen Kanal legte).
 *
 * **Der Text wird getrimmt.** Was gesendet wird, ist unwiderruflich; führende und
 * abschließende Leerzeilen sind nichts, was jemand veröffentlichen wollte.
 */
export const kommentiereArtikel = async (artikelId: string, text: string): Promise<string> => {
    const url = ARTIKEL_SCHREIB_RELAY()
    const event = artikelEreignis(artikelId)
    if (!url || !event) {
        return ''
    }

    return publishOptimistic(url, makeComment(event, text.trim(), url))
}
