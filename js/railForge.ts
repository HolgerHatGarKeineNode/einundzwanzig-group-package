/**
 * Der Forge-Baum der Workspace-Sektion — REIN & welshman-frei (wie `railGroups.ts`
 * und `paletteItems.ts`), damit die Struktur ohne Browser, ohne Relay und ohne
 * Übersetzungskatalog unter `node --test` prüfbar bleibt. Relative Imports MIT
 * `.ts`-Endung: die Datei muss aus Vite UND aus dem Node-Test-Runner ladbar sein.
 *
 * **Warum das ein eigenes Modul ist und kein Anbau an `buildGroups`.** Die vier
 * Rail-Gruppen sind ein Schnitt über RÄUME (`RailRoom` verlangt ein `h`). Ein
 * Repository ist keiner, ein Issue-Zähler erst recht nicht. Ein Umbau von
 * `buildGroups` hätte dessen Gruppen-Semantik angefasst, um eine zweite, ganz
 * andere Achse unterzubringen — deshalb steht die Baumbildung hier daneben und
 * `buildGroups` bekommt aus dieser Datei genau EINE Auskunft: welche Kanäle aus
 * der flachen Liste fallen ({@link ForgeNav.claimed}).
 *
 * ── Sprachfrei ──────────────────────────────────────────────────────────────
 * Kein `t()`, keine deutschen Beschriftungen für Zeilen, die keinen Namen aus
 * den Daten haben: `issues`, `pulls` und `more` tragen ein leeres `label`, und
 * das Markup beschriftet sie über {@link ForgeNavNode.kind}. Dieselbe Trennung
 * wie zwischen `forgeActivity.ts` (Struktur) und `forge.ts` (Verben).
 *
 * ── Wo eine weitere Sorte Kind-Zeile andockt (P2, Foren) ────────────────────
 * Ein Forum-Kanal ist strukturell dasselbe wie ein Repo-Kanal: eine Zeile mit
 * einem Raum dahinter, nur mit anderem Icon und anderem Ziel. Er dockt an genau
 * drei Stellen an, alle in dieser Datei:
 *   1. {@link ForgeNavKind} um `'forum'` erweitern (das Markup verzweigt über
 *      `kind`, nicht über eine Sorten-Liste — eine neue Variante kostet dort
 *      einen `x-if`-Zweig, keinen Umbau).
 *   2. In {@link buildForgeNav} den Kindknoten in `childrenFor` anhängen bzw.
 *      einen eigenen Top-Level-Zweig neben den Repos aufmachen; die Zuweisung
 *      „ein Raum gehört genau einem Knoten" läuft bereits über `usedRooms` und
 *      trägt eine weitere Quelle ohne Änderung.
 *   3. Nichts weiter: Einrückung (`depth`), Klappzustand, Faltung, `claimed`
 *      und der Tastaturweg über {@link flattenForgeNav} gelten für jeden Knoten,
 *      unabhängig von seiner Sorte. Insbesondere braucht die Tastatur KEINE
 *      zweite Funktion — genau der Fehler, den P3 und P7 schon zweimal hatten.
 */

import type { RailGroup, RailGroupKey, RailRoom } from './railGroups.ts'

/** Ein Repository, soweit der Baum es braucht (Untermenge von `forgeModels.Repo`). */
export type ForgeNavRepo = {
    /** `30617:<owner>:<d>` — die stabile Identität, auch über Neuankündigungen. */
    address: string
    name: string
    /** `naddr` für die Detail-Route; `''` macht die Zeile zu einem reinen Klappknoten. */
    naddr: string
    /** Kanal-UUID aus `buzz-channel`, `''` wenn das Announcement keine trägt. */
    channelId: string
    issueCount: number
    pullRequestCount: number
}

/** Ein Projekt (30621, NIP-MP), soweit der Baum es braucht. */
export type ForgeNavProject = {
    address: string
    name: string
    /** Mitglieds-Koordinaten in der Reihenfolge des Announcements. */
    repoAddresses: readonly string[]
}

/**
 * Was eine Zeile ist. Das Markup verzweigt über diesen Wert (Icon, Beschriftung,
 * Zielart) — deshalb ist es ein enger Union-Typ und kein freier String.
 */
export type ForgeNavKind = 'project' | 'repo' | 'room' | 'issues' | 'pulls' | 'more'

