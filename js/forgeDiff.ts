/**
 * P5 — der **Unified-Diff-Leser**: aus `git format-patch`-Text ein Anzeigemodell.
 *
 * Rein (kein Netz, kein Store, keine welshman-Importe, relative Importe mit
 * `.ts`) und damit unter `node --experimental-strip-types --test` fahrbar.
 *
 * ── Warum das ein eigenes Modul ist und kein Blade-Fragment ─────────────────
 *
 * Ein kind 1617 trägt seinen Diff **im `content`** — kein Git-Zugriff, keine
 * Auth, kein CORS. Genau derselbe Text steht später (P6) im PR-Diff, den
 * Amethyst über Git-Smart-HTTP berechnet, und in einer Buzz-Diff-Nachricht
 * (kind 40008, `h`-gescopet, „unified diff text" laut
 * `buzz-sdk/src/builders.rs`). Drei Quellen, ein Format: der Leser gehört
 * genau einmal hierher, nicht dreimal in eine Blade-Datei.
 *
 * ── Die Falle, die man beim ersten Versuch tritt ────────────────────────────
 *
 * **`git format-patch` endet mit einer Signatur, und die sieht aus wie eine
 * Löschzeile:**
 *
 * ```
 *  context
 * -alt
 * +neu
 * --
 * 2.43.0
 * ```
 *
 * Wer den Hunk „bis zum nächsten `diff --git` oder Dateiende" liest, nimmt
 * `--` als Löschung von `-` und zeigt dem Leser eine Änderung, die im Patch
 * nicht steht. Der Hunk-Kopf sagt aber **genau**, wie viele Zeilen kommen:
 * `@@ -1,3 +1,3 @@` sind drei alte und drei neue. {@link parseUnifiedDiff}
 * zählt deshalb beide Zähler herunter und hört auf, wenn sie leer sind — die
 * Signatur wird nie erreicht. Dasselbe schützt vor einem Commit-Text, der
 * zufällig mit `+` beginnt.
 *
 * ── Und die zweite: der Betreff darf umbrechen ──────────────────────────────
 *
 * `Subject:` ist ein RFC-5322-Header und **faltbar** — eine Fortsetzungszeile
 * beginnt mit Leerraum und gehört zum selben Feld. `git format-patch` faltet
 * ab ~78 Zeichen, also bei jedem längeren Betreff. Wer nur die erste Zeile
 * nimmt, schneidet den Titel mitten im Wort ab und merkt es nie, weil kurze
 * Betreffs (die man beim Testen tippt) nie falten.
 *
 * ── Was dieses Modul NICHT tut ──────────────────────────────────────────────
 *
 * Es wendet nichts an und prüft nichts nach. Ein Diff wird **gelesen und
 * gezeigt**, nicht validiert: ob der Patch auf den Baum passt, weiß nur Git,
 * und ein Client, der so täte, als wüsste er es, behauptete mehr als er hat.
 */

// ── Grenzen ─────────────────────────────────────────────────────────────────

/**
 * Höchstzahl gerenderter Diff-Zeilen über ALLE Dateien.
 *
 * NIP-34 empfiehlt Patches unter 60 kB, und Buzz erzwingt das beim Bauen
 * (`check_content(content, 60 * 1024)`) — gelesen werden können trotzdem
 * fremde Patches ohne diese Grenze. 4000 Zeilen sind großzügig über allem,
 * was ein Mensch am Stück liest, und decken 60 kB bei üblicher Zeilenlänge ab.
 *
 * Gekürzt wird **sichtbar**: {@link ParsedDiff.truncated} sagt es, und die
 * Fläche schreibt es hin. Eine stillschweigend gekürzte Datei wäre eine
 * falsche Aussage über den Patch — dieselbe Regel wie bei den Listen in
 * `forge.ts` (Eigenheit 4).
 */
export const DIFF_LINE_LIMIT = 4000

// ── Betreff ─────────────────────────────────────────────────────────────────

const SUBJECT_HEADER = 'Subject:'
/** `[PATCH]`, `[PATCH 1/3]`, `[PATCH v2 2/5]` — der Serien-Präfix vor dem Titel. */
const PATCH_PREFIX = /^\[PATCH[^\]]*\]\s*/

