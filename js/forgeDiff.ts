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
    /**
     * Der Zeilenvergleich hat sein Budget überschritten und wurde grob
     * degradiert (alles gelöscht, alles neu) — nur beim SELBST gerechneten
     * PR-Diff möglich, nie beim gelesenen Patch. Die Zahlen stimmen dann noch,
     * die Zuordnung ist gröber; die Fläche sagt es an, statt es zu verschweigen.
     */
    grob?: boolean
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

// ── Zeilenvergleich (P7b) ───────────────────────────────────────────────────

/**
 * Ab hier wird NICHT mehr Zeile für Zeile verglichen.
 *
 * Myers' Algorithmus läuft in O((N+M)·D) Zeit und braucht O(D²) Speicher für
 * seine Spur; `D` ist die Zahl der Einfügungen plus Löschungen. Bei einer Datei,
 * die komplett neu geschrieben wurde, ist `D` so groß wie die Datei — dort ist
 * ein zeilengenauer Vergleich weder berechenbar noch für einen Menschen lesbar.
 *
 * **Der Ausfall ist ausgezeichnet, nicht still:** {@link ZeilenVergleich.genau}
 * wird `false`, und der Vergleich degradiert auf „alles gelöscht, alles neu" —
 * die Zahlen stimmen dann immer noch, nur die Zuordnung ist gröber. Ein
 * stillschweigend abgebrochener Vergleich wäre eine falsche Aussage über die
 * Datei.
 */
export const MYERS_MAX_D = 1200

/** Ab dieser Gesamtzeilenzahl wird gar nicht erst gerechnet (siehe {@link MYERS_MAX_D}). */
export const MYERS_MAX_ZEILEN = 40_000

export type ZeilenVergleich = {
    /** Der volle Vergleich, Zeile für Zeile — noch OHNE Hunk-Schnitt. */
    lines: DiffLine[]
    additions: number
    deletions: number
    /** `false`, wenn der Budgetdeckel griff und grob degradiert wurde. */
    genau: boolean
}

/**
 * Eine Datei in Zeilen zerlegen — der abschließende Zeilenumbruch ist ein
 * TERMINATOR, kein Trenner.
 *
 * `'a\nb\n'.split('\n')` liefert `['a', 'b', '']`, und dieses letzte leere
 * Element ist keine Zeile — es ist das Ende. Wer es stehen lässt, meldet für
 * jede normal terminierte Datei eine zusätzliche leere Zeile und rechnet sie in
 * die +/− Zahlen ein.
 *
 * **Was hier bewusst NICHT passiert:** die Markierung
 * `\ No newline at end of file`. Sie steht in `git diff`, weil git den
 * Unterschied kennt; wir kennen ihn hier auch, aber sie zu setzen hieße, eine
 * Zeile in die Anzeige zu schreiben, die keine Zeile ist. Der Fall ist selten
 * und die Zahlen bleiben ohne sie richtig.
 */
export const zuZeilen = (text: string): string[] => {
    if (text === '') {
        return []
    }
    const alle = text.split('\n')
    if (alle[alle.length - 1] === '') {
        alle.pop()
    }

    return alle
}

/**
 * Der grobe Ausfallweg: alles alt weg, alles neu hin.
 *
 * Er ist die ehrliche Antwort auf „zu groß zum Vergleichen" — die Datei hat sich
 * geändert, und wie genau, sagt diese Anzeige dann nicht mehr.
 */
const grobErsetzt = (alt: readonly string[], neu: readonly string[]): ZeilenVergleich => {
    const lines: DiffLine[] = []
    alt.forEach((text, i) => lines.push({ kind: 'del', text, oldNo: i + 1, newNo: 0 }))
    neu.forEach((text, i) => lines.push({ kind: 'add', text, oldNo: 0, newNo: i + 1 }))

    return { lines, additions: neu.length, deletions: alt.length, genau: false }
}

