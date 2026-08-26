/**
 * P5 — die **Suche der Forge**, rein clientseitig.
 *
 * **Seit P7/4 auch über Vorgänge** (Issues, PRs, Patches), nicht nur über
 * Repositories. Der Grund ist derselbe, aus dem sie hier überhaupt clientseitig
 * läuft: der Vorgangsbestand liegt ohnehin schon im Speicher — `contentFilters`
 * holt ihn für die Zählung. Bis dahin durchsuchte das Suchfeld ihn nicht, obwohl
 * er dalag; wer auf dem Reiter „Issues" tippte, sah die Liste unverändert.
 *
 * Rein bis auf `nostr-tools/nip19` (bech32) — kein Netz, kein Store, keine
 * welshman-Importe; `node --experimental-strip-types --test` lädt das Modul
 * unverändert, und `nostr-tools` steht ohnehin in den Abhängigkeiten.
 *
 * ── Warum clientseitig und nicht NIP-50 ─────────────────────────────────────
 *
 * Die Fläche hat den Bestand schon vollständig im Speicher: `overviewFilters`
 * lädt alle 30617 des Workspace in einem Zug. Eine Relay-Suche wäre ein
 * zusätzlicher Roundtrip für Daten, die schon da sind — und sie könnte
 * **weniger**: NIP-50 durchsucht bei Buzz den indizierten Text, nicht die
 * clone-URL, nicht die Maintainer-Pubkeys und nicht den `euc`. Genau das sind
 * aber die Dinge, die ein Mensch beim Repo-Suchen im Kopf hat.
 *
 * Dazu kommt, was am eigenen Relay gemessen ist: dessen relay-seitige
 * NIP-50-Suche läuft mit der `simple`-Konfiguration **ohne Stemming**
 * („meetups" findet dort nie „Meetup"), und NIP-50 steht im NIP-11 nicht
 * einmal als unterstützt drin. Eine Suche darauf zu bauen hiesse, das
 * schwächere Werkzeug zu nehmen und dafür zu bezahlen.
 *
 * **Und dieses Modul nennt sich nicht nach dem, was es nicht ist.** Für die
 * relay-seitige NIP-50-Suche des Workspace ist im Paket ein eigenes Wort
 * reserviert, und ein Prüfstand hält es dort fest
 * (`tests/e2e/search-verlauf.spec.ts:386`; er ist beim Bauen dieses Moduls
 * prompt angeschlagen). Der Grund gilt hier genauso: was unten läuft, ist ein
 * Teilzeichenketten-Filter über bereits geladene Ereignisse — kein Tokenizing,
 * keine Stammformen, keine Relay-Anfrage. Es größer zu benennen wäre eine
 * Zusage, die es nicht einlöst.
 *
 * ── Die Regel: UND über Wörter, ODER über Felder ────────────────────────────
 *
 * `"verein satzung"` verlangt, dass **jedes** Wort in **irgendeinem** Feld
 * desselben Repos vorkommt. Das ist die Erwartung an ein Suchfeld und
 * zugleich das, was Amethysts Matcher tut
 * (`commons/…/search/GitRepositorySearchMatcher.kt`, Konzept übernommen,
 * Code nicht — Kotlin nach TypeScript ist Neuschrift).
 *
 * ── npub: zwei Wege, und der zweite ist eine KOSTEN-, keine Findefrage ──────
 *
 * Ein Mensch fügt einen npub **ganz** ein (aus einem anderen Client kopiert)
 * ODER er tippt die ersten Zeichen. Beides muss treffen:
 *
 * 1. **Dekodieren** — `npub1…` einmal nach Hex, dann gegen die Hex-Felder.
 * 2. **Kodieren** — die Pubkeys des Repos nach bech32 und den Präfix
 *    vergleichen.
 *
 * **Hier stand zuerst, Weg 1 sei für den ganzen npub nötig. Das war falsch,
 * und eine Mutationsprobe hat es gezeigt:** schaltet man Weg 1 ab, bleibt die
 * Zusage „findet über den Maintainer-npub" grün — ein vollständiger npub ist
 * eben auch ein Präfix seiner selbst. Die beiden Wege finden **dieselben**
 * Repos; {@link npubZuHex} ist keine zweite Trefferregel, sondern die billige
 * Abkürzung für den häufigsten Fall.
 *
 * Und die ist ihr Geld wert: bei 500 Repos mit je zehn Maintainern kostet ein
 * eingefügter npub über Weg 1 **eine** Dekodierung, über Weg 2 bis zu 5000
 * Kodierungen — pro Tastendruck. Deshalb wird der Begriff **einmal je Anfrage**
 * vorbereitet ({@link zerlegeAnfrage}) und nicht je Repo neu, und Weg 2 läuft
 * nur, wenn Weg 1 nichts hergab.
 *
 * Dass beide dasselbe finden, ist eine eigene Zusage im Prüfstand — sonst
 * verschöbe eine spätere Aufräumrunde unbemerkt das Ergebnis.
 */
