/**
 * Die Eigentümer-Ableitung aus der 39002 — der einzige Grund, aus dem die Oberfläche
 * „Löschen" an einem Raum noch anbietet.
 *
 * Alle Formen unten sind am laufenden Relay gemessen (2026-07-29); die Begründung steht
 * im Modulkopf von `roomRoles.ts`. Ein Griff auf den falschen Index gäbe entweder gar
 * keine oder — schlimmer — die falschen Eigentümer.
 *
 * Ausführen: node --test --experimental-strip-types packages/einundzwanzig-group/js/roomRoles.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roleHoldersFromMembersTags } from './roomRoles.ts'

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)

test('Buzz-Form: die Rolle steht auf Index 3', () => {
    const tags = [
        ['d', 'raum-1'],
        ['p', PK_A, '', 'owner'],
        ['p', PK_B, '', 'member'],
    ]
    assert.deepEqual([...roleHoldersFromMembersTags(tags)], [PK_A])
})

test('zooid-Form ohne Rolle: NIEMAND ist Eigentuemer', () => {
    // Der Fall, der die Regel traegt: kein Rollen-Feld ⇒ keine Behauptung, also
    // bietet die Oberflaeche dort gar kein Loeschen an.
    const tags = [['d', 'welcome'], ['p', PK_A], ['p', PK_B]]
    assert.equal(roleHoldersFromMembersTags(tags).size, 0)
})

test('39001-Form (Rolle auf Index 2) zaehlt NICHT als Eigentuemer', () => {
    // Gegenprobe gegen den naheliegenden Fehler „irgendwo steht owner drin". Buzz
    // schreibt die Admin-Liste anders als die Mitgliederliste; diese Funktion
    // beantwortet ausschliesslich die 39002-Frage.
    const tags = [['d', 'raum-1'], ['p', PK_A, 'owner']]
    assert.equal(roleHoldersFromMembersTags(tags).size, 0)
})

test('mehrere Eigentuemer werden alle gefunden, andere Rollen nicht', () => {
    const tags = [
        ['p', PK_A, '', 'owner'],
        ['p', PK_B, '', 'owner'],
        ['p', 'c'.repeat(64), '', 'admin'],
    ]
    assert.deepEqual([...roleHoldersFromMembersTags(tags)].sort(), [PK_A, PK_B].sort())
})

test('die Rolle ist waehlbar, der Default bleibt owner', () => {
    const tags = [['p', PK_A, '', 'admin']]
    assert.deepEqual([...roleHoldersFromMembersTags(tags, 'admin')], [PK_A])
    assert.equal(roleHoldersFromMembersTags(tags).size, 0)
})

test('kaputte Tags kippen die Ableitung nicht', () => {
    // Fremd-Events sind nicht validiert: ein leerer Pubkey darf nicht als Eigentuemer
    // gelten, und ein Rollen-Feld an einem Nicht-p-Tag ebenso wenig.
    const tags = [['p', '', '', 'owner'], ['p'], ['x', PK_A, '', 'owner']]
    assert.equal(roleHoldersFromMembersTags(tags).size, 0)
})