export type ForgeNavNode = {
    /**
     * Stabile, eindeutige Kennung. Sie ist DREI Dinge zugleich: `:key` im
     * `x-for`, Schlüssel des Klappzustands in `localStorage` und Kennung des
     * aktiven Ziels. Ein Knoten, dessen id sich beim Nachladen ändert, verlöre
     * deshalb seinen Klappzustand — sie leitet sich darum aus der Koordinate ab
     * (`30617:<owner>:<d>`), nie aus einer Event-Id.
     */
    id: string
    kind: ForgeNavKind
    /**
     * Anzeigename, UNGEKÜRZT. Die Kürzung ist eine Frage der Spaltenbreite und
     * gehört an die Zeile (`middleTruncate`), nicht in die Struktur — der
     * vollständige Name steht im `title`.
     *
     * Leer bei `issues`/`pulls`/`more`: die tragen keinen Namen aus den Daten,
     * sondern eine Beschriftung aus dem Katalog. Siehe Modulkopf.
     */
    label: string
    /** Einrückungsstufe. 0 = direkt unter dem Sektionskopf WORKSPACE. */
    depth: number
    /** Navigationsziel; `''` heißt: die Zeile klappt nur, sie springt nicht. */
    href: string
    /**
     * Zähler. **Nur bei `> 0` gesetzt** (Regel 5) — auf der Übersichtsseite ist
     * eine Null eine Aussage, in der Nav ist sie Lärm. Zeilen, die ohne Zähler
     * sinnlos wären (`issues`, `pulls`), entstehen bei `0` gar nicht erst.
     */
    count: number
    /**
     * Der Raum hinter einer `room`-Zeile, sonst `null`. Die Rail öffnet ihn über
     * ihr bestehendes `openRoom()` — dieselbe Bahn wie jede andere Raumzeile,
     * inklusive des Wechsels in den Workspace-Space.
     */
    room: RailRoom | null
    /** Kinder in Anzeige-Reihenfolge. Leer = Blatt, also kein Chevron. */
    children: ForgeNavNode[]
    /**
     * Liegt dieser Knoten auf dem Pfad zum aktiven Element (oder IST er es)?
     *
     * Trägt zwei Regeln zugleich: „beim ersten Laden ist alles zu, außer dem Pfad
     * zum aktiven Element" (Regel 4) und „ab fünf Projekten bleibt der aktive
     * Pfad sichtbar" (Regel 6). Beide fragen dasselbe, deshalb steht es einmal
     * hier und nicht zweimal im Aufrufer.
     */
    onActivePath: boolean
}

export type ForgeNavInput = {
    repos: readonly ForgeNavRepo[]
    projects: readonly ForgeNavProject[]
    /**
     * Die Räume, die als Kanal-Zeile VERFÜGBAR sind.
     *
     * Der Aufrufer nimmt heraus, was schon anderweitig vergeben ist — konkret
     * die angehefteten Kanäle: Anheften ist eine ausdrückliche Wahl des Nutzers
     * („steht oben"), die Repo-Bindung eine strukturelle Aussage des
     * Announcements. Der Pin schlägt sie, genau wie er in `buildGroups` schon
     * die Sektion schlägt.
     */
    rooms: readonly RailRoom[]
    /** `h` des offenen Raums, `''` wenn keiner offen ist. */
    activeRoomH?: string
    /** {@link ForgeNavNode.id} des aktiven Nicht-Raum-Ziels, `''` wenn keins. */
    activeId?: string
}

export type ForgeNav = {
    /** Die sichtbaren Top-Level-Zeilen in Anzeige-Reihenfolge (nach der Faltung). */
    nodes: ForgeNavNode[]
    /**
     * `h` der Kanäle, die im Baum stehen und deshalb aus der flachen Liste
     * fallen (Regel 3).
     *
     * **Nur die WIRKLICH sichtbaren.** Faltet Regel 6 ein Repo weg, gibt es
     * seinen Kanal hierher zurück — sonst stünde er nirgends. „Genau einmal"
     * heißt genau einmal, nicht keinmal; das ist die Präzisierung, ohne die
     * Regel 3 und Regel 6 einander widersprechen.
     */
    claimed: string[]
    /** Hat Regel 6 gegriffen? Dann steht am Ende die `more`-Zeile. */
    collapsed: boolean
    /** Zahl der Top-Level-Einträge VOR der Faltung — die Zahl an der `more`-Zeile. */
    total: number
}

