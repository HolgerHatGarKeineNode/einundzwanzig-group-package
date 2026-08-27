/**
 * P6 — der **netznahe** Teil des Code-Browsers: das Repository in den Browser
 * holen und daraus lesen.
 *
 * **Dieses Modul wird LAZY geladen.** Es zieht `isomorphic-git`,
 * `@isomorphic-git/lightning-fs` und den `buffer`-Shim nach — zusammen 84 kB
 * gzip in vier eigenen Chunks (gemessen am echten Host-Build: 68,8 + 8,2 + 6,8
 * + 0,6). Der Haupt-Chunk wächst dadurch um 0,75 kB. Wer nie einen
 * Code-Browser öffnet, lädt nichts davon. Deshalb steht hier auch nichts, was
 * eine andere Fläche brauchen könnte; die reinen Regeln liegen in
 * `gitReadme.ts` und sind ohne diese Last prüfbar.
 *
 * ── Warum die Git-Importe DYNAMISCH sind ────────────────────────────────────
 *
 * ES-Modulimporte werden gehoben: stünde `import git from 'isomorphic-git'`
 * oben, liefe sein Modulrumpf **vor** jeder Anweisung dieser Datei — also auch
 * vor dem Setzen von `globalThis.Buffer`. Heute berührt sein Rumpf das Global
 * nicht, aber darauf zu bauen hiesse, eine Reihenfolge zu verlassen, die
 * niemand prüft. Der dynamische Import macht sie erzwingbar.
 *
 * ── Was der Server NICHT kann, und was daraus folgt ─────────────────────────
 *
 * `filter=blob:none` trägt nicht (am 2026-08-24 gegen den echten Endpunkt
 * gemessen: `warning: filtering not recognized by server, ignoring`, 8,3 MB
 * kamen an — so viel wie ungefiltert). Es gibt deshalb **einen** Datenpfad:
 * einmal alles holen, danach ist alles lokal. Kein lazy Nachladen einzelner
 * Blobs, keine zweite Codebahn — aber auch keine Möglichkeit, den Download
 * kleiner zu machen als das Repository ist.
 */
import { signer } from '@welshman/app'
import { nip98AuthHeader, type SignedLike } from './nip98.ts'
import {
    istBinaer,
    klonPfad,
    ordneFehlerEin,
    zuFortschritt,
    TEXT_GRENZE,
    type Fortschritt,
    type KlonFehler,
} from './gitReadme.ts'
import type { DateiPaar } from './forgePrDiff.ts'

/**
 * Der `buffer`-Shim (6.0.3, MIT). Statisch, weil er das Global NICHT braucht —
 * anders als der Verbraucher unten.
 */
import { Buffer as BufferShim } from 'buffer'

/** Der Name der IndexedDB-Datenbank. Ein fester Wert, damit ein zweiter Besuch findet, was der erste geholt hat. */
export const FS_NAME = 'einundzwanzig-forge'

type GitModule = typeof import('isomorphic-git')
type Geladen = {
    git: GitModule['default']
    webHttp: { request: (req: Record<string, unknown>) => Promise<unknown> }
    fs: unknown
}

let geladen: Geladen | null = null

/**
 * Die Bibliothek holen — und **vorher** `globalThis.Buffer` setzen.
 *
 * ── Warum diese Zeile steht, und warum sie nicht wegdarf ────────────────────
 *
 * `isomorphic-git` greift **226-mal** auf ein globales `Buffer` zu, **kein
 * einziger** dieser Zugriffe steht hinter einer `typeof`-Wache, und das Paket
 * führt **kein `browser`-Feld** (1.41.4, `index.js:665` ist ein Beispiel:
 * `Math.min(Buffer.from(entry.path).length, 0xfff)`). In einem Browser gibt es
 * `Buffer` nicht.
 *
 * **Ohne diese Zeile baut alles fehlerfrei und stirbt beim ersten Klick** mit
 * `ReferenceError: Buffer is not defined`, sobald der erste echte Git-Pfad
 * läuft — am 2026-08-24 im echten Chromium gemessen: Module laden ✓,
 * Dateisystem schreiben ✓, `init`+`commit` ✗. Ein grüner Build sagt hier
 * nichts.
 *
 * Der Shim liegt über `readable-stream` ohnehin im Bundle; ihn global zu
 * stellen kostet **50 Bytes** (282,13 → 282,18 kB, gemessen). Es ist bewusst
 * KEIN Vite-Polyfill-Plugin und kein `define`: eine Zeile Anwendungscode am
 * spätestmöglichen Ort — hier, im lazy geladenen Git-Einstieg —, damit das
 * Global nur existiert, wo der Code-Browser wirklich läuft.
 *
 * `??=` und nicht `=`: läuft die Seite je in einer Umgebung, die ein echtes
 * `Buffer` mitbringt, wird es nicht überschrieben.
 */
