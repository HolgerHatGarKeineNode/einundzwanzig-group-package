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
import { klonPfad, ordneFehlerEin, zuFortschritt, type Fortschritt, type KlonFehler } from './gitReadme.ts'

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

export { ordneFehlerEin, type KlonFehler, type Fortschritt }
