/**
 * Longform-Artikel (NIP-23, kind 30023) — die REINE Logik (P7).
 *
 * Bewusst **ohne** welshman-Importe, damit alles hier unter `node --test` ohne Browser,
 * ohne Relay und ohne Mocks läuft (`longform.test.ts`). Die Netz- und Store-Seite liegt
 * in `longformFeed.ts` — dieselbe Aufteilung wie `pins.ts`/`roomPins.ts` und
 * `search.ts`/`roomSearch.ts`. Einzige Fremdimporte sind `markdown-it` und
 * `nostr-tools/nip19` (Präzedenzfall: `nostrEventLink.ts:27`); dazu ein reiner
 * **Typ**-Import aus `search.ts` (zur Laufzeit weggestrippt, kein Modul mehr im Graph).
 *
 * ── `html: false` ist hier die SICHERHEITSGRENZE, keine Stileinstellung ──────────────
 *
 * 30023-Inhalt ist Fremdtext. Er kommt zwar von einem Relay mit kuratierten
 * Schreibrechten (`restricted_writes: true`, am 2026-08-12 per NIP-11 nachgemessen), aber
 * `restricted_writes` filtert **Absender, nicht Inhalt** — und ein 30023 ist ersetzbar:
 * ein einziger kompromittierter Autorenschlüssel kann einen längst gelesenen Artikel
 * still umschreiben.
 *
 * Was ein durchgereichtes `<script>` hier kostet, ist maximal: die CSP des Packages
 * setzt `script-src 'self' 'unsafe-eval' 'unsafe-inline'`
 * (`src/Http/Middleware/ContentSecurityPolicy.php:41`, begründet: Alpine/Livewire liefern
 * keinen CSP-Build), das Skript liefe also. Und es liefe in einem Dokument, in dem
 * `window.nostr` (NIP-07) bzw. eine offene NIP-46-Sitzung erreichbar ist — der Angreifer
 * signierte dann Events als das Opfer.
 *
 * **Deshalb: `html: false` (die Werkseinstellung von markdown-it) bleibt.** Wer hier
 * `html: true` setzt, öffnet die Angriffsfläche in derselben Sekunde vollständig — es gibt
 * KEINEN Sanitizer dahinter, und das ist Absicht (Entscheidung des Nutzers, Vorlage
 * `p7-recon.md` §2). markdown-it dokumentiert genau diese Betriebsart als sicher
 * (`docs/safety.md`: „Don't enable HTML … Output will be safe without sanitizer") und
 * verbietet zusätzlich `javascript:`, `vbscript:`, `file:` und `data:` außer
 * `data:image/(gif|png|jpeg|webp)` (`validateLink`, `dist/markdown-it.mjs:3510-3541`).
 *
 * Gemessen statt geglaubt (2026-08-12, alle 99 Artikel des Board-Relays plus 25
 * Angriffsvektoren): **0** Treffer für `<script`, `<iframe`, `on…=`, `javascript:`,
 * `vbscript:`, `<svg`, `<object`, `<embed`, `<form` in der Ausgabe. Rohdaten und Skripte
 * im Artefakt-Ordner des Plans (`p7-recon.md` §2.4/§3.6, Host-Repo). Der
 * `security-auditor` hat die Grenze anschließend mit 300.000 Fuzz-Eingaben plus 269.389
 * gezielten Sentinel-Fällen gegen eine Tag-/Attribut-Allowlist geprüft: 0 Verstöße.
 *
 * **Ein Satz für den, der hier ein Plugin einhängen will:** Die Ausgabe landet über
 * Alpines `x-html`, und das ruft `initTree()` auf dem eingefügten Teilbaum — ein
 * `x-…`-Attribut in dieser HTML wäre also nicht bloß Markup, sondern sofort
 * ausgeführter Alpine-Ausdruck. Heute ist das unerreichbar (markdown-it schreibt keine
 * `x-`-Attribute, und Autorentext wird escaped); ein Plugin, das eigene Attribute
 * ausgibt, macht daraus einen Ausführungspfad.
 *
 * ── Zwei Entscheidungen über sichtbaren Fremdtext ───────────────────────────────────
 *
 * Beide betreffen echten Bestand, beide sind hier begründet statt stillschweigend
 * getroffen — siehe {@link stripFrontmatter} und {@link BR_SENTINEL}.
 */
import MarkdownIt from 'markdown-it'
import type { Env, Token } from 'markdown-it'
import * as nip19 from 'nostr-tools/nip19'
import { BLOSSOM_SRC_ATTR, blossomMarkerFor } from './blossomMarkup.ts'
import type { SearchableRow } from './search.ts'

/**
 * Die Kind-Zahlen wohnen im importfreien `longformKinds.ts` und werden hier nur
 * weitergereicht — die Adresse bleibt für jeden Bestandsimport dieselbe.
 *
 * **Der Umzug ist keine Kosmetik.** Diese Datei hängt an markdown-it; `articleMetrics.ts`
 * braucht `LONGFORM` und liegt über `core.ts` im Boot-Pfad jeder Seite. Der Wert-Import
 * über diese Grenze zog den Renderer in den app-Chunk: **+48 kB gzip auf JEDER Seite,
 * für die Zahl 30023** (gemessen 2026-08-21, Tabelle in `longformKinds.ts`). Dieselbe
 * Grenze begründet `bridge.ts` an drei Stellen, und `articleSorts.ts` existiert aus
 * genau demselben Grund ohne einen einzigen Import.
 */
export { LONGFORM, LONGFORM_DRAFT } from './longformKinds.ts'
import { LONGFORM } from './longformKinds.ts'

/** Die aus den Tags gehobenen Kopfdaten eines Artikels (NIP-23). */
export type ArticleTags = {
    /** `d` — die Kennung des adressierbaren Events. Leer möglich (dann nicht verlinkbar). */
    identifier: string
    /** `title`; leer, wenn das Tag fehlt — die Oberfläche setzt dann ihren eigenen Ersatz. */
    title: string
    /** `summary`; leer, wenn das Tag fehlt (10 von 99). */
    summary: string
    /** `image` (Titelbild); leer, wenn das Tag fehlt (14 von 99). */
    image: string
    /** `published_at` in Sekunden — fällt auf `created_at` zurück (2 von 99). */
    publishedAt: number
    /** `t`-Tags (22 von 99 tragen welche). Reihenfolge wie im Event, ohne Leerwerte. */
    topics: string[]
}

/**
 * Obergrenze für `published_at` in Sekunden: **4e9 = 2096-10-02**.
 *
 * Eine feste Zahl, kein `Date.now()`. Ein Artikel darf in der Zukunft datiert sein
 * (geplante Veröffentlichung ist ein legitimer Fall, und die Uhr des Lesers ist keine
 * Autorität) — er darf nur nicht in einer Zukunft liegen, die niemand gemeint haben kann.
 * Dieselbe Grenze, an der die Millisekunden-Frage gemessen wurde: **0 von 99** Artikeln
 * liegen darüber. Wer sie überschreitet, wird nach `created_at` einsortiert und verliert
 * damit genau die Wirkung, die er gesucht hat.
 */
export const PUBLISHED_AT_MAX = 4_000_000_000

/** Erster Wert eines Tags, `''` wenn keins da ist. */
const firstTag = (tags: string[][], name: string): string => {
    for (const tag of tags) {
        if (tag[0] === name && typeof tag[1] === 'string') {
            return tag[1]
        }
    }

    return ''
}

/**
 * Hebt die NIP-23-Kopfdaten aus den Roh-Tags.
 *
 * **Jedes Feld darf fehlen** — das ist kein Randfall, sondern gemessener Bestand:
 * 14 Artikel ohne `image`, 10 ohne `summary`, 2 ohne `published_at`. Nur `title` war in
 * allen 99 gesetzt; trotzdem ist auch das hier optional, denn NIP-23 verlangt keins.
 *
 * `published_at` ist laut NIP-23 die Sekunden-Zeit der ERSTEN Veröffentlichung (bei einem
 * ersetzbaren Event ist `created_at` die Zeit der letzten Änderung). Ein nicht
 * interpretierbarer Wert fällt auf `created_at` zurück, statt eine Zeile mit „01.01.1970"
 * zu erzeugen. Millisekunden-Zeitstempel werden NICHT umgerechnet: im Bestand gibt es
 * keinen einzigen (0 von 99, Grenze 4e9 geprüft), und eine Umrechnung „auf Verdacht"
 * verschöbe im Zweifel echte Daten.
 *
 * **Die Grenze gilt in BEIDE Richtungen** — hier stand nur `> 0`, und das war einseitig:
 * ein Tag `["published_at","9e15"]` kam durch, `toLocaleDateString` machte daraus
 * „Invalid Date", und weil die Liste absteigend nach dieser Zahl sortiert, nagelte der
 * Artikel sich **dauerhaft auf Platz 1**. Ein Autor braucht dafür keinen Fehler im Client,
 * nur einen Tippfehler oder Absicht. Siehe {@link PUBLISHED_AT_MAX}.
 */