const ladeGit = async (): Promise<Geladen> => {
    if (geladen) {
        return geladen
    }
    ;(globalThis as unknown as { Buffer?: unknown }).Buffer ??= BufferShim

    const [gitMod, httpMod, fsMod] = await Promise.all([
        import('isomorphic-git'),
        import('isomorphic-git/http/web'),
        import('@isomorphic-git/lightning-fs'),
    ])
    const FS = fsMod.default as unknown as new (name: string) => unknown
    geladen = {
        git: gitMod.default,
        webHttp: httpMod.default as unknown as Geladen['webHttp'],
        fs: new FS(FS_NAME),
    }

    return geladen
}

// ── Auth ────────────────────────────────────────────────────────────────────

/**
 * Der `Authorization`-Wert für den Git-Endpunkt — **einmal je Clone**.
 *
 * Zwei Eigenheiten, beide am Buzz-Quelltext geprüft:
 *
 * 1. **Der `u`-Tag trägt die REPO-BASIS, nicht die aufgerufene URL.**
 *    `git_expected_url` (`api/git/transport.rs:323-341`) schneidet alles ab
 *    `/info/refs` bzw. `/git-upload-pack` weg, samt Query. Ein Token auf die
 *    Endpunkt-URL wird mit `401 NIP-98 auth failed` abgewiesen — der erste
 *    Versuch des Auftraggebers ist genau daran gescheitert.
 * 2. **Ein Token gilt für den ganzen Vorgang.** Buzz hat den Replay-Schutz für
 *    Git ausdrücklich abgeschaltet (`transport.rs:194-199`: „Rejecting replayed
 *    event IDs would break normal clone/push operations"). Das ist keine
 *    Bequemlichkeit, sondern der Unterschied zwischen EINER Bunker-Signatur und
 *    einer je Anfrage — bei NIP-46 sind das Minuten gegen Sekunden.
 *
 * Das Zeitfenster ist **±60 s** (`buzz-auth/src/nip98.rs:32`). Der Header wird
 * deshalb unmittelbar vor dem Clone gebaut und nie gecacht.
 */
export const gitAuthHeader = async (repoBasis: string): Promise<string> => {
    const sign = signer.get()
    if (!sign) {
        throw Object.assign(new Error('nicht-angemeldet'), { code: 'nicht-angemeldet' })
    }

    return nip98AuthHeader((e) => sign.sign(e) as Promise<SignedLike>, repoBasis, 'GET')
}

// ── Klonen ──────────────────────────────────────────────────────────────────

export type KlonAuftrag = {
    /** Die Repo-Basis, zeichengenau so wie im `u`-Tag. */
    url: string
    owner: string
    dtag: string
    /** Wird bei jedem Fortschritt gerufen. */
    aufFortschritt?: (f: Fortschritt) => void
    /** Bricht den laufenden Download ab. */
    signal?: AbortSignal
}

