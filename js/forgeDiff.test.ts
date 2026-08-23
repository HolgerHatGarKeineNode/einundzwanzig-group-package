/**
 * Der Unified-Diff-Leser — geprüft wird das, was ihn zu einer Lüge machen würde.
 *
 *   1. **Die Signatur von `git format-patch` ist keine Löschzeile.** Jeder Patch
 *      endet mit `--` und der Git-Version. Ein Leser, der den Hunk „bis zum
 *      nächsten `diff --git`" konsumiert, zeigt eine Löschung, die im Patch
 *      nicht steht. Der `SIGNATUR-WÄCHTER` unten fällt genau dann.
 *   2. **Der Betreff darf umbrechen.** `Subject:` ist ein RFC-5322-Header, und
 *      `git format-patch` faltet ihn ab ~78 Zeichen — also bei jedem längeren
 *      Betreff. Wer nur die erste Zeile nimmt, schneidet mitten im Wort ab und
 *      merkt es nie, weil kurze Betreffs (die man beim Testen tippt) nie falten.
 *   3. **Ein `Subject:` IM GEÄNDERTEN CODE ist nicht der Titel des Patches.**
 *   4. **Zeilennummern müssen mitlaufen**, sonst zeigt der Leser zwar den
 *      richtigen Text an der falschen Stelle.
 *
 * ── Die Vorlage ist ECHT ────────────────────────────────────────────────────
 *
 * {@link ECHTER_PATCH} ist wörtlich die Ausgabe von `git format-patch -1
 * --stdout` aus einem eigens angelegten Repo (git 2.55.0, 2026-08-23) — mit
 * absichtlich überlangem Betreff, damit die Faltung wirklich eintritt, und mit
 * allen drei Änderungsarten (ändern, anlegen, löschen). Ein von Hand getippter
 * „Patch" hätte genau die zwei Fallen nicht enthalten, gegen die dieses Modul
 * geschrieben ist: er hätte keine Signatur und keinen gefalteten Header.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeDiff.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DIFF_LINE_LIMIT, diffStat, parseUnifiedDiff, patchBody, patchSubject } from './forgeDiff.ts'

/**
 * Die Signatur, die `git format-patch` an jeden Patch hängt.
 *
 * **Als Konstante und nicht im Textblock**, weil die erste Zeile auf ein
 * `-- ` MIT abschliessendem Leerzeichen endet (byte-geprüft: `cat -A` zeigt
 * `-- $`). Steht sie im Quelltext, frisst sie der nächste Formatierer oder
 * Editor, der Zeilenenden putzt — und die Vorlage prüft dann lautlos einen
 * anderen Fall als den echten. Genau das ist beim ersten Wurf passiert.
 */
const SIGNATUR = '--' + ' \n2.55.0\n'

const ECHTER_PATCH = `From 0f045fdca6168c4866121bb40cd27a8888c6ab9f Mon Sep 17 00:00:00 2001
From: Test <t@e.st>
Date: Sun, 23 Aug 2026 22:14:02 +0200
Subject: [PATCH] Ein absichtlich sehr langer Betreff der garantiert ueber die
 Faltgrenze von achtundsiebzig Zeichen hinauslaeuft

---
 a.txt   | 2 +-
 neu.txt | 1 +
 weg.txt | 1 -
 3 files changed, 2 insertions(+), 2 deletions(-)
 create mode 100644 neu.txt
 delete mode 100644 weg.txt

diff --git a/a.txt b/a.txt
index f00189a..8686969 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 eins
-zwei
+ZWEI
 drei
diff --git a/neu.txt b/neu.txt
new file mode 100644
index 0000000..4879932
--- /dev/null
+++ b/neu.txt
@@ -0,0 +1 @@
+neu
diff --git a/weg.txt b/weg.txt
deleted file mode 100644
index f0d0f63..0000000
--- a/weg.txt
+++ /dev/null
@@ -1 +0,0 @@
-alt
` + SIGNATUR

// ── Vorbedingung: ohne sie prüfen die Tests darunter nichts ─────────────────

test('VORBEDINGUNG: die Vorlage enthält wirklich Faltung UND Signatur', () => {
    // Fiele diese Zusage, wären „Signatur nicht mitgezählt" und „Betreff
    // entfaltet" beide grün, ohne je den Fall berührt zu haben. Genau so
    // entsteht ein Prüfstand, der nichts prüft.
    assert.ok(
        ECHTER_PATCH.includes('\n Faltgrenze von'),
        'Die Vorlage hat keine Fortsetzungszeile — der Faltungstest liefe ins Leere.',
    )
    assert.ok(
        /\n-- \n2\.55\.0/.test(ECHTER_PATCH),
        'Die Vorlage hat keine format-patch-Signatur — der Signaturtest liefe ins Leere.',
    )
})