export const readArticleTags = (tags: string[][], createdAt = 0): ArticleTags => {
    const published = Number(firstTag(tags, 'published_at'))
    const plausible = Number.isFinite(published) && published > 0 && published <= PUBLISHED_AT_MAX

    return {
        identifier: firstTag(tags, 'd'),
        title: firstTag(tags, 'title'),
        summary: firstTag(tags, 'summary'),
        image: firstTag(tags, 'image'),
        publishedAt: plausible ? Math.floor(published) : createdAt,
        topics: tags.filter((tag) => tag[0] === 't' && tag[1]).map((tag) => tag[1]),
    }
}

/** Zeilen, die als Frontmatter-Feld durchgehen (`key: wert`). */
const FRONTMATTER_KEY = /^[A-Za-z][A-Za-z0-9_-]*\s*:/

/** So viele Zeilen weit wird nach dem schließenden `---` gesucht. */
const FRONTMATTER_MAX_LINES = 30

/**
 * Entfernt einen YAML-Frontmatter-Block am Artikelanfang — **ENTSCHEIDUNG 1**.
 *
 * **Der Befund:** 5 der 99 Artikel beginnen mit `---\ntype: gallery\nlayout: grid\n---`.
 * Ohne diesen Schnitt rendert markdown-it daraus `<hr>` plus `<h2>type: gallery layout:
 * grid</h2>` — die zweite `---`-Zeile ist nach einer Textzeile eine Setext-Überschrift.
 * Die Artikel trügen also eine fette Überschrift aus Metadaten über sich (gemessen, nicht
 * vermutet).
 *
 * **Warum die Erkennung so eng ist:** Ein `---` am Artikelanfang ist auch eine völlig
 * legitime horizontale Linie. Geschnitten wird deshalb NUR, wenn (a) die erste Zeile
 * exakt `---` ist, (b) innerhalb von {@link FRONTMATTER_MAX_LINES} Zeilen eine
 * schließende `---`-Zeile folgt und (c) **jede** nicht-leere Zeile dazwischen die Form
 * `key: wert` hat. Fließtext erfüllt (c) praktisch nie — schon ein einziger normaler Satz
 * lässt den Block stehen.
 *
 * **Was bei Zweifel passiert:** der Text bleibt UNVERÄNDERT. Ein nicht erkanntes
 * Frontmatter ist eine hässliche Überschrift; ein fälschlich geschnittener Absatz ist
 * verlorener Autorentext. Die Regel fällt deshalb bewusst zugunsten des Autors aus.
 *
 * Gegenprobe am Bestand (2026-08-12): genau 5 Artikel werden geschnitten — dieselben 5,
 * die mit `---` beginnen. Kein weiterer Artikel wird angefasst.
 */
export const stripFrontmatter = (content: string): string => {
    const lines = content.split('\n')
    if (lines[0]?.trim() !== '---') {
        return content
    }
    const end = Math.min(lines.length, FRONTMATTER_MAX_LINES + 1)
    for (let i = 1; i < end; i++) {
        const line = lines[i].trim()
        if (line === '---') {
            return lines.slice(i + 1).join('\n').replace(/^\n+/, '')
        }
        if (line !== '' && !FRONTMATTER_KEY.test(line)) {
            return content
        }
    }

    return content
}

/**
 * Platzhalter, mit dem ein `<br>` des Autors durch den Renderer getragen wird —
 * **ENTSCHEIDUNG 2**.
 *
 * **Der Befund:** 10 der 99 Artikel enthalten `<br />` (14 Vorkommen). Es ist das
 * EINZIGE HTML im gesamten Bestand — kein `<script>`, kein `<iframe>`, kein `<img>`, kein
 * `<a>`, kein einziges `on…=`-Attribut (gemessen 2026-08-12). Mit `html: false` erscheint
 * es wörtlich als `&lt;br /&gt;` mitten im Fließtext.
 *
 * **Die Entscheidung: genau dieses eine Tag wird geehrt, nichts sonst.** Der Weg dorthin
 * ist bewusst NICHT `html: true` (das öffnete alles) und auch nicht `breaks: true` (das
 * änderte die Darstellung ALLER 99 Artikel, nicht nur der 10 betroffenen): vor dem
 * Rendern wird `<br>` durch dieses Zeichen ersetzt, nach dem Rendern das Zeichen durch
 * ein `<br>`.
 *
 * **Warum das sicher ist — die tragende Begründung ist die REIHENFOLGE, nicht die
 * Konstanz des Ersatzes.**
 *
 * Hier stand zuerst: „das Ersetzungsziel ist eine Konstante, also kann sich nichts
 * einschleusen". Das stimmt als Aussage, trägt aber nicht: es erklärt nur, warum ein
 * Autor, der U+E000 selbst schreibt, höchstens einen überzähligen Zeilenumbruch bekommt.
 * Es sagt **nichts** über den Fall, in dem der Rücktausch ein `<br>` mitten in einem
 * **Attributwert** ablegt — und genau der tritt auf (im Audit 11.132-mal gemessen, etwa
 * über `alt`- und `title`-Texte).
 *
 * Tragend ist: **der Rücktausch läuft NACH dem Escaping.** Wenn `md.render()` fertig ist,
 * hat markdown-it jedes `"` im Autorentext bereits zu `&quot;` gemacht und quotet jeden
 * Attributwert doppelt. Ein `<br>`, das danach in einen Attributwert fällt, kann diesen
 * Wert also nicht verlassen — im Attributwert-Zustand ist `<` für den HTML-Tokenizer
 * schlicht Text. Der Sentinel ist damit sicher, **solange er nach dem Rendern
 * zurückgetauscht wird**; wer die beiden Schritte je vertauscht oder das Escaping
 * dazwischen abschaltet, hebt genau diese Zusage auf.
 *
 * Der Nebeneffekt der Konstanz bleibt richtig und nützlich: der Ersatz braucht keinen
 * Zufallswert, und die Funktion bleibt deterministisch (und damit prüfbar).
 */
export const BR_SENTINEL = ''

/** `<br>`, `<br/>`, `<br />` — in jeder Schreibweise. */
const BR_TAG = /<br\s*\/?>/gi

/**
 * Der Renderer. **Eine Instanz pro Modul**, nicht pro Aufruf: die Konstruktion baut die
 * komplette Regelkette auf, und die Regel-Overrides unten müssten sonst jedes Mal neu
 * gesetzt werden.
 *
 * `html: false` steht hier ausgeschrieben, obwohl es der Default ist. Das ist Absicht:
 * diese Zeile ist die Sicherheitsgrenze des ganzen Screens (siehe Modulkopf), und eine
 * Grenze, die nur als abwesende Option existiert, kann niemand beim Lesen prüfen.
 *
 * `linkify: true` weicht vom Default ab: 11 der 99 Artikel enthalten nackte URLs ohne
 * Markdown-Klammern. Der Linkifier läuft durch dasselbe `validateLink` wie jeder andere
 * Link — ein `javascript:`-Token wird also auch hier nicht zum Anker (nachgemessen).
 *
 * `typographer` bleibt AUS (Default): die Regel ersetzt Zeichen im Text des Autors, und
 * genau sie trug die jüngste bekannte Schwäche der Bibliothek (GHSA-6v5v-wf23-fmfq,
 * quadratische Laufzeit in `smartquotes`, behoben in 14.2.0). Kein Nutzen, der das
 * aufwöge.
 */
const md = new MarkdownIt({ html: false, linkify: true })

/** Wie der Bild-Proxy des Aufrufers durch den Renderer gereicht wird. */
type ArticleEnv = Env & { proxify?: (url: string) => string }

/**
 * Bild-URLs laufen durch den Proxy des Aufrufers.
 *
 * Der Proxy (`proxifyImage`, `core.ts:47`) ist welshman-nah und darf hier nicht
 * importiert werden; er kommt deshalb per Parameter herein — über markdown-its `env`,
 * nicht über eine Modulvariable. Das ist kein Stil, sondern Wiedereintrittsfähigkeit:
 * eine Modulvariable wäre geteilter Zustand zwischen zwei Aufrufen, und der Reader
 * rendert später vielleicht Vorschau und Vollansicht nebeneinander. Ohne `proxify` bleibt
 * die URL unverändert — für die Pure-Tests der beobachtbare Normalfall.
 *
 * Die Zuweisung geschieht auf dem Token, NICHT durch String-Ersetzung in der fertigen
 * HTML: markdown-it escapt das Attribut anschließend selbst, und ein `"` in einer
 * Bild-URL kann so nichts aufbrechen.
 */
/**
 * Die Werksregel für Bilder. Sie MUSS am Ende laufen, sie tut mehr als Tags schreiben:
 * sie füllt das `alt` aus den Kindknoten des Tokens
 * (`renderInlineAsText(token.children)`). Ein direktes `renderToken` an ihrer Stelle
 * lieferte gemessen `alt=""` für JEDES Bild — der Alternativtext des Autors wäre
 * lautlos verschwunden. Hier wird deshalb nur der `src` verändert und dann abgegeben.
 */
