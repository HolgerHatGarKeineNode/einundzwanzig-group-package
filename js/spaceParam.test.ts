/**
 * Pure-Tests für die Space-Markierung an Raum-URLs (welshman-/Alpine-frei).
 *   node --test packages/einundzwanzig-group/js/spaceParam.test.ts
 *
 * Der Parameter hat GENAU zwei Pflichten, und beide hängen an einem realen Fehler:
 *   1. Er MUSS einen Workspace-Raum über einen Reload hinweg dem Workspace zuordnen —
 *      ohne ihn ging der Beitritt ans Vereins-Relay (`invalid: group not found`).
 *   2. Er DARF nichts anderes annehmen als den einen bekannten Wert: ein Link soll
 *      den Client nicht auf ein beliebiges Relay zeigen können.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSpaceParam, withSpace, workspaceRoomHref, SPACE_WORKSPACE } from './spaceParam.ts'

test('readSpaceParam nimmt den bekannten Wert an', () => {
    assert.equal(readSpaceParam('?space=workspace'), SPACE_WORKSPACE)
    assert.equal(readSpaceParam('?from=updates&space=workspace'), SPACE_WORKSPACE)
})

test('readSpaceParam verwirft alles andere — auch eine untergeschobene Relay-URL', () => {
    assert.equal(readSpaceParam(''), null)
    assert.equal(readSpaceParam('?from=updates'), null)
    assert.equal(readSpaceParam('?space='), null)
    assert.equal(readSpaceParam('?space=wss://evil.tld/'), null)
    assert.equal(readSpaceParam('?space=Workspace'), null)
})

test('withSpace reicht eine gültige Markierung an das neue Ziel weiter', () => {
    assert.equal(withSpace('/rooms/abc', '?space=workspace'), '/rooms/abc?space=workspace')
    assert.equal(
        withSpace('/rooms/abc/thread/nevent1x', '?space=workspace'),
        '/rooms/abc/thread/nevent1x?space=workspace',
    )
    // Ein bestehender Parameter am Ziel bleibt erhalten (`&` statt `?`).
    assert.equal(withSpace('/rooms/abc?from=updates', '?space=workspace'), '/rooms/abc?from=updates&space=workspace')
})

test('withSpace lässt ohne Markierung und bei doppelter Markierung alles, wie es ist', () => {
    assert.equal(withSpace('/rooms/abc', ''), '/rooms/abc')
    assert.equal(withSpace('/rooms/abc', '?from=updates'), '/rooms/abc')
    assert.equal(withSpace('/rooms/abc?space=workspace', '?space=workspace'), '/rooms/abc?space=workspace')
})

test('workspaceRoomHref markiert den Raum und kodiert die Raum-ID', () => {
    assert.equal(workspaceRoomHref('9d0f9704-4fe6-5e7b-b56b-3b534af74aff'), '/rooms/9d0f9704-4fe6-5e7b-b56b-3b534af74aff?space=workspace')
    assert.equal(workspaceRoomHref('a b/c'), '/rooms/a%20b%2Fc?space=workspace')
    // Der Rückweg: was gesetzt wurde, wird auch wieder gelesen.
    assert.equal(readSpaceParam(workspaceRoomHref('abc').split('?')[1]), SPACE_WORKSPACE)
})