/**
 * Ab wie vielen Top-Level-Einträgen die Liste zu „Alle Projekte · N" zusammenfällt.
 *
 * Gezählt werden Top-Level-EINTRÄGE, nicht kind-30621-Ereignisse: Ein Projekt mit
 * einem Repo ist nach Regel 2 eine Repo-Zeile, ein Repo ohne Projekt nach Regel 7
 * ebenfalls eine — für die Spaltenhöhe, um die es bei dieser Schwelle geht, sind
 * das dieselben Zeilen. Fünf ist dieselbe Zahl wie {@link MINE_SPLIT_THRESHOLD}
 * und aus demselben Grund: bis dahin sieht man die Liste als Ganzes.
 */
export const PROJECT_FOLD_THRESHOLD = 5

/** Die Detail-Route eines Repositories. */
export const repoHref = (naddr: string): string => (naddr === '' ? '' : `/forge/${encodeURIComponent(naddr)}`)

/**
 * Die Übersichtsseite. Ziel des `</>`-Icons im Sektionskopf, des Sektionsnamens
 * und der `more`-Zeile — drei Wege, ein Ort.
 */
export const FORGE_OVERVIEW_HREF = '/forge'

/**
 * Der Tab-Parameter der Repo-Seite. Die Fläche hält den Tab in Alpine; ohne
 * diesen Parameter führte „Issues · 3" auf die Seite, aber nicht auf die Liste,
 * die sie benennt — und eine Zeile, die etwas anderes zeigt als ihre Beschriftung,
 * ist schlimmer als keine.
 */
const tabHref = (naddr: string, tab: 'issues' | 'pulls'): string => {
    const base = repoHref(naddr)

    return base === '' ? '' : `${base}?tab=${tab}`
}

const byLabel = (a: ForgeNavNode, b: ForgeNavNode): number =>
    a.label.toLocaleLowerCase().localeCompare(b.label.toLocaleLowerCase()) || a.id.localeCompare(b.id)

/** Ein Knoten mit Vorbelegung — spart sechs Wiederholungen der Vollform. */
const node = (over: Partial<ForgeNavNode> & { id: string; kind: ForgeNavKind; depth: number }): ForgeNavNode => ({
    label: '',
    href: '',
    count: 0,
    room: null,
    children: [],
    onActivePath: false,
    ...over,
})

/** Markiert Eltern, unter denen etwas Aktives hängt — von unten nach oben. */
const markActivePath = (current: ForgeNavNode): boolean => {
    let active = current.onActivePath
    for (const child of current.children) {
        if (markActivePath(child)) {
            active = true
        }
    }
    current.onActivePath = active

    return active
}

/** Alle `room`-Zeilen eines Teilbaums — die Kanäle, die er der flachen Liste entzieht. */
const roomsIn = (list: readonly ForgeNavNode[]): string[] =>
    list.flatMap((current) => [
        ...(current.room ? [current.room.h] : []),
        ...roomsIn(current.children),
    ])

/**
 * Baut den Baum.
 *
 * **Vier Zuweisungen, alle deterministisch.** Nirgends entscheidet die
 * Ladereihenfolge, wohin etwas gehört — sonst sprängen Zeilen beim Nachladen
 * eines Ereignisses:
 *
 * 1. *Ein Kanal gehört genau einem Repo.* Beanspruchen ihn zwei 30617 per
 *    `buzz-channel`, gewinnt das mit der lexikografisch kleinsten Koordinate.
 *    Bewusst NICHT das ältere: ein 30617 ist ersetzbar, sein `created_at` wandert
 *    mit jeder Neuankündigung — eine Reihenfolge daraus wäre über die Zeit nicht
 *    stabil. Das unterlegene Repo zeigt dann keine Kanal-Zeile; erreichbar ist
 *    der Kanal weiterhin, nur eben an einer Stelle.
 * 2. *Ein Repo gehört genau einem Projekt* — dieselbe Regel, derselbe Grund. Ohne
 *    sie erschiene ein Repo, das zwei Projekte nennen, zweimal, und mit ihm sein
 *    Kanal; Regel 3 wäre gebrochen, ohne dass irgendwo etwas falsch aussähe.
 * 3. *Ein `buzz-channel` auf einen Kanal, den es hier nicht gibt* (nicht geladen,
 *    nicht sichtbar, gelöscht), erzeugt KEINE Zeile. Die Rail ist eine
 *    Sprungliste; eine Zeile, die ins Leere führt oder erst nach einem Klick
 *    „kein Zugriff" sagt, ist schlechter als keine. Das Repo bleibt mit seinen
 *    Zählern stehen — dass es einen Kanal hat, ist keine Auskunft, die dem
 *    Betrachter nützt, solange er ihn nicht öffnen kann.
 * 4. *Ein Projekt ohne auflösbares Repo* erzeugt keine Zeile. Eine Überschrift
 *    über nichts ist dieselbe Beschriftung über nichts, die `buildSections`
 *    schon nicht rendert.
 *
 * **Sortiert wird nach Namen, nicht nach Datum.** Die Übersichtsseite zeigt
 * „zuletzt angelegt zuerst", weil sie eine Liste IST; die Rail ist eine
 * Sprungliste, und beim Springen hilft der Name. Dieselbe Regel wie `byName` in
 * `railGroups.ts`.
 */