const defaultImageRule = md.renderer.rules.image

/**
 * Die Klasse, an der die Vollansicht ein anklickbares Artikelbild erkennt (P3).
 *
 * ── Warum NICHT `chat-image`, obwohl der Auslöser derselbe ist ───────────────────────
 *
 * Der Plan schrieb `chat-image` vor; gemessen ist das eine sichtbare Änderung am
 * Bestand. `.chat-image` (`theme.css`) setzt `width: 100%`, und `.article-content img`
 * hat zu `width` **gar keine** Deklaration — die Chat-Regel gölte also, und jedes
 * Inline-Bild eines Artikels würde auf die volle Spaltenbreite hochskaliert statt seine
 * Naturgröße zu behalten. Dazu fehlt ohne den `.chat-image-box`-Rahmen das
 * `cursor: zoom-in`: der Klick wäre unangekündigt.
 *
 * Der **Auslöser** folgt trotzdem exakt dem Chat-Muster — er liest `dataset.full`
 * (`partials/chat-row.blade.php`). Was sich unterscheidet, ist allein der Selektor, an
 * dem er greift, und der gehört zu einer anderen Fläche mit anderer Typografie.
 *
 * ── Diese beiden Attribute berühren die Sicherheitsgrenze des Moduls ─────────────────
 *
 * Der Modulkopf sagt, warum: die Ausgabe landet in Alpines `x-html`, und das ruft
 * `initTree()` auf dem Teilbaum — ein Attribut, das mit `x-`, `@` oder `:` beginnt, wäre
 * dort ein sofort ausgeführter Ausdruck. `class` und `data-full` sind inert, und dass die
 * Ausgabe über den ganzen Formen-Satz **kein einziges** solches Attribut trägt, ist der
 * Kernbeweis in `articleRenderSicherheit.test.ts` — mutationsgeprüft, nicht behauptet.
 */
export const ARTICLE_IMAGE_CLASS = 'article-image'

/** Trägt die Lightbox-Quelle. Derselbe Attributname wie im Chat, damit der Auslöser passt. */
export const ARTICLE_FULL_ATTR = 'data-full'

md.renderer.rules.image = (tokens: Token[], idx, options, env, renderer) => {
    const token = tokens[idx]
    const at = token.attrIndex('src')
    const proxify = (env as ArticleEnv | undefined)?.proxify
    if (at >= 0 && token.attrs && proxify) {
        // `String(…)`: markdown-it deklariert Attributwerte als `string | number`
        // (`attrSet` nimmt beides an). Der `src` eines Bildes ist immer ein String —
        // die Umwandlung ist die Typ-Zusage an den Compiler, kein Verhalten.
        const original = String(token.attrs[at][1])
        const proxified = proxify(original)
        const marker = blossomMarkerFor(original, proxified)
        if (original === '') {
            // **Leere Bild-URL (`![]()`) — kein `src`, keine Lightbox, keine Klasse.**
            //
            // Der `src` wird ENTFERNT und nicht auf `''` gesetzt, aus genau dem Grund,
            // der 20 Zeilen tiefer für den Blossom-Zweig steht: ein `src=""` ist zwar
            // spezifiziert („nicht laden"), aber es gab Browser, die es gegen die
            // Dokument-Adresse auflösten und die Seite selbst nachluden. Bis P3 stand
            // hier trotzdem ein `src=""` — die eigene Begründung galt nur im anderen
            // Zweig. (Sicherheitsfreigabe zu P3, Punkt F4.)
            //
            // Und ausdrücklich WEDER `data-full` NOCH die Klasse: ohne Quelle gibt es
            // nichts zu vergrößern. Ein Bild, das anklickbar aussieht (`cursor: zoom-in`)
            // und beim Klick eine leere Lightbox öffnet, ist schlechter als eines, das
            // gar nicht erst so tut.
            token.attrs.splice(at, 1)
        } else if (marker === '') {
            token.attrs[at][1] = proxified
            // Die Lightbox bekommt DIESELBE URL wie die Anzeige, nicht eine zweite.
            // Im Chat sind das zwei Presets (`msg` fürs Vorschaubild, `full` für die
            // Lightbox); der Artikel rendert von vornherein mit `full`
            // (`longformFeed.ts`, `renderCached`), es gibt also nichts zu vergrößern
            // außer der Fläche. Ein zweites Preset hier hieße, dasselbe Bild zweimal zu
            // holen, damit es zweimal gleich aussieht.
            token.attrSet(ARTICLE_FULL_ATTR, proxified)
        } else {
            // Auth-pflichtiges Bild des Workspace-Relays: der `src` wird ENTFERNT, nicht
            // geleert. Ein `src=""` ist zwar spezifiziert („nicht laden"), aber es gab
            // Browser, die es gegen die Dokument-Adresse auflösten und die Seite selbst
            // nachluden; kein Attribut ist die Aussage, die keine Auslegung zulässt.
            // Die Werksregel darunter fasst nur `alt` an — das Entfernen ist für sie
            // folgenlos (`markdown-it/dist/markdown-it.mjs:849-853`, gelesen).
            token.attrs.splice(at, 1)
            token.attrSet(BLOSSOM_SRC_ATTR, marker)
            // Leeres `data-full` als PLATZ, nicht als Wert — dieselbe Bauform wie
            // `chatImageHtml` (`blossomMarkup.ts`): der Hydrator füllt genau die
            // Attribute, die das Markup vorgesehen hat (`blossomHydrate.ts`,
            // `hasAttribute('data-full')`). Ohne diesen Platz bliebe die Lightbox eines
            // geschützten Artikelbilds leer, obwohl der Blob längst da ist.
            token.attrSet(ARTICLE_FULL_ATTR, '')
        }
        // Die Klasse gilt für ein geschütztes Bild genauso wie für ein offenes — beide
        // sind anklickbar, das geschützte nach der Hydratation. Nur der LEERE Fall
        // bekommt sie nicht: dort gibt es nichts zu öffnen. Sie über `attrSet` zu setzen
        // (statt an den String zu kleben) ist wieder die Escaping-Zusage — markdown-it
        // schreibt das Attribut selbst und escapt dabei.
        if (original !== '') {
            token.attrSet('class', ARTICLE_IMAGE_CLASS)
        }
    }

    return defaultImageRule
        ? defaultImageRule(tokens, idx, options, env, renderer)
        : renderer.renderToken(tokens, idx, options)
}

/**
 * Jeder Link verlässt die App in einem neuen Tab, mit `rel="noopener noreferrer"`.
 *
 * `noopener` ist der eigentliche Punkt: ohne ihn bekommt die Zielseite über
 * `window.opener` einen Griff auf unser Fenster und kann es umleiten (Tabnabbing). Genau
 * dieselbe Kombination setzt welshman für Chat-Links
 * (`@welshman/content/dist/render.js:39-45`).
 */
md.renderer.rules.link_open = (tokens: Token[], idx, options, env, renderer) => {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer')

    return renderer.renderToken(tokens, idx, options)
}

/**
 * Artikeltext → sicheres HTML.
 *
 * @param content Der rohe `content` des 30023.
 * @param proxify Bild-Proxy des Aufrufers (siehe {@link proxifyImageUrl}).
 */
export const renderArticleHtml = (content: string, proxify?: (url: string) => string): string => {
    const source = stripFrontmatter(content).replace(BR_TAG, BR_SENTINEL)
    const env: ArticleEnv = { proxify }

    return md.render(source, env).split(BR_SENTINEL).join('<br>')
}

/**
 * Fließtext-Vorschau für die Listenzeile — **ohne** den Renderer.
 *
 * Die Liste zeigt 99 Zeilen; sie darf nicht 99 Artikel durch markdown-it schicken (das
 * kostete gemessen 158 ms und hielte ~1 MB HTML im Speicher, allein 5 Artikel bestehen zu
 * 96–99 % aus je einem eingebetteten base64-PNG). Diese Funktion arbeitet stattdessen
 * **zeilenweise** und bricht ab, sobald genug Zeichen beisammen sind — über alle 99
 * Artikel gemessene 5,7 ms, der größte (245 875 Zeichen) 0,27 ms.
 *
 * Zeilenweise ist auch eine Sicherheitsentscheidung: ein `/```[\s\S]*?```/`-Muster über
 * einen 245-kB-Fremdtext ohne schließenden Zaun ist quadratisch. Die Schleife hier ist
 * linear, und jede Klammer-Ersetzung trägt eine Längengrenze.
 *
 * Das Ergebnis ist reiner Text und wird als solcher gebunden (`x-text`), nie als HTML.
 */