import { nip19 } from 'nostr-tools'

/**
 * Was die Suche von einem Repo braucht.
 *
 * Eine Teilmenge von `Repo` statt `Repo` selbst: so lässt sich das Modul ohne
 * einen vollständigen Repo-Bau prüfen, und es bleibt lesbar, welche Felder
 * überhaupt durchsucht werden.
 */
export type SearchableRepo = {
    name: string
    dtag: string
    description: string
    hashtags: string[]
    cloneUrls: string[]
    webUrls: string[]
    relays: string[]
    /** Pubkeys, hex und kleingeschrieben. */
    maintainers: string[]
    /** Der Autor des Announcements — impliziter Maintainer laut NIP-34. */
    owner: string
    euc: string
}

/** bech32-Zeichenvorrat, ohne `1`, `b`, `i`, `o` — genau die vier fehlen. */
const NPUB_PRAEFIX = /^npub1[023456789acdefghjklmnpqrstuvwxyz]*$/

/**
 * Die durchsuchbaren TEXT-Felder eines Repos, alle kleingeschrieben.
 *
 * Pubkeys stehen hier als Hex mit drin — ein eingefügter Hex-Schlüssel trifft
 * damit ohne Sonderweg.
 */
export const repoHaystack = (repo: SearchableRepo): string[] => {
    const felder: string[] = [
        repo.name,
        repo.dtag,
        repo.description,
        repo.euc,
        repo.owner,
        ...repo.hashtags,
        ...repo.cloneUrls,
        ...repo.webUrls,
        ...repo.relays,
        ...repo.maintainers,
    ]

    return felder.filter((wert) => typeof wert === 'string' && wert !== '').map((wert) => wert.toLowerCase())
}

/** Alle Pubkeys eines Repos: Eigentümer plus Maintainer, entdoppelt. */
const pubkeysOf = (repo: SearchableRepo): string[] => [
    ...new Set([repo.owner, ...repo.maintainers].filter((pk) => /^[0-9a-f]{64}$/i.test(pk))),
]

/**
 * Was die Suche von einem **Vorgang** (Issue, PR, Patch) braucht — P7/4.
 *
 * Wieder eine Teilmenge statt der vollen Zeile, und diesmal aus einem zweiten
 * Grund: die drei Vorgangsformen tragen unterschiedlich viel. Die
 * workspace-weite Liste (`VorgangRow`) hat aus Kostengründen **keinen Rumpf**
 * und keine Labels — `renderMarkdown` über alle Vorgänge aller Repos liefe bei
 * jedem Emit. Die Detailseite hat beides. Die optionalen Felder sind also keine
 * Bequemlichkeit, sondern die Aussage „diese Fläche kennt das nicht": was fehlt,
 * wird nicht durchsucht, statt still als leerer Text mitzulaufen.
 */
export type SearchableVorgang = {
    /** Event-Id, hex. Der Anker der Zeile ist ihre gekürzte Form — also suchbar. */
    id: string
    title: string
    /** Verfasser, hex und kleingeschrieben. */
    author: string
    /** Aufgelöster Name, wenn die Fläche ihn schon hat. */
    authorName?: string
    /** Rumpftext — nur, wo er ohnehin vorliegt. */
    content?: string
    /** `t`-Tags der Wurzel. */
    labels?: string[]
    /** Auf wen gewartet wird: Zugewiesene bzw. angefragte Reviewer, hex. */
    wartetAuf?: string[]
}

