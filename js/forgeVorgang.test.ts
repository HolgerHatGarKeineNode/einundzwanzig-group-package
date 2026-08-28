/**
 * Die Route eines einzelnen Vorgangs — geprüft wird, was einen geteilten Link
 * still ins Leere führen würde:
 *
 *   1. **Müll in der Id fällt auf die unveränderte Basis zurück**, statt als
 *      Adressat eines Relay-Filters oder in einer `querySelector` weitergereicht
 *      zu werden.
 *   2. **Die Id wird kleingeschrieben** — eine Hex-Kennung ist nicht
 *      case-sensitiv, und jede Vergleichsstelle im Haus arbeitet klein.
 *   3. **Die Segmente folgen GitHub** (`issues` Plural, `pulls`).
 *
 * Die Query-Ära (`readVorgang`/`withVorgang`) ist mit P1 (2026-08-27,
 * GitHub-Parität) verabschiedet; ihre Alt-Links deckt der serverseitige
 * Mount-Redirect der Repo-Seite.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeVorgang.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HEX64, segmentForArt, vorgangPath } from './forgeVorgang.ts'

const ID = 'a'.repeat(64)
const BASIS = '/forge/naddr1abc'

test('vorgangPath: Issue erhält das Plural-Segment, klein und angehängt', () => {
    assert.equal(vorgangPath(BASIS, { art: 'issue', id: ID }), `${BASIS}/issues/${ID}`)
})

test('vorgangPath: Pull Request erhält pulls', () => {
    assert.equal(vorgangPath(BASIS, { art: 'pr', id: ID }), `${BASIS}/pulls/${ID}`)
})

test('vorgangPath: Grossbuchstaben werden kleingeschrieben', () => {
    assert.equal(vorgangPath(BASIS, { art: 'issue', id: ID.toUpperCase() }), `${BASIS}/issues/${ID}`)
})

test('vorgangPath: keine Hex64-Id fällt auf die Basis zurück', () => {
    // Dieselbe Whitelist-Haltung wie zuvor am Query-Parameter: „master" ist
    // ein Branch-Name, kein Ziel — eine Adresse, die es nicht gibt, wäre
    // schlimmer als die Liste, die der Aufrufer ohnehin meinte.
    for (const wert of ['', 'bob', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), '../../etc', ` ${ID}`]) {
        assert.equal(vorgangPath(BASIS, { art: 'issue', id: wert }), BASIS, `„${wert}" kam durch`)
    }
})

test('vorgangPath: null fällt auf die Basis zurück', () => {
    assert.equal(vorgangPath(BASIS, null), BASIS)
})

test('segmentForArt: issue→issues, pr→pulls', () => {
    assert.equal(segmentForArt('issue'), 'issues')
    assert.equal(segmentForArt('pr'), 'pulls')
})

test('HEX64: exportierte Whitelist — 64 Kleinstellen, f bis 0', () => {
    assert.equal(HEX64.test(ID), true)
    assert.equal(HEX64.test(ID.toUpperCase()), false)
    assert.equal(HEX64.test('g'.repeat(64)), false)
    assert.equal(HEX64.test('a'.repeat(63)), false)
})