/**
 * Das Repository in den Browser holen.
 *
 * `depth: 1` · `singleBranch: true` · **`noCheckout: true`** — und das letzte
 * ist keine Sparsamkeit, sondern die einzige tragbare Form: mit Arbeitsbaum
 * misst dasselbe Repository **39 MB** statt 8,3 (gemessen), und ein
 * Code-Browser liest ohnehin aus der Objektdatenbank, nicht aus Dateien.
 *
 * ── Abbrechbar, und zwar ECHT ───────────────────────────────────────────────
 *
 * `clone` kennt kein `signal` (die Option steht in der Typdefinition als
 * „Reserved for future use"). Der HTTP-Client ist aber **unserer**, und
 * `http/web` reicht `fetchOptions` unverändert in `fetch()` weiter
 * (`http/web/index.js:142`). Darüber geht das Signal an die laufende Anfrage —
 * es ist ein echter Netzabbruch, kein Weggucken.
 */
export const klone = async ({ url, owner, dtag, aufFortschritt, signal }: KlonAuftrag): Promise<string> => {
    const { git, webHttp, fs } = await ladeGit()
    const dir = klonPfad(owner, dtag)
    const headers = { Authorization: await gitAuthHeader(url) }

    const http = {
        request: (req: Record<string, unknown>) => webHttp.request({ ...req, fetchOptions: { signal } }),
    }

    await git.clone({
        fs: fs as never,
        http: http as never,
        dir,
        url,
        headers,
        ref: undefined,
        singleBranch: true,
        depth: 1,
        noCheckout: true,
        noTags: true,
        onProgress: aufFortschritt ? (p) => aufFortschritt(zuFortschritt(p)) : undefined,
    })
    await flush(fs)

    return dir
}

/**
 * Den Verzeichnisbaum SOFORT sichern.
 *
 * **Ohne diesen Aufruf geht ein fertiger Klon verloren, wenn der Nutzer gleich
 * weiterklickt** — und das ist keine Theorie, ein Prüfstand hat es gefunden:
 * nach dem Neuladen der Seite lag `einundzwanzig-forge_files` voller Blobs in
 * IndexedDB, der Baum aber war weg, und die Fläche bot den Download erneut an.
 * 8,3 MB ein zweites Mal.
 *
 * Ursache ist `DefaultBackend`: `saveSuperblock` ist um **500 ms entprellt**
 * (`@isomorphic-git/lightning-fs/src/DefaultBackend.js:15-17`). Die Dateien
 * landen sofort in der Datenbank, der Baum erst nach der Ruhepause. Wer in
 * diesem Fenster navigiert, hinterlässt verwaiste Blobs.
 *
 * `flush()` ist öffentlich (`src/index.js:90`) — kein Griff in Interna.
 */
const flush = async (fs: unknown): Promise<void> => {
    const p = (fs as { promises?: { flush?: () => Promise<void> } }).promises
    try {
        await p?.flush?.()
    } catch {
        // Ein fehlgeschlagener Flush macht den Klon nicht ungültig — er macht
        // ihn nur flüchtig. Deshalb kein Wurf nach aussen.
    }
}

// ── Lesen ───────────────────────────────────────────────────────────────────

/** Ein Eintrag der obersten Ebene. */
export type WurzelEintrag = { name: string; art: 'blob' | 'tree' | 'commit' }

/** Liegt dieses Repository schon lokal? Dann kostet das Anzeigen kein Byte. */
export const istGeklont = async (owner: string, dtag: string): Promise<boolean> => {
    const { git, fs } = await ladeGit()
    try {
        await git.resolveRef({ fs: fs as never, dir: klonPfad(owner, dtag), ref: 'HEAD' })

        return true
    } catch {
        return false
    }
}

/** Die Einträge der obersten Ebene — die Grundlage der README-Auswahl. */
export const wurzelEintraege = async (owner: string, dtag: string): Promise<WurzelEintrag[]> => {
    const { git, fs } = await ladeGit()
    const dir = klonPfad(owner, dtag)
    const oid = await git.resolveRef({ fs: fs as never, dir, ref: 'HEAD' })
    const { tree } = await git.readTree({ fs: fs as never, dir, oid, filepath: '' })

    return tree.map((e) => ({ name: e.path, art: e.type as WurzelEintrag['art'] }))
}