/** Die durchsuchbaren TEXT-Felder eines Vorgangs, alle kleingeschrieben. */
export const vorgangHaystack = (vorgang: SearchableVorgang): string[] => {
    const felder: string[] = [
        vorgang.title,
        vorgang.id,
        vorgang.author,
        vorgang.authorName ?? '',
        vorgang.content ?? '',
        ...(vorgang.labels ?? []),
        ...(vorgang.wartetAuf ?? []),
    ]

    return felder.filter((wert) => typeof wert === 'string' && wert !== '').map((wert) => wert.toLowerCase())
}

/** Alle Pubkeys eines Vorgangs: Verfasser plus die, auf die gewartet wird. */
const vorgangPubkeys = (vorgang: SearchableVorgang): string[] => [
    ...new Set(
        [vorgang.author, ...(vorgang.wartetAuf ?? [])].filter((pk) => /^[0-9a-f]{64}$/i.test(pk)),
    ),
]

/**
 * `npub1…` → Hex, oder `''`, wenn es kein vollständiger npub ist.
 *
 * `nip19.decode` wirft bei unvollständigem oder verfälschtem bech32 — das ist
 * hier der Normalfall (jemand tippt), kein Fehler.
 */
export const npubZuHex = (begriff: string): string => {
    if (!begriff.startsWith('npub1')) {
        return ''
    }
    try {
        const dekodiert = nip19.decode(begriff)

        return dekodiert.type === 'npub' ? (dekodiert.data as string).toLowerCase() : ''
    } catch {
        return ''
    }
}

const npubVon = (hex: string): string => {
    try {
        return nip19.npubEncode(hex).toLowerCase()
    } catch {
        return ''
    }
}

/**
 * Ein vorbereiteter Suchbegriff.
 *
 * `hex` ist gesetzt, wenn `text` ein vollständiger npub war; `alsNpub` sagt,
 * ob der Kodier-Weg überhaupt in Frage kommt. Beides hängt NUR am Begriff,
 * nicht am Repo — deshalb wird es einmal je Anfrage berechnet.
 */
export type Suchbegriff = { text: string; hex: string; alsNpub: boolean }

/** Eine Anfrage in vorbereitete Begriffe zerlegen. Leer heisst: keine Begriffe. */
export const zerlegeAnfrage = (anfrage: string): Suchbegriff[] =>
    anfrage
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((wort) => wort !== '')
        .map((text) => ({ text, hex: npubZuHex(text), alsNpub: NPUB_PRAEFIX.test(text) }))

/**
 * Trifft EIN vorbereiteter Begriff diesen Heuhaufen?
 *
 * **Eine Regel für Repos und Vorgänge**, seit P7/4. Sie nimmt seither Heuhaufen
 * und Pubkeys statt eines Repos: die npub-Wege sind bei beiden Gegenständen
 * dieselben, und eine zweite Kopie wäre die zweite Stelle, an der jemand den
 * teuren Weg 2 vergisst. Die Regel selbst ist Zeichen für Zeichen dieselbe
 * geblieben.
 */
const begriffTrifft = (
    pubkeys: () => string[],
    heuhaufen: string[],
    begriff: Suchbegriff,
): boolean => {
    if (heuhaufen.some((feld) => feld.includes(begriff.text))) {
        return true
    }

    // Weg 1 — die Abkürzung: ein ganzer npub, einmal dekodiert.
    if (begriff.hex && heuhaufen.some((feld) => feld.includes(begriff.hex))) {
        return true
    }

    // Weg 2 — der vollständige, aber teure: kodieren und Präfix vergleichen.
    // Er läuft nur, wenn Weg 1 nichts hergab, und nur bei einem npub-Begriff.
    if (begriff.alsNpub) {
        // `pubkeys` ist eine Funktion und kein Feld: sie wird NUR hier
        // gebraucht, und dieser Zweig läuft selten. Ausgerechnet würde sie
        // sonst je Begriff und je Zeile — bei 500 Repos und jedem Tastendruck.
        return pubkeys().some((pk) => npubVon(pk).startsWith(begriff.text))
    }

    return false
}

/** Trifft ein Repo alle vorbereiteten Begriffe? Keine Begriffe = kein Treffer. */
export const repoTrifftBegriffe = (repo: SearchableRepo, begriffe: Suchbegriff[]): boolean => {
    if (begriffe.length === 0) {
        return false
    }
    const heuhaufen = repoHaystack(repo)

    return begriffe.every((begriff) => begriffTrifft(() => pubkeysOf(repo), heuhaufen, begriff))
}