export const buildForgeNav = (input: ForgeNavInput): ForgeNav => {
    const activeRoomH = input.activeRoomH ?? ''
    const activeId = input.activeId ?? ''

    const repoByAddress = new Map(input.repos.map((repo) => [repo.address, repo]))
    const roomByH = new Map(input.rooms.map((room) => [room.h.toLowerCase(), room]))

    // ── 1. Kanal → Repo ─────────────────────────────────────────────────────
    const usedRooms = new Set<string>()
    const channelOf = new Map<string, RailRoom>()
    for (const repo of [...input.repos].sort((a, b) => a.address.localeCompare(b.address))) {
        const key = repo.channelId.toLowerCase()
        if (key === '' || usedRooms.has(key)) {
            continue
        }
        const room = roomByH.get(key)
        if (!room) {
            continue // Zuweisung 3: kein Kanal, keine Zeile.
        }
        usedRooms.add(key)
        channelOf.set(repo.address, room)
    }

    // ── 2. Repo → Projekt ───────────────────────────────────────────────────
    const claimedByProject = new Set<string>()
    const membersOf = new Map<string, string[]>()
    for (const project of [...input.projects].sort((a, b) => a.address.localeCompare(b.address))) {
        const own: string[] = []
        for (const address of project.repoAddresses) {
            if (!repoByAddress.has(address) || claimedByProject.has(address)) {
                continue
            }
            claimedByProject.add(address)
            own.push(address)
        }
        membersOf.set(project.address, own)
    }

    const repoNode = (address: string, depth: number): ForgeNavNode => {
        const repo = repoByAddress.get(address)!
        const children: ForgeNavNode[] = []
        const room = channelOf.get(address)
        if (room) {
            children.push(node({
                id: `room:${room.h}`,
                kind: 'room',
                label: room.name || room.h,
                depth: depth + 1,
                room,
                onActivePath: activeRoomH !== '' && room.h === activeRoomH,
            }))
        }
        if (repo.issueCount > 0) {
            const id = `${address}#issues`
            children.push(node({
                id,
                kind: 'issues',
                depth: depth + 1,
                href: tabHref(repo.naddr, 'issues'),
                count: repo.issueCount,
                onActivePath: activeId !== '' && id === activeId,
            }))
        }
        if (repo.pullRequestCount > 0) {
            const id = `${address}#pulls`
            children.push(node({
                id,
                kind: 'pulls',
                depth: depth + 1,
                href: tabHref(repo.naddr, 'pulls'),
                count: repo.pullRequestCount,
                onActivePath: activeId !== '' && id === activeId,
            }))
        }

        return node({
            id: address,
            kind: 'repo',
            label: repo.name,
            depth,
            href: repoHref(repo.naddr),
            children,
            onActivePath: activeId !== '' && address === activeId,
        })
    }

    // ── 3. Top-Level ────────────────────────────────────────────────────────
    const entries: ForgeNavNode[] = []
    for (const project of input.projects) {
        const own = membersOf.get(project.address) ?? []
        if (own.length === 0) {
            continue // Zuweisung 4
        }
        if (own.length === 1) {
            // Regel 2: Projekt und Repo verschmelzen zu EINER Zeile. Erst ab dem
            // zweiten Repo unterscheidet die Projektebene überhaupt etwas.
            entries.push(repoNode(own[0], 0))
            continue
        }
        entries.push(node({
            id: project.address,
            kind: 'project',
            label: project.name,
            depth: 0,
            children: own.map((address) => repoNode(address, 1)).sort(byLabel),
            onActivePath: activeId !== '' && project.address === activeId,
        }))
    }
    // Regel 7: ein Repo ohne Projekt hängt direkt unter WORKSPACE — kein
    // erfundenes Pseudo-Projekt.
    for (const repo of input.repos) {
        if (!claimedByProject.has(repo.address)) {
            entries.push(repoNode(repo.address, 0))
        }
    }
    for (const entry of entries) {
        markActivePath(entry)
    }
    entries.sort(byLabel)

    // ── 4. Faltung (Regel 6) ────────────────────────────────────────────────
    const collapsed = entries.length >= PROJECT_FOLD_THRESHOLD
    const visible = collapsed ? entries.filter((entry) => entry.onActivePath) : entries
    const nodes = collapsed
        ? [...visible, node({ id: 'forge:more', kind: 'more', depth: 0, href: FORGE_OVERVIEW_HREF, count: entries.length })]
        : visible

    return {
        nodes,
        claimed: roomsIn(visible),
        collapsed,
        total: entries.length,
    }
}

