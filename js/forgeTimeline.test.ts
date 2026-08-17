/**
 * Die Tages-Gruppierung der Forge-Zeitleiste — geprüft wird das, was sie zu einer
 * Lüge machen würde:
 *
 *   1. **Die Tagesgrenze ist der KALENDER, nicht 24 h.** Um 00:05 gehört ein
 *      Ereignis von 23:55 unter „Gestern", obwohl es zehn Minuten her ist. Ein
 *      gleitendes Fenster sähe im Test wie ein Detail aus und in der App wie ein
 *      Fehler — die Überschrift widerspräche dem Tagestrenner im Chat-Verlauf,
 *      der dieselbe Rechnung macht.
 *   2. **Leere Buckets erscheinen nicht.** Ein Trenner „GESTERN" ohne Zeile ist
 *      eine Behauptung über einen Bestand, den es nicht gibt.
 *   3. **Die Zuordnung darf nicht kippen.** Der `INVERSIONS-WÄCHTER` unten fällt,
 *      sobald jüngste und älteste Zeile die Buckets tauschen — die Art Fehler,
 *      die eine sortierte Liste optisch unauffällig lässt.
 *   4. **Der Repo-Name wird nur unterdrückt, wo er wirklich redundant ist** —
 *      und über eine Trenner-Überschrift hinweg nie.
 *   5. **Die Bucket-Sprache ist DIESELBE wie auf `/updates`.** Verglichen wird
 *      gegen die dortige Quelle, nicht gegen eine Kopie der Wörter.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeTimeline.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    TIMELINE_BUCKET_SEQUENCE,
    groupTimeline,
    timelineBucket,
    timelineBucketLabels,
    timelineFullLabel,
    timelineTimeLabel,
    type TimelineEntry,
} from './forgeTimeline.ts'
import { BUCKET_LABELS, BUCKET_SEQUENCE } from './updatesView.ts'

/** Lokale Unix-Sekunde — bewusst über den lokalen Date-Konstruktor, nicht über UTC. */
const at = (y: number, m: number, d: number, h = 12, min = 0): number =>
    Math.floor(new Date(y, m - 1, d, h, min, 0, 0).getTime() / 1000)

const entry = (id: string, createdAt: number, repoName = 'verein'): TimelineEntry => ({
    id,
    createdAt,
    repoName,
})

const HOUR = 3_600
const DAY = 86_400

// ── Kalendergrenzen ─────────────────────────────────────────────────────────

test('Mitternacht: 23:55 ist um 00:05 „Gestern", nicht „Heute"', () => {
    const now = at(2026, 8, 17, 0, 5)
    const kurzVorher = at(2026, 8, 16, 23, 55)

    assert.equal(now - kurzVorher, 10 * 60, 'Vorbedingung: die zehn Minuten stimmen')
    assert.equal(timelineBucket(kurzVorher, now), 'yesterday')
    // Die Gegenprobe zum 24-h-Fenster: 23 Stunden ALT, aber derselbe Kalendertag
    // → „Heute". Ein gleitendes Fenster ordnete beide Fälle genau andersherum ein.
    assert.equal(timelineBucket(at(2026, 8, 17, 0, 30), at(2026, 8, 17, 23, 30)), 'today')
})

test('Mitternacht: 00:05 desselben Tages ist „Heute", auch 23 Stunden später', () => {
    const now = at(2026, 8, 17, 23, 30)

    assert.equal(timelineBucket(at(2026, 8, 17, 0, 5), now), 'today')
})

test('Zukunft (autorgesetztes created_at) fällt auf „Heute", nicht auf einen Bucket „Morgen"', () => {
    const now = at(2026, 8, 17, 12)

    assert.equal(timelineBucket(now + 900, now), 'today')
    assert.equal(timelineBucket(at(2026, 9, 1, 12), now), 'today')
})

test('Wochengrenze: 2–6 Tage sind „Diese Woche", ab 7 Tagen „Älter"', () => {
    const now = at(2026, 8, 17, 12)

    assert.equal(timelineBucket(at(2026, 8, 15, 12), now), 'week', '2 Tage')
    assert.equal(timelineBucket(at(2026, 8, 11, 12), now), 'week', '6 Tage')
    assert.equal(timelineBucket(at(2026, 8, 10, 12), now), 'older', '7 Tage')
    assert.equal(timelineBucket(at(2026, 8, 10, 23, 59), now), 'older', '7 Kalendertage trotz 6d12h')
})

