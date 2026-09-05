/**
 * **Die eine Ableitung der Frage „welche Kanäle hat dieser Workspace?"** — rein,
 * welshman-frei, unter `node --test` prüfbar (wie `railGroups.ts` und `railForge.ts`).
 *
 * ── Warum es dieses Modul gibt ──────────────────────────────────────────────
 *
 * Bis P6 wurde dieselbe Frage an ZWEI Orten beantwortet:
 *
 * | Fassung  | Insel                 | Weg                                        |
 * |----------|-----------------------|--------------------------------------------|
 * | mobil    | `nostrWorkspaceRooms` | `buildWorkspaceList(rooms, prefs)`         |
 * | Desktop  | `nostrRail`           | `buildForgeNav(...)` → `flattenForgeNav`   |
 *
 * Zwei Datenwege, zwei Zustandsbegriffe: `isPinned`/`isMuted` standen in
 * `bridge.ts` und in `rail.ts` je einmal, mit verschiedenen Quellen (dort die
 * fertige Liste, hier die rohen Präferenzen). Das ist der **Gegenfehler** zu dem,
 * was P2 behoben hat — dort EINE Fassung für zwei Flächen, hier ZWEI Fassungen
 * für eine Frage.
 *
 * Die Regel, nach der das aufgelöst ist: **der abgeleitete Zustand hat genau
 * EINEN Ort; die Darstellung darf ihn zweimal verschieden malen.** Deshalb liefert
 * {@link buildWorkspaceModel} beide Fassungen aus EINEM Aufruf:
 *
 * - {@link WorkspaceModel.rows} — die gefalteten Baumzeilen; das ist `forgeRows`
 *   der Rail, Zeile für Zeile dasselbe wie vorher.
 * - {@link WorkspaceModel.channels} — die flache Kanalliste der mobilen Fassung,
 *   in derselben Reihenfolge wie vorher (angeheftet · beigetreten · entdeckbar).
 *
 * ── Warum die RAIL die Basis ist und nicht die mobile Liste ─────────────────
 *
 * Die Plan-Zeile P6/3 lautet wörtlich „die mobile Liste zieht aus **derselben**
 * `forgeRows`-Ableitung". Wörtlich ausgeführt verlöre die mobile Liste Bestand,
 * und zwar messbar an drei Stellen: `forgeRows` enthält (a) **keine** Kanäle, die
 * kein Repository per `buzz-channel` beansprucht — das ist der Regelfall, (b)
 * **keine** angehefteten Kanäle (die nimmt der Aufrufer vor `buildForgeNav`
 * heraus, weil der Pin die Repo-Bindung schlägt), dafür (c) Repo-, Issues- und
 * PR-Zeilen, die auf `/forge` bereits der Reiter „Repositories" führt.
 *
 * Basis ist deshalb das RAIL-**Modell**, nicht die Rail-**Zeilenliste**: es ist
 * das reichere von beiden (es löst Repo-Bindung, Pin-Vorrang, Sektionen und
 * Sortiermodus bereits auf), und die flache Kanalliste ist eine **Projektion**
 * davon — dieselben Räume, dieselben Zustände, eine andere Ordnung ohne Hierarchie.
 * Umgekehrt ginge es nicht: aus der flachen Liste ließe sich der Baum nicht
 * zurückgewinnen.
 *
 * ── Was hier NICHT liegt ────────────────────────────────────────────────────
 *
 * Der Klappzustand (`localStorage`) und die Navigation bleiben in den Inseln —
 * hierher kommt er als reine Eingabe ({@link WorkspaceModelInput.open}), genau
 * wie `flattenForgeNav` seinen `isOpen`-Rückruf injiziert bekommt. Und die drei
 * NICHT-Workspace-Gruppen der Rail (`rooms`/`meetups`/`proposals`) bleiben in
 * `buildGroups`: sie sind ein Schnitt über die Räume des HEIM-Space und haben mit
 * dieser Frage nichts zu tun.
 */