/**
 * Eine Datei aus dem geklonten Repository, als Text.
 *
 * `TextDecoder` mit `fatal: false`: eine Datei mit kaputter Kodierung soll mit
 * Ersatzzeichen erscheinen, nicht die ganze Anzeige zum Absturz bringen.
 */
export const leseDatei = async (owner: string, dtag: string, pfad: string): Promise<string> => {
    const { git, fs } = await ladeGit()
    const dir = klonPfad(owner, dtag)
    const oid = await git.resolveRef({ fs: fs as never, dir, ref: 'HEAD' })
    const { blob } = await git.readBlob({ fs: fs as never, dir, oid, filepath: pfad })

    return new TextDecoder('utf-8', { fatal: false }).decode(blob)
}

/** Den Kopf-Commit — für die Angabe „Stand vom …". */
export const kopfCommit = async (owner: string, dtag: string): Promise<{ oid: string; zeit: number } | null> => {
    const { git, fs } = await ladeGit()
    const dir = klonPfad(owner, dtag)
    try {
        const oid = await git.resolveRef({ fs: fs as never, dir, ref: 'HEAD' })
        const { commit } = await git.readCommit({ fs: fs as never, dir, oid })

        return { oid, zeit: commit.author?.timestamp ?? 0 }
    } catch {
        return null
    }
}

// ── Baum und Dateien ────────────────────────────────────────────────────────

/**
 * Die Einträge EINES Verzeichnisses.
 *
 * **Aus demselben Klon wie das README** — es gibt genau einen Datenpfad. Nach
 * dem Clone ist alles lokal; diese Funktion berührt kein Netz. Das ist der
 * einzige Vorteil, den das `blob:none`-Nein übriggelassen hat, und er wird hier
 * eingelöst.
 *
 * `filepath: ''` ist die Wurzel. Ein Pfad, den es nicht gibt, wirft — der
 * Aufrufer ordnet das über {@link ordneFehlerEin} ein.
 */
export const baumEintraege = async (owner: string, dtag: string, pfad = ''): Promise<WurzelEintrag[]> => {
    const { git, fs } = await ladeGit()
    const dir = klonPfad(owner, dtag)
    const oid = await git.resolveRef({ fs: fs as never, dir, ref: 'HEAD' })
    const { tree } = await git.readTree({ fs: fs as never, dir, oid, filepath: pfad })

    return tree.map((e) => ({ name: e.path, art: e.type as WurzelEintrag['art'] }))
}

/**
 * Die ROHEN Bytes einer Datei.
 *
 * Bewusst Bytes und nicht Text: ob überhaupt Text daraus wird, entscheidet
 * {@link import('./gitReadme.ts').dateiArt} — und die Entscheidung braucht die
 * Bytes. Wer hier schon dekodierte, hätte aus einem PNG stillschweigend
 * Ersatzzeichen gemacht und die Frage „ist das binär?" unbeantwortbar.
 */
export const leseBytes = async (owner: string, dtag: string, pfad: string): Promise<Uint8Array> => {
    const { git, fs } = await ladeGit()
    const dir = klonPfad(owner, dtag)
    const oid = await git.resolveRef({ fs: fs as never, dir, ref: 'HEAD' })
    const { blob } = await git.readBlob({ fs: fs as never, dir, oid, filepath: pfad })

    return blob
}

/*
 * HIER STAND EINE `verlauf()`-FUNKTION — und sie ist bewusst wieder raus.
 *
 * Ein Commit-Log braucht Historie, und die ist bei dieser Bauform nicht da: der
 * Klon läuft auf `depth: 1`, weil der Server kein `filter=blob:none` kann. Was
 * ein tieferer Klon kostet, ist gemessen (2026-08-24, lokal, zehn Commits mit je
 * einer 1-MB-Datei):
 *
 *   Repository vollständig   14 MB   (10 Commits)
 *   depth = 1               1,1 MB   ( 1 Commit)
 *   nach deepen = 9          13 MB   (10 Commits)
 *
 * Neun Commits Historie kosten also fast das ganze Repository — ohne Filter
 * bringt jeder Commit seine vollständigen Bäume und Blobs mit. Ein Commit-Log
 * ist damit ein **zweiter, grosser Ladeweg**, keine Anzeige über vorhandene
 * Daten.
 *
 * Eine Funktion, die genau einen Eintrag liefert und so tut, als wäre sie ein
 * Verlauf, wäre die schlechtere Antwort als keine. Sie kommt wieder, wenn
 * entschieden ist, ob der Nutzer diesen zweiten Download angeboten bekommt —
 * mit derselben Ansage wie der erste.
 */

