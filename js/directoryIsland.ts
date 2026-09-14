/**
 * `nostrDirectory` — the member directory of the active space (`/directory`), and the
 * one island of this client that is fetched instead of shipped.
 *
 * ── Why this island is lazy and the others are not ──────────────────────────────────
 *
 * It lived in `bridge.ts` until 2026-09-15 and rode along in the `app` chunk, which
 * every page loads. Measured against the built artefact by deleting it: **5 016 B gzip
 * on every page** for a surface that serves exactly one route.
 *
 * The bundle latch (`tests/e2e/support/bundleGrenze.nodetest.ts`, host repo) broke for
 * the second time over P4 of the follow plan — 112 160 B against a mark of 112 000 — and
 * its docblock prescribes the answer for a second breach in as many words: *"if the mark
 * falls a SECOND time under normal growth, the problem is not the number, it is the boot
 * path. Then it does not get added to, it gets split."* This file is that split.
 *
 * ── Why this is not the split that was rejected on 2026-09-05 ───────────────────────
 *
 * That day a split of `$store.mutes` behind an `import()` was turned down, and the
 * reason was not the mechanism but the surface: the profile card that reads the store
 * sits on EVERY page, so a store that arrives late is a protective surface that is
 * sometimes absent. The member directory sits on ONE route. A reader who never opens
 * `/directory` never needs a byte of this file, and a reader who does is looking at a
 * screen that starts in a loading state anyway.
 *
 * **What would make that objection apply here again:** the moment a second surface
 * mounts `x-data="nostrDirectory"`, or a store/derivation defined here is read from a
 * component that lives in the layout (the rail, the bottom nav, the profile card). Then
 * "one route" stops being true, the island is back in the boot path of everything, and
 * this file belongs back in `bridge.ts` — or the shared part belongs in a module of its
 * own. The rule is the surface, not the size.
 *
 * ── The failure path is the price of being lazy, so it is rendered, not logged ──────
 *
 * A dynamic import that rejects fails silently in this house — `js/core.ts` is static
 * and a toplevel throw there kills the island at boot, while `js/longformFeed.ts` is
 * dynamic and swallowed. Two real ways end in a rejection: a chunk that no longer lies
 * where the manifest says after a deploy, and a network that drops between the document
 * and the chunk.
 *
 * `nostrDirectoryShell` in `bridge.ts` is therefore not a thin wrapper around an
 * `import()` but the whole of the failure discipline: while the chunk is in flight it
 * renders the same skeleton the island itself shows before its profiles are in
 * (`partials/directory-skeleton.blade.php`, included by both), and on a rejection it
 * renders a callout with a retry — the same shape `nostrArticles` uses for
 * `longformFeed.ts`. What it must never do is stand there empty and look finished.
 *
 * ── What did NOT move ───────────────────────────────────────────────────────────────
 *
 * Everything the island reads from: `members.ts`, `actionItems.ts`, `userStatus.ts`,
 * `groups.ts` and the rest are imported by other components of `bridge.ts` too and stay
 * in the boot chunk. The 5 016 B are this file's own code, nothing else — which is also
 * why the win cannot be repeated by moving one more import along.
 */
import { get } from 'svelte/store'
import { app, Relays } from './welshmanApp.ts'
import type { RelayInfo } from './welshmanRelay.ts'
import type { FollowsStore } from './follows.ts'
import { dispatchModal } from './modal.ts'
import { activeSpace, displayRelayUrl, loadSpaceRooms, watchSpaceRooms, loadSpaceInviteClaim, addRoomMember } from './groups.ts'
import { mayWriteKind } from './relayCapability.ts'
import { BUZZ_TIMEOUT } from './moderationTimeoutModels.ts'
import { deriveStatusPending, deriveUserStatuses, warmUserStatuses, type UserStatus } from './userStatus.ts'
import { deriveSpaceKind, type SpaceKind } from './spaceCaps.ts'
import {
    deriveSpaceDirectory,
    deriveSpaceRoles,
    deriveVereinAccess,
    isVereinGatedOut,
    deriveUserIsSpaceAdmin,
    refreshSpaceAdmin,
    loadSpaceDirectory,
    watchSpaceDirectory,
    loadMemberProfiles,
    settleMemberProfiles,
    loadRestrictedMembers,
    createRole,
    editRole,
    deleteRole,
    assignRole,
    unassignRole,
    removeSpaceMember,
    banSpaceMember,
    unbanSpaceMember,
    timeoutSpaceMember,
    untimeoutSpaceMember,
    addSpaceMember,
    banEvent,
    resolveReport,
    setRelayName,
    setRelayDescription,
    setRelayIcon,
    type DirectoryView,
    type MemberView,
    type RoleView,
    type RestrictedMember,
    type SpaceRole,
    type VereinAccess,
} from './members.ts'
import {
    deriveSpaceReports,
    loadSpaceReports,
    forgetBuzzReport,
    watchSpaceReports,
    deriveSpaceJoinRequests,
    loadSpaceJoinRequests,
    watchSpaceJoinRequests,
    type ReportView,
    type JoinRequestView,
} from './actionItems.ts'
import { uploadAttachment } from './uploads.ts'
import { toast } from './toast.ts'
import { t } from './i18n.ts'
import { formatNumber } from './locale.ts'

/** The Alpine magics this island reaches for — same one-line shape as in `bridge.ts`. */
type AlpineMagics = { $refs: Record<string, HTMLElement>; $nextTick: (cb: () => void) => void; $el: HTMLElement }

/**
 * Der „kein Status"-Wert der Directory-Zeile — eine geteilte, eingefrorene Instanz.
 * Ein frisches Objektliteral je Aufruf sähe für Alpine bei jedem Durchlauf wie eine
 * Änderung aus und triebe die Liste in eine Neuberechnung pro Emit.
 */
const EMPTY_STATUS: { text: string; emoji: string } = Object.freeze({ text: '', emoji: '' })

/** Formular-Zustand einer Rolle (hue 0–360, lightness 0–1; '' id = neu). */
type RoleForm = { id: string; label: string; description: string; hue: number; lightness: number; order: number }

/**
 * **The frozen write set of one bulk follow** (P4, point 5 of the plan).
 *
 * Built once, in {@link DirectoryState.openBulkPreview}, and never recomputed while the
 * preview stands. Both sources underneath it are live — the member list is a running
 * subscription on the relay-signed 13534 (`members.ts`), and the reader's own contact
 * list can come back larger at any moment — so "what is shown" and "what is written"
 * would otherwise be two different sets separated by however long the reader looked at
 * the dialog.
 *
 * `targets` is therefore the authoritative argument of the write, not `selected`.
 *
 * The three counts exist to be COMPARED by a human, which is the whole point of the
 * step: a reader with 700 contacts who sees `from: 1` is looking at a contact list this
 * client failed to read, and this dialog is the only place that number is visible before
 * a signature turns it into the truth.
 */
