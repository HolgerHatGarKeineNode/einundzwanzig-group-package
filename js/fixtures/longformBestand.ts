/**
 * **Der eingefrorene FORMEN-Satz** — Zugang und Definition in einer Datei.
 *
 * `longform-bestand.json` daneben trägt dreizehn Artikel, ausgewählt nach STRUKTUR. Dieses
 * Modul sagt, was „Struktur" heißt: {@link BESTAND_FORMEN} ist die **maßgebliche**
 * Definition der dreizehn Formen, nicht eine Beschreibung davon. Eine Form, die hier nicht
 * steht, ist nicht Teil des Satzes; ein Eintrag im JSON, den keine Form trifft, fällt in
 * der Schranke (`longformBestand.test.ts`) auf.
 *
 * ── Warum die Prädikate hier und nicht im Test stehen ────────────────────────────────
 *
 * Weil mehrere Tests denselben Satz brauchen (der P3-Kernbeweis über den Renderer, die
 * Schranke, und was danach kommt), und weil zwei Kopien derselben Klassifikation genau
 * die Art Zweitwahrheit sind, die still auseinanderläuft. Der Preis ist eine Nicht-Test-
 * Datei unter `js/`: sie wird von keinem Insel-Modul importiert und landet deshalb in
 * keinem Bundle.
 *
 * ── Was dieser Satz NICHT ist ────────────────────────────────────────────────────────
 *
 * Kein Abbild des Bestands. Die Bestandszahlen (104 Artikel, 57 ohne Überschrift, …)
 * sind bewusst **nirgends** eingefroren: ein `assert.equal(…, 57)` prüfte den Relay,
 * nicht unseren Code, und würde durch fremdes Publizieren rot, ohne dass etwas kaputt
 * ist. Die Zahlen stehen im Docblock, die Formen im Code.
 *
 * ── Woran diese Einteilung geprüft wurde ─────────────────────────────────────────────
 *
 * **Nicht an sich selbst.** Über dieselben 104 Events gezählt liefert {@link BESTAND_FORMEN}
 * 57 ohne Überschrift · 33 mit ≥3 H2 · 14 Podcast · 22 mit `t` · 12 ohne `summary` ·
 * 14 ohne `image` · 2 ohne `published_at` — und alle sieben Zahlen decken sich mit den
 * **unabhängig davon** erhobenen Zahlen des Plans. Zwei Messungen, zwei Werkzeuge,
 * dasselbe Ergebnis: das ist die Gegenprobe, dass die Einteilung misst, was sie zu messen
 * behauptet, statt bloß in sich schlüssig zu sein. Ein Prädikat, das gegen niemanden
 * kalibriert ist, teilt genauso zuverlässig falsch ein wie richtig — man merkt es nur nie.
 *
 * Wer den Satz neu zieht, wiederholt die Gegenprobe und schreibt das Ergebnis in den
 * Dateikopf des JSON. Ein Fixture ohne Angabe, woran seine Einteilung geprüft wurde,
 * altert schneller als einer mit.
 *
 * ── ZWEI Events sind synthetisch, und sie können NIE vom Relay kommen ────────────────
 *
 * Beide Formen kommen im echten Bestand **0 von 104** mal vor (gemessen 2026-08-21,
 * derselbe Zug, aus dem die anderen elf stammen), und beide halten trotzdem einen
 * Zustand, den der Satz braucht:
 *
 *  · **`ohne-d`** — der einzige Zustand, in dem ein Artikel keine Adresse hat: kein
 *    `naddr`, kein Link, nichts zu teilen.
 *  · **`br-im-attributwert`** — die einzige Lage, in der eine rohe spitze Klammer
 *    INNERHALB eines Attributwerts landet. An genau ihr war der Kernbeweis-Scanner blind;
 *    ohne sie misst der Satz die Blendbarkeit der eigenen Sonde nicht.
 *
 * Beide Events sind erkennbar gefälscht (leere `sig`, sprechende `id`) und in
 * `synthetisch` namentlich aufgeführt.
 *
 * **Wer diese Datei aktualisiert, ersetzt die elf echten Events und übernimmt diese zwei
 * von Hand.** Ein geschlossener Neubau aus einem frischen `nak`-Zug verlöre sie
 * stillschweigend — „gegen den Relay aktualisieren" ist für diese Formen kein Weg, sondern
 * der Weg, sie zu verlieren.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripFrontmatter } from '../longform.ts'

/** Genau so viel eines Nostr-Events, wie der Formen-Satz braucht. */
export type BestandEvent = {
    id: string
    pubkey: string
    created_at: number
    kind: number
    tags: string[][]
    content: string
    sig: string
}

export type BestandDatei = {
    zweck: string
    befehl: string
    stand: string
    gezogenAus: number
    aktualisierung: string
    grenze: string
    /** Event-Ids, die NICHT vom Relay stammen. */
    synthetisch: string[]
    warumSynthetisch: string
    events: BestandEvent[]
}

const PFAD = join(import.meta.dirname, 'longform-bestand.json')

/**
 * Den Satz laden.
 *
 * **Wirft, wenn die Datei fehlt, unlesbar ist oder keine Events trägt** — statt einen
 * leeren Satz zurückzugeben. Eine Sonde, die bei unlesbarer Eingabe „nichts gefunden"
 * meldet, ist fail-open: jeder Test darüber liefe dann über null Fälle und sähe grün aus.
 */