import {
    buildWorkspaceList,
    type RailRoom,
    type WorkspacePrefs,
} from './railGroups.ts'
import {
    buildForgeNav,
    flattenForgeNav,
    isForgeNodeOpen,
    type ForgeNav,
    type ForgeNavNode,
    type ForgeNavProject,
    type ForgeNavRepo,
} from './railForge.ts'
import { workspaceRoomHref } from './spaceParam.ts'

/**
 * Der leere Baum. Steht hier und nicht als Literal in den Aufrufern: `rail.ts`
 * trug ihn wörtlich für den Suchfall, und ein zweites Literal derselben Form ist
 * genau die Doppelung, gegen die dieses Modul gebaut ist.
 */
export const EMPTY_FORGE_NAV: ForgeNav = Object.freeze({
    nodes: Object.freeze([] as ForgeNavNode[]),
    claimed: Object.freeze([] as string[]),
    collapsed: false,
    total: 0,
}) as ForgeNav

/**
 * **Angeheftet?** — die EINE Implementierung dieser Frage im ganzen Paket.
 *
 * Vorher stand sie zweimal: `rail.ts` las `(prefs.pinned ?? []).includes(h)`,
 * `bridge.ts` las die fertige Liste aus `buildWorkspaceList`. Beide Antworten
 * stimmten überein — bis eine der beiden Seiten angefasst worden wäre.
 *
 * `includes` und kein `Set`: die Frage stellt das Markup einmal PRO ZEILE, und
 * ein `Set` müsste je Aufruf neu gebaut werden (die Präferenzen liegen als Array
 * im Insel-Zustand). Bei den Größen dieser Listen — Buzz deckelt bei 500
 * Einträgen, real sind es Dutzende — ist der lineare Blick billiger als der
 * Aufbau. Für die Reihenfolge INNERHALB einer Liste baut `buildWorkspaceList`
 * sich sein Set einmal; das ist Sortierung, keine zweite Zustandsauskunft.
 */
export const isChannelPinned = (prefs: WorkspacePrefs | undefined, h: string): boolean =>
    (prefs?.pinned ?? []).includes(h)

/** **Stummgeschaltet?** — dieselbe Quelle und derselbe Grund wie {@link isChannelPinned}. */
export const isChannelMuted = (prefs: WorkspacePrefs | undefined, h: string): boolean =>
    (prefs?.muted ?? []).includes(h)

/**
 * The three room pots of a space view — structurally typed, so this module keeps its
 * two imports and stays loadable under `node --test`. Matches `groups.ts SpaceView`.
 */
export type WorkspaceRoomPots = {
    userRooms: readonly { h: string }[]
    otherRooms: readonly { h: string }[]
    dmRooms: readonly { h: string }[]
}

/**
 * **Does this room belong to the workspace relay?** — the ONE answer to a question that
 * two places in the rail ask.
 *
 * It decides two things at once: whether `openRoom` has to switch the ephemeral space
 * before navigating, and (since P4) whether a row may carry a channel preference at
 * all. The second one is a data question, not a cosmetic one — the `channel-stars` and
 * `channel-mutes` blobs describe BUZZ channels, and writing a room of the zooid space
 * into them would put an id there that no other client can resolve.
 *
 * `some` over three short arrays and no `Set`: the same reasoning as
 * {@link isChannelPinned} — the markup asks this once per row, and building a set per
 * call costs more than the linear look at a list of dozens.
 */
export const isWorkspaceChannel = (workspace: WorkspaceRoomPots | null, h: string): boolean =>
    workspace !== null
    && (workspace.userRooms.some((room) => room.h === h)
        || workspace.otherRooms.some((room) => room.h === h)
        || workspace.dmRooms.some((room) => room.h === h))

/**
 * Eine Zeile der flachen Kanalliste — die mobile Fassung des Modells.
 *
 * **Der Raum bleibt als Objekt daran hängen** ({@link WorkspaceChannelRow.room}),
 * und zwar identitätserhaltend: `buildWorkspaceList` gibt die Original-Objekte
 * zurück (nicht Kopien), damit ein `room.picture = ''` aus dem Bildfallback der
 * Kachel nicht ins Leere läuft. Die Zeile trägt daneben die abgeleiteten Felder,
 * damit das Markup keine Funktion je Zeile aufrufen muss.
 */