/**
 * Der Betreff eines `git format-patch`-Textes, entfaltet und ohne `[PATCH …]`.
 *
 * `''`, wenn kein `Subject:`-Header da ist — dann setzt die Fläche ihren
 * eigenen Ersatztext ein. Hier einen englischen Vorgabetext einzusetzen hiesse,
 * eine unübersetzbare Zeichenkette durch die Übersetzungsschicht zu schmuggeln
 * (dieselbe Begründung wie bei `rootTitle` in `forgeModels.ts`).
 *
 * **Der Header wird NUR im Kopfbereich gesucht.** Ein Patch, der eine Datei
 * mit einer Zeile `Subject: …` ändert, trüge sonst deren Inhalt als Titel:
 * die Suche endet an der ersten `diff --git`- oder `---`-Trennzeile.
 */
export const patchSubject = (content: string): string => {
    const zeilen = content.split('\n')
    let gefunden = false
    const teile: string[] = []

    for (const roh of zeilen) {
        const zeile = roh.replace(/\r$/, '')
        if (!gefunden) {
            // Der Kopf endet an der Trennlinie (`---`) oder am ersten Dateiblock.
            // Danach ist alles Nutzlast, und ein `Subject:` darin gehört dem
            // geänderten Code, nicht dem Patch.
            if (zeile === '---' || zeile.startsWith('diff --git ')) {
                break
            }
            if (zeile.startsWith(SUBJECT_HEADER)) {
                teile.push(zeile.slice(SUBJECT_HEADER.length).trim())
                gefunden = true
            }
            continue
        }
        // RFC-5322-Faltung: Fortsetzungszeilen beginnen mit Leerraum.
        if (/^[ \t]/.test(zeile)) {
            teile.push(zeile.trim())
            continue
        }
        break
    }

    if (!gefunden) {
        return ''
    }

    return teile.join(' ').trim().replace(PATCH_PREFIX, '').trim()
}

/**
 * Der Beschreibungstext eines Patches: alles zwischen dem Header-Block und der
 * `---`-Trennlinie — also die Commit-Nachricht ohne ihre erste Zeile.
 *
 * **Das ist KLARTEXT, kein Markdown.** Eine Commit-Nachricht durch den
 * Markdown-Renderer zu schicken, verfälscht sie: `*` würde zu Kursiv, ein
 * eingerückter Block zu Code, und `_variablen_name_` verlöre seine
 * Unterstriche. Die Fläche zeigt den Text deshalb über `x-text` mit erhaltenen
 * Umbrüchen und rendert ihn NICHT.
 *
 * `''`, wenn der Patch keine Beschreibung hat — der Normalfall bei
 * Einzeiler-Commits.
 */
export const patchBody = (content: string): string => {
    const zeilen = content.split('\n').map((zeile) => zeile.replace(/\r$/, ''))
    // Der Header-Block endet an der ersten Leerzeile. Bis dahin stehen
    // `From:`, `Date:`, `Subject:` samt Faltung.
    let i = 0
    while (i < zeilen.length && zeilen[i] !== '') {
        if (zeilen[i]?.startsWith('diff --git ') || zeilen[i] === '---') {
            return ''
        }
        i += 1
    }
    const rumpf: string[] = []
    for (i += 1; i < zeilen.length; i += 1) {
        const zeile = zeilen[i] ?? ''
        if (zeile === '---' || zeile.startsWith('diff --git ')) {
            break
        }
        rumpf.push(zeile)
    }

    return rumpf.join('\n').trim()
}

// ── Modell ──────────────────────────────────────────────────────────────────

/** Was eine Diff-Zeile ist. `meta` sind Hunk-Köpfe und `\ No newline …`. */
export type DiffLineKind = 'context' | 'add' | 'del' | 'meta'

export type DiffLine = {
    kind: DiffLineKind
    /** Der Text OHNE das führende Vorzeichen — das Vorzeichen ist `kind`. */
    text: string
    /** Zeilennummer in der alten Fassung, `0` wenn die Zeile dort nicht steht. */
    oldNo: number
    /** Zeilennummer in der neuen Fassung, `0` wenn die Zeile dort nicht steht. */
    newNo: number
}