/**
 * Die Sorten, die BEIM ERSTEN LADEN offen stehen (P2, korrigierte Regel 4).
 *
 * P1 ließ jeden Knoten ohne Eintrag zu. Das war ein Fehler in der Vorgabe, nicht
 * in der Umsetzung: Regel 4 („beim ersten Laden ist alles zu") war für die
 * EBENEN im Baum gedacht und hat die Sektion mit erfasst — Ergebnis war eine
 * Fläche, deren Kern (die Repos) man erst nach zwei Klicks sah.
 *
 * Offen sind die BEHÄLTER (`project`, `repo`) — sie tragen den Bestand, um den
 * es geht. Zu bleiben die MERKMALE (`issues`, `pulls`) und die Blätter (`room`,
 * `more`): sie haben heute gar keine Kinder, der Wert ist für sie also
 * unbeobachtbar. Er steht trotzdem hier und nicht als `true` für alles, weil
 * P2 (Foren) eine Kind-Ebene unter einem Kanal bringt — dann ist die Aussage
 * „nur Behälter starten offen" die, die gemeint war.
 */
export const OPEN_BY_DEFAULT: readonly ForgeNavKind[] = ['project', 'repo']

/**
 * Ist dieser Knoten aufgeklappt?
 *
 * Drei Quellen, in dieser Reihenfolge — und die Reihenfolge IST die Regel:
 *
 * 1. **Der aktive Pfad zwingt auf.** Sonst verschwände unter dem Nutzer, wo er
 *    gerade steht (Regel 4, zweite Hälfte).
 * 2. **Die Wahl des Nutzers schlägt den Default** — auch, wenn sie „zu" lautet.
 *    Genau dafür wird zwischen „kein Eintrag" (`undefined`) und „ausdrücklich
 *    zugeklappt" (`false`) unterschieden: ein Default, den man nicht
 *    wegklicken kann, ist keiner, sondern ein Zwang. Der Aufrufer liest den
 *    Wert deshalb über `Object.hasOwn` aus seinem Speicher und nicht über
 *    `?? undefined` — ein gespeichertes `false` und ein fehlender Eintrag sind
 *    zwei verschiedene Aussagen.
 * 3. **Sonst die Sorte** ({@link OPEN_BY_DEFAULT}).
 *
 * Rein und injiziert wie {@link flattenForgeNav}: der Klappzustand lebt in
 * `localStorage` und ist damit unrein — die Regel darüber ist es nicht.
 */
export const isForgeNodeOpen = (node: ForgeNavNode, stored: boolean | undefined): boolean => {
    if (node.onActivePath) {
        return true
    }
    if (stored !== undefined) {
        return stored
    }

    return OPEN_BY_DEFAULT.includes(node.kind)
}

/**
 * Die SICHTBARE Zeilenfolge — der Baum, abgeflacht entlang der offenen Knoten.
 *
 * **Diese eine Liste speist alles**: das `x-for` im Markup, Alt+↑/↓ und die Frage,
 * ob die Workspace-Gruppe aufklappen muss. Genau das ist die Lehre aus P3 und P7:
 * eine Zeile, die das Auge sieht, die Tastatur aber nicht kennt, entsteht immer
 * dann, wenn zwei Stellen dieselbe Menge getrennt berechnen. Es gibt hier deshalb
 * keine zweite Funktion, die „auch fast dasselbe" liefert.
 *
 * `isOpen` ist injiziert und nicht eingebaut: der Klappzustand lebt in
 * `localStorage` und ist damit unrein — die Reihenfolge, die daraus folgt, ist es
 * nicht.
 */
