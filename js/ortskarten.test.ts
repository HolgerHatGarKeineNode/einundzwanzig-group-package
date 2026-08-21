/**
 * Pure-Tests der Ortskarten-Regeln (P5).
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/ortskarten.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ORTSKARTEN_DROSSEL_MS, ORTSKARTEN_NACHLADE_MS, zeigeLive } from './ortskarten.ts'

test('zeigeLive nimmt nur eine Zahl GRÖSSER null an', () => {
    assert.equal(zeigeLive(1), true)
    assert.equal(zeigeLive(104), true)
})

test('null, undefined und 0 lassen die statische Zeile stehen', () => {
    // Die tragende Zusage der Phase: „ohne Antwort bleibt die statische Zeile stehen".
    // `null` = noch nichts geladen, `0` = geladen und nichts zu berichten — für die
    // Unterzeile derselbe Fall.
    assert.equal(zeigeLive(null), false)
    assert.equal(zeigeLive(undefined), false)
    assert.equal(zeigeLive(0), false)
})

test('kaputte Zahlen zählen als „nichts" und nicht als Wert', () => {
    // `NaN` entsteht aus einer Summe über einen Store, den es noch nicht gibt
    // (`$store.unread?.roomsTotal + …` ist `NaN`, sobald eine Hälfte fehlt). Ohne diesen
    // Zweig stünde „NaN ungelesen" in der Leiste — und `NaN > 0` ist zwar `false`, aber
    // `Infinity > 0` ist `true`, und das wäre eine unendlich große Ungelesen-Zahl.
    assert.equal(zeigeLive(Number.NaN), false)
    assert.equal(zeigeLive(Number.POSITIVE_INFINITY), false)
    assert.equal(zeigeLive(-3), false)
})

test('die beiden Zeitkonstanten stehen WÖRTLICH da', () => {
    // Gegen Literale, nicht gegen sich selbst: beide Zahlen sind Entscheidungen (die
    // Leiste darf nicht mit dem Erstaufbau konkurrieren, und ihre Zeilen dürfen nicht
    // flimmern), und eine Mutation muss diesen Test rot machen.
    assert.equal(ORTSKARTEN_NACHLADE_MS, 1500)
    assert.equal(ORTSKARTEN_DROSSEL_MS, 500)

    // Und die Beziehung, die den Entwurf trägt: erst laden, dann drosseln — die
    // Drosselung darf nie länger sein als die Wartezeit davor, sonst wäre die erste
    // sichtbare Zahl später als der zweite Emit.
    assert.ok(ORTSKARTEN_DROSSEL_MS < ORTSKARTEN_NACHLADE_MS)
})
