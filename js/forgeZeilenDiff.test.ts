/**
 * Der ZEILENVERGLEICH (P7b) — die Hälfte des Diffs, die ein kind 1618 nicht
 * mitbringt.
 *
 * Ein Patch (1617) trägt seinen Diff als Text; ein Pull Request (1618) trägt nur
 * zwei Commit-Ids. Was dazwischen liegt, muss dieser Client selbst ausrechnen —
 * und ein selbst gerechneter Diff ist genau dann wertlos, wenn er plausibel
 * aussieht und falsch ist.
 *
 * ── Das Orakel ist git selbst, nicht meine Erwartung ────────────────────────
 *
 * `git diff --no-index --numstat` läuft hier als **Differenzorakel**: dieselben
 * zwei Dateien durch beide Wege, und die +/− Zahlen müssen übereinstimmen. Das
 * ist kein weiches Kriterium — bei Myers ist `D` (Einfügungen plus Löschungen)
 * MINIMAL und damit eindeutig, und `#del − #add = n − m` liegt ohnehin fest.
 * Beide Zahlen sind also für jede korrekte Umsetzung dieselben, egal welchen der
 * gleich langen Pfade sie wählt.
 *
 * Die zweite, von git unabhängige Zusage ist die REKONSTRUKTION: aus den
 * `context`+`del`-Zeilen muss wieder die alte Datei entstehen, aus
 * `context`+`add` die neue. Ein Vergleich, der das nicht erfüllt, zeigt Text,
 * der in keiner der beiden Fassungen stand.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeZeilenDiff.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    HUNK_KONTEXT,
    MYERS_MAX_ZEILEN,
    vergleicheZeilen,
    zuHunks,
    zuZeilen,
    type DiffLine,
} from './forgeDiff.ts'

const alteSeite = (lines: readonly DiffLine[]): string[] =>
    lines.filter((z) => z.kind === 'context' || z.kind === 'del').map((z) => z.text)

const neueSeite = (lines: readonly DiffLine[]): string[] =>
    lines.filter((z) => z.kind === 'context' || z.kind === 'add').map((z) => z.text)

// ── Grundformen ─────────────────────────────────────────────────────────────

test('eine geänderte Zeile ist eine Löschung und eine Einfügung', () => {
    const v = vergleicheZeilen('eins\nzwei\ndrei\n', 'eins\nZWEI\ndrei\n')
    assert.equal(v.genau, true)
    assert.equal(v.additions, 1)
    assert.equal(v.deletions, 1)
    assert.deepEqual(alteSeite(v.lines), ['eins', 'zwei', 'drei'])
    assert.deepEqual(neueSeite(v.lines), ['eins', 'ZWEI', 'drei'])
})

test('gleiche Dateien ergeben null Änderungen — und keinen Hunk', () => {
    const v = vergleicheZeilen('a\nb\nc\n', 'a\nb\nc\n')
    assert.equal(v.additions, 0)
    assert.equal(v.deletions, 0)
    assert.deepEqual(zuHunks(v.lines), [])
})

test('neue Datei: alles Einfügung, alte Seite leer', () => {
    const v = vergleicheZeilen('', 'a\nb\n')
    assert.equal(v.additions, 2)
    assert.equal(v.deletions, 0)
    assert.deepEqual(alteSeite(v.lines), [])
})

test('gelöschte Datei: alles Löschung, neue Seite leer', () => {
    const v = vergleicheZeilen('a\nb\n', '')
    assert.equal(v.additions, 0)
    assert.equal(v.deletions, 2)
    assert.deepEqual(neueSeite(v.lines), [])
})

/**
 * Der abschließende Zeilenumbruch ist ein TERMINATOR. Wer ihn als Trenner liest,
 * meldet für jede normal geschriebene Datei eine leere Zusatzzeile — und rechnet
 * sie in die +/− Zahlen ein.
 */
test('der abschließende Zeilenumbruch erzeugt keine Geisterzeile', () => {
    assert.deepEqual(zuZeilen('a\nb\n'), ['a', 'b'])
    assert.deepEqual(zuZeilen('a\nb'), ['a', 'b'])
    assert.deepEqual(zuZeilen(''), [])
    assert.deepEqual(zuZeilen('\n'), [''])
    assert.equal(vergleicheZeilen('a\n', 'a\n').lines.length, 1)
})

// ── Hunks ───────────────────────────────────────────────────────────────────

/**
 * **Ohne Hunk-Schnitt ist der 4000-Zeilen-Deckel sofort weg.** Eine geänderte
 * Zeile mitten in einer langen Datei darf nicht die ganze Datei mitbringen.
 */
test('der Hunk trägt nur Kontext um die Änderung, nicht die Datei', () => {
    const alt = Array.from({ length: 200 }, (_, i) => `zeile ${i}`).join('\n') + '\n'
    const neu = alt.replace('zeile 100\n', 'ZEILE 100\n')
    const hunks = zuHunks(vergleicheZeilen(alt, neu).lines)
    // 1 Kopf + 3 Kontext + 1 del + 1 add + 3 Kontext
    assert.equal(hunks.length, 1 + HUNK_KONTEXT * 2 + 2)
    assert.equal(hunks[0]?.kind, 'meta')
    assert.equal(hunks[0]?.text, '@@ -98,7 +98,7 @@')
})

