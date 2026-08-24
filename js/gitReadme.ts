/**
 * P6 — die **reine** Hälfte des Code-Browsers: welche clone-URL, welches
 * README, welcher Ablageort, welche Größenangabe.
 *
 * Kein Netz, kein `isomorphic-git`, keine welshman-Importe, relative Importe
 * mit `.ts` — damit `node --experimental-strip-types --test` das Modul lädt.
 * Alles Netznahe steht in `gitBrowser.ts`, und das wird **lazy** geladen: die
 * Bibliothek wiegt 84 kB gzip und gehört nicht in den Chunk, den jede Seite
 * zieht.
 *
 * ── Die Vorbedingung, ohne die dieses Modul nicht existieren dürfte ─────────
 *
 * Ein NIP-34-Repository enthält **keinen Code**. Das 30617 trägt nur
 * `clone`/`web`-URLs, das 30618 nur Ref-Namen. Wer eine Datei zeigen will, muss
 * Git sprechen. Am 2026-08-24 wurde gemessen, dass unser eigener Relay das
 * hergibt: `/git/<owner>/<repo>` über NIP-98, CORS für beide Hosts frei,
 * clone-URLs zeigen dorthin.
 *
 * ── Und die Grenze, die den ganzen Aufbau bestimmt ──────────────────────────
 *
 * **`filter=blob:none` trägt nicht.** Am 2026-08-24 gegen den echten Endpunkt
 * gemessen: `warning: filtering not recognized by server, ignoring`, 8,3 MB
 * kamen an — Byte für Byte so viel wie ungefiltert. Ursache ist
 * `uploadpack.allowFilter` (Default `false`, im Buzz-Quellbaum nirgends
 * gesetzt, und `harden_git_env` schneidet System- und Global-Config ab).
 * Selbst wenn es gesetzt WÄRE, fragte `isomorphic-git` die Capability nie an —
 * seine Liste ist ein festes Literal (`index.js:10172-10186`).
 *
 * Zwei Folgen, und beide stehen in der Fläche:
 *
 * 1. **Es gibt nur eine Bauform:** ganzes Repository auf `depth: 1`, ohne
 *    Arbeitsbaum (`noCheckout`). Mit Arbeitsbaum wären es 39 MB statt 8,3 —
 *    bei einer App mit 37 MB APK eine Verdopplung für EIN Repository.
 * 2. **Der Download ist eine Entscheidung des Nutzers**, kein Nebenbei. Die
 *    Fläche sagt das an, bevor sie lädt — auf einem Telefon im Mobilfunknetz
 *    ist es sein Datenvolumen.
 */

// ── Die clone-URL ───────────────────────────────────────────────────────────

/**
 * Die erste brauchbare clone-URL — oder `''`.
 *
 * **Nur `http(s)`.** `git://` und `ssh://` kann ein Browser nicht sprechen; sie
 * hier durchzulassen hiesse, den Fehler in die Bibliothek zu verschieben, wo er
 * als unverständlicher Netzfehler ankommt statt als klare Auskunft „dieses
 * Repository ist von hier nicht erreichbar".
 *
 * Der abschliessende `/` fällt weg: der NIP-98-`u`-Tag muss **zeichengenau**
 * die Repo-Basis tragen, die der Server erwartet (`git_expected_url` baut sie
 * aus `path` ohne Query zusammen), und ein Schrägstrich zu viel ist ein
 * `401 NIP-98 auth failed`.
 */
export const waehleCloneUrl = (cloneUrls: readonly string[]): string => {
    for (const roh of cloneUrls) {
        const url = (roh ?? '').trim()
        if (/^https?:\/\//i.test(url)) {
            return url.replace(/\/+$/, '')
        }
    }

    return ''
}

/**
 * Zeigt diese clone-URL auf den Workspace-Relay selbst?
 *
 * Nur dann trägt unser NIP-98-Token: es ist auf `https://<host>/git/…`
 * ausgestellt, und ein fremder Git-Host würde es nicht einmal verstehen. Ein
 * GitHub-Repo ist deshalb keine Fehlermeldung, sondern eine andere Auskunft —
 * „liegt woanders, hier ist der Link".
 */
export const istEigenerHost = (cloneUrl: string, relayUrl: string): boolean => {
    if (!cloneUrl || !relayUrl) {
        return false
    }
    try {
        const a = new URL(cloneUrl)
        const b = new URL(relayUrl.replace(/^ws/, 'http'))

        return a.host.toLowerCase() === b.host.toLowerCase()
    } catch {
        return false
    }
}