// ── Was lokal liegt ─────────────────────────────────────────────────────────

/** Ein lokal liegender Klon. */
export type LokalerKlon = { owner: string; dtag: string; nutzdaten: number }

/**
 * Alle lokal liegenden Klone — mit ihren **gemessenen** Nutzdaten.
 *
 * „Nutzdaten" und nicht „Speicherverbrauch", und der Unterschied ist keine
 * Wortklauberei: die Zahl ist die Summe der Dateigrössen im virtuellen
 * Dateisystem. Was IndexedDB darum herum an Verwaltung anlegt, weiss nur der
 * Browser, und **je Repository sagt er es nicht**. Eine hochgerechnete Zahl
 * wäre eine erfundene; deshalb steht die Ursprungszahl aus
 * {@link speicherLage} getrennt daneben.
 */
export const lokaleKlone = async (): Promise<LokalerKlon[]> => {
    const { fs } = await ladeGit()
    const p = (fs as { promises: {
        readdir(x: string): Promise<string[]>
        stat(x: string): Promise<{ isDirectory(): boolean; size: number }>
    } }).promises

    const summe = async (pfad: string): Promise<number> => {
        let kinder: string[] = []
        try {
            kinder = await p.readdir(pfad)
        } catch {
            try {
                return (await p.stat(pfad)).size ?? 0
            } catch {
                return 0
            }
        }
        let n = 0
        for (const kind of kinder) {
            n += await summe(`${pfad}/${kind}`)
        }

        return n
    }

    const out: LokalerKlon[] = []
    let owners: string[] = []
    try {
        owners = await p.readdir('/repos')
    } catch {
        return out
    }
    for (const owner of owners) {
        let dtags: string[] = []
        try {
            dtags = await p.readdir(`/repos/${owner}`)
        } catch {
            continue
        }
        for (const dtag of dtags) {
            out.push({ owner, dtag, nutzdaten: await summe(`/repos/${owner}/${dtag}`) })
        }
    }

    return out.sort((a, b) => b.nutzdaten - a.nutzdaten)
}

// ── Speicher ────────────────────────────────────────────────────────────────

/**
 * Wie viel der Browser diesem Ursprung insgesamt zugeteilt hat und wie viel
 * belegt ist — `null`, wenn die Umgebung es nicht sagt.
 *
 * Bewusst die Zahl des ganzen Ursprungs und nicht die des Repositories: eine
 * je-Repo-Zahl gäbe IndexedDB nicht her, und eine geschätzte wäre eine
 * erfundene.
 */
export const speicherLage = async (): Promise<{ belegt: number; kontingent: number } | null> => {
    const s = (navigator as unknown as { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } }).storage
    if (!s?.estimate) {
        return null
    }
    try {
        const { usage, quota } = await s.estimate()

        return { belegt: usage ?? 0, kontingent: quota ?? 0 }
    } catch {
        return null
    }
}

/** Einen lokalen Klon wieder loswerden. */
export const entferneKlon = async (owner: string, dtag: string): Promise<void> => {
    const { fs } = await ladeGit()
    const dir = klonPfad(owner, dtag)
    const p = (fs as { promises: { readdir(x: string): Promise<string[]>; unlink(x: string): Promise<void>; rmdir(x: string): Promise<void>; stat(x: string): Promise<{ isDirectory(): boolean }> } }).promises

    const weg = async (pfad: string): Promise<void> => {
        let eintraege: string[] = []
        try {
            eintraege = await p.readdir(pfad)
        } catch {
            // Keine Verzeichnis-Einträge: dann ist es eine Datei.
            await p.unlink(pfad).catch(() => undefined)

            return
        }
        for (const e of eintraege) {
            await weg(`${pfad}/${e}`)
        }
        await p.rmdir(pfad).catch(() => undefined)
    }
    await weg(dir)
    // Sonst stünde der gelöschte Baum nach einem Neuladen wieder da: gelöscht
    // ist er nur im Speicher, bis der Superblock geschrieben ist.
    await flush(fs)
}

