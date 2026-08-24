/**
 * Die Sätze der Schreibriegel — **Vollständigkeit, nicht Wortlaut**.
 *
 * `gateTextFrom` (`forge.ts`) fällt bei einem unbekannten Grund stillschweigend
 * auf den `anonymous`-Satz zurück. Ergänzt jemand einen neuen
 * `WriteGateReason` und vergisst die Tabellen, steht danach „Zum Schreiben bitte
 * anmelden." unter einem Knopf, der aus einem völlig anderen Grund zu ist — und
 * zwar bei einem angemeldeten Nutzer. Ein Riegel, der den falschen Grund nennt,
 * ist schlimmer als einer, der schweigt: er schickt den Leser weg.
 *
 * Geprüft wird deshalb, dass jeder Grund, den der jeweilige Riegel WIRKLICH
 * liefern kann, einen eigenen Satz hat — und dass der `anonymous`-Fall einen
 * hat, der auf der Fläche auch erscheint. Den gibt es: `EnsureNostrAuth` lässt
 * den Mobile-Pfad ungeprüft durch, und `viewer` kommt aus der Insel, nicht aus
 * der Laravel-Sitzung.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeRiegelTexte.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ASSIGN_GATE_TEXTS, REVIEW_GATE_TEXTS } from './forgeNameGuardHost.ts'
import { approveGate, assignGate } from './forgeWriteModels.ts'

const OWNER = 'a'.repeat(64)
const AUTHOR = 'b'.repeat(64)
const STRANGER = 'c'.repeat(64)
const REVIEWER = 'e'.repeat(64)
const COMMIT = '1'.repeat(40)
const ADDRESS = `30617:${OWNER}:mein-repo`
const ISSUE = { author: AUTHOR, repoAddress: ADDRESS }
const PR = { author: AUTHOR, repoAddress: ADDRESS, reviewers: [REVIEWER], commit: COMMIT, status: 'open' }

/**
 * Die Gründe werden nicht aufgezählt, sondern aus dem Riegel selbst GEHOLT.
 * Eine Liste von Hand wäre eine zweite Wahrheit — sie bliebe grün, während der
 * Riegel einen neuen Grund liefert, für den es keinen Satz gibt.
 */
const assignGruende = [
    assignGate('', ISSUE, [STRANGER]).reason,
    assignGate(STRANGER, ISSUE, [REVIEWER]).reason,
    assignGate(AUTHOR, ISSUE, []).reason,
]

const reviewGruende = [
    approveGate('', PR).reason,
    approveGate(STRANGER, PR).reason,
    approveGate(REVIEWER, { ...PR, commit: '' }).reason,
    approveGate(REVIEWER, { ...PR, status: 'merged' }).reason,
]

test('jeder Grund, den der Zuweisungs-Riegel liefert, hat einen eigenen Satz', () => {
    for (const grund of assignGruende) {
        assert.notEqual(grund, 'ok', 'diese Fälle müssen gesperrt sein — sonst misst der Test nichts')
        assert.ok(ASSIGN_GATE_TEXTS[grund], `kein Satz für „${grund}"`)
    }
    // Und die Sätze sind verschieden: ein Rückfall auf `anonymous` sähe sonst
    // aus wie eine Antwort.
    const saetze = assignGruende.map((g) => ASSIGN_GATE_TEXTS[g])
    assert.equal(new Set(saetze).size, new Set(assignGruende).size)
})

test('jeder Grund, den der Freigabe-Riegel liefert, hat einen eigenen Satz', () => {
    for (const grund of reviewGruende) {
        assert.notEqual(grund, 'ok')
        assert.ok(REVIEW_GATE_TEXTS[grund], `kein Satz für „${grund}"`)
    }
    const saetze = reviewGruende.map((g) => REVIEW_GATE_TEXTS[g])
    assert.equal(new Set(saetze).size, new Set(reviewGruende).size)
})

/**
 * Der `anonymous`-Fall ist auf dieser Fläche ERREICHBAR — anders als eine
 * frühere Annahme im E2E-Prüfstand behauptete. Er braucht deshalb einen Satz,
 * der etwas sagt, nicht bloß einen Eintrag.
 */
test('der anonyme Fall trägt in beiden Riegeln einen Satz, den die Fläche zeigen kann', () => {
    assert.equal(assignGate('', ISSUE, [STRANGER]).reason, 'anonymous')
    assert.equal(approveGate('', PR).reason, 'anonymous')
    assert.ok(ASSIGN_GATE_TEXTS.anonymous.length > 10)
    assert.ok(REVIEW_GATE_TEXTS.anonymous.length > 10)
})
