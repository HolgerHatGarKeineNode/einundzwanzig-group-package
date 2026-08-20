/**
 * **Die Schranke unter dem Formen-Satz.**
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/fixtures/longformBestand.test.ts
 *
 * Der Satz ist die Grundlage mehrerer Tests, unter anderem des P3-Kernbeweises über den
 * Renderer. Ohne diese Datei höhlte ein gutgemeintes Aufräumen — „der 227-kB-Artikel
 * bläht das Repo, den nehmen wir raus" — still zwölf Tests aus: sie liefen weiter, nur
 * über weniger Fälle, und blieben grün. Vorbild: `I18nCatalogGateTest.php`.
 *
 * Die Schranke prüft drei Dinge, und keines davon ist der Inhalt eines Artikels:
 *   1. der Satz ist überhaupt ladbar und nicht leer (sonst misst alles darüber nichts),
 *   2. **jede** der zwölf Formen kommt mindestens einmal vor,
 *   3. jedes Event trifft mindestens eine Form — ein Eintrag, den keine Form beschreibt,
 *      ist entweder Ballast oder ein Hinweis auf eine dreizehnte, ungeschriebene Form.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BESTAND_FORMEN, FORMEN_NAMEN, ladeBestand } from './longformBestand.ts'
import { renderArticleHtml } from '../longform.ts'

test('der Formen-Satz ist ladbar und traegt Events — sonst misst jeder Test darueber nichts', () => {
    const datei = ladeBestand()
    assert.equal(datei.events.length > 0, true)
    // Die Herkunft gehört zur Datei, nicht in ein Gedächtnis: ohne den Befehl weiß der
    // Nächste nicht, wie er sie neu zieht.
    assert.match(datei.befehl, /^nak req -k 30023 /)
    assert.match(datei.stand, /^\d{4}-\d{2}-\d{2}$/)
})

test('FORMEN_NAMEN traegt WOERTLICH dreizehn Formen, in der Reihenfolge des Plans', () => {
    // Literale, kein Symbolvergleich: eine Form, die aus BESTAND_FORMEN verschwindet,
    // muss hier auffallen und nicht in einer Schleife über sich selbst untergehen.
    assert.deepEqual([...FORMEN_NAMEN], [
        'ohne-ueberschrift',
        'h2-mindestens-3',
        'yaml-frontmatter',
        'br-im-text',
        'br-im-attributwert',
        'base64-riese',
        'podcast-episode',
        'mit-t-tags',
        'ohne-summary',
        'ohne-image',
        'ohne-d',
        'd-draft-praefix',
        'ohne-published-at',
    ])
    assert.equal(FORMEN_NAMEN.length, 13)
})

test('JEDE der dreizehn Formen kommt im Satz mindestens einmal vor', () => {
    const { events } = ladeBestand()
    const fehlend = FORMEN_NAMEN.filter((name) => !events.some((event) => BESTAND_FORMEN[name]!(event)))
    assert.deepEqual(fehlend, [], `Diese Formen hat der Satz nicht mehr: ${fehlend.join(', ')}`)
})

test('jedes Event trifft mindestens eine Form — kein Ballast, keine vierzehnte Form', () => {
    const { events } = ladeBestand()
    const ohneForm = events
        .filter((event) => !FORMEN_NAMEN.some((name) => BESTAND_FORMEN[name]!(event)))
        .map((event) => event.id)
    assert.deepEqual(ohneForm, [], `Diese Events gehören zu keiner Form: ${ohneForm.join(', ')}`)
})

test('alle Events sind kind 30023 — ein 30024 (Entwurf) gehoert nicht in den Satz', () => {
    const { events } = ladeBestand()
    // Die Kind-Zahl ist die einzige gültige Unterscheidung zwischen publiziert und
    // Entwurf; `d = draft-<ts>` ist es ausdrücklich NICHT (72 der 104 tragen es).
    assert.deepEqual([...new Set(events.map((event) => event.kind))], [30023])
})

test('die synthetischen Events sind namentlich benannt und die einzigen ohne `sig`', () => {
    const { events, synthetisch } = ladeBestand()
    assert.equal(synthetisch.length, 2)
    const ohneSig = events.filter((event) => event.sig === '').map((event) => event.id)
    // Beide Richtungen: kein echtes Event darf seine `sig` verlieren, und ein
    // synthetisches darf keine bekommen — sonst wäre nicht mehr zu sehen, welche es sind.
    assert.deepEqual([...ohneSig].sort(), [...synthetisch].sort())
})

test('die beiden Formen mit 0 Vorkommen im Bestand haengen an GENAU einem synthetischen Event', () => {
    const { events, synthetisch } = ladeBestand()
    // Der Grund steht im Modulkopf: beide Formen haben im echten Bestand 0 von 104
    // Vorkommen. Fände sich hier ein zweiter Träger, käme er aus einem Neubau, der die
    // Herkunft nicht mehr trennt — genau das, wovor der Dateikopf warnt.
    for (const form of ['ohne-d', 'br-im-attributwert'] as const) {
        const treffer = events.filter(BESTAND_FORMEN[form]!).map((event) => event.id)
        assert.equal(treffer.length, 1, `Form ${form}: ${treffer.length} Träger statt einem`)
        assert.equal(synthetisch.includes(treffer[0]!), true, `Form ${form}: Träger ist nicht als synthetisch benannt`)
    }
})

test('das `br-im-attributwert`-Event erzeugt WIRKLICH ein rohes < im Attributwert', () => {
    // Die Form ist nur so viel wert wie ihre Wirkung: ohne diesen Schritt stünde im Satz
    // ein Event, das die gefährliche Lage bloß im Quelltext andeutet. Geprüft wird an der
    // gerenderten Ausgabe — dort, wo die Sonde blind war.
    const { events, synthetisch } = ladeBestand()
    const event = events.find((e) => BESTAND_FORMEN['br-im-attributwert']!(e))!
    assert.equal(synthetisch.includes(event.id), true)
    const html = renderArticleHtml(event.content, (url) => `/img/full?src=${encodeURIComponent(url)}`)
    assert.match(html, /alt="[^"]*<br>/, 'Kein rohes <br> im alt-Attribut — die Form misst ihre Lage nicht mehr.')
    assert.match(html, /title="[^"]*<br>/, 'Kein rohes <br> im title-Attribut.')
})