// ── Der PR-Diff (P7b) ───────────────────────────────────────────────────────

/**
 * Wie viele Commits tief nachgeholt wird, wenn der `merge-base` im flachen
 * Bestand fehlt.
 *
 * **Die Zahl ist eine Kostenentscheidung, keine technische Grenze.** Gemessen
 * am selben Repository (2026-08-24): 1 Commit = 1,1 MB, 10 Commits = 13 MB von
 * 14 MB gesamt — der Server kann kein `filter=blob:none`, also bringt jeder
 * zusätzliche Commit seine vollständigen Bäume und Blobs mit. 50 ist großzügig
 * für einen normalen Vorschlag und bleibt eine Zahl, die man in der Ansage
 * nennen kann.
 */
export const PR_DIFF_TIEFE = 50

/** Warum ein PR-Diff am Git-Endpunkt nicht zustande kam. */
export type PrDiffFehler = KlonFehler | 'spitze-fehlt' | 'basis-fehlt'

export type PrDiffAuftrag = {
    /** Die Repo-Basis, zeichengenau so wie im `u`-Tag. */
    url: string
    owner: string
    dtag: string
    /** `merge-base` — der Punkt, gegen den gerechnet wird. */
    basis: string
    /** `c` — der Stand, den der Vorschlag vorschlägt. */
    spitze: string
    aufFortschritt?: (f: Fortschritt) => void
    signal?: AbortSignal
}

/**
 * Die berührten Dateien zwischen `merge-base` und Tip — **als Text, noch nicht
 * verglichen.**
 *
 * Der Vergleich selbst steht in `forgePrDiff.ts` und ist ohne Browser prüfbar;
 * hier passiert nur, was Git braucht. Dieselbe Trennung wie zwischen
 * `gitBrowser.ts` und `gitReadme.ts`, und aus demselben Grund.
 *
 * ── Warum ALLE Branches geholt werden und nicht der Tip ─────────────────────
 *
 * Ein `want <oid>` auf einen Commit, der kein Ref-Tip ist, setzt
 * `uploadpack.allowReachableSHA1InWant` voraus — im Buzz-Quellbaum nirgends
 * gesetzt, und `isomorphic-git` fragt die Capability ohnehin nie an (seine
 * Liste ist ein festes Literal). Der tragfähige Weg ist deshalb: die Ref-Tips
 * holen und danach **nachsehen**, ob der gesuchte Commit dabei ist. Ist er es
 * nicht, ist das eine Auskunft (`spitze-fehlt`) und keine Fehlermeldung — der
 * Tip liegt dann in einem Fork, und den kennt dieser Endpunkt nicht.
 *
 * ── Und warum in zwei Stufen ────────────────────────────────────────────────
 *
 * Erst `depth: 1`: das reicht, wenn der Vorschlag genau einen Commit vor seiner
 * Basis liegt — der häufigste Fall. Fehlt die Basis danach, wird EINMAL auf
 * {@link PR_DIFF_TIEFE} vertieft. Zwei bewusste Schritte statt eines großen:
 * der billige Fall bleibt billig, und der teure ist in der Ansage genannt.
 */
