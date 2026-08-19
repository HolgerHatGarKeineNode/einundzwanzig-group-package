/**
 * Longform-Artikel (NIP-23, kind 30023) — die REINE Logik (P7).
 *
 * Bewusst **ohne** welshman-Importe, damit alles hier unter `node --test` ohne Browser,
 * ohne Relay und ohne Mocks läuft (`longform.test.ts`). Die Netz- und Store-Seite liegt
 * in `longformFeed.ts` — dieselbe Aufteilung wie `pins.ts`/`roomPins.ts` und
 * `search.ts`/`roomSearch.ts`. Einzige Fremdimporte sind `markdown-it` und
 * `nostr-tools/nip19` (Präzedenzfall: `nostrEventLink.ts:27`).
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

/** NIP-23: der publizierte Longform-Artikel (adressierbar, `d` = Kennung). */
export const LONGFORM = 30023

/**
 * NIP-23: der ENTWURF. Steht hier nur, damit die Zahl einen Namen hat — gefragt wird er
 * nie.
 *
 * **Wichtig für den Listenfilter:** 67 der 99 publizierten Artikel tragen ein `d` der
 * Form `draft-<ts>` (gemessen 2026-08-12; der Plan nannte 66 von 98). Das sind
 * **publizierte** Artikel, deren Kennung nur so heißt, weil der schreibende Client sie
 * beim ersten Speichern vergeben hat. Ein Filter auf das `d`-Muster löschte damit
 * **zwei Drittel** des Bestands — der teuerste stille Fehler, den diese Fläche machen
 * kann. Ein echter Entwurf ist kind {@link LONGFORM_DRAFT}, und den fragen wir nicht ab
 * (am Relay existieren davon 2).
 */
export const LONGFORM_DRAFT = 30024

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
        if (marker === '') {
            token.attrs[at][1] = proxified
        } else {
            // Auth-pflichtiges Bild des Workspace-Relays: der `src` wird ENTFERNT, nicht
            // geleert. Ein `src=""` ist zwar spezifiziert („nicht laden"), aber es gab
            // Browser, die es gegen die Dokument-Adresse auflösten und die Seite selbst
            // nachluden; kein Attribut ist die Aussage, die keine Auslegung zulässt.
            // Die Werksregel darunter fasst nur `alt` an — das Entfernen ist für sie
            // folgenlos (`markdown-it/dist/markdown-it.mjs:849-853`, gelesen).
            token.attrs.splice(at, 1)
            token.attrSet(BLOSSOM_SRC_ATTR, marker)
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