/**
 * Der Ablageort im Browser-Dateisystem (IndexedDB über LightningFS).
 *
 * Aus **Eigentümer und `d`-Tag**, nicht aus dem Repo-Namen: der Name ist frei
 * wählbar und zweimal vergeben in derselben Sekunde. Die Koordinate ist die
 * Identität — dieselbe Regel, nach der die ganze Forge ihre Adressen bildet.
 */
export const klonPfad = (owner: string, dtag: string): string =>
    `/repos/${owner.toLowerCase()}/${dtag.replace(/[^a-zA-Z0-9._-]/g, '_')}`

// ── README ─────────────────────────────────────────────────────────────────

/**
 * Bevorzugte README-Dateinamen, in dieser Reihenfolge.
 *
 * Konzept von Amethysts `findReadme` (`GitReadmeTab.kt:166-174`) — Markdown
 * zuerst, weil wir es rendern können; `.rst` steht am Ende, weil wir es nur als
 * Text zeigen.
 */
export const README_VORZUG: readonly string[] = [
    'readme.md',
    'readme.markdown',
    'readme.mdown',
    'readme',
    'readme.txt',
    'readme.rst',
]

/**
 * Der beste README-Kandidat aus einer Liste von Wurzel-Dateinamen — oder `''`.
 *
 * Nur die **Wurzel**: ein `docs/readme.md` ist die Anleitung eines
 * Unterverzeichnisses, nicht die Visitenkarte des Repositories. Der Aufrufer
 * reicht deshalb nur die oberste Ebene herein.
 *
 * Steht keiner der bevorzugten Namen da, gewinnt die erste Datei, deren Name
 * ohne Endung `readme` heisst (`README.adoc`, `readme.org`) — sonst `''`.
 */
export const findeReadme = (wurzelNamen: readonly string[]): string => {
    const kandidaten = wurzelNamen.filter((name) => {
        const klein = name.toLowerCase()

        return klein === 'readme' || klein.startsWith('readme.')
    })
    if (kandidaten.length === 0) {
        return ''
    }
    for (const vorzug of README_VORZUG) {
        const treffer = kandidaten.find((name) => name.toLowerCase() === vorzug)
        if (treffer) {
            return treffer
        }
    }

    return [...kandidaten].sort((a, b) => a.localeCompare(b))[0] ?? ''
}

/** Rendern wir diese Datei als Markdown, oder zeigen wir sie als Text? */
export const istMarkdown = (name: string): boolean =>
    /\.(md|markdown|mdown)$/i.test(name)

// ── Größen ─────────────────────────────────────────────────────────────────

/**
 * Bytes als Zahl und Einheit — **getrennt**, damit die Fläche sie übersetzen
 * kann.
 *
 * Die Einheit ist ein Code (`B`/`kB`/`MB`), kein fertiger Satz: ein
 * zusammengesetzter String hier hiesse, eine unübersetzbare Zeichenkette durch
 * die Übersetzungsschicht zu schmuggeln — dieselbe Regel wie bei `rootTitle`.
 *
 * Dezimal (1000), nicht binär (1024): der Nutzer vergleicht die Zahl mit dem
 * Datenvolumen seines Mobilfunkvertrags, und der rechnet in Megabyte zu 1000.
 */
export type Groesse = { zahl: number; einheit: 'B' | 'kB' | 'MB' }

export const groesse = (bytes: number): Groesse => {
    const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
    if (n < 1000) {
        return { zahl: Math.round(n), einheit: 'B' }
    }
    if (n < 1_000_000) {
        return { zahl: Math.round(n / 100) / 10, einheit: 'kB' }
    }

    return { zahl: Math.round(n / 100_000) / 10, einheit: 'MB' }
}

// ── Fortschritt ────────────────────────────────────────────────────────────

/**
 * Der Fortschritt eines Clones, anzeigefertig.
 *
 * `isomorphic-git` meldet `{phase, loaded, total}`. **`total` ist oft `0`** —
 * bei der Phase „Receiving objects" kennt der Client die Gesamtzahl erst, wenn
 * der Server sie genannt hat, und bei „Analyzing workdir" gibt es keine. Ein
 * Balken, der aus `loaded/total` rechnet, springt dann auf `Infinity` oder
 * bleibt bei 0 stehen und behauptet Stillstand, wo Arbeit läuft.
 *
 * Deshalb zwei getrennte Aussagen: ein **Anteil** nur, wenn er berechenbar ist
 * (`null` sonst), und der rohe Zähler immer. Was die Fläche nicht weiß, sagt
 * sie nicht.
 */
export type Fortschritt = { phase: string; anteil: number | null; geladen: number; gesamt: number }