export const holePrDateipaare = async ({
    url,
    owner,
    dtag,
    basis,
    spitze,
    aufFortschritt,
    signal,
}: PrDiffAuftrag): Promise<DateiPaar[]> => {
    const { git, webHttp, fs } = await ladeGit()
    const dir = klonPfad(owner, dtag)
    const headers = { Authorization: await gitAuthHeader(url) }
    const http = {
        request: (req: Record<string, unknown>) => webHttp.request({ ...req, fetchOptions: { signal } }),
    }

    // Ein Repository, das noch nie geholt wurde, hat kein `.git` — `fetch`
    // braucht eins. `init` auf ein bestehendes ist folgenlos.
    try {
        await git.resolveRef({ fs: fs as never, dir, ref: 'HEAD' })
    } catch {
        await git.init({ fs: fs as never, dir })
    }
    // ── Und es braucht eine REFSPEC, nicht nur eine URL ──────────────────────
    //
    // **Ohne diese Zeile bricht jeder Fetch ab**, und zwar mit
    // `NoRefspecError: Could not find a fetch refspec for remote "origin"` —
    // am 2026-08-27 im echten Chromium gegen ein echtes `git upload-pack`
    // gemessen. `git.init()` legt keinen Remote an; `fetch({url})` ordnet die
    // gelieferten Refs trotzdem über `remote.<name>.fetch` in
    // `refs/remotes/origin/*` ein und findet den Eintrag dann nicht.
    // `clone()` fällt nicht darauf herein, weil es intern selbst `addRemote`
    // ruft — deshalb ist der README-Pfad davon nie betroffen gewesen.
    //
    // `force: true`: ein vorhandener Remote (nach einem früheren Klon desselben
    // Repositories) wird überschrieben statt abgelehnt. Die URL kann sich
    // geändert haben — das 30617 ist ersetzbar.
    //
    // **Das ist der Befund, den erst der Prüfstand mit echter Git-Gegenstelle
    // gefunden hat.** Bis dahin war dieser Pfad nie gelaufen: ein Build, ein
    // Typecheck und dreizehn Unit-Tests sagen darüber nichts.
    await git.addRemote({ fs: fs as never, dir, remote: 'origin', url, force: true })

    const liegtVor = async (oid: string): Promise<boolean> => {
        try {
            await git.readCommit({ fs: fs as never, dir, oid })

            return true
        } catch {
            return false
        }
    }

    const hole = async (depth: number): Promise<void> => {
        await git.fetch({
            fs: fs as never,
            http: http as never,
            dir,
            url,
            headers,
            singleBranch: false,
            tags: false,
            depth,
            onProgress: aufFortschritt ? (p) => aufFortschritt(zuFortschritt(p)) : undefined,
        })
        await flush(fs)
    }

    if (!(await liegtVor(spitze)) || !(await liegtVor(basis))) {
        await hole(1)
    }
    if (!(await liegtVor(spitze))) {
        throw Object.assign(new Error('spitze-fehlt'), { code: 'spitze-fehlt' })
    }
    if (!(await liegtVor(basis))) {
        await hole(PR_DIFF_TIEFE)
    }
    if (!(await liegtVor(basis))) {
        throw Object.assign(new Error('basis-fehlt'), { code: 'basis-fehlt' })
    }

    const baumVon = async (commitOid: string): Promise<string> =>
        (await git.readCommit({ fs: fs as never, dir, oid: commitOid })).commit.tree

    const paare: DateiPaar[] = []
    await sammleUnterschiede(git, fs, dir, await baumVon(basis), await baumVon(spitze), '', paare)

    return paare.sort((a, b) => a.pfad.localeCompare(b.pfad))
}

/** Ein Eintrag eines Git-Baums, auf das reduziert, was der Vergleich braucht. */
type BaumZeile = { path: string; oid: string; type: string }

const leseBaum = async (git: GitModule['default'], fs: unknown, dir: string, oid: string): Promise<BaumZeile[]> => {
    try {
        const { tree } = await git.readTree({ fs: fs as never, dir, oid })

        return tree.map((e) => ({ path: e.path, oid: e.oid, type: e.type as string }))
    } catch {
        return []
    }
}

/**
 * Zwei Bäume gegeneinander laufen lassen — rekursiv, Ebene für Ebene.
 *
 * **Gleiche Oid heißt gleicher Inhalt.** Ein Unterverzeichnis mit unverändertem
 * Baum-Hash wird gar nicht erst betreten; das ist der Grund, warum ein Vergleich
 * über ein großes Repository trotzdem schnell ist.
 *
 * **Umbenennungen werden NICHT erkannt.** Git rechnet sie heuristisch aus
 * Ähnlichkeit aus; wir zeigen sie als Löschung plus Neuanlage. Das ist die
 * ehrlichere Anzeige für einen Client, der die Heuristik nicht hat — eine
 * geratene Umbenennung wäre eine Behauptung über Absicht.
 */