export type DiffFile = {
    /** Anzeigepfad: der neue Pfad, bei Löschung der alte. */
    path: string
    oldPath: string
    newPath: string
    /** `add` neue Datei · `del` gelöscht · `mod` geändert · `ren` umbenannt. */
    change: 'add' | 'del' | 'mod' | 'ren'
    /** Binärdatei — dann ist `lines` leer und es gibt nichts zu zeigen. */
    binary: boolean
    additions: number
    deletions: number
    /** Alle Zeilen der Datei, Hunk-Köpfe als `meta` dazwischen. */
    lines: DiffLine[]
}

export type ParsedDiff = {
    files: DiffFile[]
    additions: number
    deletions: number
    /** Wurde an {@link DIFF_LINE_LIMIT} abgeschnitten? Die Fläche sagt es an. */
    truncated: boolean
}

export const EMPTY_DIFF: ParsedDiff = { files: [], additions: 0, deletions: 0, truncated: false }

const HUNK = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * `a/pfad` → `pfad`. `/dev/null` bleibt stehen, es ist die Aussage „gab es nicht".
 *
 * Git setzt die Präfixe `a/` und `b/` (abschaltbar per `--no-prefix`, dann
 * fehlen sie). Beide Formen kommen vor; abgeschnitten wird nur, was da ist.
 */