/**
 * Zwei Fassungen einer Datei zeilenweise vergleichen — Myers' greedy Algorithmus.
 *
 * ── Warum überhaupt selbst gerechnet ────────────────────────────────────────
 *
 * Ein kind 1617 bringt seinen Diff als TEXT mit; {@link parseUnifiedDiff} liest
 * ihn. Ein kind 1618 bringt ihn NICHT mit — dort stehen nur zwei Commit-Ids
 * (`merge-base` und `c`), und was dazwischen liegt, weiß nur Git. Amethyst
 * rechnet es mit JGit aus, wir hier mit denselben zwei Bäumen aus dem lokalen
 * Klon. Ein Paket dafür wäre eine neue Abhängigkeit für rund hundert Zeilen.
 *
 * ── Gemeinsamer Anfang und gemeinsames Ende zuerst ──────────────────────────
 *
 * Das ist keine Optimierung am Rand, sondern der Normalfall: eine geänderte
 * Zeile in einer 2000-Zeilen-Datei ergibt nach dem Abschneiden ein Problem der
 * Größe 1. Ohne diesen Schritt liefe Myers über die ganze Datei.
 */
export const vergleicheZeilen = (altText: string, neuText: string): ZeilenVergleich => {
    const alt = zuZeilen(altText)
    const neu = zuZeilen(neuText)

    if (alt.length + neu.length > MYERS_MAX_ZEILEN) {
        return grobErsetzt(alt, neu)
    }

    // Gemeinsamer Anfang.
    let vorn = 0
    while (vorn < alt.length && vorn < neu.length && alt[vorn] === neu[vorn]) {
        vorn += 1
    }
    // Gemeinsames Ende — nie über den gemeinsamen Anfang hinaus.
    let hinten = 0
    while (
        hinten < alt.length - vorn &&
        hinten < neu.length - vorn &&
        alt[alt.length - 1 - hinten] === neu[neu.length - 1 - hinten]
    ) {
        hinten += 1
    }

    const a = alt.slice(vorn, alt.length - hinten)
    const b = neu.slice(vorn, neu.length - hinten)
    const pfad = myersPfad(a, b, MYERS_MAX_D)
    if (!pfad) {
        return grobErsetzt(alt, neu)
    }

    const lines: DiffLine[] = []
    let additions = 0
    let deletions = 0
    let nrAlt = 1
    let nrNeu = 1

    for (let i = 0; i < vorn; i += 1) {
        lines.push({ kind: 'context', text: alt[i] ?? '', oldNo: nrAlt, newNo: nrNeu })
        nrAlt += 1
        nrNeu += 1
    }
    for (const schritt of pfad) {
        if (schritt.art === 'gleich') {
            lines.push({ kind: 'context', text: a[schritt.i] ?? '', oldNo: nrAlt, newNo: nrNeu })
            nrAlt += 1
            nrNeu += 1
        } else if (schritt.art === 'weg') {
            lines.push({ kind: 'del', text: a[schritt.i] ?? '', oldNo: nrAlt, newNo: 0 })
            nrAlt += 1
            deletions += 1
        } else {
            lines.push({ kind: 'add', text: b[schritt.j] ?? '', oldNo: 0, newNo: nrNeu })
            nrNeu += 1
            additions += 1
        }
    }
    for (let i = 0; i < hinten; i += 1) {
        const text = alt[alt.length - hinten + i] ?? ''
        lines.push({ kind: 'context', text, oldNo: nrAlt, newNo: nrNeu })
        nrAlt += 1
        nrNeu += 1
    }

    return { lines, additions, deletions, genau: true }
}

type Schritt = { art: 'gleich' | 'weg' | 'hin'; i: number; j: number }

/**
 * Der Editierpfad zwischen zwei Zeilenfolgen — `null`, wenn das Budget nicht
 * reicht.
 *
 * Die Spur speichert je Runde nur den benutzten `k`-Bereich (`2d+1` Werte)
 * statt des ganzen Vektors. Die Summe über alle Runden ist damit D², nicht
 * D·(N+M) — bei einer 20 000-Zeilen-Datei ist das der Unterschied zwischen
 * 4 MB und 160 MB.
 */
const myersPfad = (a: readonly string[], b: readonly string[], maxD: number): Schritt[] | null => {
    const n = a.length
    const m = b.length
    if (n === 0 && m === 0) {
        return []
    }
    const max = n + m
    const v = new Int32Array(2 * max + 1)
    const spur: Int32Array[] = []

    for (let d = 0; d <= Math.min(max, maxD); d += 1) {
        // Der Stand VOR dieser Runde — genau der, den der Rückweg braucht.
        spur.push(v.slice(max - d, max + d + 1))
        for (let k = -d; k <= d; k += 2) {
            let x =
                k === -d || (k !== d && (v[k - 1 + max] ?? 0) < (v[k + 1 + max] ?? 0))
                    ? (v[k + 1 + max] ?? 0)
                    : (v[k - 1 + max] ?? 0) + 1
            let y = x - k
            while (x < n && y < m && a[x] === b[y]) {
                x += 1
                y += 1
            }
            v[k + max] = x
            if (x >= n && y >= m) {
                return rueckweg(spur, a, b)
            }
        }
    }

    return null
}