test('zwei weit entfernte Änderungen ergeben zwei Hunks, zwei nahe einen', () => {
    const alt = Array.from({ length: 100 }, (_, i) => `z${i}`).join('\n') + '\n'
    const weit = alt.replace('z10\n', 'Z10\n').replace('z80\n', 'Z80\n')
    const nah = alt.replace('z10\n', 'Z10\n').replace('z12\n', 'Z12\n')
    const koepfe = (text: string): number =>
        zuHunks(vergleicheZeilen(alt, text).lines).filter((z) => z.kind === 'meta').length
    assert.equal(koepfe(weit), 2)
    assert.equal(koepfe(nah), 1)
})

// ── Der Budgetdeckel ────────────────────────────────────────────────────────

/**
 * Der Ausfall muss AUSGEZEICHNET sein. Ein stillschweigend grob gerechneter
 * Vergleich sähe aus wie ein Ergebnis und wäre eine falsche Aussage über die
 * Datei — die Zahlen stimmen dann zwar, die Zuordnung nicht.
 */
test('über der Zeilengrenze degradiert der Vergleich sichtbar', () => {
    const n = MYERS_MAX_ZEILEN
    const alt = Array.from({ length: n }, (_, i) => `a${i}`).join('\n')
    const neu = Array.from({ length: n }, (_, i) => `b${i}`).join('\n')
    const v = vergleicheZeilen(alt, neu)
    assert.equal(v.genau, false)
    assert.equal(v.additions, n)
    assert.equal(v.deletions, n)
})

// ── Das Orakel: git selbst ──────────────────────────────────────────────────

/** `git diff --no-index` — Exit 1 heißt „es gibt Unterschiede", nicht „Fehler". */
const gitZahlen = (alt: string, neu: string): { additions: number; deletions: number } => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-diff-orakel-'))
    try {
        writeFileSync(join(dir, 'alt.txt'), alt)
        writeFileSync(join(dir, 'neu.txt'), neu)
        let out = ''
        try {
            out = execFileSync(
                'git',
                ['diff', '--no-index', '--numstat', '--no-color', 'alt.txt', 'neu.txt'],
                { cwd: dir, encoding: 'utf8' },
            )
        } catch (fehler) {
            out = String((fehler as { stdout?: string }).stdout ?? '')
        }
        if (out.trim() === '') {
            return { additions: 0, deletions: 0 }
        }
        const teile = out.trim().split(/\s+/)

        return { additions: Number(teile[0] ?? 0), deletions: Number(teile[1] ?? 0) }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

/**
 * Deterministischer Zufall: derselbe Fehlschlag ist morgen derselbe Fehlschlag.
 * Ein `Math.random()`-Fall, den man nicht wiederholen kann, ist kein Befund.
 */
const wuerfel = (saat: number): (() => number) => {
    let s = saat >>> 0

    return () => {
        s = (s * 1664525 + 1013904223) >>> 0

        return s / 4294967296
    }
}

test('gegen `git diff --numstat`: 200 zufällige Paare, gleiche +/− Zahlen', () => {
    const rnd = wuerfel(21)
    let mitAenderung = 0
    for (let fall = 0; fall < 200; fall += 1) {
        const n = 1 + Math.floor(rnd() * 40)
        const alt: string[] = []
        for (let i = 0; i < n; i += 1) {
            alt.push(`zeile-${Math.floor(rnd() * 12)}`)
        }
        const neu: string[] = []
        for (const zeile of alt) {
            const w = rnd()
            if (w < 0.15) {
                continue
            }
            if (w < 0.3) {
                neu.push(`neu-${Math.floor(rnd() * 12)}`)
            }
            neu.push(zeile)
        }
        if (rnd() < 0.3) {
            neu.push(`schwanz-${Math.floor(rnd() * 12)}`)
        }
        const altText = alt.join('\n') + '\n'
        const neuText = neu.length === 0 ? '' : neu.join('\n') + '\n'

        const meins = vergleicheZeilen(altText, neuText)
        const gits = gitZahlen(altText, neuText)
        assert.deepEqual(
            { additions: meins.additions, deletions: meins.deletions },
            gits,
            `Fall ${fall}:\n--- alt ---\n${altText}--- neu ---\n${neuText}`,
        )
        // Und die Rekonstruktion, unabhängig von git.
        assert.deepEqual(alteSeite(meins.lines), zuZeilen(altText), `Rekonstruktion alt, Fall ${fall}`)
        assert.deepEqual(neueSeite(meins.lines), zuZeilen(neuText), `Rekonstruktion neu, Fall ${fall}`)
        if (meins.additions + meins.deletions > 0) {
            mitAenderung += 1
        }
    }
    // NEGATIVKONTROLLE: ein Orakel, das überwiegend identische Dateien
    // vergleicht, ist keines. Der Lauf muss echte Änderungen enthalten haben.
    assert.ok(mitAenderung > 150, `nur ${mitAenderung} von 200 Fällen hatten Änderungen`)
})