/**
 * **The two calls this surface needs from the follows store and does not have yet.**
 *
 * **Both exist now** — `js/follows.ts` implements them, and `FollowsStore` declares them.
 * This type is kept because it says what this surface ASKS FOR, which is a different
 * statement from what that module happens to offer: a reader of `armBulkFollow` below can
 * see the contract without opening another file, and the guards at the call sites stay
 * meaningful for a store that is not there at all (`Alpine.store('follows')` is
 * `undefined` until `wireFollows` has run).
 *
 * `armFollowRead` is the one that is easy to miss: see {@link DirectoryState.armBulkFollow}.
 * It is the only read-only entry point on the store, and without it the whole bulk bar
 * stays inert forever for every reader whose `OutboxKnowledge` is `confirmed-none` — the
 * button would say „Kontaktliste laden" and correctly do nothing.
 */
type BulkFollowCapable = {
    /** One kind 3 for n targets — `planFollowWrite` has taken n since P3. */
    followMany?(targets: readonly string[]): Promise<void>
    /** A read-only pass over the reader's own list, so `listSeen` can become true. */
    armFollowRead?(): Promise<void>
}

/** The Flux modal that shows {@link BulkFollowPlan} before anything is signed. */
const BULK_PREVIEW_MODAL = 'follow-bulk-preview'

type BulkFollowPlan = {
    /** Pubkeys in list order, exactly the set the preview counted. */
    targets: string[]
    /** How many of `targets` are not in the reader's contact list yet — `to - from`. */
    add: number
    /** How many of `targets` the reader already follows. `add + already === targets.length`. */
    already: number
    /** Size of the reader's contact list when the preview opened. */
    from: number
    /** `from + add`. */
    to: number
}

type DirectoryState = {
    ready: boolean
    profilesReady: boolean
    members: MemberView[]
    roles: RoleView[]
    query: string
    gatedOut: boolean
    // NIP-38-Status je Mitglied (P2). Ein einfaches Objekt statt einer Map, weil Alpine
    // nur auf zugewiesene Eigenschaften reagiert; je Emit wird es KOMPLETT ersetzt.
    // Bewusst NICHT in `MemberView` gelegt: `deriveSpaceDirectory` ist die Liste der
    // Mitgliedschaft (13534/33534, relay-signiert), der Status eine flüchtige Beigabe —
    // sie in eine Ableitung zu ziehen hieße, die Liste bei jedem Statuswechsel neu zu
    // bauen und zu sortieren.
    statuses: Record<string, { text: string; emoji: string }>
    statusPending: boolean
    statusOf(pubkey: string): { text: string; emoji: string }
    _unsubStatuses: null | (() => void)
    _unsubStatusPending: null | (() => void)
    // Admin (NIP-86)
    isAdmin: boolean
    rolesFull: SpaceRole[]
    editingMember: MemberView | null
    roleForm: RoleForm
    banned: RestrictedMember[]
    /** Warum die Sperrliste leer ist, wenn sie es nicht wirklich ist ('' = alles gut). */
    bannedError: string
    // Befristete Sperre (P4, Buzz kind 9042/9043). `canTimeout` ist der Riegel aus P1 in
    // der Fläche: der Menü-Eintrag existiert nur, wo der Kind auch geschrieben werden darf.
    _spaceKind: SpaceKind
    _unsubSpaceKind: null | (() => void)
    canTimeout: boolean
    timeoutTarget: MemberView | null
    /** Ausgewählte Dauer in SEKUNDEN — als String, weil ein <select> Strings liefert. */
    timeoutDuration: string
    timeoutReason: string
    inviteLink: string
    inviteBusy: boolean
    busy: boolean
    // Melde-Queue (P3, NIP-56 kind 1984)
    reports: ReportView[]
    // Beitritts-Queue (P4b, offene 9021 für closed-Räume)
    joinRequests: JoinRequestView[]
    // Space-Metadaten bearbeiten (P2, NIP-86 changerelay*)
    spaceForm: { name: string; description: string }
    _spaceInitial: { name: string; description: string } // Prefill-Snapshot (Vergleichsbasis: nur GEÄNDERTES senden)
    spaceIconPreview: string // Vorschau: data-URL des neu gewählten Icons ODER aktuelle Icon-URL
    _spaceIconFile: File | null // neu gewähltes Icon (null = unverändert)
    spaceSaving: boolean
    _url: string | null
    _controller: AbortController | null
    _unsubActive: null | (() => void)
    _unsubDir: null | (() => void)
    _unsubRoles: null | (() => void)
    _unsubAdmin: null | (() => void)
    _unsubAccess: null | (() => void)
    _unsubReports: null | (() => void)
    _unsubJoins: null | (() => void)
    _loadedDir: Set<string>
    _loadedProfiles: Set<string>
    _settleStarted: boolean
    init(): void
    destroy(): void
    filtered(): MemberView[]
    reload(): void
    openRoleCreate(): void
    openRoleEdit(role: SpaceRole): void
    saveRole(): Promise<void>
    removeRole(id: string): Promise<void>
    openMemberRoles(m: MemberView): void
    memberHasRole(roleId: string): boolean
    toggleMemberRole(roleId: string): Promise<void>
    removeMember(m: MemberView): Promise<void>
    banMember(m: MemberView): Promise<void>
    openTimeout(m: MemberView): void
    confirmTimeout(): Promise<void>
    liftTimeout(pubkey: string): Promise<void>
    loadBanned(): Promise<void>
    unbanMember(pubkey: string): Promise<void>
    restoreMember(pubkey: string): Promise<void>
    loadInvite(): Promise<void>
    copyInvite(): void
    _reportDone(r: ReportView): void
    dismissReport(r: ReportView): Promise<void>
    removeReportedContent(r: ReportView): Promise<void>
    banReportedUser(r: ReportView): Promise<void>
    acceptJoin(j: JoinRequestView): Promise<void>
    rejectJoin(j: JoinRequestView): Promise<void>
    openSpaceEdit(): void
    _prefillSpace(profile?: RelayInfo): void
    pickSpaceIcon(input: HTMLInputElement): void
    saveSpace(): Promise<void>
    // ── Bulk follow (P4): selection mode over the member list ──────────────────
    selectMode: boolean
    selected: Record<string, boolean>
    directoryAnswered: boolean
    bulkPlan: BulkFollowPlan | null
    bulkBusy: boolean
    bulkError: string
    enterSelectMode(root: HTMLElement): void
    leaveSelectMode(root: HTMLElement): void
    isSelected(pubkey: string): boolean
    toggleSelect(pubkey: string, on: boolean): void
    rowSelectLabel(m: MemberView): string
    selectableMembers(): MemberView[]
    selectedCount(): number
    allVisibleSelected(): boolean
    someVisibleSelected(): boolean
    syncSelectAll(el: HTMLElement): void
    setSelectAll(on: boolean): void
    selectionSummary(): string
    bulkHint(): string
    bulkPrimaryLabel(): string
    bulkPrimaryBlocked(): boolean
    bulkPrimary(): void
    openBulkPreview(): void
    planGrowth(): string
    num(value: number | undefined): string
    armBulkFollow(): Promise<void>
    confirmBulkFollow(): Promise<void>
}

