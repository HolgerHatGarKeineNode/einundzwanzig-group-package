/**
 * P7b — **der PR-Diff**: die reine Hälfte.
 *
 * Ein Pull Request (kind 1618) trägt seinen Diff NICHT bei sich. Er nennt zwei
 * Commit-Ids — `merge-base` (woher) und `c` (wohin) — und mindestens eine
 * `clone`-URL, *„where the tip commit can be fetched"* (NIP-34). Was zwischen
 * den beiden Commits liegt, weiß nur Git. Ein Patch (1617) ist darin der
 * einfachere Fall: dort steht der Unified Diff im `content`, und
 * {@link import('./forgeDiff.ts').parseUnifiedDiff} liest ihn ohne ein Byte
 * Netz.
 *
 * Kein Netz, kein `isomorphic-git`, keine welshman-Importe, relative Importe mit
 * `.ts` — damit `node --experimental-strip-types --test` das Modul lädt. Was
 * Netz braucht, steht in `gitBrowser.ts` und wird **lazy** geladen.
 *
 * ── Die zwei Vorbedingungen, die diese Fläche formen ────────────────────────
 *
 * 1. **Die Kostenansage steht VOR dem Download.** Der Klon läuft auf
 *    `depth: 1 singleBranch noCheckout`, weil der Git-Endpunkt kein
 *    `filter=blob:none` kann (am 2026-08-24 gemessen). Historie ist deshalb
 *    teuer: am selben Repository kostete **1 Commit 1,1 MB**, **10 Commits
 *    13 MB** von 14 MB gesamt. Ein „Files changed"-Reiter, der das
 *    stillschweigend nachlädt, gibt das Datenvolumen des Nutzers aus, ohne ihn
 *    zu fragen.
 * 2. **Ein Teil der PR-Diffs ist prinzipiell nicht darstellbar.** Der Tip darf
 *    laut NIP-34 in einem Fork auf einem fremden Host liegen. Unser
 *    NIP-98-Token gilt nur für den Workspace-Host
 *    ({@link import('./gitReadme.ts').istEigenerHost}), und ob ein fremder Host
 *    CORS öffnet, weiß vorher niemand. **Das ist eine Auskunft mit Link, kein
 *    Fehlerbild** — dieselbe Entscheidung wie beim README, und aus demselben
 *    Grund: ein Repository, das woanders liegt, ist kein Defekt.
 */
import {
    DIFF_LINE_LIMIT,
    vergleicheZeilen,
    zuHunks,
    type DiffFile,
    type DiffLine,
    type ParsedDiff,
} from './forgeDiff.ts'
import { istEigenerHost, waehleCloneUrl } from './gitReadme.ts'

// ── Woher der Diff käme ─────────────────────────────────────────────────────

/**
 * Warum ein PR-Diff nicht gebildet werden kann — oder woher er käme.
 *
 * Als **Code**, nicht als Satz: dieses Modul bleibt sprachfrei, die Fläche
 * übersetzt (dieselbe Regel wie bei {@link import('./gitReadme.ts').KlonFehler}).
 */
export type PrDiffQuelle =
    /** Kein `clone`-Tag, das ein Browser abrufen könnte (nur ssh/git — oder gar keins). */
    | { art: 'keine-quelle' }
    /** Der Tip liegt woanders. `link` ist die beste browsbare Adresse dorthin. */
    | { art: 'fremd'; link: string; host: string }
    /** Das Ereignis nennt die zwei Punkte nicht, zwischen denen zu rechnen wäre. */
    | { art: 'unvollstaendig'; fehlt: 'merge-base' | 'commit' | 'beides' }
    /** Ladbar — von hier aus, mit unserem Zugang. */
    | { art: 'ladbar'; url: string; basis: string; spitze: string }

/** Sieht das wie eine Commit-Id aus? Alles andere ist kein Punkt, gegen den man rechnet. */
const istCommit = (wert: string): boolean => /^[0-9a-f]{7,64}$/i.test(wert.trim())

/**
 * Die beste browsbare Adresse zu einem fremden Repository.
 *
 * Zuerst eine `web`-URL, die auf **denselben Host** zeigt wie der Tip: sie
 * stammt aus dem Ereignis und ist die Angabe des Eigentümers. Sonst die
 * clone-URL ohne `.git` — das ist bei GitHub, GitLab und Gitea die
 * Browser-Adresse desselben Repositories.
 *
 * **Warum nicht einfach die erste `web`-URL:** sie kann auf einen ganz anderen
 * Host zeigen als der Tip (ein Repo, das seine Startseite woanders hat). Ein
 * Link, der etwas anderes öffnet, als der Satz daneben behauptet, ist
 * schlimmer als kein Link.
 */
export const fremdLink = (cloneUrl: string, webUrls: readonly string[] = []): string => {
    let host = ''
    try {
        host = new URL(cloneUrl).host.toLowerCase()
    } catch {
        return ''
    }
    for (const roh of webUrls) {
        const kandidat = (roh ?? '').trim()
        if (!/^https?:\/\//i.test(kandidat)) {
            continue
        }
        try {
            if (new URL(kandidat).host.toLowerCase() === host) {
                return kandidat
            }
        } catch {
            continue
        }
    }

    return cloneUrl.replace(/\.git$/i, '')
}