test('Wochengrenze zählt KALENDERTAGE: 6d 23h über eine Tagesgrenze sind schon „Älter"', () => {
    const now = at(2026, 8, 17, 23, 0)

    // Kalendarisch der 10. → sieben Tage → „Älter", obwohl keine 7×24 h vergangen sind.
    assert.equal(now - at(2026, 8, 11, 0, 30), 6 * DAY + 22 * HOUR + 30 * 60)
    assert.equal(timelineBucket(at(2026, 8, 11, 0, 30), now), 'week')
    assert.equal(timelineBucket(at(2026, 8, 10, 0, 30), now), 'older')
})

// ── Gruppierung ─────────────────────────────────────────────────────────────

test('leere Buckets fallen raus, die übrigen stehen in fester Reihenfolge', () => {
    const now = at(2026, 8, 17, 12)
    const groups = groupTimeline(
        [entry('a', at(2026, 8, 17, 9)), entry('b', at(2026, 8, 1, 9))],
        now,
    )

    assert.deepEqual(
        groups.map((group) => group.bucket),
        ['today', 'older'],
        'kein „Gestern" und kein „Diese Woche" ohne Zeile',
    )
})

test('eine leere Eingabe ergibt KEINE Gruppe (und keinen leeren Trenner)', () => {
    assert.deepEqual(groupTimeline([], at(2026, 8, 17, 12)), [])
})

test('die Reihenfolge der Trenner hängt nicht an der Eingabereihenfolge', () => {
    const now = at(2026, 8, 17, 12)
    // Absichtlich verkehrt herum hereingegeben: ältestes zuerst.
    const groups = groupTimeline(
        [
            entry('alt', at(2026, 7, 1, 9)),
            entry('woche', at(2026, 8, 14, 9)),
            entry('gestern', at(2026, 8, 16, 9)),
            entry('heute', at(2026, 8, 17, 9)),
        ],
        now,
    )

    assert.deepEqual(
        groups.map((group) => group.bucket),
        [...TIMELINE_BUCKET_SEQUENCE],
    )
    assert.deepEqual(
        groups.map((group) => group.items.map((item) => item.id)),
        [['heute'], ['gestern'], ['woche'], ['alt']],
    )
})

test('INVERSIONS-WÄCHTER: das jüngste Ereignis steht im ERSTEN Bucket, das älteste im LETZTEN', () => {
    const now = at(2026, 8, 17, 12)
    const groups = groupTimeline(
        [entry('jung', now - 60), entry('alt', at(2026, 6, 1, 12))],
        now,
    )

    assert.equal(groups.length, 2)
    // Beides zusammen fällt, sobald die Zuordnung kippt: die Bucket-Kennung UND
    // die Zeile, die darunter steht.
    assert.equal(groups[0].bucket, 'today')
    assert.deepEqual(groups[0].items.map((item) => item.id), ['jung'])
    assert.equal(groups[1].bucket, 'older')
    assert.deepEqual(groups[1].items.map((item) => item.id), ['alt'])
})

test('innerhalb eines Buckets: neueste zuerst, bei gleicher Sekunde nach id', () => {
    const now = at(2026, 8, 17, 12)
    const sekunde = at(2026, 8, 17, 9)
    const groups = groupTimeline(
        [
            entry('push:b', sekunde),
            entry('frueh', at(2026, 8, 17, 8)),
            entry('push:a', sekunde),
            entry('spaet', at(2026, 8, 17, 11)),
        ],
        now,
    )

    assert.equal(groups.length, 1)
    assert.deepEqual(
        groups[0].items.map((item) => item.id),
        ['spaet', 'push:a', 'push:b', 'frueh'],
    )
})

// ── Repo-Namen ──────────────────────────────────────────────────────────────

test('ohne repoNames trägt keine einzige Zeile einen Repo-Namen (Einzel-Repo-Ansicht)', () => {
    const now = at(2026, 8, 17, 12)
    const groups = groupTimeline([entry('a', now - 60), entry('b', now - 120)], now)

    assert.deepEqual(
        groups.flatMap((group) => group.items.map((item) => item.showRepoName)),
        [false, false],
    )
})