const ohnePraefix = (pfad: string): string => {
    if (pfad === '/dev/null') {
        return pfad
    }

    return pfad.replace(/^[ab]\//, '')
}

/**
 * Der Pfad aus einer `--- `/`+++ `-Zeile.
 *
 * Git hängt bei manchen Fassungen einen Zeitstempel mit Tabulator an — der
 * gehört nicht zum Pfad.
 */
const pfadAus = (zeile: string): string => ohnePraefix(zeile.slice(4).split('\t')[0]?.trim() ?? '')

const neueDatei = (): DiffFile => ({
    path: '',
    oldPath: '',
    newPath: '',
    change: 'mod',
    binary: false,
    additions: 0,
    deletions: 0,
    lines: [],
})

/**
 * Einen Unified Diff lesen — `git format-patch`, `git diff` und der Rumpf einer
 * Buzz-Diff-Nachricht sind dasselbe Format.
 *
 * Robust gegen den Kopfteil eines `format-patch` (alles vor dem ersten
 * `diff --git` wird übersprungen) und gegen die Signatur am Ende (siehe
 * Modulkopf).
 */
export const parseUnifiedDiff = (content: string): ParsedDiff => {
    const zeilen = content.split('\n')
    const files: DiffFile[] = []
    let datei: DiffFile | null = null
    let restAlt = 0
    let restNeu = 0
    let nrAlt = 0
    let nrNeu = 0
    let gesamt = 0
    let truncated = false

    /** Zeile aufnehmen, solange das Gesamtbudget reicht. */
    const nimm = (line: DiffLine): void => {
        if (gesamt >= DIFF_LINE_LIMIT) {
            truncated = true

            return
        }
        gesamt += 1
        datei?.lines.push(line)
    }

    const abschliessen = (): void => {
        if (datei && (datei.path || datei.lines.length > 0)) {
            files.push(datei)
        }
        datei = null
        restAlt = 0
        restNeu = 0
    }

    for (const roh of zeilen) {
        const zeile = roh.replace(/\r$/, '')

        // ── Ein neuer Dateiblock ────────────────────────────────────────────
        if (zeile.startsWith('diff --git ')) {
            abschliessen()
            datei = neueDatei()
            // `diff --git a/x b/y` — die Pfade stehen schon hier und sind die
            // einzige Quelle, wenn der Block eine reine Modus- oder
            // Umbenennungsänderung ohne `---`/`+++` ist.
            const teile = zeile.slice('diff --git '.length).split(' ')
            if (teile.length >= 2) {
                datei.oldPath = ohnePraefix(teile[0] ?? '')
                datei.newPath = ohnePraefix(teile[teile.length - 1] ?? '')
                datei.path = datei.newPath || datei.oldPath
            }
            continue
        }

        // Alles vor dem ersten Dateiblock ist Patch-Kopf (From/Date/Subject,
        // Beschreibung, Diffstat). Der Betreff kommt aus `patchSubject`.
        if (!datei) {
            continue
        }

        // ── Innerhalb eines Hunks: die Zähler entscheiden, nicht das Aussehen ──
        if (restAlt > 0 || restNeu > 0) {
            if (zeile.startsWith('\\')) {
                // `\ No newline at end of file` — zählt für keine Seite.
                nimm({ kind: 'meta', text: zeile, oldNo: 0, newNo: 0 })
                continue
            }
            const zeichen = zeile.charAt(0)
            if (zeichen === '+') {
                datei.additions += 1
                nimm({ kind: 'add', text: zeile.slice(1), oldNo: 0, newNo: nrNeu })
                nrNeu += 1
                restNeu -= 1
                continue
            }
            if (zeichen === '-') {
                datei.deletions += 1
                nimm({ kind: 'del', text: zeile.slice(1), oldNo: nrAlt, newNo: 0 })
                nrAlt += 1
                restAlt -= 1
                continue
            }
            // Kontext ist ' ' — und die LEERE Zeile ist ebenfalls Kontext:
            // manche Werkzeuge sparen das Leerzeichen einer leeren Kontextzeile
            // ein. Wer sie hier abweist, verliert die Synchronisation und
            // bricht mitten im Hunk ab.
            if (zeichen === ' ' || zeile === '') {
                nimm({ kind: 'context', text: zeile.slice(1), oldNo: nrAlt, newNo: nrNeu })
                nrAlt += 1
                nrNeu += 1
                restAlt -= 1
                restNeu -= 1
                continue
            }
            // Etwas Unerwartetes mitten im Hunk: der Hunk ist zu Ende, die
            // Zeile wird unten normal behandelt.
            restAlt = 0
            restNeu = 0
        }

        // ── Hunk-Kopf ───────────────────────────────────────────────────────
        const hunk = HUNK.exec(zeile)
        if (hunk) {
            nrAlt = Number(hunk[1])
            restAlt = hunk[2] === undefined ? 1 : Number(hunk[2])
            nrNeu = Number(hunk[3])
            restNeu = hunk[4] === undefined ? 1 : Number(hunk[4])
            nimm({ kind: 'meta', text: zeile, oldNo: 0, newNo: 0 })
            continue
        }

        // ── Kopfzeilen des Dateiblocks ──────────────────────────────────────
        if (zeile.startsWith('--- ')) {
            datei.oldPath = pfadAus(zeile)
            continue
        }
        if (zeile.startsWith('+++ ')) {
            datei.newPath = pfadAus(zeile)
            datei.path = datei.newPath === '/dev/null' ? datei.oldPath : datei.newPath
            continue
        }
        if (zeile.startsWith('new file mode')) {
            datei.change = 'add'
            continue
        }
        if (zeile.startsWith('deleted file mode')) {
            datei.change = 'del'
            continue
        }
        if (zeile.startsWith('rename from ') || zeile.startsWith('rename to ')) {
            datei.change = 'ren'
            continue
        }
        if (zeile.startsWith('Binary files ') || zeile.startsWith('GIT binary patch')) {
            datei.binary = true
            continue
        }
        // `index …`, `similarity index …`, `old mode` — kein Anzeigewert.
    }
    abschliessen()

    // `/dev/null` als Anzeigepfad wäre eine Lüge über den Dateinamen: bei einer
    // neuen Datei steht der echte Name im `+++`, bei einer gelöschten im `---`.
    for (const f of files) {
        if (f.oldPath === '/dev/null') {
            f.change = 'add'
        }
        if (f.newPath === '/dev/null') {
            f.change = 'del'
        }
        if (!f.path || f.path === '/dev/null') {
            f.path = (f.newPath !== '/dev/null' && f.newPath) || f.oldPath || ''
        }
    }

    return {
        files,
        additions: files.reduce((n, f) => n + f.additions, 0),
        deletions: files.reduce((n, f) => n + f.deletions, 0),
        truncated,
    }
}

/**
 * Kurzfassung fürs Abzeichen: `3 Dateien +42 −7`.
 *
 * Als Zahlen, nicht als Satz — die Fläche baut den Satz in ihrer Sprache.
 */
export type DiffStat = { files: number; additions: number; deletions: number }

export const diffStat = (diff: ParsedDiff): DiffStat => ({
    files: diff.files.length,
    additions: diff.additions,
    deletions: diff.deletions,
})