// ── Betreff ─────────────────────────────────────────────────────────────────

test('der gefaltete Betreff wird zu EINER Zeile zusammengesetzt', () => {
    assert.equal(
        patchSubject(ECHTER_PATCH),
        'Ein absichtlich sehr langer Betreff der garantiert ueber die Faltgrenze von achtundsiebzig Zeichen hinauslaeuft',
    )
})

test('KONTROLLE: die erste Header-Zeile allein wäre abgeschnitten', () => {
    // Der Gegenbeweis zur Zusage darüber: nähme der Leser nur die erste Zeile,
    // käme genau dieser Torso heraus. Der Test hält fest, dass die Zusage einen
    // Unterschied macht — und fiele, wenn jemand die Faltung wieder ausbaut.
    const torso = 'Ein absichtlich sehr langer Betreff der garantiert ueber die'
    assert.notEqual(patchSubject(ECHTER_PATCH), torso)
    assert.ok(patchSubject(ECHTER_PATCH).startsWith(torso))
})

test('der [PATCH …]-Präfix fällt weg, in allen gängigen Formen', () => {
    assert.equal(patchSubject('Subject: [PATCH] Kurz\n\n---\n'), 'Kurz')
    assert.equal(patchSubject('Subject: [PATCH 1/3] Serie\n\n---\n'), 'Serie')
    assert.equal(patchSubject('Subject: [PATCH v2 3/7] Zweite Runde\n\n---\n'), 'Zweite Runde')
    // Ohne Präfix bleibt der Betreff unangetastet.
    assert.equal(patchSubject('Subject: Ganz ohne Klammer\n\n---\n'), 'Ganz ohne Klammer')
})

test('ohne Subject-Header bleibt der Titel LEER — kein englischer Ersatztext', () => {
    // Leer heißt: die Fläche setzt ihren eigenen, übersetzten Ersatztext ein.
    // Dieselbe Regel wie `rootTitle` in `forgeModels.ts`.
    assert.equal(patchSubject('diff --git a/x b/x\n'), '')
    assert.equal(patchSubject(''), '')
    assert.equal(patchSubject('Subject:   \n\n---\n'), '')
})

test('ein Subject IM GEÄNDERTEN CODE wird nicht zum Titel des Patches', () => {
    const patch = `From abc Mon Sep 17 00:00:00 2001
From: T <t@e.st>
Subject: [PATCH] Der echte Titel

---
 mail.txt | 1 +

diff --git a/mail.txt b/mail.txt
index 1..2 100644
--- a/mail.txt
+++ b/mail.txt
@@ -0,0 +1 @@
+Subject: Ich bin nur Dateiinhalt
`
    assert.equal(patchSubject(patch), 'Der echte Titel')
})

test('auch OHNE eigenen Titel gewinnt der Dateiinhalt nicht', () => {
    // Die Suche endet an der `---`-Trennlinie. Ohne diesen Riegel trüge ein
    // Patch, der eine Mail-Vorlage ändert, deren Betreffzeile als Titel.
    const patch = `From abc Mon Sep 17 00:00:00 2001
From: T <t@e.st>

---
diff --git a/mail.txt b/mail.txt
--- a/mail.txt
+++ b/mail.txt
@@ -0,0 +1 @@
+Subject: Ich bin nur Dateiinhalt
`
    assert.equal(patchSubject(patch), '')
})

// ── Der Signatur-Wächter ────────────────────────────────────────────────────

test('SIGNATUR-WÄCHTER: `--` am Patch-Ende zählt NICHT als Löschung', () => {
    const diff = parseUnifiedDiff(ECHTER_PATCH)
    // Der Patch löscht genau zwei Zeilen: `zwei` in a.txt und `alt` in weg.txt.
    // Ein Leser, der die Signatur mitzählt, käme auf drei.
    assert.equal(diff.deletions, 2, 'Die format-patch-Signatur wurde als Löschzeile gezählt.')
    assert.equal(diff.additions, 2)

    // Und sie darf auch nicht als Zeile IRGENDEINER Art in der letzten Datei
    // hängen: die Zähler des Hunks waren da längst leer.
    const letzte = diff.files[diff.files.length - 1]
    assert.ok(letzte)
    assert.ok(
        !letzte.lines.some((l) => l.text.startsWith('2.55.0') || l.text === '- '),
        'Die Signaturzeilen sind in den Diff gerutscht.',
    )
})

// ── Struktur ────────────────────────────────────────────────────────────────

