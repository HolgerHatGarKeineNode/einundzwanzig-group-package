/**
 * `parseInviteLink` must not mistake the join page's own address for an invite.
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/inviteLink.test.ts
 *
 * Measured on the emulator (2026-10-25): `/join` opened without `?r=` showed
 * "You've been invited to this Space: 127.0.0.1/join", because the bare-relay fallback
 * accepted the http page URL as a relay.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseInviteLink } from './groups.ts'

test('a web link without r is no invite', () => {
    assert.equal(parseInviteLink('http://127.0.0.1/join'), undefined)
    assert.equal(parseInviteLink('https://group.einundzwanzig.space/join?c=abc'), undefined)
})

test('a web link with r still yields relay and claim', () => {
    assert.deepEqual(parseInviteLink('https://group.einundzwanzig.space/join?r=wss%3A%2F%2Fgroup.einundzwanzig.space&c=abc'), {
        url: 'wss://group.einundzwanzig.space/',
        claim: 'abc',
    })
})

test('a bare relay address still works as a fallback', () => {
    assert.deepEqual(parseInviteLink('wss://group.einundzwanzig.space'), { url: 'wss://group.einundzwanzig.space/', claim: '' })
    assert.deepEqual(parseInviteLink('group.einundzwanzig.space'), { url: 'wss://group.einundzwanzig.space/', claim: '' })
})