export type PrDiffEingabe = {
    /** Die `clone`-Tags des 1618. */
    cloneUrls: readonly string[]
    /** `web`-Tags des REPOS — nur für den Link im Fremdfall. */
    webUrls?: readonly string[]
    /** Der Commit, auf den der PR heute zeigt (`c`). */
    commit: string
    /** Der gemeinsame Vorfahr (`merge-base`). */
    mergeBase: string
    /** Die Workspace-Relay-URL — gegen sie wird „eigener Host" geprüft. */
    workspaceUrl: string
}

/**
 * Woher der Diff dieses Pull Requests käme — **ohne ein Byte Netz**.
 *
 * ── Die Reihenfolge der Prüfungen ist die Aussage ───────────────────────────
 *
 * `fremd` steht VOR `unvollstaendig`, und das ist eine bewusste Wahl: liegt der
 * Tip auf github.com, ist der Link die brauchbare Antwort — dort sieht der
 * Nutzer den Diff, ganz gleich ob unser Ereignis auch noch einen `merge-base`
 * mitbringt. Die Reihenfolge umgekehrt lieferte ihm die technisch korrektere,
 * aber nutzlosere Auskunft („kein merge-base") und verschwiege den Weg, der ans
 * Ziel führt.
 */
export const prDiffQuelle = ({
    cloneUrls,
    webUrls = [],
    commit,
    mergeBase,
    workspaceUrl,
}: PrDiffEingabe): PrDiffQuelle => {
    const url = waehleCloneUrl(cloneUrls)
    if (!url) {
        return { art: 'keine-quelle' }
    }
    if (!istEigenerHost(url, workspaceUrl)) {
        let host = ''
        try {
            host = new URL(url).host
        } catch {
            host = ''
        }

        return { art: 'fremd', link: fremdLink(url, webUrls), host }
    }
    const spitze = istCommit(commit) ? commit.trim().toLowerCase() : ''
    const basis = istCommit(mergeBase) ? mergeBase.trim().toLowerCase() : ''
    if (!spitze || !basis) {
        return {
            art: 'unvollstaendig',
            fehlt: !spitze && !basis ? 'beides' : !basis ? 'merge-base' : 'commit',
        }
    }

    return { art: 'ladbar', url, basis, spitze }
}

// ── Aus zwei Bäumen ein Anzeigemodell ───────────────────────────────────────

/**
 * Eine Datei, wie sie in beiden Ständen aussieht.
 *
 * **Der Text steht schon drin.** Das Lesen der Blobs macht `gitBrowser.ts`; hier
 * wird nur noch verglichen. Die Trennung ist der Grund, warum von diesem Modul
 * fast alles ohne Browser prüfbar ist — die Alternative wäre eine Funktion, die
 * Git spricht und rechnet, und die man nur im Ganzen oder gar nicht testen kann.
 */
export type DateiPaar = {
    /** Anzeigepfad: der neue Pfad, bei Löschung der alte. */
    pfad: string
    oldPath: string
    newPath: string
    change: DiffFile['change']
    /** Mindestens eine Seite ist binär — dann gibt es nichts zu vergleichen. */
    binaer: boolean
    alt: string
    neu: string
}

/**
 * Aus den Dateipaaren zweier Commits ein {@link ParsedDiff} — **dieselbe Form**,
 * die {@link import('./forgeDiff.ts').parseUnifiedDiff} aus einem Patch liest.
 *
 * Das ist der ganze Punkt der Übung: zwei sehr verschiedene Herkünfte (Text im
 * Ereignis · zwei Bäume aus dem Klon) münden in EIN Anzeigemodell, und die
 * Anzeige weiß von der Herkunft nichts. Ein zweites Diff-Markup daneben wäre die
 * Fehlerform, gegen die `forgeDiff.ts` überhaupt angelegt wurde.
 *
 * **Der Deckel gilt über ALLE Dateien**, nicht je Datei — sonst brächte ein
 * Vorschlag mit vierzig berührten Dateien vierzigmal das Budget mit.
 * {@link ParsedDiff.truncated} sagt es an, und die Fläche schreibt es hin.
 */
export const baueDiff = (paare: readonly DateiPaar[], grenze = DIFF_LINE_LIMIT): ParsedDiff => {
    const files: DiffFile[] = []
    let gesamt = 0
    let truncated = false

    for (const paar of paare) {
        if (paar.binaer) {
            files.push({
                path: paar.pfad,
                oldPath: paar.oldPath,
                newPath: paar.newPath,
                change: paar.change,
                binary: true,
                additions: 0,
                deletions: 0,
                lines: [],
            })
            continue
        }
        const vergleich = vergleicheZeilen(paar.alt, paar.neu)
        const hunks = zuHunks(vergleich.lines)
        // Erst schneiden, dann deckeln: was das Budget abschneidet, sind
        // Hunk-Zeilen, nicht ganze Dateien ohne Kopfzeile.
        const platz = Math.max(0, grenze - gesamt)
        const lines: DiffLine[] = hunks.slice(0, platz)
        if (lines.length < hunks.length) {
            truncated = true
        }
        gesamt += lines.length
        files.push({
            path: paar.pfad,
            oldPath: paar.oldPath,
            newPath: paar.newPath,
            change: paar.change,
            binary: false,
            additions: vergleich.additions,
            deletions: vergleich.deletions,
            lines,
            grob: vergleich.genau ? undefined : true,
        })
    }

    return {
        files,
        additions: files.reduce((n, f) => n + f.additions, 0),
        deletions: files.reduce((n, f) => n + f.deletions, 0),
        truncated,
    }
}
