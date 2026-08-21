/**
 * **Der Riegel zwischen dem reinen Modul, der welshman-Seite und dem Markup der
 * Autorenseite (P4).**
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleAuthorMarkup.test.ts
 *
 * Drei Zusagen dieser Phase stehen zwangsläufig doppelt und können still auseinanderlaufen:
 *
 *  1. **Der Bestandsfilter.** Die Autorenseite liest denselben `{kinds:[30023], limit}`
 *     wie die Liste. Genau daran hängt, dass ihre Auswahl vollständig ist — und genau da
 *     kippt sie still, sobald der Relay `ARTICLE_LOAD_LIMIT` Artikel führt. Der Docblock
 *     bei `deriveAuthorPage` sagt das; hier wird es geprüft, statt geglaubt.
 *  2. **Der Kernbeweis an seiner produktiven Stelle.** `deriveAuthorPage` darf die Artikel
 *     nicht mit einem zweiten, eigenen `filter` auswählen, sondern über die geprüfte
 *     Funktion `artikelDesAutors`. Sonst gäbe es über „welche Artikel gehören diesem
 *     Autor" zwei Wahrheiten, und nur eine davon hat Tests.
 *  3. **Die vier Fehlzustände.** Sie stehen als TypeScript-Union in `articleAuthor.ts` und
 *     als `data-autor-fehler`-Werte im Blade. PHP und TypeScript teilen zur Laufzeit
 *     nichts: ein umbenannter Zustand ließe die Fläche stumm nichts anzeigen, während
 *     jeder Test grün bliebe.
 *
 * **Warum als Quelltext-Sonde und nicht als Import:** `longformFeed.ts` ist unter
 * `node --test` nicht ladbar (13 endungslose relative Importe in der Kette, danach ein
 * `localStorage` beim Boot von `session.ts` — gemessen 2026-08-20, Begründung im Kopf von
 * `longform.ts`). Ein Import wäre der bessere Weg; er steht nicht zur Verfügung.
 *
 * Bauform wie `articleReaderMarkup.test.ts`: **findet eine Sonde ihren Gegenstand nicht,
 * WIRFT sie.** Eine Sonde, die bei unlesbarer Eingabe „nichts gefunden" meldet, ist
 * fail-open und sähe nach dem nächsten Umbau wie ein bestandener Test aus.
 *
 * ── Mutationsproben (von Hand gefahren, 2026-08-21, jede bytegenau zurückgebaut) ────
 *
 * | Mutation                                                                | gemessen        |
 * |-------------------------------------------------------------------------|-----------------|
 * | Blade: `data-autor-fehler="npub"` → `"npub-kaputt"`                      | **rot**, 1 Fall |
 * | `deriveAuthorPage`: eigenes `.filter(e => e.pubkey === pubkey)` statt `artikelDesAutors` | **rot**, 1 Fall |
 * | `deriveAuthorPage`: `listFilters(ARTICLE_LOAD_LIMIT)` → `listFilters(50)` | **rot**, 1 Fall |
 * | Blade: `tabular-nums` an der Monatsmarke gestrichen                       | **rot**, 1 Fall |
 * | Blade: `uppercase` an der Monatsmarke ergänzt                             | **rot**, 1 Fall |
 *
 * Nachgetragen 2026-08-21 (Nachbesserung):
 *
 * | Mutation                                                                | gemessen        |
 * |-------------------------------------------------------------------------|-----------------|
 * | `bridge.ts`: `this.fehlerDomain = ''` aus `retry()` gestrichen           | **rot**, 1 Fall |
 * | `articleAuthor.ts`: `AbortSignal.timeout(NIP05_TIMEOUT_MS)` → `(8_000)`  | **rot**, 1 Fall |
 * | Blade: `data-autor-karte` → `data-autor-kartex`                          | **rot**, 1 Fall |
 * | Blade: der `x-for`-Block der Monate IN die Autorenkarte verschoben       | **rot**, 1 Fall |
 *
 * **Die dritte ist beim ersten Anlauf GRÜN geblieben** — die Sonde suchte mit
 * `indexOf('data-autor-karte')` und fand den umbenannten Präfix `data-autor-kartex`
 * gleich mit. Der Gegenstand war weg, die Sonde meldete trotzdem „gefunden": fail-open,
 * genau die Klasse, gegen die dieser Dateikopf geschrieben ist. Seitdem trifft sie das
 * Attribut über `/data-autor-karte[\s>]/`, und die Mutation macht rot.
 *
 * Die zweite ist die wichtigste: sie ist die Form, in der der Kernbeweis dieser Phase
 * still umgangen würde — der reine Test in `articleAuthor.test.ts` bliebe dabei grün,
 * weil die Funktion, die er prüft, dann niemand mehr aufruft.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const JS = import.meta.dirname
const VIEWS = join(JS, '..', 'resources', 'views')
const FEED = join(JS, 'longformFeed.ts')
const REIN = join(JS, 'articleAuthor.ts')
const INSEL = join(JS, 'bridge.ts')
const SEITE = join(VIEWS, '⚡article-author.blade.php')

/** Quelltext, **werfend** bei fehlender oder leerer Datei. */
const lies = (pfad: string): string => {
    const roh = readFileSync(pfad, 'utf8')
    if (roh.trim() === '') {
        throw new Error(`${pfad} ist leer — die Sonde misst nichts mehr.`)
    }

    return roh
}

