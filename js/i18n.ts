/**
 * Übersetzung IN DER INSEL (P2, Strang C) — das Gegenstück zu Laravels `__()`.
 *
 * Die Insel ist eine TypeScript-Alpine-Insel; ihre Toasts, Fehlermeldungen und
 * Labels entstehen im Browser, nicht in Blade. Sie sind deshalb nie durch `__()`
 * gelaufen und blieben deutsch, egal welche Sprache der Nutzer gewählt hat.
 * `t()` schließt genau diese Lücke — mit demselben Schema wie serverseitig:
 * **der Schlüssel IST der deutsche Quelltext.**
 *
 * ── Warum der Katalog im Layout ausgeliefert wird (und nicht anders) ─────────
 *
 * Gewählt: der Host schreibt den Katalog der AKTIVEN Sprache als
 * `window.__nostrI18n` in den `<head>`, VOR `@vite` (siehe
 * `group::partials.i18n`, eingebunden von beiden Head-Partials). Vier Gründe,
 * die zusammen keine Alternative übrig lassen:
 *
 *  1. **Kein Netzwerkaufruf.** Der Katalog liegt im HTML, das ohnehin geladen
 *     wurde. Die Insel startet auch offline aus ihrem IndexedDB-Kaltstart-Cache
 *     (`storage.ts`) — ein nachgeladener Katalog wäre genau dann weg, wenn er
 *     gebraucht wird, und die Oberfläche fiele mitten im Betrieb auf Deutsch
 *     zurück.
 *  2. **Synchron.** Mehrere Aufrufstellen sind Modul-Konstanten
 *     (`publishResult.NO_VERDICT_ERROR`, `rail.GROUP_LABEL`,
 *     `updatesView.BUCKET_LABELS`). Ein `await import()` wäre dort nicht
 *     einsetzbar, ohne ihre Form zu ändern.
 *  3. **`wire:navigate`-fest.** Der Body wird getauscht, der Head bleibt —
 *     `window.__nostrI18n` überlebt die Navigation genau wie `window.__nostrSpace`.
 *     Und ein SPRACHWECHSEL lädt per `LocaleController` ohnehin voll neu (das
 *     `<html lang>` muss mitkommen), der Katalog kann also nie veralten.
 *     Trotzdem liest {@link catalog} bei JEDEM Aufruf frisch vom `window` statt
 *     beim Modul-Boot einmal zu schnappschussen — das kostet nichts und macht
 *     die Reihenfolge Skript/Modul-Boot irrelevant.
 *  4. **Bundle bleibt schlank.** Im JS-Bundle steht KEIN Katalog — weder einer
 *     noch acht. Ausgeliefert wird pro Seite nur `lang/<aktive-locale>.json`.
 *
 * Verworfen: **per-Locale-JSON als Vite-Chunk** (`import(\`../lang/${l}.json\`)`).
 * Das hätte die Kataloge zwar aus dem Haupt-Bundle gehalten, aber (a) einen
 * Netzwerk-Roundtrip beim Boot gekostet, der offline scheitert, (b) `t()` async
 * gemacht und damit die drei Modul-Konstanten oben aufgebrochen, (c) einen
 * zweiten Ort für dieselben Übersetzungen geschaffen — der Übersetzer pflegt
 * `lang/*.json`, und genau die sollen hier ankommen.
 *
 * Ebenfalls verworfen: **nur die Insel-Schlüssel ausliefern** statt des ganzen
 * Katalogs. Das verlangt eine gepflegte Schlüsselliste; ein später ergänztes
 * `t('…')`, das dort fehlt, fiele STILL auf Deutsch zurück — ununterscheidbar
 * von einer fehlenden Übersetzung. Ein Fehler, der sich als Normalzustand tarnt,
 * ist die Ersparnis nicht wert. Der Preis dafür ist gemessen (2026-08-09):
 * `de` = `{}`, also **2 Byte** — die Standardsprache zahlt gar nichts; `en` und
 * `es` = 433 Schlüssel, rund **21–23 kB** JSON vor gzip pro Seitenaufbau, und
 * das trägt zugleich die Blade-Seite mit.
 *
 * ── Verhalten bei fehlendem Schlüssel ───────────────────────────────────────
 *
 * Identisch zu Laravel: **der Schlüssel selbst wird zurückgegeben**, also der
 * deutsche Quelltext. Nicht `undefined`, nicht `[key]`, nicht der leere String.
 * Das ist keine Kosmetik — dieselbe Zeichenkette steht teils in Blade und teils
 * hier (z. B. „Nicht verbunden"); zwei verschiedene Rückfälle hießen, dass
 * dieselbe fehlende Übersetzung an zwei Orten unterschiedlich aussieht.
 * Nebeneffekt: unter `de` gibt es gar kein `lang/de.json`, der Katalog ist leer
 * und JEDER Aufruf liefert exakt den bisherigen Text — die deutsche Oberfläche
 * ist damit bitgleich zu vorher.
 *
 * Ohne `window` (die `*.test.ts` laufen unter `node --test`) ist der Katalog
 * ebenfalls leer → die Pure-Tests sehen weiterhin die deutschen Texte.
 */

import { pluralCategory } from './locale.ts'

/** Platzhalter-Werte für `:name`-Ersetzungen, wie `__('…', [...])` in PHP. */
export type Replacements = Record<string, string | number>

declare global {
    interface Window {
        /** Vom Layout gesetzter JSON-Katalog der aktiven Sprache (leer unter `de`). */
        __nostrI18n?: Record<string, string>
    }
}

/** Der aktive Katalog — frisch vom `window`, leer außerhalb des Browsers. */
const catalog = (): Record<string, string> =>
    (typeof window !== 'undefined' ? window.__nostrI18n : undefined) ?? {}