export const flattenForgeNav = (
    nodes: readonly ForgeNavNode[],
    isOpen: (candidate: ForgeNavNode) => boolean,
): ForgeNavNode[] => {
    const out: ForgeNavNode[] = []
    const walk = (list: readonly ForgeNavNode[]): void => {
        for (const current of list) {
            out.push(current)
            if (current.children.length > 0 && isOpen(current)) {
                walk(current.children)
            }
        }
    }
    walk(nodes)

    return out
}

// ── Die Sprungliste der ganzen Rail ─────────────────────────────────────────

/**
 * Eine anspringbare Zeile der Rail — Raum oder Adresse.
 *
 * **Ein Typ für beides, weil Alt+↑/↓ eine Liste durchläuft und nicht zwei.** Vor
 * P1 war jede Zeile ein Raum und die Tastatur lief über `RailRoom[]`; seit der
 * Forge-Baum daneben steht, sind Repo-, Issues- und PR-Zeilen ebenso sichtbar und
 * ebenso anspringbar. Zwei getrennte Listen wären genau die Konstruktion, die in
 * P3 und P7 schon zweimal auseinandergelaufen ist.
 */
export type RailTarget = {
    /** Eindeutig über die ganze Rail: `room:<h>` für Räume, sonst die Knoten-id. */
    id: string
    /** Der Raum, wenn die Zeile einer ist — sonst `null`. */
    room: RailRoom | null
    /** Adresse für Nicht-Raum-Zeilen. Bei Räumen `''`: die öffnet `openRoom()`. */
    href: string
}

const roomTarget = (room: RailRoom): RailTarget => ({ id: `room:${room.h}`, room, href: '' })

/**
 * Alle anspringbaren Zeilen EINER Gruppe, in Markup-Reihenfolge — unabhängig vom
 * Klappzustand der Gruppe selbst.
 *
 * Die Reihenfolge ist die des Markups und keine andere: angeheftet · Forge-Baum ·
 * Sektionen · beigetreten · entdeckbar. Der Baum steht hinter den Angehefteten,
 * weil der Pin auch in `buildGroups` alles schlägt.
 *
 * **Klappknoten OHNE Ziel fallen heraus** — eine Projektzeile und ein Repo ohne
 * `naddr` klappen nur. Stünden sie in dieser Liste, bliebe Alt+↓ auf ihnen
 * stehen: `openTarget` hätte nichts zu öffnen, die aktive Kennung änderte sich
 * nicht, und der nächste Tastendruck liefe wieder auf dieselbe Zeile. „Jede
 * sichtbare Zeile erreichen" heißt anspringen; eine Zeile ohne Sprungziel ist
 * keine Ausnahme davon, sondern gehört nicht zur Frage.
 */
export const groupTargets = (group: RailGroup, forgeRows: readonly ForgeNavNode[] = []): RailTarget[] => [
    ...group.pinned.map(roomTarget),
    ...forgeRows.flatMap((current): RailTarget[] => {
        if (current.room) {
            return [roomTarget(current.room)]
        }

        return current.href === '' ? [] : [{ id: current.id, room: null, href: current.href }]
    }),
    ...group.sections.flatMap((section) => section.rooms.map(roomTarget)),
    ...group.joined.map(roomTarget),
    ...group.others.map(roomTarget),
]

/**
 * Die SICHTBARE Sprungliste über alle offenen Gruppen — die Grundlage für
 * Alt+↑/↓ und Enter.
 *
 * Zeilen aus zugeklappten Gruppen gehören nicht dazu: eine Tastatur-Navigation
 * an unsichtbaren Zeilen entlang wäre eine Blackbox. Der Forge-Baum wird
 * vorgeflacht übergeben (`flattenForgeNav` mit dem Klappzustand der Knoten) —
 * dieselbe Liste, die das Markup rendert, nicht eine zweite Berechnung daneben.
 */
export const railTargets = (
    groups: readonly RailGroup[],
    forgeRows: readonly ForgeNavNode[],
    isOpen: (key: RailGroupKey) => boolean,
): RailTarget[] =>
    groups
        .filter((group) => isOpen(group.key))
        .flatMap((group) => groupTargets(group, group.key === 'workspace' ? forgeRows : []))