export type WorkspaceChannelRow<T extends RailRoom = RailRoom> = {
    /** Das Original-Raumobjekt — für `openRoom()` und den Bildfallback. */
    room: T
    /** NIP-29 `h`. Auch der `:key` des `x-for`. */
    h: string
    /** Anzeigename, UNGEKÜRZT — gekürzt wird in der Zeile, nicht im Modell. */
    name: string
    pinned: boolean
    muted: boolean
    joined: boolean
    locked: boolean
    /**
     * Name des Repositories, unter dem dieser Kanal in der Rail hängt; `''` wenn
     * ihn keins per `buzz-channel` beansprucht.
     *
     * **Das ist genau die Auskunft, die der Baum über die Einrückung gibt.** Ohne
     * sie beantwortete die mobile Fassung eine ANDERE Frage als die Rail („welche
     * Kanäle gibt es" statt „welche Kanäle gibt es und wozu gehören sie") — und
     * genau das wäre wieder ein zweites Modell, nur unauffälliger.
     */
    repoName: string
    /** `/rooms/{h}?space=workspace` — reload-fest, aus `spaceParam.ts`. */
    href: string
}

export type WorkspaceModelInput<T extends RailRoom = RailRoom> = {
    /** ALLE Räume des Workspace-Space, mit gesetztem `joined`. */
    rooms: readonly T[]
    /** Kanal-Präferenzen aus Buzz Desktop (NIP-78), gelesen von `channelPrefs.ts`. */
    prefs?: WorkspacePrefs
    repos?: readonly ForgeNavRepo[]
    projects?: readonly ForgeNavProject[]
    /** `h` des offenen Raums, `''` wenn keiner offen ist. */
    activeRoomH?: string
    /** Knoten-id des aktiven Nicht-Raum-Ziels, `''` wenn keins. */
    activeId?: string
    /**
     * Läuft gerade eine Suche oder ein Scope-Filter?
     *
     * Dann gibt es KEINEN Baum: eine Suche ist eine flache Trefferliste, und eine
     * Hierarchie darüber verbärge Treffer hinter zugeklappten Knoten. Die
     * Kanalliste bleibt davon unberührt — die mobile Fassung hat keine Suche, und
     * eine leere `claimed`-Liste heißt für die Rail genau das Richtige: die
     * Kanäle stehen flach in ihrer Gruppe.
     */
    filtering?: boolean
    /** Klappzustand der Baumknoten (Rail-`localStorage`), `{}` = alles auf Default. */
    open?: Readonly<Record<string, boolean>>
}

export type WorkspaceModel<T extends RailRoom = RailRoom> = {
    /** Der Baum — Eingabe für `buildGroups` (`claimed`) und für den Gruppenzähler (`total`). */
    nav: ForgeNav
    /** Die SICHTBAREN Baumzeilen, entlang der offenen Knoten gefaltet — `forgeRows`. */
    rows: ForgeNavNode[]
    /**
     * Alle Baumzeilen, unabhängig vom Klappzustand.
     *
     * Die Rail braucht beides: das Markup rendert {@link WorkspaceModel.rows},
     * `activeGroup()` fragt über den GANZEN Baum („liegt das aktive Element in
     * einem zugeklappten Repo?"). Vorher stand dafür ein zweiter
     * `flattenForgeNav`-Aufruf im Insel-Code.
     */
    allRows: ForgeNavNode[]
    /** Die flache Kanalliste — die mobile Fassung. */
    channels: WorkspaceChannelRow<T>[]
    /** `h` der angehefteten Kanäle, die WIRKLICH in der Liste stehen. */
    pinned: string[]
    /** `h` der stummgeschalteten Kanäle — sie bleiben in {@link channels} stehen. */
    muted: string[]
    /**
     * Zahl der Kanäle dieses Workspace.
     *
     * Steht hier, weil sie sonst nirgends steht: der Reiter „Kanäle" auf `/forge`
     * hat bis heute keinen Zähler, weil die Zahl in der Insel lebte und die
     * Reiter außerhalb stehen (Befund aus P1). Seit die Ableitung EINE ist, kann
     * sie jede Fläche aus demselben Aufruf holen, statt einen zweiten Datenweg
     * dafür aufzumachen.
     */
    channelCount: number
}