const rueckweg = (spur: readonly Int32Array[], a: readonly string[], b: readonly string[]): Schritt[] => {
    const schritte: Schritt[] = []
    let x = a.length
    let y = b.length

    for (let d = spur.length - 1; d >= 0; d -= 1) {
        const v = spur[d] as Int32Array
        const lies = (k: number): number => v[k + d] ?? 0
        const k = x - y
        const vorK = k === -d || (k !== d && lies(k - 1) < lies(k + 1)) ? k + 1 : k - 1
        const vorX = d === 0 ? 0 : lies(vorK)
        const vorY = vorX - vorK

        while (x > vorX && y > vorY) {
            x -= 1
            y -= 1
            schritte.push({ art: 'gleich', i: x, j: y })
        }
        if (d > 0) {
            if (x === vorX) {
                y -= 1
                schritte.push({ art: 'hin', i: x, j: y })
            } else {
                x -= 1
                schritte.push({ art: 'weg', i: x, j: y })
            }
        }
    }

    return schritte.reverse()
}

// ── Hunks ───────────────────────────────────────────────────────────────────

/** Kontextzeilen ober- und unterhalb einer Änderung — wie `git diff` sie setzt. */
export const HUNK_KONTEXT = 3

/**
 * Aus einem VOLLSTÄNDIGEN Zeilenvergleich die Hunks schneiden.
 *
 * **Ohne diesen Schritt ist der 4000-Zeilen-Deckel sofort erreicht:** eine
 * geänderte Zeile in einer 3000-Zeilen-Datei brächte 3000 Kontextzeilen mit,
 * und die zweite Datei des Vorschlags käme nicht mehr vor. Ein Diff ist die
 * Umgebung der Änderung, nicht die Datei.
 *
 * Das Ergebnis hat dieselbe Form wie das von {@link parseUnifiedDiff} — Hunk-
 * Köpfe als `meta`-Zeilen dazwischen —, damit beide Wege durch dieselbe Anzeige
 * laufen.
 */
export const zuHunks = (lines: readonly DiffLine[], kontext = HUNK_KONTEXT): DiffLine[] => {
    const geaendert = lines
        .map((zeile, i) => (zeile.kind === 'add' || zeile.kind === 'del' ? i : -1))
        .filter((i) => i >= 0)
    if (geaendert.length === 0) {
        return []
    }

    // Bereiche zusammenlegen, die sich über ihre Kontextzeilen berühren.
    const bereiche: { von: number; bis: number }[] = []
    for (const i of geaendert) {
        const von = Math.max(0, i - kontext)
        const bis = Math.min(lines.length - 1, i + kontext)
        const letzter = bereiche[bereiche.length - 1]
        if (letzter && von <= letzter.bis + 1) {
            letzter.bis = Math.max(letzter.bis, bis)
        } else {
            bereiche.push({ von, bis })
        }
    }

    const out: DiffLine[] = []
    for (const bereich of bereiche) {
        let altVon = 0
        let neuVon = 0
        let altZahl = 0
        let neuZahl = 0
        for (let i = bereich.von; i <= bereich.bis; i += 1) {
            const zeile = lines[i] as DiffLine
            if (zeile.kind !== 'add') {
                altZahl += 1
                if (altVon === 0) {
                    altVon = zeile.oldNo
                }
            }
            if (zeile.kind !== 'del') {
                neuZahl += 1
                if (neuVon === 0) {
                    neuVon = zeile.newNo
                }
            }
        }
        out.push({
            kind: 'meta',
            text: `@@ -${altVon || 0},${altZahl} +${neuVon || 0},${neuZahl} @@`,
            oldNo: 0,
            newNo: 0,
        })
        for (let i = bereich.von; i <= bereich.bis; i += 1) {
            out.push(lines[i] as DiffLine)
        }
    }

    return out
}
