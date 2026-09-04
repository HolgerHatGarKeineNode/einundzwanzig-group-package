/**
 * Pure tests for the room-navigation rule (no welshman, no Alpine, no browser):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/roomNavModel.test.ts
 *
 * The rule has exactly two duties, and both are a real failure that has been paid for:
 *   1. A WORKSPACE room must carry `?space=workspace`. Without it `/rooms/{h}` loads
 *      against the home relay, which does not know the channel: empty history, and a
 *      join answered with `invalid: group not found`.
 *   2. Coming back from a workspace room into a HOME room must CLEAR the ephemeral
 *      space. `/rooms/{h}` sets nothing on mount, and `clearEphemeralSpace()` otherwise
 *      only runs on `/spaces` — the same failure, mirrored.
 *
 * The second one is the reason this file exists at all: it is invisible in the href and
 * lives entirely in the `switch`. A test that only compared addresses would be green
 * while the client sat on the wrong relay.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planRoomNavigation } from './roomNavModel.ts'
import { SPACE_PARAM, SPACE_WORKSPACE, readSpaceParam } from './spaceParam.ts'

test('a workspace room carries the marker and switches the space', () => {
    const plan = planRoomNavigation('abc', true, false)

    assert.equal(plan.href, '/rooms/abc?space=workspace')
    assert.equal(plan.switch, 'workspace')
    // Against the READER, not against a second string literal: the marker is only worth
    // anything if `readSpaceParam` takes it back.
    assert.equal(readSpaceParam(plan.href.slice(plan.href.indexOf('?'))), SPACE_WORKSPACE)
})

test('a workspace room switches even when the client already sits in the workspace', () => {
    // `inEphemeralSpace` says nothing about WHICH ephemeral space — re-setting is the
    // only answer that is right in both cases.
    assert.equal(planRoomNavigation('abc', true, true).switch, 'workspace')
})

test('a home room clears the ephemeral space — but only when there is one', () => {
    assert.deepEqual(planRoomNavigation('abc', false, true), { href: '/rooms/abc', switch: 'home' })
    assert.deepEqual(planRoomNavigation('abc', false, false), { href: '/rooms/abc', switch: 'none' })
})

test('a home room never carries the marker', () => {
    for (const inEphemeral of [true, false]) {
        const { href } = planRoomNavigation('abc', false, inEphemeral)
        assert.equal(href.includes(SPACE_PARAM), false, String(inEphemeral))
    }
})

test('the h tag is encoded, not pasted', () => {
    // A Buzz `h` is relay-assigned and this client never validated its alphabet. A `?`
    // or `#` in it would otherwise cut the address in half.
    assert.equal(planRoomNavigation('a b?c#d', false, false).href, '/rooms/a%20b%3Fc%23d')
    assert.equal(planRoomNavigation('a b?c#d', true, false).href, '/rooms/a%20b%3Fc%23d?space=workspace')
})

test('no h is no navigation — and no space mutation either', () => {
    // The empty case has its own answer: `navigateTo('')` returns early, but a `switch`
    // of `'workspace'` would still have moved the client to another relay for a click
    // that opens nothing.
    assert.deepEqual(planRoomNavigation('', true, true), { href: '', switch: 'none' })
    assert.deepEqual(planRoomNavigation('', false, true), { href: '', switch: 'none' })
})

test('CONTROL: the assertions above can fail', () => {
    // Negative control for the two duties, so a rule that silently stopped deciding
    // anything cannot pass this file. Both branches must differ from each other.
    const workspace = planRoomNavigation('x', true, false)
    const home = planRoomNavigation('x', false, false)

    assert.notEqual(workspace.href, home.href)
    assert.notEqual(workspace.switch, home.switch)
    assert.notEqual(planRoomNavigation('x', false, true).switch, planRoomNavigation('x', false, false).switch)
})
