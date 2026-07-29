/**
 * Tests fuer den Kategorie-Marker im `about`-Feld (Buzz-Pfad).
 *
 * Lauf:
 *   node --test packages/einundzwanzig-group/js/roomAbout.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAboutMarker, buildAboutMarker, readAboutTag, ABOUT_MARKER_PREFIX } from './roomAbout.ts'

test('liest Kategorie und id aus dem vollstaendigen Marker', () => {
    assert.deepEqual(parseAboutMarker('einundzwanzig:meetup:1234 — Meetup Nuernberg'), {
        kind: 'meetup',
        id: '1234',
    })
})

test('kommt ohne Freitext aus', () => {
    assert.deepEqual(parseAboutMarker('einundzwanzig:proposal:87'), { kind: 'proposal', id: '87' })
})

test('toleriert fehlende id', () => {
    assert.deepEqual(parseAboutMarker('einundzwanzig:meetup'), { kind: 'meetup', id: '' })
})

test('liefert null ohne Praefix — ein unkategorisierter Raum ist kein Fehler', () => {
    assert.equal(parseAboutMarker('Einfach ein Raum'), null)
    assert.equal(parseAboutMarker(''), null)
    assert.equal(parseAboutMarker(null), null)
    assert.equal(parseAboutMarker(undefined), null)
})

test('greift nicht bei einem Praefix mitten im Text', () => {
    // Sonst wuerde ein Raum, der den Marker nur ERWAEHNT, faelschlich kategorisiert.
    assert.equal(parseAboutMarker('Siehe einundzwanzig:meetup:1234'), null)
})

test('id darf Sonderzeichen und weitere Doppelpunkte enthalten', () => {
    assert.deepEqual(parseAboutMarker('einundzwanzig:meetup:a:b:c — x'), { kind: 'meetup', id: 'a:b:c' })
})

test('build und parse sind zueinander invers', () => {
    for (const [kind, id, text] of [
        ['meetup', '1234', 'Meetup Nuernberg'],
        ['proposal', '87', ''],
        ['meetup', '9', 'Mit — Gedankenstrich im Text'],
    ] as [string, string, string][]) {
        const about = buildAboutMarker(kind, id, text)
        assert.deepEqual(parseAboutMarker(about), { kind, id }, about)
    }
})

test('buildAboutMarker trifft exakt das Format des Sync-Skripts', () => {
    // scripts/sync-meetup-rooms.sh schreibt: about=einundzwanzig:meetup:$ID — $NAME
    assert.equal(buildAboutMarker('meetup', '1234', 'Meetup Nuernberg'), 'einundzwanzig:meetup:1234 — Meetup Nuernberg')
    assert.equal(ABOUT_MARKER_PREFIX, 'einundzwanzig:')
})

test('readAboutTag hebt den about-Wert aus den Roh-Tags', () => {
    const tags = [
        ['d', 'b68f6543-44dc-51b6-8659-958e5424134b'],
        ['name', 'Meetup Nuernberg'],
        ['about', 'einundzwanzig:meetup:1234 — Meetup Nuernberg'],
        ['public'],
        ['closed'],
        ['t', 'stream'],
    ]
    assert.equal(readAboutTag(tags), 'einundzwanzig:meetup:1234 — Meetup Nuernberg')
    assert.equal(readAboutTag([['name', 'x']]), '')
})