/**
 * Blade-Quelltext **ohne Kommentare**.
 *
 * Kein Zierrat: diese View erklärt sich ausführlich, und jede Zusage steht dort auch als
 * Zitat — `font-mono` kommt im Entwurfskommentar vor, und zwar in dem Satz „KEIN
 * `font-mono`". Eine Sonde über den rohen Quelltext meldete dafür einen Verstoß, den es
 * nicht gibt. Dieselbe Behandlung wie in `articleReaderMarkup.test.ts`.
 */
const liesBlade = (pfad: string): string => {
    const quelle = lies(pfad).replace(/\{\{--[\s\S]*?--\}\}/g, '')
    if (quelle.trim() === '') {
        throw new Error(`${pfad} besteht nur aus Kommentaren — die Sonde misst nichts mehr.`)
    }

    return quelle
}

/**
 * Der Rumpf von `deriveAuthorPage` — **werfend**, wenn es die Funktion nicht mehr gibt.
 *
 * Angesetzt am Namen und begrenzt am nächsten `export const` auf Spaltenanfang: ein
 * Schnitt „ab hier 40 Zeilen" träfe nach dem nächsten Umbau die Nachbarfunktion mit
 * voller Überzeugung.
 */
const ableitungsRumpf = (): string => {
    const quelle = lies(FEED)
    const ab = quelle.indexOf('export const deriveAuthorPage')
    if (ab < 0) {
        throw new Error(`deriveAuthorPage steht nicht mehr in ${FEED} — die Sonde misst nichts mehr.`)
    }
    const bis = quelle.indexOf('\nexport const ', ab + 1)
    if (bis < 0) {
        throw new Error(`Kein Ende von deriveAuthorPage gefunden — die Sonde misst nichts mehr.`)
    }

    return quelle.slice(ab, bis)
}

// ── Die Schranke zuerst ────────────────────────────────────────────────────────────

test('die Sonden finden ihre Gegenstaende ueberhaupt — sonst ist alles darunter wertlos', () => {
    assert.ok(lies(FEED).length > 5_000, 'longformFeed.ts ist verdächtig klein.')
    assert.ok(lies(REIN).length > 5_000, 'articleAuthor.ts ist verdächtig klein.')
    assert.ok(liesBlade(SEITE).length > 3_000, 'Die Autorenseite ist verdächtig klein.')
    assert.ok(ableitungsRumpf().length > 300, 'Der Rumpf von deriveAuthorPage ist verdächtig kurz.')
})

// ── 1. Der Bestandsfilter, und die Bedingung, unter der er kippt ──────────────────

test('ARTICLE_LOAD_LIMIT ist 200 — die Zahl, unter der die Auswahl der Autorenseite vollstaendig ist', () => {
    // **Ein Literal, kein Symbol.** Der Bestand lag am 2026-08-20 bei 104 Artikeln; erst
    // ab 200 zeigt die Autorenseite still einen Ausschnitt. Wer die Zahl ändert, ändert
    // damit die Bedingung, unter der diese Fläche die Wahrheit sagt — und soll hier
    // darüber stolpern.
    assert.match(lies(FEED), /export const ARTICLE_LOAD_LIMIT = 200\b/)
})

test('die Autorenseite liest DENSELBEN Bestandsfilter wie die Liste — nicht einen eigenen', () => {
    // Ein autorenskopierter Load ohne passende Ableitung wäre wirkungslos (Begründung im
    // Docblock von `deriveAuthorPage`). Solange beide über `listFilters(ARTICLE_LOAD_LIMIT)`
    // gehen, ist die Auswahl unterhalb des Deckels vollständig.
    assert.match(ableitungsRumpf(), /deriveEventsForUrl\(BOARD_URL, listFilters\(ARTICLE_LOAD_LIMIT\)\)/)
})

// ── 2. Der Kernbeweis an seiner produktiven Stelle ────────────────────────────────

