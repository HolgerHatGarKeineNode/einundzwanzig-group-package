/**
 * **The device gate sends a guest to the login only where the server would.**
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/mobileGate.test.ts
 *
 * Until 2026-09-22 `session.ts applyMobileAuthGate` redirected every guest page to
 * `/nostr-login`, Start included. The routes that need a key are the ones behind
 * `nostr.auth` in `routes/group.php`; the package layout marks them, and this function
 * turns that mark into the decision.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mobileGateTarget } from './auth-gate.ts'

test('a guest on an open page (Start, articles, meetups, courses) stays', () => {
    assert.equal(mobileGateTarget(false, false, '/start'), null)
    assert.equal(mobileGateTarget(false, false, '/bereich/meetups', '?ansicht=termine'), null)
})

test('a guest on a page behind nostr.auth goes to the login, and comes back afterwards', () => {
    assert.equal(mobileGateTarget(false, true, '/bereich/wallet'), '/nostr-login?return=%2Fbereich%2Fwallet')
    assert.equal(mobileGateTarget(false, true, '/rooms/abc', '?c=1'), '/nostr-login?return=%2Frooms%2Fabc%3Fc%3D1')
})

test('a signed-in reader is never sent anywhere', () => {
    assert.equal(mobileGateTarget(true, true, '/bereich/wallet'), null)
    assert.equal(mobileGateTarget(true, false, '/start'), null)
})

test('the login page itself does not loop', () => {
    assert.equal(mobileGateTarget(false, true, '/nostr-login'), null)
})