test('mit repoNames nennt nur die erste Zeile eines Laufs ihr Repo', () => {
    const now = at(2026, 8, 17, 12)
    const groups = groupTimeline(
        [
            entry('a', now - 60, 'verein'),
            entry('b', now - 120, 'verein'),
            entry('c', now - 180, 'group'),
            entry('d', now - 240, 'verein'),
        ],
        now,
        { repoNames: true },
    )

    assert.deepEqual(
        groups[0].items.map((item) => [item.id, item.showRepoName]),
        [
            ['a', true],
            ['b', false],
            ['c', true],
            ['d', true],
        ],
    )
})

test('die Unterdrückung läuft NIE über einen Trenner hinweg', () => {
    const now = at(2026, 8, 17, 12)
    const groups = groupTimeline(
        [entry('heute', at(2026, 8, 17, 9), 'verein'), entry('gestern', at(2026, 8, 16, 9), 'verein')],
        now,
        { repoNames: true },
    )

    assert.deepEqual(groups.map((group) => group.bucket), ['today', 'yesterday'])
    assert.equal(groups[0].items[0].showRepoName, true)
    assert.equal(groups[1].items[0].showRepoName, true, 'die erste Zeile nach dem Trenner nennt ihr Repo wieder')
})

test('ein namenloses Repo zeigt nichts an — und unterdrückt den nächsten echten Namen nicht', () => {
    const now = at(2026, 8, 17, 12)
    const groups = groupTimeline(
        [entry('a', now - 60, 'verein'), entry('b', now - 120, ''), entry('c', now - 180, 'verein')],
        now,
        { repoNames: true },
    )

    assert.deepEqual(
        groups[0].items.map((item) => item.showRepoName),
        [true, false, true],
    )
})

test('die Gruppierung baut neue Zeilen — die Eingabe bleibt unangetastet', () => {
    const now = at(2026, 8, 17, 12)
    const input = [entry('a', now - 60)]
    groupTimeline(input, now, { repoNames: true })

    assert.equal('showRepoName' in input[0], false)
})

// ── Beschriftungen ──────────────────────────────────────────────────────────

test('die Bucket-Sprache ist Feld für Feld dieselbe wie auf /updates', () => {
    assert.deepEqual(timelineBucketLabels(), BUCKET_LABELS)
    assert.deepEqual([...TIMELINE_BUCKET_SEQUENCE], [...BUCKET_SEQUENCE])
})

test('die Trenner stehen NORMAL geschrieben im DOM (Versalien macht das Markup)', () => {
    const labels = timelineBucketLabels()

    assert.equal(labels.today, 'Heute')
    assert.equal(labels.week, 'Diese Woche')
    assert.notEqual(labels.today, labels.today.toUpperCase())
})

// ── Zeit-Label ──────────────────────────────────────────────────────────────

test('die Zeile trägt die relative Angabe, solange sie präziser ist als der Kalender', () => {
    const now = at(2026, 8, 17, 12)

    assert.equal(timelineTimeLabel(now - 30, now), 'gerade eben')
    assert.equal(timelineTimeLabel(now + 900, now), 'gerade eben', 'Zukunft wird geklemmt')
    assert.equal(timelineTimeLabel(now - 5 * 60, now), 'vor 5 Min')
    assert.equal(timelineTimeLabel(now - 3 * HOUR, now), 'vor 3 Std')
    assert.equal(timelineTimeLabel(now - 23 * HOUR, now), 'vor 23 Std', 'unter 24 h gewinnt die relative Angabe')
})

test('jenseits von 24 h übernimmt der Kalender: „gestern", dann ein Datum MIT Jahr', () => {
    const now = at(2026, 8, 17, 12)

    assert.equal(timelineTimeLabel(at(2026, 8, 16, 2), now), 'gestern')

    const alt = timelineTimeLabel(at(2024, 3, 4, 2), now)
    assert.match(alt, /2024/, 'ohne Jahr behauptete die Zeile den falschen Zeitraum')
    assert.doesNotMatch(alt, /vor /)
    assert.doesNotMatch(alt, /\d\d:\d\d/, 'die Uhrzeit gehört ins title, nicht in die Zeile')
})

test('das title-Label trägt die volle Angabe inklusive Uhrzeit', () => {
    const full = timelineFullLabel(at(2026, 8, 17, 2, 31))

    assert.match(full, /2026/)
    assert.match(full, /02:31/)
})