export const ladeBestand = (): BestandDatei => {
    const roh = readFileSync(PFAD, 'utf8')
    const datei = JSON.parse(roh) as BestandDatei
    if (!Array.isArray(datei.events) || datei.events.length === 0) {
        throw new Error(`${PFAD} trägt keine Events — der Formen-Satz misst nichts mehr.`)
    }

    return datei
}

const tagWert = (event: BestandEvent, name: string): string | undefined =>
    event.tags.find((tag) => tag[0] === name)?.[1]

/**
 * Die dreizehn Formen. **Die Reihenfolge ist die des Plans**, die dreizehnte hängt hinter
 * ihrer nächsten Verwandten (`br-im-text`), damit sich beides nebeneinander lesen lässt.
 *
 * Jedes Prädikat arbeitet auf dem ROHEN Event — nicht auf einer `ArticleRow`. Die Formen
 * beschreiben den Eingang der Fläche, nicht ihre Verarbeitung; ein Prädikat über
 * `buildArticleRow` prüfte den Code, gegen den es kalibrieren soll.
 *
 * `stripFrontmatter` kommt aus dem Produktivmodul und wird hier NICHT nachgebaut: die
 * Frage „hat dieser Artikel eine Überschrift?" muss dieselbe Antwort geben wie im
 * Renderer, sonst klassifiziert der Satz an der Fläche vorbei.
 */
export const BESTAND_FORMEN: Readonly<Record<string, (event: BestandEvent) => boolean>> = {
    /** Der Normalfall des Bestands (57 von 104) — und der Grund, warum ein TOC nicht in P3 ist. */
    'ohne-ueberschrift': (event) => !/^#{1,6}\s/m.test(stripFrontmatter(event.content)),
    /** Die Gegenseite: gegliederter Langtext (33 von 104). */
    'h2-mindestens-3': (event) => (stripFrontmatter(event.content).match(/^##\s/gm) ?? []).length >= 3,
    /** YAML-Kopf im `content` — muss unsichtbar bleiben, nicht als Text erscheinen. */
    'yaml-frontmatter': (event) => event.content.startsWith('---\n') && event.content.indexOf('\n---', 3) > 0,
    /** Rohes `<br>` im Fremdtext — der eine bewusst durchgelassene Tag (`BR_SENTINEL`). */
    'br-im-text': (event) => /<br\s*\/?>/i.test(event.content),
    /**
     * Rohes `<br>` an einer Stelle, die im gerenderten HTML zu einem ATTRIBUTWERT wird —
     * Alt-Text eines Bildes oder Titel eines Links.
     *
     * **Das ist nicht dieselbe Form wie `br-im-text`, und der Unterschied hat einen
     * Fund gekostet.** Im Fließtext wird aus dem Sentinel ein `<br>` zwischen zwei
     * Textknoten: harmlos und für jeden Leser sichtbar. In einem Attributwert landet
     * dagegen eine rohe spitze Klammer INNERHALB von Anführungszeichen — und daran war
     * der Kernbeweis-Scanner blind (er endete am ersten `>`, egal wo es stand, und sah
     * die dahinter stehenden Attribute nicht mehr; mit einem `x-init` am Bild blieb er
     * dabei grün). Ohne diese Form misst der Satz genau die Lage nicht, an der die Sonde
     * blenden kann.
     *
     * **Im Bestand: 0 von 104** (10 Artikel tragen überhaupt ein `<br>`, keiner davon in
     * einem Bild-Alt). Der Eintrag ist deshalb synthetisch — siehe Modulkopf.
     */
    'br-im-attributwert': (event) =>
        /!\[[^\]]*<br\s*\/?>[^\]]*\]/i.test(event.content) || /\]\([^)]*"[^"]*<br\s*\/?>[^"]*"/i.test(event.content),
    /** Der Riese: >200 000 Zeichen, fast alles ein eingebettetes base64-Bild. */
    'base64-riese': (event) => event.content.length > 200_000 && /data:image\/[a-z]+;base64,/.test(event.content),
    /** Podcast-Bridge: `imeta` mit `m audio/…` (14 von 104, keiner davon mit Dauer). */
    'podcast-episode': (event) =>
        event.tags.some((tag) => tag[0] === 'imeta' && tag.slice(1).some((feld) => /^m audio\//.test(feld))),
    /** Themen-Tags (22 von 104). */
    'mit-t-tags': (event) => event.tags.some((tag) => tag[0] === 't'),
    /** Kein `summary` (12 von 104) — der Teaser muss aus dem Text kommen. */
    'ohne-summary': (event) => tagWert(event, 'summary') === undefined,
    /** Kein `image` (14 von 104) — das Ersatz-Cover trägt die Karte. */
    'ohne-image': (event) => tagWert(event, 'image') === undefined,
    /** Kein `d` — keine Adresse, kein `naddr`, nichts zu teilen. SYNTHETISCH, siehe Modulkopf. */
    'ohne-d': (event) => {
        const wert = tagWert(event, 'd')

        return wert === undefined || wert === ''
    },
    /** `d = draft-<ts>` und trotzdem publiziert (72 von 104) — der teuerste stille Fehler der Fläche. */
    'd-draft-praefix': (event) => /^draft-\d+$/.test(tagWert(event, 'd') ?? ''),
    /** Kein `published_at` (2 von 104) — die Feldwahl fällt auf `created_at` zurück. */
    'ohne-published-at': (event) => tagWert(event, 'published_at') === undefined,
}

/** Die Namen der dreizehn Formen, in der Reihenfolge des Plans. */
export const FORMEN_NAMEN: readonly string[] = Object.keys(BESTAND_FORMEN)