export const zuFortschritt = (p: { phase?: string; loaded?: number; total?: number }): Fortschritt => {
    const geladen = Number.isFinite(p.loaded) ? Math.max(0, p.loaded as number) : 0
    const gesamt = Number.isFinite(p.total) ? Math.max(0, p.total as number) : 0

    return {
        phase: p.phase ?? '',
        anteil: gesamt > 0 ? Math.min(1, geladen / gesamt) : null,
        geladen,
        gesamt,
    }
}

// ── Fehlercodes ────────────────────────────────────────────────────────────

/**
 * Warum ein Clone nicht geklappt hat — als CODE, nicht als Satz.
 *
 * Die Fläche übersetzt; dieses Modul bleibt sprachfrei. `unbekannt` ist
 * ausdrücklich vorgesehen: einen Fehler in eine der bekannten Schubladen zu
 * pressen, die nicht passt, wäre schlimmer als zuzugeben, dass wir ihn nicht
 * einordnen können.
 */
export type KlonFehler =
    | 'keine-clone-url'
    | 'fremder-host'
    | 'nicht-angemeldet'
    | 'abgebrochen'
    | 'kein-zugriff'
    | 'netz'
    | 'unbekannt'

/**
 * Einen geworfenen Fehler einordnen.
 *
 * **`AbortError` zuerst**, und das ist kein Stil: ein abgebrochener `fetch`
 * wirft, und wer die Reihenfolge dreht, meldet dem Nutzer einen Netzfehler für
 * etwas, das er selbst ausgelöst hat.
 */
export const ordneFehlerEin = (fehler: unknown): KlonFehler => {
    const name = (fehler as { name?: string } | null)?.name ?? ''
    const text = String((fehler as { message?: string } | null)?.message ?? fehler ?? '')

    if (name === 'AbortError' || /abort/i.test(text)) {
        return 'abgebrochen'
    }
    if (/\b401\b|unauthor|nip-98|not a member|forbidden|\b403\b/i.test(text)) {
        return 'kein-zugriff'
    }
    if (/failed to fetch|networkerror|load failed|cors|econnrefused/i.test(text)) {
        return 'netz'
    }

    return 'unbekannt'
}

// ── Der Baum ────────────────────────────────────────────────────────────────

/** Ein Eintrag im Verzeichnisbaum, wie ihn die Fläche braucht. */
export type BaumEintrag = { name: string; art: 'blob' | 'tree' | 'commit' }

/**
 * Anzeigereihenfolge: Verzeichnisse zuerst, dann alphabetisch ohne Rücksicht
 * auf Gross-/Kleinschreibung.
 *
 * Dieselbe Regel wie in Amethysts `sortForDisplay` und wie in jedem Dateimanager
 * — und sie ist nicht Geschmack: Git liefert die Baumeinträge in seiner eigenen
 * Sortierung (Verzeichnisse mit angehängtem `/`), in der `Zebra` vor `apfel`
 * steht. Wer sie durchreicht, zeigt eine Liste, die kein Mensch überfliegen kann.
 *
 * `localeCompare` ohne Locale-Argument: die Sprache der Oberfläche entscheidet,
 * nicht die des Repositories.
 */
export const sortiereEintraege = (eintraege: readonly BaumEintrag[]): BaumEintrag[] =>
    [...eintraege].sort((a, b) => {
        const aOrdner = a.art === 'tree'
        const bOrdner = b.art === 'tree'
        if (aOrdner !== bOrdner) {
            return aOrdner ? -1 : 1
        }

        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })

/**
 * Ein Pfad als Krümelspur — Paare aus Beschriftung und Zielpfad.
 *
 * Der leere Pfad ergibt eine leere Spur; die Wurzel selbst benennt die Fläche,
 * weil ihr Wort übersetzt sein muss.
 */
export const krumelspur = (pfad: string): { name: string; pfad: string }[] => {
    const teile = pfad.split('/').filter((t) => t !== '')
    const spur: { name: string; pfad: string }[] = []
    let bisher = ''
    for (const teil of teile) {
        bisher = bisher === '' ? teil : `${bisher}/${teil}`
        spur.push({ name: teil, pfad: bisher })
    }

    return spur
}

/** Pfad eine Ebene höher — `''` heisst Wurzel. */
export const elternPfad = (pfad: string): string => {
    const teile = pfad.split('/').filter((t) => t !== '')
    teile.pop()

    return teile.join('/')
}

/** Zwei Pfadteile verbinden, ohne doppelte oder führende Schrägstriche. */
export const verbinde = (basis: string, name: string): string => (basis === '' ? name : `${basis}/${name}`)

// ── Was mit einer Datei geschieht ───────────────────────────────────────────