/**
 * Kanal-`h` → Name des Repositories, unter dem der Kanal im Baum hängt.
 *
 * Läuft über den fertigen Baum und nicht ein zweites Mal über `repo.channelId`:
 * die Zuweisung „ein Kanal gehört genau einem Repo" trifft `buildForgeNav` mit
 * vier deterministischen Regeln (lexikografisch kleinste Koordinate gewinnt,
 * Faltung, unauflösbare Kanäle fallen weg). Sie ein zweites Mal nachzubauen wäre
 * die Doppelung, um deren Beseitigung es hier geht.
 */
const repoNamesByRoom = (nodes: readonly ForgeNavNode[]): Map<string, string> => {
    const out = new Map<string, string>()
    const walk = (list: readonly ForgeNavNode[], repoName: string): void => {
        for (const current of list) {
            if (current.room) {
                out.set(current.room.h, repoName)
            }
            walk(current.children, current.kind === 'repo' ? current.label : repoName)
        }
    }
    walk(nodes, '')

    return out
}

/**
 * Baut das Modell — EIN Aufruf, zwei Fassungen.
 *
 * **Die Reihenfolge der drei Schritte ist die Regel, nicht Bequemlichkeit:**
 *
 * 1. Der Baum entsteht über die Räume OHNE die angehefteten. Der Pin ist die
 *    ausdrückliche Wahl „steht oben" und schlägt die Repo-Bindung — dieselbe
 *    Rangfolge, mit der er in `buildGroups` schon die Sektion schlägt.
 * 2. Die flache Liste entsteht über ALLE Räume: mobil gibt es kein „oben", von
 *    dem ein Kanal verdrängt werden könnte, und ein Kanal, der in der einen
 *    Fassung fehlt, wäre genau der Bestandsverlust, den dieses Modul verhindert.
 * 3. Die Repo-Namen kommen aus dem Baum aus Schritt 1. Ein angehefteter Kanal
 *    trägt deshalb `repoName: ''` — er steht in der Rail oben und nicht unter
 *    seinem Repo, und die mobile Zeile sagt dasselbe.
 */
export const buildWorkspaceModel = <T extends RailRoom>(input: WorkspaceModelInput<T>): WorkspaceModel<T> => {
    const prefs = input.prefs ?? {}
    const rooms = input.rooms
    const open = input.open ?? {}

    const nav = input.filtering === true
        ? EMPTY_FORGE_NAV
        : buildForgeNav({
            repos: input.repos ?? [],
            projects: input.projects ?? [],
            rooms: rooms.filter((room) => !isChannelPinned(prefs, room.h)),
            activeRoomH: input.activeRoomH ?? '',
            activeId: input.activeId ?? '',
        })

    const repoNames = repoNamesByRoom(nav.nodes)
    const channels: WorkspaceChannelRow<T>[] = buildWorkspaceList<T>([...rooms], prefs).rooms.map((room) => ({
        room,
        h: room.h,
        name: room.name || room.h,
        pinned: isChannelPinned(prefs, room.h),
        muted: isChannelMuted(prefs, room.h),
        joined: room.joined === true,
        locked: room.locked === true,
        repoName: repoNames.get(room.h) ?? '',
        href: workspaceRoomHref(room.h),
    }))

    return {
        nav,
        rows: flattenForgeNav(
            nav.nodes,
            (node) => isForgeNodeOpen(node, Object.hasOwn(open, node.id) ? open[node.id] : undefined),
        ),
        allRows: flattenForgeNav(nav.nodes, () => true),
        channels,
        // Gemeldet wird über die ZEILEN und nicht über `prefs`: was hier steht,
        // ist der Bestand, der wirklich in der Liste liegt. Ein `h` aus den
        // Präferenzen, zu dem es keinen Raum (mehr) gibt, ist keine Zeile.
        pinned: channels.filter((row) => row.pinned).map((row) => row.h),
        muted: channels.filter((row) => row.muted).map((row) => row.h),
        channelCount: channels.length,
    }
}