test('deriveAuthorPage waehlt ueber artikelDesAutors aus — kein zweites, ungeprueftes filter', () => {
    const rumpf = ableitungsRumpf()
    assert.match(rumpf, /artikelDesAutors\(events as TrustedEvent\[\], pubkey\)/)
    // Und es gibt daneben keinen handgeschriebenen Vergleich auf `pubkey`, der dasselbe
    // noch einmal — und ungeprüft — täte.
    assert.equal(
        /\.filter\([^)]*pubkey\s*===/.test(rumpf),
        false,
        'In deriveAuthorPage steht ein eigener pubkey-Filter neben artikelDesAutors — damit gäbe es zwei Wahrheiten, und nur eine hat Tests.',
    )
})

test('die Autorenkarte entsteht ueber buildArticleAuthor — dieselbe Funktion wie in der Vollansicht', () => {
    const rumpf = ableitungsRumpf()
    assert.match(rumpf, /buildArticleAuthor\(pubkey, \{/)
    // Der dreiwertige Lightning-Zustand hängt an DIESEM Feld; ohne es wäre er zweiwertig
    // und die Fläche behauptete „keine Lightning-Adresse" über ein Profil, das noch
    // unterwegs ist.
    assert.match(rumpf, /profilBekannt:\s*profil !== undefined/)
})

// ── 3. Vier Fehlzustände, auf beiden Seiten der Sprachgrenze dieselben ────────────

/** Die Union `AutorFehler` aus dem Quelltext — **werfend**, wenn sie nicht mehr da ist. */
const fehlerAusTypescript = (): string[] => {
    const treffer = /export type AutorFehler = ([^\n]+)/.exec(lies(REIN))
    if (!treffer) {
        throw new Error(`Die Union AutorFehler steht nicht mehr in ${REIN} — die Sonde misst nichts mehr.`)
    }
    const werte = [...treffer[1]!.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]!)
    if (werte.length === 0) {
        throw new Error(`AutorFehler trägt keine Werte mehr — die Sonde misst nichts mehr.`)
    }

    return werte.sort()
}

/** Die `data-autor-fehler`-Werte aus dem Blade — **werfend**, wenn keiner mehr da ist. */
const fehlerAusBlade = (): string[] => {
    const werte = [...liesBlade(SEITE).matchAll(/data-autor-fehler="([a-z0-9-]+)"/g)].map((m) => m[1]!)
    if (werte.length === 0) {
        throw new Error(`Kein data-autor-fehler in ${SEITE} — die Sonde misst nichts mehr.`)
    }

    return werte.sort()
}

test('jeder Fehlzustand aus dem TypeScript hat GENAU EINEN Block im Markup — und umgekehrt', () => {
    const ts = fehlerAusTypescript()
    // Die Zahl steht als Literal da: die DoD verlangt VIER unterscheidbare Fehlzustände.
    // Ein fünfter ist kein Fehler, aber er soll hier auffallen und bewusst eingetragen
    // werden — genauso wie ein verschwundener vierter.
    assert.equal(ts.length, 4, `AutorFehler trägt ${ts.length} Werte statt vier: ${ts.join(', ')}`)
    assert.deepEqual(fehlerAusBlade(), ts)
})

test('jeder Fehlzustand wird in der Flaeche auch ABGEFRAGT — ein Block ohne Bedingung erscheint nie', () => {
    const quelle = liesBlade(SEITE)
    for (const wert of fehlerAusTypescript()) {
        assert.ok(
            quelle.includes(`fehler === '${wert}'`),
            `Für „${wert}" gibt es einen Block, aber keine Bedingung, die ihn zeigt.`,
        )
    }
})

// ── Hausregeln, die kein anderer Test für diese Datei trägt ───────────────────────

test('die Autorenseite setzt KEIN font-mono — sie zoege eine zweite Schriftfamilie herein', () => {
    // `--font-mono` ist im Theme nicht definiert (`theme.css` setzt nur `--font-sans` auf
    // Inconsolata); jedes `font-mono` fällt damit auf den Browser-Default zurück.
    assert.equal(/\bfont-mono\b/.test(liesBlade(SEITE)), false)
})

test('Zahlen stehen mit tabular-nums — Monatsmarken und die Anzahl im Kopf', () => {
    const quelle = liesBlade(SEITE)
    // Geprüft wird das ELEMENT, nicht die Datei: ein `tabular-nums` irgendwo im Markup
    // sagt nichts darüber, ob die Monatsmarke eins trägt. Gelesen wird das Klassenattribut
    // GENAU des Elements, das `:data-monatsmarke` bindet — sonst stünden die Jahreszahlen
    // der Marken unterschiedlich breit untereinander, und genau daran soll man die
    // Gliederung ablesen können.
    const marke = /<span class="([^"]*)"[^>]*:data-monatsmarke[\s=>]/.exec(quelle)
    if (!marke) {
        throw new Error('Die Monatsmarke trägt kein data-monatsmarke mehr — die Sonde misst nichts mehr.')
    }
    assert.match(marke[1]!, /tabular-nums/)
    // Und KEIN `uppercase`: „AUGUST 2026" schriee, und ein Monatsname ist ein Wort.
    assert.equal(/\buppercase\b/.test(marke[1]!), false)
    // Und die Grundangaben-Zeile im Kopf, aus demselben Grund.
    const zahlen = /<p([^>]*?)data-autor-zahlen[\s=>]/.exec(quelle)
    if (!zahlen) {
        throw new Error('Die Grundangaben-Zeile trägt kein data-autor-zahlen mehr — die Sonde misst nichts mehr.')
    }
    assert.match(zahlen[1]!, /tabular-nums/)
})