/**
 * Register the island under the name the markup already asks for.
 *
 * Called from `nostrDirectoryShell` (`bridge.ts`) once the chunk has landed, and always
 * BEFORE the shell flips `hydrated` — the inner `x-data="nostrDirectory"` sits inside a
 * `<template x-if="hydrated">` and is evaluated only when that template renders, so the
 * name is resolved after this line has run and never before.
 */
export function wireDirectory(Alpine: {
    data: (name: string, factory: (...args: unknown[]) => unknown) => void
    store: (name: string, value?: unknown) => unknown
}): void {
    // Space-Directory (M3): Mitglieder + Rollen des AKTIVEN Space. Gated auf
    // relay.self (Fix A) — bis NIP-11 da ist, Skeleton statt „keine Mitglieder".
    // Client-Suche filtert über Name + npub. Kein Multi-Space (§12).
    Alpine.data('nostrDirectory', (): DirectoryState => ({
        ready: false,
        profilesReady: false,
        members: [],
        roles: [],
        query: '',
        gatedOut: false,
        statuses: {},
        statusPending: false,
        statusOf(pubkey: string) {
            return this.statuses[pubkey] ?? EMPTY_STATUS
        },
        _unsubStatuses: null,
        _unsubStatusPending: null,
        isAdmin: false,
        rolesFull: [],
        editingMember: null,
        roleForm: { id: '', label: '', description: '', hue: 210, lightness: 0.5, order: 0 },
        banned: [],
        bannedError: '',
        _spaceKind: 'unknown',
        _unsubSpaceKind: null,
        canTimeout: false,
        timeoutTarget: null,
        // Vorauswahl 1 Tag — die Dauer ist im Dialog frei wählbar (Nutzerwunsch
        // 2026-09-03: „Timeout, welchen man einstellen kann"), dies ist nur der
        // Startwert des Auswahlfelds und keine im Code festgeschriebene Sperrdauer.
        timeoutDuration: '86400',
        timeoutReason: '',
        inviteLink: '',
        inviteBusy: false,
        busy: false,
        reports: [],
        joinRequests: [],
        spaceForm: { name: '', description: '' },
        _spaceInitial: { name: '', description: '' },
        spaceIconPreview: '',
        _spaceIconFile: null,
        spaceSaving: false,
        // ── Bulk follow (P4) ───────────────────────────────────────────────────
        selectMode: false,
        selected: {},
        directoryAnswered: false,
        bulkPlan: null,
        bulkBusy: false,
        bulkError: '',
        _url: null,
        _controller: null,
        _unsubActive: null,
        _unsubDir: null,
        _unsubRoles: null,
        _unsubAdmin: null,
        _unsubAccess: null,
        _unsubReports: null,
        _unsubJoins: null,
        _loadedDir: new Set<string>(),
        _loadedProfiles: new Set<string>(),
        _settleStarted: false,
        init() {
            // Aktiver Space → dessen Directory laden + Subs neu aufbauen.
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this._unsubDir?.()
                this._unsubRoles?.()
                this._unsubAdmin?.()
                this._unsubAccess?.()
                this._unsubReports?.()
                this._unsubJoins?.()
                this._unsubStatuses?.()
                this._unsubStatusPending?.()
                this._unsubSpaceKind?.()
                this._controller?.abort()
                this.ready = false
                this.profilesReady = false
                this._settleStarted = false
                this.reports = []
                this.joinRequests = []
                this.members = []
                this.roles = []
                this.statuses = {}
                this.gatedOut = false
                this.editingMember = null
                // Die Sperrliste gehört dem alten Space — sie beim Wechsel stehen zu
                // lassen zeigte fremde Sperren unter neuem Namen.
                this.banned = []
                this.bannedError = ''
                this.timeoutTarget = null
                this._spaceKind = 'unknown'
                this.canTimeout = false
                // A selection is a statement about THIS space's member list. Carrying it
                // across a space switch would offer to follow people the reader picked
                // out of a list they are no longer looking at — the same class of fault
                // as the ban list two lines up, only with a signature at the end of it.
                this.selectMode = false
                this.selected = {}
                this.bulkPlan = null
                this.bulkError = ''
                this.directoryAnswered = false
                this._url = url
                this._controller = new AbortController()
                // Sicherheitsnetz: bleibt das Directory-Loaded-Signal (EOSE/CLOSED)
                // aus (Relay-Timeout/Netzfehler), nach 8s trotzdem rendern statt
                // ewig Skeleton — dann eben mit dem bis dahin bekannten Stand.
                setTimeout(() => {
                    if (this._url === url && !this.profilesReady) {
                        this.profilesReady = true
                    }
                }, 8000)
                // Vereins-Relay & kein Mitglied → Mitgliederliste liefert der Relay
                // nicht aus; Suche + falsche „keine Mitglieder"-Meldung ausblenden.
                this._unsubAccess = deriveVereinAccess(url).subscribe((a: VereinAccess) => {
                    this.gatedOut = isVereinGatedOut(a)
                    // `a.ready` = relay.self da UND das Directory (13534/33534) ist
                    // FERTIG geladen — per EOSE (Liste inkl. Mitglieder da) oder
                    // CLOSED (Nicht-Mitglied, keine Liste). ERST jetzt steht die
                    // Mitgliederzahl final. `view.ready` allein (nur relay.self)
                    // triggerte das Gate bei members=0 → profilesReady verfrüht,
                    // die Liste sortierte/animierte danach bei jedem Profil neu.
                    // P4, point 3: the bulk button waits for BOTH lists. This is the
                    // 13534 half, and it is deliberately NOT `profilesReady` — that one
                    // also goes true on the 8 s safety net above, which is a timeout and
                    // not an answer. A surface that offers to write a contact list off a
                    // member list nobody confirmed would be the same fail-open shape the
                    // whole plan exists to close.
                    this.directoryAnswered = this.directoryAnswered || a.ready
                    if (a.ready && !this._settleStarted) {
                        this._settleStarted = true
                        const pubkeys = this.members.map((m) => m.pubkey)
                        pubkeys.forEach((pk) => this._loadedProfiles.add(pk))
                        void settleMemberProfiles(url, pubkeys).then(() => {
                            if (this._url === url) {
                                this.profilesReady = true
                            }
                        })
                    }
                })
                if (!this._loadedDir.has(url)) {
                    this._loadedDir.add(url)
                    loadSpaceDirectory(url)
                }
                // watchSpaceDirectory (statt listen): lädt 13534/33534 UND meldet per
                // EOSE/CLOSED, dass das Directory fertig ist ([[spaceDirectoryLoaded]]) —
                // das Signal, an dem `a.ready` oben hängt. Bleibt offen (Live-Updates).
                watchSpaceDirectory(url, this._controller.signal)
                // NIP-38-Statuse (P2): eine Subscription für die ganze Liste, plus der
                // dreiwertige Wartezustand aus P1. `warmUserStatuses` läuft unten mit der
                // Mitgliederliste — hier steht sie noch nicht.
                this._unsubStatusPending = deriveStatusPending(url).subscribe((pending: boolean) => {
                    this.statusPending = pending
                })
                this._unsubStatuses = deriveUserStatuses(url).subscribe((table: ReadonlyMap<string, UserStatus>) => {
                    // Neues Objekt je Emit: Alpine beobachtet Zuweisungen, keine Map-Mutation.
                    const next: Record<string, { text: string; emoji: string }> = {}
                    for (const [pk, status] of table) {
                        next[pk] = { text: status.text, emoji: status.emoji }
                    }
                    this.statuses = next
                })
                this._unsubDir = deriveSpaceDirectory(url).subscribe((view: DirectoryView) => {
                    this.ready = view.ready
                    warmUserStatuses(url, view.members.map((m) => m.pubkey))
                    // Liste im Hintergrund aktuell halten; die View zeigt sie erst,
                    // wenn `profilesReady` steht (x-if, gesetzt vom Access-Gate oben) —
                    // kein progressives Umsortieren einer sichtbaren Liste.
                    this.members = view.members
                    this.roles = view.roles
                    // Falls das Rollen-Modal offen ist, die Auswahl frisch halten.
                    if (this.editingMember) {
                        this.editingMember =
                            view.members.find((m) => m.pubkey === this.editingMember!.pubkey) ?? this.editingMember
                    }
                    // Nachzügler (Live-Admin fügt nach dem Gate Mitglieder hinzu):
                    // deren Profile einzeln nachladen — je pubkey einmal.
                    if (this.profilesReady) {
                        const missing = view.members
                            .map((m) => m.pubkey)
                            .filter((pk) => !this._loadedProfiles.has(pk))
                        missing.forEach((pk) => this._loadedProfiles.add(pk))
                        loadMemberProfiles(url, missing)
                    }
                })
                this._unsubRoles = deriveSpaceRoles(url).subscribe((roles: SpaceRole[]) => {
                    this.rolesFull = roles
                })
                this._unsubAdmin = deriveUserIsSpaceAdmin(url).subscribe((admin: boolean) => {
                    this.isAdmin = admin
                })
                // Die Relay-Art entscheidet, ob es die befristete Sperre hier überhaupt
                // gibt (9042/9043 sind Buzz-Dialekt), und sie trifft SPÄT ein. Abonniert
                // statt einmal gelesen — ein synchroner Blick beim Aufziehen meldet
                // verlässlich `'unknown'`, der Menü-Eintrag bliebe für immer aus und
                // niemand sähe, warum (dieselbe Klasse Fehler wie beim
                // `spaceIsBuzz()`-Schnappschuss aus P6).
                this._unsubSpaceKind = deriveSpaceKind(url).subscribe((kind: SpaceKind) => {
                    this._spaceKind = kind
                    // Der Riegel aus P1 beantwortet die Markup-Frage und die Schreibfrage
                    // aus DERSELBEN Funktion. Eine zweite Regel hier („ist es Buzz?")
                    // driftete von der ersten weg, und das Ergebnis wäre ein Knopf, der
                    // garantiert nichts tut.
                    this.canTimeout = mayWriteKind(BUZZ_TIMEOUT, kind)
                })
                // Melde-Queue (P3): Meldungen (kind 1984) laden + live halten. Die
                // Ableitung ist billig; die UI zeigt sie nur Admins (x-show), also
                // kein Gate auf den (async auflösenden) Admin-Status nötig.
                loadSpaceReports(url)
                watchSpaceReports(url, this._controller.signal)
                this._unsubReports = deriveSpaceReports(url).subscribe((r: ReportView[]) => {
                    this.reports = r
                })
                // Beitritts-Queue (P4b): Räume (39000/39002) UND Join-Requests (9021/9022)
                // laden — auf der Directory-Seite lädt sonst niemand die Räume, dann fehlte
                // der Membership-Abgleich (offene vs. angenommene Anfrage).
                loadSpaceRooms(url)
                watchSpaceRooms(url, this._controller.signal)
                loadSpaceJoinRequests(url)
                watchSpaceJoinRequests(url, this._controller.signal)
                this._unsubJoins = deriveSpaceJoinRequests(url).subscribe((j: JoinRequestView[]) => {
                    this.joinRequests = j
                })
            })
        },
        filtered() {
            const q = this.query.trim().toLowerCase()
            return q ? this.members.filter((m) => m.search.includes(q)) : this.members
        },

        // ── Bulk follow (P4): selection mode ────────────────────────────────────────
        //
        // Everything below is the SURFACE half. It decides what is selected, what is
        // shown and what is frozen; it signs nothing. The two seams that will sign are
        // `armBulkFollow` and `confirmBulkFollow` at the end of the block.

        /**
         * Enter selection mode and put the keyboard where the mode begins.
         *
         * The focus move is not a nicety: the button that was just pressed is REMOVED by
         * the same state change — the band swaps its content — and focus falls to
         * `<body>`. That is the trap the empty-search state documents at length in
         * `⚡directory.blade.php`, one variable further along.
         *
         * **The root comes in as an argument, and that is the whole fix.** `$refs` is no
         * help for the documented reason (it ascends from the handler element, which is
         * detached by the time the callback runs) — but `this.$el` is no help either, and
         * that is the part the existing comment does not cover: magics are injected per
         * ELEMENT into the scope stack, so inside a method reached from an `x-on:click` on
         * a button, `this.$el` IS that button, not the island root. Measured 2026-09-14:
         * driven from `Alpine.$data(root)` the same code focused the box and it held for
         * 200 ms (`$el tag: div`); driven from the button's click it left
         * `document.activeElement` on `<body>` at all three viewports.
         *
         * `$root` in the markup resolves to the `x-data` element whatever fires the call.
         */
        enterSelectMode(root: HTMLElement) {
            this.selectMode = true
            this.bulkError = ''
            ;(this as unknown as AlpineMagics).$nextTick(() => {
                root.querySelector<HTMLElement>('[data-directory-select-all]')?.focus()
            })
        },

        /** Leave the mode; an explicit cancel drops the selection with it. */
        leaveSelectMode(root: HTMLElement) {
            this.selectMode = false
            this.selected = {}
            this.bulkPlan = null
            this.bulkError = ''
            ;(this as unknown as AlpineMagics).$nextTick(() => {
                root.querySelector<HTMLElement>('[data-directory-select-toggle]')?.focus()
            })
        },

        isSelected(pubkey: string): boolean {
            return this.selected[pubkey] === true
        },

        /**
         * A fresh object per change rather than a mutation: Alpine reacts to assignment,
         * and every row's `checked` binding hangs on this single value. The cost is one
         * object of at most the member count per click; the alternative is to mutate and
         * then depend on the proxy trapping `delete`, which is a reactivity question this
         * surface should not have to answer.
         */
        toggleSelect(pubkey: string, on: boolean) {
            const next = { ...this.selected }
            if (on) {
                next[pubkey] = true
            } else {
                delete next[pubkey]
            }
            this.selected = next
            this.bulkError = ''
        },

        rowSelectLabel(m: MemberView): string {
            return t(':name auswählen', { name: m.name })
        },

        /**
         * The rows a "select all" may touch: what the search currently shows, minus the
         * reader themselves. A contact list containing its own author says nothing and
         * `planFollowWrite` refuses it — a checkbox whose target the write path throws
         * away is a checkbox that lies about the count above it.
         */
        selectableMembers(): MemberView[] {
            const me = (Alpine.store('follows') as FollowsStore | undefined)?.me ?? ''

            return this.filtered().filter((m) => m.pubkey !== me)
        },

        /** Only `true` is ever stored, so the key count IS the selection size. */
        selectedCount(): number {
            return Object.keys(this.selected).length
        },

        allVisibleSelected(): boolean {
            const visible = this.selectableMembers()

            return visible.length > 0 && visible.every((m) => this.isSelected(m.pubkey))
        },

        someVisibleSelected(): boolean {
            return this.selectableMembers().some((m) => this.isSelected(m.pubkey))
        },

        /**
         * Keep the "select all" box in step with the rows below it.
         *
         * **Two states and not three, and that is a measurement rather than a preference.**
         * The obvious build is the tri-state box — checked, unchecked, mixed — and it is
         * not available on `ui-checkbox`. Its `indeterminate` setter writes only
         * `data-indeterminate`, so the dash is painted and `aria-checked` still says
         * "false"; and writing `aria-checked="mixed"` from outside does not survive,
         * because Flux installs a "durable attribute observer" over exactly that attribute
         * that reverts any foreign mutation to its previous value
         * (`attributeObserver`/`setAttribute2`, `flux-pro/dist/flux.module.js:1747-1809`).
         * Measured at all three viewports: with one of 59 rows picked the box showed the
         * dash and announced `aria-checked="false"` — a visual state no screen reader can
         * hear, which is WCAG 4.1.2 rather than a missing nicety.
         *
         * Two honest states plus the count in the bar below ("Auswahl: 12 von 59") carry
         * the same information in words, and the box then promises exactly what a click
         * does: unchecked means "select all of these".
         *
         * Called from `x-effect`, so the reads inside `allVisibleSelected` register the
         * dependencies (`selected`, `members`, `query`) and the box re-syncs when any of
         * them moves — including when a search narrows what "all" means.
         */
        syncSelectAll(el: HTMLElement) {
            ;(el as HTMLElement & { checked: boolean }).checked = this.allVisibleSelected()
        },

        /**
         * "All" means what is on screen, which with an active search is the matches and
         * not the directory. Turning it off drops those same rows and nothing else, so a
         * reader who picks people, searches, and then clears the search keeps the earlier
         * picks.
         */
        setSelectAll(on: boolean) {
            const next = { ...this.selected }
            for (const m of this.selectableMembers()) {
                if (on) {
                    next[m.pubkey] = true
                } else {
                    delete next[m.pubkey]
                }
            }
            this.selected = next
            this.bulkError = ''
        },

        /**
         * `:m` counts the whole directory and not the filtered view, on purpose: it is the
         * denominator a reader judges their own selection against, and it must not move
         * while they type in the search field.
         */
        selectionSummary(): string {
            const me = (Alpine.store('follows') as FollowsStore | undefined)?.me ?? ''
            const total = this.members.filter((m) => m.pubkey !== me).length

            return t('Auswahl: :n von :m', {
                n: formatNumber(this.selectedCount()),
                m: formatNumber(total),
            })
        },

        /**
         * Why the bulk action cannot run yet — `''` means it can.
         *
         * Literal, already translated wording, the same contract as `bannedError`: the
         * markup prints this and decides nothing.
         */
        bulkHint(): string {
            if (!this.directoryAnswered) {
                return t('Die Mitgliederliste ist noch nicht vollständig geladen.')
            }
            const follows = Alpine.store('follows') as FollowsStore | undefined
            if (!follows || !follows.listSeen) {
                return follows?.noRelayList
                    ? t('Kontaktliste laden — danach kannst du folgen')
                    : t('Kontaktliste wird geladen — Folgen ist noch nicht möglich')
            }

            return ''
        },

        /**
         * Three labels for the same three states the single-person button carries in
         * `profile-card.blade.php`, in the same words.
         *
         * The third one — "we have not looked" — keeps both of its readings: for a reader
         * WITH a relay list the read is running, so "Lädt…" is true; for a reader without
         * one it has not started, because a page load does not ask four relays the reader
         * never chose (P2/D8), and the label invites the click that does the reading.
         */
        bulkPrimaryLabel(): string {
            const follows = Alpine.store('follows') as FollowsStore | undefined
            if (!follows?.listSeen) {
                return follows?.noRelayList ? t('Kontaktliste laden') : t('Lädt…')
            }

            return t('Auswahl prüfen')
        },

        bulkPrimaryBlocked(): boolean {
            const follows = Alpine.store('follows') as FollowsStore | undefined
            if (this.bulkBusy || follows?.busy === true || !this.directoryAnswered) {
                return true
            }
            // Arming is a READ and needs no selection. Only the step that plans a write
            // does, and for that an empty selection is what blocks it.
            if (!follows?.listSeen) {
                return !follows?.noRelayList
            }

            return this.selectedCount() === 0
        },

        bulkPrimary() {
            if (this.bulkPrimaryBlocked()) {
                return
            }
            if (!(Alpine.store('follows') as FollowsStore | undefined)?.listSeen) {
                void this.armBulkFollow()

                return
            }
            this.openBulkPreview()
        },

        /**
         * Freeze the selection and show it (P4, points 4 and 5).
         *
         * `targets` comes out in member-list order — the dialog is read next to the list,
         * and a set ordered by click would be hard to check against it. Anyone selected
         * who has since left the directory is appended rather than dropped, so
         * `targets.length` is always the number the bar was showing a moment ago; a count
         * that shrinks between two surfaces looks like a bug even when it is not.
         */
        openBulkPreview() {
            const follows = Alpine.store('follows') as FollowsStore | undefined
            if (!follows?.listSeen) {
                return
            }
            const inList = this.members.map((m) => m.pubkey).filter((pk) => this.isSelected(pk))
            const known = new Set(inList)
            const targets = [...inList, ...Object.keys(this.selected).filter((pk) => !known.has(pk))]
            const from = follows.following.length
            const already = targets.filter((pk) => follows.isFollowing(pk)).length
            const add = targets.length - already
            this.bulkError = ''
            this.bulkPlan = { targets, add, already, from, to: from + add }
            dispatchModal(BULK_PREVIEW_MODAL)
        },

        /**
         * A whole sentence and not a figure with a label beside it — the house rule for
         * counters (`lang/README.md`) and the reason there is no plural form to carry:
         * both numbers sit next to prepositions, not next to a noun they would have to
         * agree with, in all seven languages.
         */
        planGrowth(): string {
            const plan = this.bulkPlan
            if (!plan) {
                return ''
            }
            // A reachable selection: pick only people you already follow. "grows from 703
            // to 703" would be false in the one word that carries the sentence, and the
            // reader would be looking for a change that is not coming.
            if (plan.add === 0) {
                return t('Deine Kontaktliste ändert sich nicht — du folgst allen Ausgewählten schon.')
            }

            return t('Deine Kontaktliste wächst von :von auf :auf.', {
                von: formatNumber(plan.from),
                auf: formatNumber(plan.to),
            })
        },

        num(value: number | undefined): string {
            return formatNumber(value ?? 0)
        },

        /**
         * **Arm the bulk action:** read the reader's own contact list once, so `listSeen`
         * turns true and the button can move on from „Kontaktliste laden".
         *
         * **`armFollowRead` is the only read-only entry point on the store**, and it exists
         * for this call. Everything else there needs a person and writes: `toggle(target)`
         * takes one, `followMany(targets)` takes a set. For a reader whose
         * `OutboxKnowledge` came back `confirmed-none` this client deliberately does not
         * read on a page load (P2/D8) — so without it that reader could never arm the bulk
         * bar at all, and the whole surface would stay permanently inert for them.
         *
         * It reads through `readOwnFollowList` over the same relay set the write uses, and
         * `listSeen`/`noRelayList`/`following` come from that answer and from nothing else
         * (P1). None of that verdict is reimplemented here, which is why the call sits on
         * the store rather than inlined into this file.
         */
        async armBulkFollow() {
            const follows = Alpine.store('follows') as (FollowsStore & BulkFollowCapable) | undefined
            if (!follows?.armFollowRead || this.bulkBusy) {
                return
            }
            this.bulkBusy = true
            this.bulkError = ''
            try {
                await follows.armFollowRead()
            } finally {
                this.bulkBusy = false
                this.bulkError = follows.error
            }
        },

        /**
         * **Sign and publish ONE kind 3** carrying `bulkPlan.targets` — since P3
         * `planFollowWrite` takes n targets in a single pass, one event, one signature,
         * independent of the count.
         *
         * `targets` is copied into a local BEFORE the write can start, because the
         * `x-on:close` on the preview modal clears `bulkPlan`, and a write that reaches
         * for it afterwards finds `null`.
         *
         * On success the selection is dropped and the mode stays open — the reader keeps
         * their place in the list. Saying that the write LANDED is P5's job (`duplicate:`
         * is not success), so nothing is claimed here.
         */
        async confirmBulkFollow() {
            const plan = this.bulkPlan
            const follows = Alpine.store('follows') as (FollowsStore & BulkFollowCapable) | undefined
            if (!plan || plan.add === 0 || this.bulkBusy || !follows?.followMany) {
                return
            }
            const targets = [...plan.targets]
            this.bulkBusy = true
            this.bulkError = ''
            try {
                await follows.followMany(targets)
            } finally {
                this.bulkBusy = false
            }
            if (follows.error) {
                this.bulkError = follows.error
                // **A refused write voids the plan.** The three numbers above the button
                // were counted against the contact list as the store held it when the
                // dialog opened, and every refusal `followMany` can produce has moved that
                // list or its owner: the first click on an unseen list IS the read (P1), so
                // afterwards `following` is no longer `[]`; a partial write moved it too.
                // Leaving the dialog open would put a second click one keystroke away from
                // signing against „wächst von 0 auf 400" while the truth is 703 → 1103 —
                // and those numbers are the only place the plan gives the reader to notice
                // an unread base BEFORE the signature.
                //
                // Unconditional rather than „only when the list moved": the selection
                // survives, so the cost is one press of „Auswahl prüfen", which rebuilds
                // the counts from the list that is now loaded. A condition here would be a
                // second rule about when the numbers are stale, and it would be the one
                // that is wrong.
                this.bulkPlan = null
                dispatchModal(BULK_PREVIEW_MODAL, false)

                return
            }
            this.selected = {}
            dispatchModal(BULK_PREVIEW_MODAL, false)
        },
        // Nach jeder Admin-Mutation: neu ziehen + Admin-Status re-checken (Fix C).
        // Die Live-Sub reflektiert die relay-signierte Änderung ohnehin.
        reload() {
            if (this._url) {
                loadSpaceDirectory(this._url)
                refreshSpaceAdmin(this._url)
            }
        },
        openRoleCreate() {
            this.roleForm = { id: '', label: '', description: '', hue: 210, lightness: 0.5, order: this.rolesFull.length }
            dispatchModal('role-form')
        },
        openRoleEdit(role: SpaceRole) {
            this.roleForm = {
                id: role.id,
                label: role.label,
                description: role.description,
                hue: parseFloat(role.color.hue) || 0,
                lightness: parseFloat(role.color.lightness) || 0.5,
                order: role.order,
            }
            dispatchModal('role-form')
        },
        async saveRole() {
            if (!this._url || this.busy || !this.roleForm.label.trim()) {
                return
            }
            this.busy = true
            const { id, label, description, hue, lightness, order } = this.roleForm
            const color = { hue: String(hue), saturation: '0.7', lightness: String(lightness) }
            try {
                const err = id
                    ? await editRole(this._url, id, label, description, color, order)
                    : await createRole(this._url, label, description, color, order)
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('role-form', false)
                    this.reload()
                }
            } finally {
                this.busy = false
            }
        },
        async removeRole(id: string) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await deleteRole(this._url, id)
                err ? toast(err) : this.reload()
            } finally {
                this.busy = false
            }
        },
        openMemberRoles(m: MemberView) {
            this.editingMember = m
            dispatchModal('member-roles')
        },
        memberHasRole(roleId: string) {
            return Boolean(this.editingMember?.roleIds.includes(roleId))
        },
        async toggleMemberRole(roleId: string) {
            if (!this._url || !this.editingMember || this.busy) {
                return
            }
            this.busy = true
            const pk = this.editingMember.pubkey
            const has = this.editingMember.roleIds.includes(roleId)
            try {
                const err = has
                    ? await unassignRole(this._url, pk, roleId)
                    : await assignRole(this._url, pk, roleId)
                err ? toast(err) : this.reload()
            } finally {
                this.busy = false
            }
        },
        async removeMember(m: MemberView) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await removeSpaceMember(this._url, m.pubkey)
                err ? toast(err) : this.reload()
            } finally {
                this.busy = false
            }
        },
        async banMember(m: MemberView) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await banSpaceMember(this._url, m.pubkey)
                err ? toast(err) : this.reload()
            } finally {
                this.busy = false
            }
        },
        // ── P4: befristete Sperre (Buzz kind 9042/9043) ────────────────────────
        // Die HÄRTESTE Maßnahme dieser Oberfläche. Entfernen und Bannen von Mitgliedern
        // bietet sie nicht mehr an (fachliche Entscheidung des Vereins, 2026-09-03) —
        // die Schreibpfade dafür stehen weiterhin darüber, ihre Bedienflächen sind an
        // allen vier Markup-Stellen auskommentiert und tragen den Grund im Kommentar.
        openTimeout(m: MemberView) {
            this.timeoutTarget = m
            this.timeoutReason = ''
            dispatchModal('member-timeout')
        },
        async confirmTimeout() {
            const target = this.timeoutTarget
            if (!this._url || !target || this.busy) {
                return
            }
            this.busy = true
            try {
                // `Number(...)` erst hier: das <select> liefert einen String, und die
                // Umrechnung Dauer → `expiration` gehört in die reine Funktion
                // (`planTimeout`), nicht in die Fläche. Ein unbrauchbarer Wert kommt von
                // dort als Absage zurück, statt hier zu einem NaN zu werden.
                const err = await timeoutSpaceMember(
                    this._url,
                    target.pubkey,
                    Number(this.timeoutDuration),
                    this._spaceKind,
                    this.timeoutReason.trim(),
                )
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('member-timeout', false)
                    toast(t('Mitglied befristet gesperrt.'), 'success')
                    // 9042 ist nie lesbar (der Relay speichert und fanoutet 9042–9044
                    // nicht) — die Sperrliste ist der einzige Erfolgsnachweis, also frisch
                    // ziehen statt optimistisch etwas anzuzeigen.
                    await this.loadBanned()
                }
            } finally {
                this.busy = false
            }
        },
        async liftTimeout(pubkey: string) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await untimeoutSpaceMember(this._url, pubkey, this._spaceKind)
                if (err) {
                    toast(err)
                } else {
                    await this.loadBanned()
                }
            } finally {
                this.busy = false
            }
        },
        async loadBanned() {
            if (!this._url) {
                return
            }
            // Zwei Felder statt eines: „niemand ist gesperrt" und „du darfst diese
            // Abfrage nicht" sind verschiedene Auskünfte, und die zweite als leere Liste
            // zu zeigen sagte dem Moderator das Gegenteil der Wahrheit.
            const { entries, error } = await loadRestrictedMembers(this._url)
            this.banned = entries
            this.bannedError = error
        },
        async unbanMember(pubkey: string) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await unbanSpaceMember(this._url, pubkey)
                if (err) {
                    toast(err)
                } else {
                    await this.loadBanned()
                }
            } finally {
                this.busy = false
            }
        },
        async restoreMember(pubkey: string) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await addSpaceMember(this._url, pubkey)
                if (err) {
                    toast(err)
                } else {
                    await this.loadBanned()
                    this.reload()
                }
            } finally {
                this.busy = false
            }
        },
        // Invite-Link generieren: Claim (28935) vom Relay holen → /join?r=&c=.
        async loadInvite() {
            if (!this._url) {
                return
            }
            this.inviteBusy = true
            this.inviteLink = ''
            try {
                const claim = await loadSpaceInviteClaim(this._url)
                const params = new URLSearchParams({ r: displayRelayUrl(this._url), c: claim })
                this.inviteLink = `${window.location.origin}/join?${params}`
            } finally {
                this.inviteBusy = false
            }
        },
        copyInvite() {
            if (this.inviteLink) {
                navigator.clipboard?.writeText(this.inviteLink).then(() => toast(t('Link kopiert.'), 'success'))
            }
        },
        // ── P3: Melde-Queue (NIP-56 kind 1984) ─────────────────────────────────
        // Meldung verwerfen: den Report relay-seitig bannen (banevent) → er
        // verschwindet aus der Queue (optimistisch lokal via removeEvent). Der
        // gemeldete Inhalt bleibt unberührt. Gemeinsames busy-Gate wie die anderen
        // Admin-Mutationen (immer nur eine Aktion offen).
        // Eine erledigte Meldung aus BEIDEN Quellen räumen: dem Repository (zooid,
        // kind 1984) und dem Buzz-Report-Store. Danach frisch nachladen — die
        // Relay-Datenbank ist die Wahrheit, das lokale Entfernen nur die Optik.
        _reportDone(r: ReportView) {
            const url = this._url
            if (!url) {
                return
            }
            app.repository.removeEvent(r.id)
            forgetBuzzReport(url, r.id)
            void loadSpaceReports(url)
        },
        async dismissReport(r: ReportView) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await resolveReport(this._url, r.id, 'dismiss')
                if (err) {
                    toast(err)
                } else {
                    this._reportDone(r)
                }
            } finally {
                this.busy = false
            }
        },
        // Gemeldeten Inhalt entfernen: das gemeldete Event bannen (banevent) UND die
        // Meldung verwerfen (erledigt → aus der Queue). Beides relay-seitig, lokal
        // optimistisch ausgeblendet.
        async removeReportedContent(r: ReportView) {
            if (!this._url || this.busy || !r.reportedId) {
                return
            }
            this.busy = true
            try {
                // Das `h` durchreichen: Buzz' kind 9005 verlangt Raum-Bezug
                // (`invalid: channel-scoped events must include an h tag`, am laufenden
                // Relay gemessen). Es kommt dort aus `channel_id` des Report-Datensatzes.
                // Auf zooid ist der vierte Parameter folgenlos.
                const err =
                    (await banEvent(this._url, r.reportedId, '', r.roomH)) ||
                    (await resolveReport(this._url, r.id, 'delete'))
                if (err) {
                    toast(err)
                } else {
                    app.repository.removeEvent(r.reportedId)
                    this._reportDone(r)
                }
            } finally {
                this.busy = false
            }
        },
        // Gemeldeten Autor bannen (banpubkey — entfernt ihn + löscht alle seine
        // Events) UND die Meldung verwerfen. Der Autor-Bann räumt den gemeldeten
        // Inhalt relay-seitig gleich mit weg.
        async banReportedUser(r: ReportView) {
            if (!this._url || this.busy || !r.reportedPubkey) {
                return
            }
            this.busy = true
            try {
                const err =
                    (await banSpaceMember(this._url, r.reportedPubkey)) ||
                    (await resolveReport(this._url, r.id, 'ban'))
                if (err) {
                    toast(err)
                } else {
                    refreshSpaceAdmin(this._url)
                    this._reportDone(r)
                }
            } finally {
                this.busy = false
            }
        },
        // ── P4b: Beitritts-Queue (offene 9021 für closed-Räume) ────────────────
        // Accept: kind 9000 (put-user) — the relay writes the pubkey into the 39002 and
        // the request leaves the queue.
        //
        // It leaves because the 9000 is a **later moderation op on that pubkey**, not
        // because of the resulting membership; the previous wording named the mechanism
        // that P5 stage 3 replaced. The distinction is not academic — see the note inside
        // `acceptJoin` on the 39001 precondition, which is why `removeEvent` below is
        // still doing work.
        // Der Anfragende ist bereits Space-Member (sonst wäre sein 9021 abgelehnt worden),
        // also genügt der Raum-Beitritt (kein zusätzliches allowpubkey nötig).
        async acceptJoin(j: JoinRequestView) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await addRoomMember(this._url, j.h, j.pubkey)
                if (err) {
                    toast(err)
                } else {
                    // Withdraw the 9021 (same as on reject). Best-effort — the
                    // membership already stands.
                    //
                    // The local half of this is obsolete since P5 stage 3. The old
                    // comment read: without removing it, the request would reappear as
                    // "open" after a later kick (a 9001 produces no 9022 and drops the
                    // pubkey out of the 39002). That resurrection is fixed at the source
                    // now — `deriveSpaceJoinRequests` sits on `Rooms.pendingJoins`, which
                    // answers a request by the latest moderation op on that pubkey. The
                    // case is covered by `joinQueueQuelle.test.ts` ("a kick after approval
                    // does NOT reopen the request").
                    //
                    // **Narrower than first written, after measuring:** the pruning only
                    // happens when the 9000 is authored by a pubkey in THAT room's
                    // relay-signed 39001, or by the relay itself — that is the condition
                    // `Rooms.foldMembership` applies to moderation ops. On Buzz, where
                    // room roles are per-channel, an accepting manager outside that 39001
                    // does NOT prune the request (measured: queue entry stays). So
                    // `removeEvent` is still doing work, and not only as an optimistic
                    // counterpart.
                    //
                    // `banEvent` is obsolete in no reading: it asks the relay to drop the
                    // 9021, which no client-side derivation can do.
                    void banEvent(this._url, j.id)
                    app.repository.removeEvent(j.id)
                }
            } finally {
                this.busy = false
            }
        },
        // Ablehnen: den 9021-Request bannen (banevent) → aus der Queue (optimistisch lokal).
        async rejectJoin(j: JoinRequestView) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await banEvent(this._url, j.id)
                if (err) {
                    toast(err)
                } else {
                    app.repository.removeEvent(j.id)
                }
            } finally {
                this.busy = false
            }
        },
        // ── P2: Space-Metadaten bearbeiten (NIP-86 changerelay*) ───────────────
        // Vorbelegen aus dem NIP-11-Info-Doc + Snapshot (_spaceInitial) als Vergleichs-
        // basis: saveSpace sendet NUR Felder, die der Admin gegenüber dem Prefill wirklich
        // geändert hat → kein Whitespace-No-op, und ein (noch) leeres Feld aus einem nicht
        // geladenen Profil wird NIE als „auf leer gesetzt" gesendet (kein Namens-Wipe).
        // Modal SOFORT mit dem Cache-Snapshot öffnen (nie hinter await blocken,
        // [[zap-modal-open-never-block-on-resolvezapper]]); dann das NIP-11 frisch
        // nachladen (1h-loadRelay-Cache umgehen) und neu vorbelegen — aber nur, wenn der
        // Admin das Formular noch nicht angefasst hat (sonst überschriebe es seine Eingabe).
        openSpaceEdit() {
            const url = this._url
            if (!url) {
                return
            }
            this._prefillSpace(get(app.use(Relays).index.$).get(url))
            this._spaceIconFile = null
            dispatchModal('space-edit')
            void app.use(Relays).forceLoad(url).then(() => {
                const pristine =
                    !this._spaceIconFile &&
                    this.spaceForm.name === this._spaceInitial.name &&
                    this.spaceForm.description === this._spaceInitial.description
                if (this._url === url && pristine) {
                    this._prefillSpace(get(app.use(Relays).index.$).get(url))
                }
            })
        },
        _prefillSpace(profile?: RelayInfo) {
            this.spaceForm = { name: profile?.name ?? '', description: profile?.description ?? '' }
            this._spaceInitial = { name: this.spaceForm.name, description: this.spaceForm.description }
            this.spaceIconPreview = profile?.icon ?? ''
        },
        // Neues Icon wählen: lokale Vorschau (data-URL) + Datei merken (Upload erst
        // beim Speichern, damit ein Abbrechen nichts hochlädt). `input.value` leeren,
        // damit dieselbe Datei nach einem Abbruch erneut wählbar bleibt (wie pickImage).
        pickSpaceIcon(input: HTMLInputElement) {
            const file = input.files?.[0]
            input.value = ''
            if (!file || !file.type.startsWith('image/')) {
                return
            }
            this._spaceIconFile = file
            const reader = new FileReader()
            reader.onload = (e) => {
                this.spaceIconPreview = String(e.target?.result ?? '')
            }
            reader.readAsDataURL(file)
        },
        // Speichern: nur gegenüber dem Prefill-Snapshot GEÄNDERTE Felder senden (je ein
        // manageRelay-Call, wie der Referenz-Client), ein neues Icon vorher hochladen.
        // Danach das NIP-11 hart neu laden (forceLoadRelay) → das Branding (Space-Auswahl/
        // Raum-Header) zieht ohne Reload nach. Erster Fehler bricht ab (Modal bleibt offen).
        async saveSpace() {
            if (!this._url || this.spaceSaving) {
                return
            }
            this.spaceSaving = true
            const url = this._url
            try {
                if (this.spaceForm.name !== this._spaceInitial.name) {
                    const err = await setRelayName(url, this.spaceForm.name.trim())
                    if (err) {
                        toast(err)
                        return
                    }
                }
                if (this.spaceForm.description !== this._spaceInitial.description) {
                    const err = await setRelayDescription(url, this.spaceForm.description.trim())
                    if (err) {
                        toast(err)
                        return
                    }
                }
                if (this._spaceIconFile) {
                    const uploaded = await uploadAttachment(this._spaceIconFile)
                    const err = await setRelayIcon(url, uploaded.url)
                    if (err) {
                        toast(err)
                        return
                    }
                }
                // Gespeichert (Relay hat quittiert); das lokale NIP-11 frisch nachziehen,
                // damit das Branding vor dem Toast steht.
                await app.use(Relays).forceLoad(url)
                dispatchModal('space-edit', false)
                toast(t('Space gespeichert.'), 'success')
            } catch {
                toast(t('Speichern fehlgeschlagen.'))
            } finally {
                this.spaceSaving = false
            }
        },
        destroy() {
            this._unsubActive?.()
            this._unsubDir?.()
            this._unsubRoles?.()
            this._unsubAdmin?.()
            this._unsubAccess?.()
            this._unsubReports?.()
            this._unsubJoins?.()
            this._unsubStatuses?.()
            this._unsubStatusPending?.()
            this._unsubSpaceKind?.()
            this._controller?.abort()
        },
    }))
}