test('drei Dateien, mit richtigen Pfaden und Änderungsarten', () => {
    const diff = parseUnifiedDiff(ECHTER_PATCH)
    assert.equal(diff.files.length, 3)
    assert.deepEqual(
        diff.files.map((f) => [f.path, f.change]),
        [
            ['a.txt', 'mod'],
            ['neu.txt', 'add'],
            ['weg.txt', 'del'],
        ],
    )
    // `/dev/null` ist nie ein Anzeigepfad — sonst hiesse die neue Datei „/dev/null".
    assert.ok(!diff.files.some((f) => f.path === '/dev/null'))
})

test('je Datei stimmen die Zähler', () => {
    const diff = parseUnifiedDiff(ECHTER_PATCH)
    assert.deepEqual(
        diff.files.map((f) => [f.additions, f.deletions]),
        [
            [1, 1],
            [1, 0],
            [0, 1],
        ],
    )
    assert.deepEqual(diffStat(diff), { files: 3, additions: 2, deletions: 2 })
})

test('die Zeilennummern laufen auf beiden Seiten mit', () => {
    const diff = parseUnifiedDiff(ECHTER_PATCH)
    const a = diff.files[0]
    assert.ok(a)
    // Hunk `@@ -1,3 +1,3 @@`: Kontext 1/1, Löschung alt 2, Zusatz neu 2,
    // Kontext 3/3. Eine gelöschte Zeile hat KEINE neue Nummer und umgekehrt —
    // `0` sagt das, statt eine Nummer zu erfinden.
    assert.deepEqual(
        a.lines.filter((l) => l.kind !== 'meta').map((l) => [l.kind, l.text, l.oldNo, l.newNo]),
        [
            ['context', 'eins', 1, 1],
            ['del', 'zwei', 2, 0],
            ['add', 'ZWEI', 0, 2],
            ['context', 'drei', 3, 3],
        ],
    )
})

test('der Hunk-Kopf bleibt als meta-Zeile erhalten', () => {
    const diff = parseUnifiedDiff(ECHTER_PATCH)
    const koepfe = diff.files.flatMap((f) => f.lines.filter((l) => l.kind === 'meta').map((l) => l.text))
    assert.deepEqual(koepfe, ['@@ -1,3 +1,3 @@', '@@ -0,0 +1 @@', '@@ -1 +0,0 @@'])
})

// ── Sonderformen ────────────────────────────────────────────────────────────

test('ein Hunk-Kopf ohne Zähler meint genau eine Zeile', () => {
    // `@@ -1 +1 @@` ist gültig und heisst „eine alte, eine neue". Wer die
    // fehlende Zahl als 0 liest, konsumiert den Hunk gar nicht.
    const diff = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -7 +7 @@
-alt
+neu
`)
    assert.equal(diff.additions, 1)
    assert.equal(diff.deletions, 1)
    const zeilen = diff.files[0]?.lines.filter((l) => l.kind !== 'meta') ?? []
    assert.deepEqual(zeilen.map((l) => [l.oldNo, l.newNo]), [[7, 0], [0, 7]])
})

test('eine LEERE Kontextzeile bricht den Hunk nicht ab', () => {
    // Manche Werkzeuge sparen das führende Leerzeichen einer leeren
    // Kontextzeile ein. Wer sie abweist, verliert die Synchronisation und
    // verschluckt den Rest des Hunks — sichtbar als „halb angezeigter Patch".
    const diff = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,3 +1,3 @@
 eins

-drei
+DREI
`)
    assert.equal(diff.files[0]?.lines.filter((l) => l.kind !== 'meta').length, 4)
    assert.equal(diff.additions, 1)
    assert.equal(diff.deletions, 1)
})