/**
 * Ab hier wird Text NICHT mehr gerendert.
 *
 * 512 kB sind rund 15 000 Zeilen — mehr, als ein Mensch in einem Browserfenster
 * liest, und genug, um das Layout eines Telefons in die Knie zu zwingen. Die
 * Grenze ist bewusst grosszügig: sie soll die Ausreisser abfangen (in diesem
 * einen Repository eine 6 MB grosse `vendor.js.map`), nicht normalen Quelltext.
 */
export const TEXT_GRENZE = 512_000

/**
 * Ab hier wird ein Bild nicht mehr angezeigt.
 *
 * Ein Bild landet als Blob-URL im Speicher des Dokuments; 2 MB sind für eine
 * Vorschau reichlich und für den Speicher unauffällig.
 */
export const BILD_GRENZE = 2_000_000

/**
 * Höchstzahl gerenderter Zeilen einer Textdatei.
 *
 * Auch unterhalb von {@link TEXT_GRENZE} kann eine Datei zehntausend Zeilen
 * haben (minifizierter Code hat eine einzige, dafür sehr lange). Gekürzt wird
 * **sichtbar** — dieselbe Regel wie beim Diff.
 */
export const ZEILEN_GRENZE = 3000

/** Was die Fläche mit einer Datei tun soll. */
export type DateiArt = 'markdown' | 'text' | 'bild' | 'binaer' | 'zu-gross'

const BILD_ENDUNGEN = /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i
const SVG_ENDUNG = /\.svg$/i

/**
 * Enthalten diese Bytes ein NUL? Dann ist es keine Textdatei.
 *
 * Dieselbe Heuristik, die git und Amethyst benutzen (`isProbablyBinary`), und
 * bewusst nur auf den ersten 8000 Bytes: eine 6-MB-Datei ganz zu durchsuchen
 * kostet mehr, als die Antwort wert ist, und ein NUL kommt in echten
 * Binärdateien praktisch immer früh.
 */
export const istBinaer = (bytes: Uint8Array): boolean => {
    const bis = Math.min(bytes.length, 8000)
    for (let i = 0; i < bis; i += 1) {
        if (bytes[i] === 0) {
            return true
        }
    }

    return false
}

/**
 * Die Entscheidung, was mit einer Datei passiert — **vor** dem Rendern.
 *
 * Die Reihenfolge ist die Aussage:
 *
 * 1. **Bilder zuerst**, und zwar an der Endung: ein PNG ist binär, soll aber
 *    angezeigt werden. Andersherum geprüft, landete jedes Bild bei „binär".
 * 2. **Grösse vor Inhalt.** Eine 6-MB-Datei wird gar nicht erst untersucht;
 *    sie in den DOM zu schieben und dann festzustellen, dass es zu viel war,
 *    ist genau die stillschweigende Entscheidung, die hier nicht passieren soll.
 * 3. **NUL-Prüfung zuletzt**, weil sie die Bytes anfassen muss.
 *
 * `svg` gilt als **Text**, nicht als Bild: es ist Quelltext, und ihn als Bild
 * einzubinden hiesse, fremdes Markup in das Dokument zu lassen.
 */
export const dateiArt = (name: string, bytes: Uint8Array): DateiArt => {
    if (BILD_ENDUNGEN.test(name)) {
        return bytes.length > BILD_GRENZE ? 'zu-gross' : 'bild'
    }
    if (bytes.length > TEXT_GRENZE) {
        return 'zu-gross'
    }
    if (istBinaer(bytes)) {
        return 'binaer'
    }
    if (SVG_ENDUNG.test(name)) {
        return 'text'
    }

    return istMarkdown(name) ? 'markdown' : 'text'
}

/** MIME-Typ für die Blob-URL eines Bildes. */
export const bildMime = (name: string): string => {
    const endung = name.toLowerCase().split('.').pop() ?? ''
    const karte: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        avif: 'image/avif',
        bmp: 'image/bmp',
        ico: 'image/x-icon',
    }

    return karte[endung] ?? 'application/octet-stream'
}

/**
 * Text auf {@link ZEILEN_GRENZE} kürzen — und **sagen**, dass gekürzt wurde.
 *
 * Gibt die Gesamtzahl mit zurück, damit die Fläche „3000 von 41 233 Zeilen"
 * schreiben kann statt eines nichtssagenden „gekürzt".
 */
export const kuerzeZeilen = (text: string): { text: string; gekuerzt: boolean; zeilen: number } => {
    const alle = text.split('\n')
    if (alle.length <= ZEILEN_GRENZE) {
        return { text, gekuerzt: false, zeilen: alle.length }
    }

    return { text: alle.slice(0, ZEILEN_GRENZE).join('\n'), gekuerzt: true, zeilen: alle.length }
}
