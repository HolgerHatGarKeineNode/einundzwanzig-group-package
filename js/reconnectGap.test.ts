/**
 * node --test packages/einundzwanzig-group/js/reconnectGap.test.ts
 *
 * Grenzfälle der Mindestpause: niemals abgerissen (0), knapp darunter, exakt an
 * der Grenze und deutlich darüber. Ein Vorzeichenfehler (`<=` statt `>=`, oder
 * die Operanden vertauscht) macht mindestens einen dieser vier Fälle rot.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconnectDue } from './reconnectGap.ts'

const MIN_GAP = 60_000

test('noch nie abgerissen (lastReconnectAt = 0): sofort fällig', () => {
    // Ein plausibler Epoch-Zeitstempel — `lastReconnectAt = 0` liegt so weit in
    // der Vergangenheit, dass jede reale Mindestpause längst verstrichen ist.
    assert.equal(reconnectDue(Date.now(), 0, MIN_GAP), true)
})

test('knapp unterhalb der Mindestpause: NICHT fällig', () => {
    const now = 1_000_000
    assert.equal(reconnectDue(now, now - (MIN_GAP - 1), MIN_GAP), false)
})

test('exakt an der Grenze: fällig (>=, nicht >)', () => {
    const now = 1_000_000
    assert.equal(reconnectDue(now, now - MIN_GAP, MIN_GAP), true)
})

test('deutlich über der Mindestpause: fällig', () => {
    const now = 1_000_000
    assert.equal(reconnectDue(now, now - MIN_GAP - 30_000, MIN_GAP), true)
})

test('gerade erst abgerissen (0 ms her): nicht fällig', () => {
    const now = 1_000_000
    assert.equal(reconnectDue(now, now, MIN_GAP), false)
})
