/**
 * Pure-Tests für die Wahl der Anlege-Bauform (welshman-/Alpine-frei).
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeAnlegen.test.ts
 *
 * Die tragende Zusage ist nicht „Desktop bekommt den Kopfknopf", sondern die
 * AUSSCHLIESSLICHKEIT: über jede Kombination aus Chassis, Reiter und Ladezustand
 * gibt es höchstens eine Form. Ein zweiter sichtbarer Knopf für dieselbe
 * Handlung wäre schlimmer als der Zustand vor dem Umbau.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anlegeForm, ANLEGE_TAB, type AnlegeForm } from './forgeAnlegen.ts'

// WÖRTLICH und nicht aus `FORGE_TABS` gezogen: eine Schleife über die Konstante
// prüfte sie gegen sich selbst und bliebe grün, wenn jemand einen Reiter
// herausnimmt oder hinzufügt.
const REITER = ['issues', 'pulls', 'patches', 'code', 'activity']

test('am Desktop steht der beschriftete Knopf — aber nur über SEINER Liste', () => {
    assert.equal(anlegeForm(true, 'issues', true), 'kopf')
    assert.equal(anlegeForm(true, 'pulls', true), 'keins')
    assert.equal(anlegeForm(true, 'patches', true), 'keins')
    assert.equal(anlegeForm(true, 'code', true), 'keins')
    assert.equal(anlegeForm(true, 'activity', true), 'keins')
})

test('im Mobil-Chassis bleibt der FAB — auf JEDEM Reiter', () => {
    // Der FAB ist auf jedem Reiter erreichbar, weil `toggleIssueDraft` beim
    // Öffnen auf die Issue-Liste schaltet. Fiele diese Zeile weg, legte ein
    // Klick auf dem Code-Reiter ein Issue an, von dem danach nichts zu sehen
    // wäre — die neue Zeile, ein abgelehnter Schreibversuch und die Weckmeldung
    // stehen alle drei in dieser Liste.
    assert.equal(anlegeForm(false, 'issues', true), 'fab')
    assert.equal(anlegeForm(false, 'pulls', true), 'fab')
    assert.equal(anlegeForm(false, 'patches', true), 'fab')
    assert.equal(anlegeForm(false, 'code', true), 'fab')
    assert.equal(anlegeForm(false, 'activity', true), 'fab')
})

test('ohne geladene Ansicht gibt es nichts anzulegen', () => {
    // Der frühere FAB hing an `!!view` — das bleibt so. Ein Knopf über einem
    // Ladeskelett verspricht eine Adresse, die es noch nicht gibt.
    assert.equal(anlegeForm(true, 'issues', false), 'keins')
    assert.equal(anlegeForm(false, 'issues', false), 'keins')
    assert.equal(anlegeForm(false, 'code', false), 'keins')
})

test('über ALLE Kombinationen: nie zwei Formen zugleich', () => {
    // Die Zusage aus dem Auftrag, als Eigenschaft geprüft statt an Beispielen.
    // Sie ist hier per Konstruktion wahr (EIN Rückgabewert) — der Test hält
    // fest, dass sie es bleibt, falls jemand die Funktion je auf ein Paar oder
    // eine Menge umstellt.
    const gesehen = new Set<AnlegeForm>()
    let faelle = 0
    for (const desktop of [true, false]) {
        for (const tab of REITER) {
            for (const geladen of [true, false]) {
                const form = anlegeForm(desktop, tab, geladen)
                assert.ok(
                    form === 'kopf' || form === 'fab' || form === 'keins',
                    `Unbekannte Form ${form} bei desktop=${desktop} tab=${tab} geladen=${geladen}`,
                )
                gesehen.add(form)
                faelle += 1
            }
        }
    }
    assert.equal(faelle, 2 * REITER.length * 2)
    // NEGATIVKONTROLLE: der Durchlauf muss alle drei Ausgänge wirklich getroffen
    // haben. Ohne diese Zeile wäre der Test auch dann grün, wenn die Funktion
    // stumpf immer `keins` lieferte — also bei genau der Regression, die den
    // Knopf ganz verschwinden lässt.
    assert.deepEqual([...gesehen].sort(), ['fab', 'keins', 'kopf'])
})

test('der Reiter des Kopfknopfes ist die Issue-Liste', () => {
    assert.equal(ANLEGE_TAB, 'issues')
})