test('`\\ No newline at end of file` zählt für keine Seite', () => {
    const diff = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-alt
\\ No newline at end of file
+neu
\\ No newline at end of file
`)
    assert.equal(diff.additions, 1)
    assert.equal(diff.deletions, 1)
})

test('eine Binärdatei wird als solche gemeldet statt als leere Änderung', () => {
    const diff = parseUnifiedDiff(`diff --git a/bild.png b/bild.png
index 1..2 100644
Binary files a/bild.png and b/bild.png differ
`)
    assert.equal(diff.files.length, 1)
    assert.equal(diff.files[0]?.binary, true)
    assert.equal(diff.files[0]?.path, 'bild.png')
    assert.equal(diff.files[0]?.lines.length, 0)
})

test('eine Umbenennung ohne Hunk verschwindet nicht', () => {
    const diff = parseUnifiedDiff(`diff --git a/alt.txt b/neu.txt
similarity index 100%
rename from alt.txt
rename to neu.txt
`)
    assert.equal(diff.files.length, 1)
    assert.equal(diff.files[0]?.change, 'ren')
    assert.equal(diff.files[0]?.oldPath, 'alt.txt')
    assert.equal(diff.files[0]?.newPath, 'neu.txt')
})

test('CRLF-Zeilenenden ändern nichts am Ergebnis', () => {
    const diff = parseUnifiedDiff(ECHTER_PATCH.replace(/\n/g, '\r\n'))
    assert.equal(diff.files.length, 3)
    assert.equal(diff.additions, 2)
    assert.equal(diff.deletions, 2)
    assert.equal(diff.files[0]?.lines[1]?.text, 'eins')
})

test('`--no-prefix` (Pfade ohne a/ und b/) wird trotzdem gelesen', () => {
    const diff = parseUnifiedDiff(`diff --git x.txt x.txt
--- x.txt
+++ x.txt
@@ -1 +1 @@
-alt
+neu
`)
    assert.equal(diff.files[0]?.path, 'x.txt')
})

test('ein leerer oder diff-loser Text ergibt einen leeren Diff, keinen Wurf', () => {
    assert.deepEqual(parseUnifiedDiff(''), { files: [], additions: 0, deletions: 0, truncated: false })
    assert.deepEqual(parseUnifiedDiff('nur Prosa\nohne alles\n').files, [])
})

// ── Die Grenze ──────────────────────────────────────────────────────────────

test('über der Zeilengrenze wird gekürzt — und es wird GESAGT', () => {
    const viele = Array.from({ length: DIFF_LINE_LIMIT + 500 }, (_, i) => `+Zeile ${i}`).join('\n')
    const diff = parseUnifiedDiff(`diff --git a/gross.txt b/gross.txt
--- /dev/null
+++ b/gross.txt
@@ -0,0 +1,${DIFF_LINE_LIMIT + 500} @@
${viele}
`)
    assert.equal(diff.truncated, true, 'Die Kürzung wurde verschwiegen.')
    // Gerendert wird höchstens das Budget; gezählt wird trotzdem alles, damit
    // die Zusammenfassung die WAHRE Größe des Patches nennt.
    assert.equal(diff.files[0]?.lines.length, DIFF_LINE_LIMIT)
    assert.equal(diff.additions, DIFF_LINE_LIMIT + 500)
})

test('KONTROLLE: unter der Grenze wird nichts gekürzt', () => {
    const diff = parseUnifiedDiff(ECHTER_PATCH)
    assert.equal(diff.truncated, false)
})

// ── Der Beschreibungstext ───────────────────────────────────────────────────

test('patchBody liefert die Commit-Beschreibung ohne Header und ohne Diff', () => {
    const patch = `From abc Mon Sep 17 00:00:00 2001
From: T <t@e.st>
Subject: [PATCH] Kurz

Die erste Zeile der Beschreibung.

Und ein zweiter Absatz mit *Sternchen*, die NICHT kursiv werden duerfen.
---
 a.txt | 1 +

diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -0,0 +1 @@
+neu
`
    assert.equal(
        patchBody(patch),
        'Die erste Zeile der Beschreibung.\n\nUnd ein zweiter Absatz mit *Sternchen*, die NICHT kursiv werden duerfen.',
    )
})

test('patchBody: ohne Beschreibung bleibt es leer, statt das Diffstat einzusammeln', () => {
    // Der Normalfall bei Einzeiler-Commits: nach dem Header kommt sofort `---`.
    const patch = `From abc Mon Sep 17 00:00:00 2001
Subject: [PATCH] Nur ein Einzeiler

---
 a.txt | 1 +

diff --git a/a.txt b/a.txt
`
    assert.equal(patchBody(patch), '')
})

test('patchBody: ein reiner `git diff` ohne Mail-Kopf hat keinen Rumpf', () => {
    assert.equal(patchBody('diff --git a/x b/x\n--- a/x\n+++ b/x\n'), '')
    assert.equal(patchBody(''), '')
})

test('patchBody nimmt NICHTS aus dem Diff mit', () => {
    // Der Riegel, der zählt: liefe die Schleife bis zum Textende, stünde der
    // ganze Patch als „Beschreibung" im Bild.
    const body = patchBody(ECHTER_PATCH)
    assert.ok(!body.includes('diff --git'), 'Der Diff ist in die Beschreibung gerutscht.')
    assert.ok(!body.includes('@@'), 'Ein Hunk-Kopf ist in die Beschreibung gerutscht.')
    assert.ok(!body.includes('a.txt   |'), 'Das Diffstat ist in die Beschreibung gerutscht.')
})