/**
 * Trifft die Anfrage dieses Repo? Jedes Wort muss irgendwo vorkommen.
 *
 * Eine leere Anfrage trifft **nichts** — nicht „alles". Die Fläche fragt gar
 * nicht erst, wenn das Feld leer ist; wer diese Funktion direkt benutzt, soll
 * am Ergebnis merken, dass er eine Bedingung vergessen hat, statt eine
 * ungefilterte Liste für ein Suchergebnis zu halten.
 */
export const repoTrifft = (repo: SearchableRepo, anfrage: string): boolean =>
    repoTrifftBegriffe(repo, zerlegeAnfrage(anfrage))

/**
 * Die Liste filtern — bei leerer Anfrage **unverändert** zurück.
 *
 * Das ist bewusst NICHT dieselbe Regel wie in {@link repoTrifft}: hier ist
 * „nichts eingegeben" die Aussage „kein Filter", und die vollständige Liste ist
 * die richtige Antwort. Die Reihenfolge bleibt, wie sie war — Treffer werden
 * nicht nach Güte umsortiert, sonst spränge die Liste beim Tippen.
 */
export const filterRepos = <T extends SearchableRepo>(repos: T[], anfrage: string): T[] => {
    // EINMAL zerlegen, nicht je Repo — hier zahlt sich die Vorbereitung aus.
    const begriffe = zerlegeAnfrage(anfrage)
    if (begriffe.length === 0) {
        return repos
    }

    return repos.filter((repo) => repoTrifftBegriffe(repo, begriffe))
}

// ── Vorgänge (P7/4) ─────────────────────────────────────────────────────────

/**
 * Trifft ein Vorgang alle vorbereiteten Begriffe? Keine Begriffe = kein Treffer.
 *
 * Dieselbe Regel wie bei {@link repoTrifftBegriffe} — UND über Wörter, ODER über
 * Felder —, nur mit dem Heuhaufen eines Vorgangs. Absichtlich **keine** eigene
 * Zerlegung: `npub`-Auflösung, Kleinschreibung und Wortgrenzen sind Eigenschaft
 * der Anfrage, nicht des Gegenstands.
 */
export const vorgangTrifftBegriffe = (
    vorgang: SearchableVorgang,
    begriffe: Suchbegriff[],
): boolean => {
    if (begriffe.length === 0) {
        return false
    }
    const heuhaufen = vorgangHaystack(vorgang)

    return begriffe.every((begriff) => begriffTrifft(() => vorgangPubkeys(vorgang), heuhaufen, begriff))
}

/** Trifft die Anfrage diesen Vorgang? Leere Anfrage trifft **nichts**. */
export const vorgangTrifft = (vorgang: SearchableVorgang, anfrage: string): boolean =>
    vorgangTrifftBegriffe(vorgang, zerlegeAnfrage(anfrage))

/**
 * Vorgänge nach dem Suchtext auswählen — bei leerer Anfrage **unverändert**
 * zurück. Wortgleich zu {@link filterRepos} und aus demselben Grund: „nichts
 * eingegeben" heisst „kein Filter". Die Reihenfolge bleibt; sortiert wird
 * anderswo (`forgeFilter.ts`), und zwar **nach** dieser Auswahl.
 *
 * **`suche…` und nicht `filter…`, obwohl der Zwilling `filterRepos` heisst.**
 * `forgeFilter.ts` exportiert bereits ein `filtereVorgaenge` — das ist der
 * Scope („alle / von mir / mir zugewiesen"), etwas ganz anderes. Beide werden in
 * `forge.ts` **ineinander verschachtelt** aufgerufen; zwei Namen, die sich um
 * einen Buchstaben unterscheiden, wären dort eine Verwechslung mit Ansage.
 */
export const sucheVorgaenge = <T extends SearchableVorgang>(vorgaenge: T[], anfrage: string): T[] => {
    const begriffe = zerlegeAnfrage(anfrage)
    if (begriffe.length === 0) {
        return vorgaenge
    }

    return vorgaenge.filter((vorgang) => vorgangTrifftBegriffe(vorgang, begriffe))
}