export const articleSnippet = (content: string, max = 160): string => {
    const parts: string[] = []
    let length = 0
    let inFence = false
    for (const raw of stripFrontmatter(content).split('\n')) {
        const line = raw.trim()
        if (line.startsWith('```') || line.startsWith('~~~')) {
            inFence = !inFence
            continue
        }
        if (inFence) {
            continue
        }
        const text = line
            .replace(/!\[[^\]]{0,200}\]\([^)]{0,2000}\)/g, ' ')
            .replace(/\[([^\]]{0,200})\]\([^)]{0,2000}\)/g, '$1')
            .replace(/^\s{0,3}#{1,6}\s+/, '')
            .replace(/^\s{0,3}>\s?/, '')
            .replace(/^\s{0,3}([-*+]|\d{1,9}[.)])\s+/, '')
            .replace(/[*_~`#]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
        if (!text) {
            continue
        }
        parts.push(text)
        length += text.length + 1
        if (length > max) {
            break
        }
    }
    const joined = parts.join(' ')

    return joined.length > max ? `${joined.slice(0, max).replace(/\s\S*$/, '')}…` : joined
}

/**
 * Lesegeschwindigkeit in Wörtern pro Minute.
 *
 * 200 wpm ist der übliche Mittelwert für stilles Lesen von Sachtext. Die Zahl ist eine
 * Festlegung, keine Messung — sie steht hier als Konstante, damit sie an genau einer
 * Stelle geändert werden kann und ein Test sie **wörtlich** festhalten kann.
 */
export const WORDS_PER_MINUTE = 200

/** Leerraum-Codepoints, an denen {@link readingTime} Wörter trennt (inkl. NBSP). */
const WHITESPACE_CODES = new Set([9, 10, 11, 12, 13, 32, 0x00a0])

/**
 * Lesezeit eines Artikels in **ganzen Minuten**, aufgerundet.
 *
 * **`Math.ceil`, nicht `Math.round`** — das ist die eigentliche Aussage dieser Funktion:
 * ein Artikel mit einem einzigen Wort braucht 1 Minute, nicht 0. Gerundet ergäbe alles
 * unter 100 Wörtern „0 Min.", und eine Null ist für den Leser keine Angabe, sondern ein
 * Fehler. `0` bleibt genau einem Fall vorbehalten: dem leeren Text — die Oberfläche kann
 * die Angabe dann weglassen (dieselbe Regel wie „Metriken mit Wert 0 werden nicht
 * gezeigt").
 *
 * Das Frontmatter fällt vorher weg ({@link stripFrontmatter}): `type: gallery` ist kein
 * Text, den jemand liest.
 *
 * **Warum hier NICHT gestrippt wird, was {@link stripDataUris} entfernt:** gemessen am
 * größten Artikel des Bestands (245 875 Zeichen, davon 243 230 in einem eingebetteten
 * base64-PNG) ergibt die Zählung **314** Wörter roh und **315** ohne die Data-URI. Ein
 * base64-Block enthält keinen Leerraum (0 von 104 Artikeln, nachgemessen) und zählt
 * deshalb als genau EIN Wort — er verfälscht die Lesezeit nicht. Ein zusätzlicher
 * Strip-Durchlauf kostete eine Kopie des Textes für einen Unterschied von einem Wort.
 *
 * Gezählt wird ohne `split()`: eine lineare Schleife über die Code-Units, kein Array von
 * hunderttausend Einträgen und kein Regex-Rückzug auf 245 kB Fremdtext.
 */
export const readingTime = (content: string): number => {
    const text = stripFrontmatter(content)
    let words = 0
    let inWord = false
    for (let i = 0; i < text.length; i++) {
        if (WHITESPACE_CODES.has(text.charCodeAt(i))) {
            inWord = false
        } else if (!inWord) {
            inWord = true
            words++
        }
    }

    return Math.ceil(words / WORDS_PER_MINUTE)
}

/**
 * Bis zu wie vielen Tagen die Liste ein **relatives** Datum zeigt („vor 3 Tagen") statt
 * des absoluten („12. Juni 2026").
 *
 * ── Warum es die Schwelle überhaupt gibt, und warum sie bei 30 liegt ─────────────────
 *
 * Ein relatives Datum beantwortet genau eine Frage: **„ist das neu?"** Es beantwortet sie
 * gut, solange die Antwort unterscheidet. Am 2026-08-20 über den echten Bestand gezählt
 * (104 Artikel, `published_at` mit Rückfall auf `created_at`):
 *
 * | jünger als | Artikel |
 * |---|---:|
 * | 1 Tag   |   2 |
 * | 7 Tage  |   5 |
 * | 14 Tage |   8 |
 * | **30 Tage** | **15** |
 * | 60 Tage |  61 |
 * | 90 Tage |  85 |
 *
 * Der Sprung von 15 auf 61 hat einen Grund im Bestand: **50 der 104 Artikel tragen ein
 * Juni-2026-Datum**, weitere 24 ein Juli-Datum (gezählt; ob sie gebündelt eingespielt
 * wurden, ist eine naheliegende Erklärung und nicht gemessen — für die Schwelle zählt
 * ohnehin nur die Häufung selbst). Bei einer Schwelle jenseits von 30 Tagen stünde
 * „vor 2 Monaten" fünfzigmal untereinander — eine Angabe, die alle Unterschiede
 * einebnet, die das absolute Datum bewahrt. Bei 30 Tagen bekommen genau die 15 jüngsten
 * ihre relative Angabe, und das Juni-Bündel behält seine Daten.
 *
 * **Die Zahl ist eine Festlegung, keine Messung** — sie steht als Konstante, damit sie an
 * einer Stelle änderbar ist und ein Test sie wörtlich festhalten kann.
 */
export const RELATIVE_DATE_MAX_DAYS = 30

/**
 * Der Tag eines Zeitstempels als **Ordinalzahl** (Tage seit der Unix-Epoche).
 *
 * ── Warum nicht `(jetzt - dann) / 86400` ────────────────────────────────────────────
 *
 * Weil „vor wie vielen Tagen" eine KALENDER-Frage ist, keine Zeitspannen-Frage. Ein
 * Artikel von gestern 23:00 liegt heute um 08:00 neun Stunden zurück — die Division
 * ergäbe 0 und die Oberfläche schriebe „heute" über einen Artikel von gestern.
 *
 * Gerechnet wird deshalb auf Ordinalen: erst die **lokale** Kalenderdatums-Trias
 * (`getFullYear`/`getMonth`/`getDate` — der Leser rechnet in seiner Zone, nicht in UTC),
 * dann `Date.UTC` als reine Arithmetik über diese drei Zahlen. Die Differenz zweier
 * Ordinale ist die Zahl der Kalendertage dazwischen, in jeder Zone.
 *
 * **Bewusst nicht über eine lokale Mitternacht:** die gibt es nicht überall. In Santiago
 * und Havanna springt die Uhr an Umstellungstagen von 23:59 auf 01:00; ein
 * `new Date(y, m, d, 0, 0)` wäre dort ein Zeitpunkt, den es nie gab. (Diese beiden Zonen
 * sind aus einer früheren Messung im Haus übernommen, nicht hier nachgestellt — die
 * Konstruktion vermeidet den Fall ohnehin, statt ihn zu behandeln.)
 */
const dayOrdinal = (ts: number): number => {
    const d = new Date(ts * 1000)

    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}

/** Ein relativer Zeitabstand, fertig für `Intl.RelativeTimeFormat` (negativ = Vergangenheit). */
export type RelativeDate = {
    value: number
    unit: 'day' | 'week'
}

/**
 * Der relative Abstand eines Artikeldatums — oder `null`, wenn die Liste das **absolute**
 * Datum zeigen soll.
 *
 * Rein: `now` kommt als Argument herein, damit die Funktion prüfbar bleibt. Formatiert
 * wird sie nicht hier, sondern in `locale.ts` (`formatRelativeDate`) — die Sprache ist
 * eine Laufzeitfrage, die Entscheidung nicht.
 *
 * Drei Fälle, alle absichtlich:
 *
 *  · **0 bis 6 Tage → `day`.** `Intl.RelativeTimeFormat` mit `numeric: 'auto'` macht
 *    daraus „heute", „gestern", „vorgestern" und danach „vor 4 Tagen".
 *  · **7 bis 29 Tage → `week`,** abgerundet. „vor 23 Tagen" ist eine Zahl, die niemand
 *    einordnet; „vor 3 Wochen" ist eine Auskunft.
 *  · **Alles ab {@link RELATIVE_DATE_MAX_DAYS} → `null`,** also absolutes Datum.
 *
 * **Ein Datum in der ZUKUNFT gilt ebenfalls als absolut.** `published_at` darf bis
 * {@link PUBLISHED_AT_MAX} (Jahr 2096) reichen, ein zukunftsdatierter Artikel ist also
 * möglich — und „in 3 Tagen" unter einer Karte, die man jetzt lesen kann, wäre eine
 * Aussage, die der Bildschirm sofort widerlegt. Im heutigen Bestand ist der Fall leer
 * (alle 13 Driftfälle sind rückdatiert); die Regel steht für den Tag, an dem er es nicht
 * mehr ist.
 */
export const relativeDateParts = (publishedAt: number, now: number): RelativeDate | null => {
    const tage = dayOrdinal(now) - dayOrdinal(publishedAt)
    if (tage < 0 || tage >= RELATIVE_DATE_MAX_DAYS) {
        return null
    }

    // `tage === 0` gesondert: `-0` ist in JavaScript ein eigener Wert, den `Object.is`
    // und `assert.deepEqual` von `0` unterscheiden — und der über JSON verlorenginge.
    // `Intl.RelativeTimeFormat` liefert für beide dasselbe Wort; ein `-0` in einer
    // Datenstruktur ist trotzdem eine Überraschung, die niemand braucht.
    if (tage === 0) {
        return { value: 0, unit: 'day' }
    }

    return tage < 7 ? { value: -tage, unit: 'day' } : { value: -Math.floor(tage / 7), unit: 'week' }
}

/**
 * Eingebettete `data:…;base64,…`-Nutzlast, wie sie in Artikeltexten vorkommt.
 *
 * Die Zeichenklasse des base64-Teils enthält **bewusst keinen Leerraum**: sonst liefe der
 * Treffer über das Ende der URI hinaus in den folgenden Fließtext (dessen Buchstaben
 * allesamt in `[A-Za-z0-9+/=]` liegen) und löschte echten Autorentext. Im Bestand ist
 * kein einziger base64-Block umbrochen (2026-08-20 über 104 Artikel gemessen), die enge
 * Klasse kostet also nichts.
 *
 * Die Längenschranken sind Hausregel (vgl. {@link articleSnippet}): jede Quantorenweite
 * ist begrenzt. 10 000 000 liegt weit über jeder Event-Größe, die ein Relay annimmt —
 * die Schranke bremst nichts Echtes, sie deckelt nur den pathologischen Fall.
 */
const DATA_URI = /data:[a-zA-Z0-9!#$&^_+.\/-]{0,120};base64,[A-Za-z0-9+\/=]{0,10000000}/g

/**
 * Entfernt eingebettete base64-Nutzlasten aus einem Artikeltext.
 *
 * **Wofür das da ist: die Suche, nicht die Anzeige.** Gemessen am echten Bestand
 * (104 Artikel, 2026-08-20):
 *
 * | | Zeichen | ms je Tastendruck | „bitcoin"-Treffer |
 * |---|---|---|---|
 * | roh | 1 324 075 | 181,6 | 75 |
 * | ohne Data-URIs | 458 687 | 56,5 | 75 |
 * | ohne Data-URIs, auf 8 000 gekappt | 409 815 | 50,8 | **74** |
 *
 * **66 % des gesamten Bestandstextes sind base64.** Ihn wegzuschneiden drittelt die
 * Suchlaufzeit, ohne einen einzigen echten Treffer zu kosten — Kappen dagegen kostet ab
 * 8 000 Zeichen bereits Treffer und spart nur noch Millisekunden. Deshalb: **strippen,
 * nicht kappen.**
 *
 * Der zweite Grund wiegt schwerer als die Laufzeit: base64 ist alphanumerisches Rauschen
 * und erzeugt **Falschtreffer**. Gemessen finden `iVBOR` 5, `gaaa` 5, `sad` 7 und `adeq`
 * 2 Artikel — nach dem Strippen 0, 0, 2 und 0. Ein Nutzer, der „sad" sucht, bekäme heute
 * fünf Artikel angeboten, in denen das Wort nirgends steht.
 *
 * Der Durchlauf kostet über den ganzen Bestand 3,0 ms und gehört **einmal je Liste**
 * ausgeführt, nicht je Tastendruck — siehe {@link articleSearchText}.
 */
export const stripDataUris = (text: string): string => text.replace(DATA_URI, ' ')

/**
 * Was eine Zeile mitbringen muss, um durchsuchbar gemacht zu werden.
 *
 * Bewusst **strukturell** statt `ArticleRow` importiert zu bekommen: der Typ deckt sich
 * mit {@link ArticleRow}, aber diese Funktion ist auf keinen ihrer übrigen Felder
 * angewiesen — und ein struktureller Vertrag hält auch, wenn P4 die Autorenseite mit
 * einer eigenen, schmaleren Zeile ankommt.
 */
export type ArticleSearchInput = {
    id: string
    title: string
    teaser: string
    content: string
    authorName: string
    publishedAt: number
}

/**
 * Artikelzeile → durchsuchbare Zeile (`SearchableRow`-Vertrag aus `search.ts`).
 *
 * **Das `created_at` ist der stille Punkt.** `searchMessages` sortiert seine Treffer
 * absteigend nach `row.created_at` (`search.ts`, `searchMessages`); eine `ArticleRow`
 * trägt dieses Feld nicht von selbst. Ohne diesen Adapter wäre es `undefined`, und
 * `b.created_at - a.created_at` ergäbe `NaN` — die Sortierung fiele auf die Reihenfolge
 * des Eingangsarrays zurück, ohne dass irgendetwas rot würde.
 *
 * **Gefüllt wird es mit `publishedAt`, nicht mit `createdAt`** — und das ist eine
 * Entscheidung, keine Namensgleichheit: die Liste sortiert nach `publishedAt`
 * ({@link ArticleRow}), die Karte zeigt `publishedAt` als Datum. Nähme die Suche
 * stattdessen `created_at` (die Zeit der letzten *Überarbeitung* eines ersetzbaren
 * Events), hätte derselbe Bestand zwei Ordnungen, und ein Leser sähe nach dem Tippen
 * eine andere Reihenfolge als davor. Dass `publishedAt` dabei nicht entgleisen kann,
 * sichert {@link PUBLISHED_AT_MAX}.
 *
 * **Einmal je Liste aufrufen, nicht je Tastendruck.** {@link stripDataUris} kostet über
 * den Bestand 3,0 ms; in der Tastendruck-Schleife wäre das ein Vielfaches der Suche
 * selbst. Das Ergebnis hängt nur an der Zeile, ist also merkbar.
 */
export const articleSearchText = <T extends ArticleSearchInput>(row: T): T & SearchableRow => ({
    ...row,
    // Titel und Teaser stehen VOR dem Fließtext: sie sind kurz, und der Ausschnitt in
    // der Trefferliste beginnt am ersten Fund — ein Treffer im Titel soll den Titel
    // zeigen, nicht eine Stelle aus Absatz neun.
    text: `${row.title}\n${row.teaser}\n${stripDataUris(row.content)}`,
    name: row.authorName,
    created_at: row.publishedAt,
})

/** Winkel des Cover-Verlaufs in Grad. */
export const COVER_GRADIENT_ANGLE = 135

/**
 * Farbpaare für das Ersatz-Titelbild. **Jede Farbe ist dunkel genug für weiße Schrift**
 * (gemessen: schlechtestes Paar 8,34:1 gegen Weiß, WCAG AA verlangt 4,5:1) — das Cover
 * trägt in der Karte den Titel, und ein hübsches Pastell machte ihn unlesbar. Ein Test
 * hält die Schranke fest, damit eine spätere „schönere" Palette nicht still durchrutscht.
 *
 * Acht Paare, damit die 14 coverlosen Artikel nicht wie eine Serie aussehen; das erste
 * Paar ist die Marken-Orange-Achse (`theme.css`, `--color-brand-900/950`).
 */
export const COVER_PALETTE: readonly (readonly [string, string])[] = [
    ['#7b3d10', '#421d06'],
    ['#1e3a8a', '#0f172a'],
    ['#14532d', '#052e16'],
    ['#7f1d1d', '#450a0a'],
    ['#164e63', '#083344'],
    ['#4c1d95', '#2e1065'],
    ['#404040', '#171717'],
    ['#78350f', '#431407'],
]

/**
 * FNV-1a, 32 Bit, **mit Nachmischung**. Kein kryptographischer Hash und keiner nötig:
 * gesucht ist eine stabile Streuung über acht Paare, kein Angriffswiderstand.
 *
 * ── Die Nachmischung ist nicht Zierrat, sie repariert einen echten Fehlschlag ────────
 *
 * FNV-1a hat schwache **niedrige** Bits — und `% COVER_PALETTE.length` liest genau die.
 * Der Grund ist strukturell: modulo einer Zweierpotenz ist die Rekurrenz
 * `s' = (s xor c) * 0x01000193` in sich geschlossen, sie hängt also nur von den unteren
 * Bits der Eingabezeichen ab. Mit `% 8` läuft der Zustand für ein Zeichen mit `c % 8 == 2`
 * (`'b'`) sofort in den Fixpunkt 5, für `c % 8 == 1` (`'a'`) in einen Zyklus der Länge 8 —
 * nach 64 gleichen Zeichen stehen **beide** auf 5. Beim Bauen dieser Funktion gemessen:
 * `'a'.repeat(64)` und `'b'.repeat(64)` bekamen für **jede** Kennung denselben Verlauf,
 * obwohl der Autor ein anderer war. Der Test, der das fand, steht in `longform.test.ts`.
 *
 * Die Nachmischung (xorshift/multiply, Bauform von Murmur3s `fmix32`) trägt die hohen
 * Bits in die niedrigen und macht das ganze Wort brauchbar. `>>> 0` hält das Ergebnis
 * vorzeichenlos — ohne das lieferte `% length` bei negativem Zwischenwert einen negativen
 * Index und damit `undefined`.
 */
const fnv1a32 = (text: string): number => {
    let hash = 0x811c9dc5
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    hash ^= hash >>> 16
    hash = Math.imul(hash, 0x21f0aaad)
    hash ^= hash >>> 15
    hash = Math.imul(hash, 0x735a2d97)
    hash ^= hash >>> 15

    return hash >>> 0
}

/** Ein Ersatz-Titelbild: die beiden Farben und der fertige CSS-Wert. */
export type ArticleGradient = {
    from: string
    to: string
    /** Direkt als `style="background-image: …"` bindbar. */
    css: string
}

/**
 * Deterministischer Zwei-Farb-Verlauf als Ersatz-Titelbild (14 von 104 Artikeln haben
 * kein `image`-Tag).
 *
 * **Die Eingabe ist `pubkey` + `d`, ausdrücklich NICHT der Titel.** Ein 30023 ist
 * ersetzbar: derselbe Artikel bekommt bei jeder Überarbeitung eine neue Event-Id und
 * womöglich einen neuen Titel. Hinge der Verlauf am Titel, wechselte ein Artikel beim
 * Umbenennen die Farbe — der Leser sähe eine fremde Karte an vertrauter Stelle. `pubkey`
 * und `d` sind die einzigen beiden Felder, die über alle Fassungen hinweg gleich bleiben;
 * zusammen sind sie die Adresse des Artikels (NIP-01 `a`-Tag, ohne das Kind). Dass der
 * Titel nicht durchschlagen kann, ist hier **strukturell** gesichert: er ist kein
 * Parameter.
 *
 * Das `:` zwischen beiden Teilen steht aus demselben Grund wie im `a`-Tag: es macht die
 * Grenze eindeutig, statt sie aus der Länge des Hex-Schlüssels zu folgern.
 */
export const coverGradient = (pubkey: string, identifier: string): ArticleGradient => {
    const [from, to] = COVER_PALETTE[fnv1a32(`${pubkey}:${identifier}`) % COVER_PALETTE.length]

    return { from, to, css: `linear-gradient(${COVER_GRADIENT_ANGLE}deg, ${from}, ${to})` }
}

/** Eine Audio-Anlage am Artikel — was ein Player daraus bauen kann. */
export type PodcastEpisode = {
    /** Die `url` aus dem `imeta` (nur `http`/`https`). */
    url: string
    /** Der `m`-Wert, roh — für `<source type>`. */
    mimeType: string
    /** Dauer in ganzen Sekunden; `0`, wenn keine angegeben ist (siehe unten). */
    durationSeconds: number
}

/**
 * Ein `imeta`-Tag in seine Felder zerlegen (NIP-92: „variadic, space-delimited
 * key/value pair"). Getrennt wird am **ersten** Leerzeichen — der Wert darf selbst
 * welche enthalten (`alt A scenic photo …` aus dem Spec-Beispiel).
 */
const imetaFields = (tag: string[]): Map<string, string> => {
    const fields = new Map<string, string>()
    for (const entry of tag.slice(1)) {
        if (typeof entry !== 'string') {
            continue
        }
        const at = entry.indexOf(' ')
        if (at > 0 && !fields.has(entry.slice(0, at))) {
            fields.set(entry.slice(0, at), entry.slice(at + 1).trim())
        }
    }

    return fields
}

/** Dauer in Sekunden aus einem Feld-/Tag-Wert; `0` bei allem Unbrauchbaren. */
const toSeconds = (raw: string | undefined): number => {
    const value = Number(raw)

    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * Erkennt eine Podcast-Episode: ein `imeta` (NIP-92) mit einem **Audio**-`m`-Wert.
 *
 * 14 der 104 Artikel sind solche Episoden — fremde Podcasts über vier Bridge-Konten. Sie
 * bekommen in P2 eine eigene Darstellungsklasse mit Player; alles andere bekommt keinen.
 *
 * **Die Prüfung hängt am `m`-Wert, nicht an der bloßen Existenz eines `imeta`.** Genau
 * ein Artikel des Bestands trägt ein `imeta` mit `m image/webp` — er ist kein Podcast,
 * und ein Audio-Player unter einem Bild wäre der sichtbare Fehler. Geprüft wird das
 * Präfix `audio/`, nicht `audio/mpeg`: NIP-94 schreibt kleingeschriebene MIME-Typen vor,
 * und ein `audio/mp4` ist dieselbe Sache.
 *
 * **Ohne brauchbare `url` gilt es nicht als Episode.** NIP-92 verlangt ohnehin ein `url`
 * je `imeta`; ein Player ohne Quelle wäre ein Bedienelement, das nichts tut. Zugelassen
 * sind nur `http`/`https` — dieselbe Linie, die der Renderer für Links zieht.
 *
 * **Zur Dauer, gemessen statt angenommen:** NIP-92 erlaubt in `imeta` die Felder aus
 * NIP-94, und **NIP-94 kennt kein `duration`**. Die Dauer ist in NIP-71 spezifiziert —
 * dort sowohl als `imeta`-Feld als auch als eigenes Tag, in Sekunden. Beide werden hier
 * gelesen (`imeta` zuerst). **Im aktuellen Bestand trägt keine einzige der 14 Episoden
 * eine Dauer** (die `imeta`-Tags enthalten ausschließlich `m` und `url`, 2026-08-20
 * nachgemessen) — die Oberfläche muss den Fall `0` also als Normalfall tragen, nicht als
 * Randfall.
 */
export const isPodcastEpisode = (tags: string[][]): PodcastEpisode | null => {
    for (const tag of tags) {
        if (tag[0] !== 'imeta') {
            continue
        }
        const fields = imetaFields(tag)
        const mimeType = fields.get('m') ?? ''
        const url = fields.get('url') ?? ''
        if (!mimeType.toLowerCase().startsWith('audio/') || !/^https?:\/\//i.test(url)) {
            continue
        }

        return {
            url,
            mimeType,
            durationSeconds: toSeconds(fields.get('duration') ?? firstTag(tags, 'duration')),
        }
    }

    return null
}

/**
 * `naddr` eines Artikels (NIP-19) — die Kennung in der URL.
 *
 * Ein `naddr` trägt Kind, Autor und `d` und ist damit **portabel**: der Link funktioniert
 * in jedem Nostr-Client, nicht nur in diesem. Deshalb steht er in der Route und nicht die
 * Event-Id (die bei einem ersetzbaren Event ohnehin mit jeder Änderung wechselt).
 *
 * Relay-Hint bewusst optional: er hilft fremden Clients, den Artikel zu finden.
 */
export const naddrForArticle = (pubkey: string, identifier: string, relays: string[] = []): string =>
    nip19.naddrEncode({ kind: LONGFORM, pubkey, identifier, relays })

/** Adresse eines Artikels in ihrer Roh-Form (`kind:pubkey:d`, NIP-01 `a`-Tag). */
export type ArticleAddress = {
    pubkey: string
    identifier: string
}

/**
 * `naddr` → Adresse, oder `null`.
 *
 * `null` bei allem, was nicht passt: kaputtes bech32, ein `naddr` auf ein anderes Kind
 * (jemand teilt einen Kalendereintrag), eine andere Kennungsart (`nevent`, `npub`). Der
 * Aufrufer zeigt dann seinen Leerzustand — eine geratene Adresse führte zu einer
 * Dauerabfrage nach einem Artikel, den es nicht gibt.
 */
export const decodeArticleNaddr = (naddr: string): ArticleAddress | null => {
    try {
        const decoded = nip19.decode(naddr)
        if (decoded.type !== 'naddr' || decoded.data.kind !== LONGFORM) {
            return null
        }

        return { pubkey: decoded.data.pubkey, identifier: decoded.data.identifier }
    } catch {
        return null
    }
}

/**
 * Eine Zeile der Artikelliste. Reiner Anzeigezustand — kein Markdown, kein HTML.
 *
 * **Wohnt hier und nicht in `longformFeed.ts`, seit P1**: die Zeile ist der gemeinsame
 * Nenner der Artikelfläche (Liste, Vollansicht, Suche, Autorenseite), und sie zu bauen
 * verlangt nichts von welshman außer zwei Anzeigewerten, die {@link ArticleRowDeps}
 * hereinreicht. `longformFeed.ts` re-exportiert den Typ unverändert weiter — für jeden
 * Importeur (heute: `bridge.ts`) ändert sich nichts.
 */
export type ArticleRow = {
    /** Event-Id — nur als `:key` der Liste. Sie wechselt bei jeder Änderung des Artikels. */
    id: string
    /**
     * Der Autor. **Die Adresse, nicht der Name** — zwei Autoren dürfen gleich heißen.
     *
     * Trägt die Autoren-Hovercard (`$dispatch('open-profile', pubkey)`, an sechs Stellen
     * produktiv) und in P4 die Filterung der Autorenseite.
     */
    pubkey: string
    /**
     * Das `d`-Tag, ROH — `''`, wenn keins gesetzt ist.
     *
     * Zusammen mit {@link ArticleRow.pubkey} ist das die **Adresse** des Artikels
     * (NIP-01 `a`-Tag, ohne das Kind). Der {@link ArticleRow.naddr} trägt dieselbe
     * Information, aber bech32-kodiert — wer sie rechnen will (der Verlauf des
     * Ersatz-Titelbilds heute, der `#a`-Filter aus P6 morgen), müsste ihn erst wieder
     * aufmachen. Steht seit P2 hier, damit genau das nirgends passiert.
     */
    identifier: string
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
    /**
     * Der **rohe** Artikeltext, unverändert wie im Event.
     *
     * ── Warum roh, und warum das nichts kostet ────────────────────────────────────────
     *
     * Die naheliegende Sorge ist der Speicher: der größte Artikel des Bestands ist
     * 245 875 Zeichen groß (243 230 davon ein eingebettetes base64-PNG), der ganze
     * Bestand 1 324 075 Zeichen. Die Sorge trägt nicht. Ein JS-String ist unveränderlich
     * und wird per Referenz weitergereicht; `event.content` liegt ohnehin für die Dauer
     * der Sitzung im `repository`. Dieses Feld ist ein **Zeiger auf denselben String**,
     * keine Kopie — es kostet acht Byte je Zeile, nicht 245 kB.
     *
     * ── Was tatsächlich teuer ist, und wo es behoben wird ─────────────────────────────
     *
     * Teuer ist nicht das Halten, sondern das **Falten** in der Suche: `search.ts` baut
     * je Treffersuche eine Index-Tabelle über jedes Zeichen. Roh gemessen (2026-08-20,
     * 104 Artikel): **181,6 ms je Tastendruck**, dazu Falschtreffer aus dem base64-Müll.
     * Das ist ein Problem der SUCHE, nicht der Zeile — und es wird dort gelöst, wo es
     * entsteht: {@link articleSearchText} strippt die Data-URIs (56,5 ms, gleiche
     * Trefferzahl, keine Falschtreffer).
     *
     * **Deshalb ist dieses Feld roh und nicht gekappt.** Ein gekappter Text hier hätte
     * jeden späteren Verbraucher auf die Suchgrenze festgelegt: die Lesezeit zählte dann
     * die Wörter eines abgeschnittenen Artikels, und der Lesefortschritt aus P3 rechnete
     * gegen eine falsche Länge. Gemessen ist Kappen ohnehin der schlechtere Hebel — ab
     * 8 000 Zeichen kostet es echte Treffer und spart nur noch Millisekunden (Tabelle bei
     * {@link stripDataUris}).
     */
    content: string
    authorName: string
    /** Avatar des Autors, ROH — `x-group::nostr-avatar` proxifiziert selbst. */
    authorPicture: string
    /**
     * Erstveröffentlichung in Sekunden (`published_at`, sonst `created_at`).
     *
     * **Das Sortier- und Anzeigefeld der Fläche** — nicht {@link ArticleRow.createdAt}.
     */
    publishedAt: number
    /**
     * `created_at` des Events, roh — die Zeit der **letzten Überarbeitung**.
     *
     * Nicht mit {@link ArticleRow.publishedAt} verwechseln: bei einem ersetzbaren Event
     * sind das zwei verschiedene Zeitpunkte, und im Bestand driften sie in 13 Fällen bis
     * zu 164 Tage auseinander. Steht hier, weil P2 einen Sortier-Umschalter darauf
     * anbietet und weil „zuletzt geändert" eine eigene, legitime Frage ist. Die
     * **Feldwahl der Liste bleibt `publishedAt`** (Begründung im Plan unter „Verworfen").
     */
    createdAt: number
    /**
     * Das Datum, wie die FLÄCHE es zeigt — je nach Aufrufer relativ („vor 3 Tagen") oder
     * absolut („12. Juni 2026"). Welches, entscheidet `longformFeed.ts` beim Bauen; die
     * Regel dahinter ist {@link relativeDateParts}.
     */
    dateLabel: string
    /**
     * Dasselbe Datum als ISO-Zeitpunkt, für das `datetime`-Attribut eines `<time>`.
     *
     * **Der Grund ist die relative Beschriftung.** „vor 3 Wochen" ist für einen Menschen
     * eine Auskunft und für eine Maschine gar nichts — ohne dieses Feld verlöre die Karte
     * mit dem relativen Label ihr maschinenlesbares Datum. Hier steht bewusst ein
     * vollständiger ISO-INSTANT (`toISOString()`, also UTC) und kein Kalenderdatum:
     * `datetime` bezeichnet einen Zeitpunkt, und ein Zeitpunkt hat keine Zone-Ambiguität.
     * (Die Kalender-Arithmetik daneben rechnet aus demselben Grund GENAU umgekehrt —
     * siehe {@link relativeDateParts}.)
     */
    dateIso: string
    topics: string[]
    /**
     * Der fertige `background-image`-Wert des Ersatz-Titelbilds ({@link coverGradient}).
     *
     * **Immer gesetzt, auch wenn {@link ArticleRow.image} steht.** Zwei Gründe, beide
     * gemessen: (1) das echte Titelbild kann im Browser scheitern (fremder Host, 404,
     * blockierter Proxy) — dann liegt der Verlauf schon darunter und die Karte hat nie
     * ein weißes Loch; (2) er ist deterministisch aus `pubkey:d`, kostet also nichts,
     * was ein `if` sparen würde.
     */
    coverCss: string
    /**
     * Lesezeit in ganzen Minuten ({@link readingTime}). `0` heißt **keine Angabe** — die
     * Oberfläche lässt die Zeile dann weg, statt „0 Min." zu behaupten.
     *
     * Kommt aus {@link ArticleRowDeps}, nicht aus einem Aufruf hier: die Zählung ist
     * linear über den Artikeltext und kostet über den Bestand gemessene **29 ms**
     * (2026-08-20, 104 Artikel, 1 324 075 Zeichen). `deriveArticles` baut die Zeilen bei
     * JEDEM Emit neu, und es emittiert für jedes eintreffende kind-0 — die 29 ms fielen
     * sonst ein Dutzend Mal an. Gemerkt wird deshalb dort, wo eine Event-Id zur Hand ist
     * (`longformFeed.ts`, dasselbe Muster wie `htmlCache`).
     */
    readingMinutes: number
    /**
     * Die Audio-Anlage, wenn der Artikel eine Podcast-Episode ist ({@link isPodcastEpisode});
     * sonst `null`.
     *
     * **Podcast und fehlendes Titelbild sind ZWEI Merkmale, nicht eines.** Am 2026-08-20
     * über den Bestand nachgemessen: 14 Episoden, 14 Artikel ohne `image` — die
     * Schnittmenge ist aber **12**. Zwei Episoden bringen ein Titelbild mit, zwei
     * Nicht-Episoden bringen keins. Die Karte behandelt beides deshalb unabhängig.
     */
    podcast: PodcastEpisode | null
}

/**
 * Was zum Bauen einer {@link ArticleRow} von außen hereinkommt.
 *
 * Alles vier stammt aus der welshman- bzw. Locale-Seite und wird deshalb **übergeben,
 * nicht importiert** — genau das hält dieses Modul rein und `buildArticleRow` unter
 * `node --test` prüfbar (siehe Modulkopf).
 */
export type ArticleRowDeps = {
    /** Anzeigename des Autors (`displayProfileByPubkey`), sonst die npub-Kurzform. */
    authorName: string
    /** Avatar-URL, roh. */
    authorPicture: string
    /** Relay-Hints für den `naddr` — leer ist zulässig. */
    relays: string[]
    /** Datumsformatierer (`locale.ts`, `formatTimestamp`). */
    formatDate: (ts: number) => string
    /**
     * Lesezeit in ganzen Minuten — vom Aufrufer, nicht hier gerechnet.
     *
     * Der Grund steht bei {@link ArticleRow.readingMinutes}: die Zählung ist linear über
     * den Artikeltext, und diese Funktion läuft bei jedem Emit der Ableitung erneut. Der
     * Aufrufer hat eine Event-Id und kann merken; diese Funktion hat keine Historie und
     * darf keine haben — sie ist rein.
     *
     * **Verpflichtend, nicht optional mit Default.** Ein Default machte aus einem
     * vergessenen Aufrufer eine stille `0`, und `0` ist hier kein Platzhalter, sondern
     * eine Aussage („keine Angabe", die Oberfläche lässt die Zeile dann weg). Verpflichtend
     * wird derselbe Fehler ein Typfehler beim Übersetzen — das ist der ganze Unterschied
     * zwischen „fällt in P4 jemandem auf" und „fällt nie auf".
     */
    readingMinutes: number
}

/**
 * Das Minimum, das ein 30023 mitbringen muss, um eine Zeile zu werden.
 *
 * Strukturell statt `TrustedEvent`: ein Typ-Import aus `@welshman/util` wäre zwar zur
 * Laufzeit weggestrippt, aber der Vertrag dieser Funktion ist tatsächlich nur dieser
 * Ausschnitt — und ein Test darf ein Fixture bauen, ohne es zu signieren.
 */
export type ArticleEventLike = {
    id: string
    pubkey: string
    content: string
    created_at: number
    tags: string[][]
}

/**
 * Event → Listenzeile. **Der einzige Ort, an dem aus einem 30023 Anzeigezustand wird.**
 *
 * `longformFeed.ts` (`toRow`) reicht nur noch die vier Werte aus
 * {@link ArticleRowDeps} an. Dass es genau einen Bauweg gibt, ist die Zusage, an der
 * Liste und Vollansicht dieselbe Zeile bekommen.
 *
 * **`createdAt` kommt aus `event.created_at`, `publishedAt` aus dem Tag** — siehe
 * {@link readArticleTags}. Die beiden zu vertauschen ist der Fehler, den `longformFeed.test.ts`
 * an einem Fixture festnagelt, in dem sie verschieden sind.
 */
export const buildArticleRow = (event: ArticleEventLike, deps: ArticleRowDeps): ArticleRow => {
    const tags = readArticleTags(event.tags, event.created_at)

    return {
        id: event.id,
        pubkey: event.pubkey,
        identifier: tags.identifier,
        naddr: tags.identifier ? naddrForArticle(event.pubkey, tags.identifier, deps.relays) : '',
        title: tags.title,
        teaser: tags.summary || articleSnippet(event.content),
        image: tags.image,
        content: event.content,
        authorName: deps.authorName,
        authorPicture: deps.authorPicture,
        publishedAt: tags.publishedAt,
        createdAt: event.created_at,
        dateLabel: deps.formatDate(tags.publishedAt),
        dateIso: new Date(tags.publishedAt * 1000).toISOString(),
        topics: tags.topics,
        coverCss: coverGradient(event.pubkey, tags.identifier).css,
        readingMinutes: deps.readingMinutes,
        podcast: isPodcastEpisode(event.tags),
    }
}

/**
 * Was ein kind-0 über den Autor hergibt — **roh**, so wie es im Profil steht.
 *
 * Kommt herein statt hier geholt zu werden, aus demselben Grund wie
 * {@link ArticleRowDeps}: das Profil liegt in welshmans Store, und dieses Modul kennt
 * welshman nicht.
 */
export type ArticleAuthorDeps = {
    /** Anzeigename (`displayProfile`), leer ⇒ npub-Kurzform. */
    name: string
    /** Avatar-URL, ROH — `x-group::nostr-avatar` proxifiziert selbst. */
    picture: string
    /**
     * `banner` aus kind 0, ROH — die Fläche proxifiziert selbst (`$img(…, 'banner')`),
     * dieselbe Regel wie bei {@link ArticleAuthorDeps.picture} und `ArticleRow.image`.
     *
     * Steht seit P4 hier: die **Autorenseite** zeigt es, die Vollansicht nicht. Ein
     * eigenes zweites Autoren-Objekt nur für dieses eine Feld wäre der teurere Weg —
     * dann gäbe es zwei Bauwege für dieselbe Karte, und der nächste, der etwas ergänzt,
     * trifft den falschen.
     */
    banner: string
    /** `about` aus kind 0, roh. */
    about: string
    /** Website, **bereits sanitisiert** (`sanitizeUrl` auf der welshman-Seite). */
    website: string
    /**
     * Liegt das kind 0 dieses Autors überhaupt schon vor?
     *
     * **Der Unterschied zwischen „hat keine" und „wissen wir noch nicht".** Das Profil
     * trifft ASYNCHRON ein — oft deutlich nach dem Artikel, weil die zwölf Autoren auf
     * ihren eigenen Relays stehen. Vor dem Eintreffen ist jede Aussage über ihre
     * Zahlungsadresse ungedeckt; genau dieselbe Unterscheidung, die diese Fläche schon
     * einmal treffen musste (`missing` vs. `error` in `⚡article.blade.php`: „gibt es
     * nicht" ist eine Aussage über den Relay und nur gedeckt, wenn er geantwortet hat).
     */
    profilBekannt: boolean
    /**
     * Hat der Autor eine Lightning-Adresse? **Der Befund, nicht die Adresse** — und nur
     * gültig, wenn {@link ArticleAuthorDeps.profilBekannt} steht.
     *
     * Die Adresse selbst kommt bewusst NICHT hier herein. Zahlungsfelder haben im Haus
     * eine eigene Herkunftsregel (`zapTargetSources.test.ts`: nur Repository oder
     * gemergte Map, nie eine Fremdquelle, jeder Leser namentlich inventarisiert). Ein
     * `lud16` in einem reinen Anzeige-Modul wäre ein zweiter Ort, an dem eine
     * Empfangsadresse steht — und der nächste, der ihn anfasst, sieht die Regel nicht.
     * Für die Entscheidung „Einstieg bereit oder sichtbar inert" genügt das Ja/Nein.
     */
    hatLightning: boolean
    /** VERIFIZIERTER NIP-05-Handle; leer, solange oder weil er nicht bestätigt ist. */
    nip05: string
}

/** Die Autorenkarte der Vollansicht (P3, Schritt 12). */
export type ArticleAuthor = {
    /** Hex — Auslöser der Hovercard (`$dispatch('open-profile', pubkey)`). */
    pubkey: string
    /** `npub` (NIP-19) — der Wert zum Kopieren. */
    npub: string
    /** Anzeigename, nie leer: fällt auf die npub-Kurzform zurück. */
    name: string
    picture: string
    /** Titelbild des Profils, roh. `''` = keins — die Autorenseite lässt den Streifen dann WEG. */
    banner: string
    about: string
    website: string
    nip05: string
    /**
     * Der Lightning-Einstieg in **drei** Zuständen — und der dritte ist der Grund dafür.
     *
     * `ja` = Adresse vorhanden · `nein` = Profil da, aber ohne Adresse ·
     * **`unbekannt` = das Profil ist noch nicht eingetroffen.**
     *
     * Am laufenden Client gesehen (2026-08-21): solange das kind 0 unterwegs war, stand
     * unter jedem Artikel „Keine Lightning-Adresse" — eine Aussage über einen Autor, über
     * den in dem Moment nichts bekannt war. Bei einem Autor MIT Adresse sprang sie danach
     * um. Ein Zwei-Zustands-Feld kann diesen Fall nicht ausdrücken; es behauptet
     * zwangsläufig eines von beiden.
     *
     * **Vier der zwölf Autoren haben wirklich keine** — dieselben vier, deren Artikel
     * Podcast-Bridges sind. Für sie ist `nein` richtig, und der Einstieg wird dort
     * **sichtbar inert**: nicht still grau und nicht verschwunden. Ein Knopf, der ohne
     * Erklärung fehlt, lässt den Nutzer nach ihm suchen; einer, der ohne Erklärung nichts
     * tut, lässt ihn zweimal klicken. Bei `unbekannt` steht gar keine Zeile — es gibt
     * nichts zu sagen, und Schweigen ist die einzige ungelogene Anzeige dafür.
     *
     * **Die Adresse steht hier absichtlich nicht** — siehe {@link ArticleAuthorDeps}.
     * Wer sie braucht (Kopieren, Zappen), geht über die Profilkarte, die sie ohnehin
     * schon zeigt und deren Herkunft bereits inventarisiert ist.
     */
    lightning: 'ja' | 'nein' | 'unbekannt'
}

/**
 * Die npub-Kurzform, wie sie im ganzen Haus aussieht: `npub1abcde…xyz123`.
 *
 * Bewusst nicht „die ersten 8 Zeichen": ein `npub1` allein unterscheidet niemanden,
 * und der Schwanz trägt die Entropie, die zwei Autoren auseinanderhält.
 */
const npubKurz = (npub: string): string => `${npub.slice(0, 12)}…${npub.slice(-6)}`

/**
 * Autor eines Artikels → Autorenkarte.
 *
 * Wirft nicht, wenn der `pubkey` unbrauchbar ist: `npubEncode` verlangt 32 Byte Hex, und
 * ein Ereignis mit kaputtem `pubkey` käme über den Relay gar nicht erst herein — aber
 * eine Fläche, die deshalb WEISS bleibt, wäre der teurere Fehler. Ohne `npub` gibt es
 * dann eben nichts zu kopieren; alles andere steht weiter da.
 */
export const buildArticleAuthor = (pubkey: string, deps: ArticleAuthorDeps): ArticleAuthor => {
    let npub = ''
    try {
        npub = nip19.npubEncode(pubkey)
    } catch {
        npub = ''
    }

    return {
        pubkey,
        npub,
        name: deps.name || (npub ? npubKurz(npub) : pubkey),
        picture: deps.picture,
        banner: deps.banner,
        about: deps.about,
        website: deps.website,
        nip05: deps.nip05,
        lightning: deps.profilBekannt ? (deps.hatLightning ? 'ja' : 'nein') : 'unbekannt',
    }
}