const sammleUnterschiede = async (
    git: GitModule['default'],
    fs: unknown,
    dir: string,
    oidAlt: string,
    oidNeu: string,
    praefix: string,
    out: DateiPaar[],
): Promise<void> => {
    if (oidAlt === oidNeu) {
        return
    }
    const alt = new Map((await leseBaum(git, fs, dir, oidAlt)).map((e) => [e.path, e]))
    const neu = new Map((await leseBaum(git, fs, dir, oidNeu)).map((e) => [e.path, e]))
    const namen = [...new Set([...alt.keys(), ...neu.keys()])].sort()

    for (const name of namen) {
        const a = alt.get(name)
        const b = neu.get(name)
        const pfad = praefix === '' ? name : `${praefix}/${name}`

        if (a?.type === 'tree' && b?.type === 'tree') {
            await sammleUnterschiede(git, fs, dir, a.oid, b.oid, pfad, out)
            continue
        }
        // Ein Verzeichnis, das zur Datei wurde (oder umgekehrt): beide Seiten
        // getrennt behandeln, statt so zu tun, als wäre es dasselbe Ding.
        if (a?.type === 'tree') {
            await sammleUnterschiede(git, fs, dir, a.oid, '', pfad, out)
            if (b) {
                out.push(await zuPaar(git, fs, dir, pfad, undefined, b))
            }
            continue
        }
        if (b?.type === 'tree') {
            if (a) {
                out.push(await zuPaar(git, fs, dir, pfad, a, undefined))
            }
            await sammleUnterschiede(git, fs, dir, '', b.oid, pfad, out)
            continue
        }
        if (a && b && a.oid === b.oid) {
            continue
        }
        // `commit` ist ein Submodul-Zeiger — kein Inhalt, den ein Browser hätte.
        if (a?.type === 'commit' || b?.type === 'commit') {
            continue
        }
        out.push(await zuPaar(git, fs, dir, pfad, a, b))
    }
}

/**
 * Einen Blob als Text holen — oder als „binär" markieren.
 *
 * Dieselbe Entscheidungsreihe wie in der Dateianzeige
 * ({@link import('./gitReadme.ts').dateiArt}): erst die Größe, dann die
 * NUL-Prüfung. Wer zuerst dekodiert, hat aus einem PNG stillschweigend
 * Ersatzzeichen gemacht und die Frage „ist das binär?" unbeantwortbar.
 */
const leseText = async (
    git: GitModule['default'],
    fs: unknown,
    dir: string,
    oid: string,
): Promise<{ text: string; binaer: boolean }> => {
    try {
        const { blob } = await git.readBlob({ fs: fs as never, dir, oid })
        if (blob.length > TEXT_GRENZE || istBinaer(blob)) {
            return { text: '', binaer: true }
        }

        return { text: new TextDecoder('utf-8', { fatal: false }).decode(blob), binaer: false }
    } catch {
        return { text: '', binaer: true }
    }
}

const zuPaar = async (
    git: GitModule['default'],
    fs: unknown,
    dir: string,
    pfad: string,
    a: BaumZeile | undefined,
    b: BaumZeile | undefined,
): Promise<DateiPaar> => {
    const alt = a ? await leseText(git, fs, dir, a.oid) : { text: '', binaer: false }
    const neu = b ? await leseText(git, fs, dir, b.oid) : { text: '', binaer: false }

    return {
        pfad,
        oldPath: a ? pfad : '/dev/null',
        newPath: b ? pfad : '/dev/null',
        change: !a ? 'add' : !b ? 'del' : 'mod',
        binaer: alt.binaer || neu.binaer,
        alt: alt.text,
        neu: neu.text,
    }
}

export { ordneFehlerEin, type KlonFehler, type Fortschritt }