/**
 * `:name`-Platzhalter füllen — **längster Schlüssel zuerst**, wie Laravels
 * `MessageSelector`/`Translator::makeReplacements`. Ohne diese Sortierung würde
 * `:count` von einem gleichzeitig übergebenen `:c` zerschnitten.
 */
const fill = (line: string, replace: Replacements): string => {
    let out = line
    for (const key of Object.keys(replace).sort((a, b) => b.length - a.length)) {
        out = out.split(`:${key}`).join(String(replace[key]))
    }
    return out
}

/**
 * Übersetzt `key` (= der deutsche Quelltext) in die aktive Sprache.
 *
 * @param key     Der deutsche Quelltext, exakt wie er bisher im Code stand.
 * @param replace Optionale `:name`-Werte.
 */
export const t = (key: string, replace?: Replacements): string => {
    const line = catalog()[key] ?? key

    return replace ? fill(line, replace) : line
}

/**
 * Die zwei Formen, in denen Deutsch zählt — zugleich die zwei Katalogschlüssel.
 *
 * `one` schreibt die Eins aus (`'1 Raum'`), `other` trägt den Platzhalter
 * (`':count Räume'`). Beide sind der deutsche Quelltext, also nach der Hausregel
 * zugleich der Schlüssel; beide stehen in ALLEN sieben Katalogen.
 */
export type PluralForms = { one: string; other: string }

/**
 * Zählform-Schlüssel: `<other-Schlüssel>#<CLDR-Kategorie>`, z. B.
 * `':count Räume#few'`. Getrennt vom Basisschlüssel durch `#`, weil das Zeichen
 * in keinem der 757 deutschen Quelltexte vorkommt (geprüft) und der Schlüssel
 * dadurch eindeutig zerlegbar bleibt.
 */
export const pluralVariantKey = (other: string, category: string): string => `${other}#${category}`

/**
 * Numerus MIT den Regeln der Zielsprache — das Gegenstück zum alten
 * `count === 1 ? eine : viele`.
 *
 * ── Die Katalog-Konvention ──────────────────────────────────────────────────
 *
 * Zwei Ebenen, und die untere ist die, die es vorher schon gab:
 *
 *  1. **Die zwei Grundformen** (`forms.one`, `forms.other`) stehen unverändert
 *     in allen sieben Katalogen. Sie tragen jede Sprache, deren CLDR-Kategorien
 *     sich auf „eins" und „nicht eins" abbilden lassen — das sind sechs der
 *     acht: de, en, es, hu, nl und (mit der Einschränkung unten) pt.
 *  2. **Sonderformen** `':count Räume#few'`, `…#many'`, `…#zero'`, `…#one'`
 *     stehen NUR in den Katalogen der Sprachen, die sie brauchen. `en.json` hat
 *     kein `#few`, weil Englisch kein `few` kennt; ein `#few` dort wäre toter
 *     Text, den ein Übersetzer trotzdem pflegen müsste. Welche Sprache welche
 *     Sonderform tragen MUSS, ist gemessen und in `GroupI18nTest` verankert —
 *     nicht dem Augenmaß überlassen.
 *
 * ── Die Suchreihenfolge, und warum sie so herum ist ─────────────────────────
 *
 * Gesucht wird über den `other`-Schlüssel, NICHT über den `one`-Schlüssel: nur
 * er trägt `:count`. Das ist der Grund, warum auch die `one`-Kategorie eine
 * Sonderform bekommen kann. In `lv` fallen 21, 31 und 101 in `one`, in `pt`
 * fällt die 0 dorthin — der ausgeschriebene Schlüssel „1 sala" verschluckte die
 * Zahl. `':count sala#one'` behebt genau das, ohne die anderen Sprachen zu
 * berühren.
 *
 * ── Der Rückfall ist der Normalfall, nicht der Notfall ──────────────────────
 *
 * Fehlt die Sonderform, wird NICHT der rohe Schlüssel gezeigt, sondern die
 * passende Grundform — also exakt das, was vor dieser Änderung erschien. Fehlt
 * auch die (weil die Sprache den Eintrag nicht hat), greift dieselbe Regel wie
 * bei {@link t}: der Schlüssel selbst, also der deutsche Quelltext. Nie
 * `undefined`, nie der leere String, nie ein sichtbares `#few`.
 *
 * Ein leerer Katalogwert zählt dabei ausdrücklich als „fehlt". Ein leerer String
 * ist die Narbe der alten Fragment-Verkettung; er darf eine gültige Grundform
 * nicht verdrängen.
 *
 * Unter `de` ist der Katalog leer → beide Ebenen greifen ins Leere → heraus
 * kommt der Schlüssel, und `Intl.PluralRules('de')` liefert `one` genau für 1.
 * **Die deutsche Ausgabe ist damit bitgleich zu vorher.**
 *
 * @param forms   Die zwei deutschen Formen (= Katalogschlüssel).
 * @param count   Der Zählwert. Steht als `:count` zur Verfügung.
 * @param replace Weitere `:name`-Werte; `:count` wird ergänzt, kann aber
 *                überschrieben werden (etwa mit einer formatierten Zahl).
 */
export const tPlural = (forms: PluralForms, count: number, replace?: Replacements): string => {
    const values: Replacements = { count, ...replace }
    const lines = catalog()

    const variant = lines[pluralVariantKey(forms.other, pluralCategory(count))]
    if (variant) {
        return fill(variant, values)
    }

    const base = pluralCategory(count) === 'one' ? forms.one : forms.other
    const line = lines[base]

    return fill(line || base, values)
}