// ── Die zwei Grenzen der NIP-05-Abfrage sind auch VERDRAHTET ──────────────────────
//
// `articleAuthor.test.ts` prüft ihre Werte und ihr Verhalten am `fetch`-Double. Was von
// dort aus nicht sichtbar ist: WELCHE Zahl an der Anfrage ankommt. Aus einem laufenden
// `AbortSignal` ist die Dauer nicht auslesbar, und eine Uhr acht Sekunden laufen zu
// lassen wäre eine Prüfung, die niemand mehr abwartet. Deshalb hier, am Quelltext — zwei
// Zeilen, die genau die Lücke schließen, die eine Literal-Zeile allein offen lässt.

/** Rumpf einer `export const`-Funktion aus `articleAuthor.ts` — **werfend**, wenn weg. */
const reinerRumpf = (name: string): string => {
    const quelle = lies(REIN)
    const ab = quelle.indexOf(`export const ${name} =`)
    if (ab < 0) {
        throw new Error(`${name} steht nicht mehr in ${REIN} — die Sonde misst nichts mehr.`)
    }
    const bis = quelle.indexOf('\nexport const ', ab + 1)

    return quelle.slice(ab, bis < 0 ? undefined : bis)
}

test('die Frist ist an der Anfrage verdrahtet — NIP05_TIMEOUT_MS und nicht eine zweite Zahl daneben', () => {
    const rumpf = reinerRumpf('holeNip05Json')
    assert.match(rumpf, /signal: AbortSignal\.timeout\(NIP05_TIMEOUT_MS\)/)
    // Und keine ausgeschriebene Zahl an derselben Stelle: eine zweite Wahrheit über die
    // Frist wäre genau der Fall, gegen den die Konstante gebaut ist.
    assert.equal(
        /AbortSignal\.timeout\(\s*\d/.test(rumpf),
        false,
        'In holeNip05Json steht eine ausgeschriebene Frist statt NIP05_TIMEOUT_MS.',
    )
})

test('die Groessengrenze steht IM Lesen und nicht dahinter — kein res.text()/res.json() im Abfrageweg', () => {
    const hole = reinerRumpf('holeNip05Json')
    const lesen = reinerRumpf('liesBegrenzt')
    // **Der Befund, gegen den diese Sonde steht** (2026-08-21): die Grenze stand hinter
    // `await antwort.text()` und schützte damit `JSON.parse`, nicht den Speicher. Der
    // Körper muss durch die begrenzende Funktion gehen — und die muss ihn STÜCKWEISE
    // lesen, sonst liegt er schon vollständig im Speicher, wenn gezählt wird.
    assert.match(hole, /liesBegrenzt\(antwort\.body\)/)
    assert.equal(
        /antwort\.(text|json)\(\)/.test(hole),
        false,
        'holeNip05Json liest den Körper wieder am Stück — dann wirkt NIP05_MAX_ZEICHEN erst vor dem Parser.',
    )
    assert.match(lesen, /getReader\(\)/)
    assert.match(lesen, /text\.length > NIP05_MAX_ZEICHEN/)
})

// ── `retry()` lässt nichts vom vorigen Versuch stehen ─────────────────────────────

/** Rumpf einer Methode der Insel `nostrArticleAuthor` — **werfend**, wenn weg. */
const inselMethode = (name: string): string => {
    const quelle = lies(INSEL)
    const insel = quelle.indexOf("Alpine.data('nostrArticleAuthor'")
    if (insel < 0) {
        throw new Error(`nostrArticleAuthor steht nicht mehr in ${INSEL} — die Sonde misst nichts mehr.`)
    }
    const ab = quelle.indexOf(`\n            ${name}(`, insel)
    if (ab < 0) {
        throw new Error(`${name}() steht nicht mehr in nostrArticleAuthor — die Sonde misst nichts mehr.`)
    }
    const bis = quelle.indexOf('\n            },', ab)
    if (bis < 0) {
        throw new Error(`Kein Ende von ${name}() gefunden — die Sonde misst nichts mehr.`)
    }

    return quelle.slice(ab, bis)
}

test('retry() setzt JEDES Feld zurueck, das ein frueherer Versuch geschrieben hat', () => {
    // **Der Befund** (2026-08-21): `fehlerDomain`, `pubkey`, `gruppen`, `anzahl` und
    // `seitJahr` blieben stehen. Sichtbar wurde das nicht, weil beide heutigen Aufrufer
    // nur bei `anzahl === 0` erscheinen — eine Eigenschaft der AUFRUFER, die nirgends
    // stand. Ein dritter Aufrufer (P5 verlinkt diese Seite) hätte die Liste des ersten
    // Versuchs unter der Fehlermeldung des zweiten stehen lassen: das `x-for` der Monate
    // hängt an `gruppen`, nicht an `hatAutor()`.
    //
    // Geprüft wird gegen die Felder, die `_boot`/`_gliedern`/`_endeMitFehler` schreiben —
    // aufgezählt, weil eine Herleitung aus dem Quelltext hier mehr raten als messen würde.
    const rumpf = inselMethode('retry')
    for (const feld of ['fehler', 'fehlerDomain', 'error', 'aufloesend', 'loading', 'autor', 'gruppen', 'anzahl', 'seitJahr', 'pubkey']) {
        assert.match(
            rumpf,
            new RegExp(`this\\.${feld} = `),
            `retry() setzt „${feld}" nicht zurück — der Zustand des vorigen Versuchs überlebt ihn.`,
        )
    }
    // `_param` und `_base` bleiben: sie sind Eigenschaften der SEITE, nicht des Versuchs.
    assert.equal(/this\._param = /.test(rumpf), false, 'retry() darf den Routen-Parameter nicht anfassen.')
    assert.equal(/this\._base = /.test(rumpf), false, 'retry() darf den Basis-Pfad nicht anfassen.')
    // Und es fängt wirklich von vorn an, nicht erst beim Laden.
    assert.match(rumpf, /this\._boot\(\)/)
    assert.equal(
        /this\._load\(\)/.test(rumpf),
        false,
        'retry() startet nur das Laden neu — dann bliebe „nip05-fehlgeschlagen" stehen, der Fall, für den der Knopf da ist.',
    )
})

test('die Artikelliste haengt NICHT an der Autorenkarte — DoD 8, an seiner strukturellen Stelle', () => {
    // Der Nachweis am laufenden Stack steht in `tests/e2e/article-author.spec.ts`
    // („Ein Autor OHNE kind 0…"). Hier steht die Struktur, die ihn trägt: das `x-for` der
    // Monatsgruppen darf nicht innerhalb des Karten-`<template>` liegen und nicht an
    // `autor` hängen — sonst verschwände mit dem fehlenden Profil auch die Liste.
    const quelle = liesBlade(SEITE)
    // Das Attribut GENAU treffen, nicht als Präfix: ein `indexOf('data-autor-karte')`
    // fände auch ein `data-autor-kartex` und die Sonde bliebe grün, obwohl ihr Gegenstand
    // umbenannt wurde. (Beim Kalibrieren am 2026-08-21 genau so passiert.)
    const karte = /data-autor-karte[\s>]/.exec(quelle)
    if (!karte) {
        throw new Error('Die Autorenkarte trägt kein data-autor-karte mehr — die Sonde misst nichts mehr.')
    }
    const karteAb = karte.index
    const karteBis = quelle.indexOf('</section>', karteAb)
    const listeAb = quelle.indexOf('x-for="gruppe in gruppen"')
    if (listeAb < 0 || karteBis < 0) {
        throw new Error('Karte oder Monatsliste nicht gefunden — die Sonde misst nichts mehr.')
    }
    // Geprüft wird genau die Zusage — „nicht INNERHALB der Karte" — und nicht eine
    // Reihenfolge: ob die Karte über oder unter der Liste steht, ist eine Entwurfsfrage
    // und geht diese Sonde nichts an.
    assert.equal(
        listeAb > karteAb && listeAb < karteBis,
        false,
        'Die Monatsliste steht INNERHALB der Autorenkarte — ein Autor ohne kind 0 verlöre damit seine Artikel.',
    )
})
