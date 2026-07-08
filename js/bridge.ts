/**
 * Reaktivitäts-Bridge: welshman-Store (Svelte-Contract) → Alpine.
 *
 * welshman-Stores erfüllen den Svelte-Store-Contract (`subscribe(cb) => unsub`),
 * ohne Svelte-Compiler. `alpineFromStore` koppelt jeden Store an Alpine-State;
 * `init`/`destroy` folgen dem Alpine-Lifecycle (kein Doppel-Alpine).
 */
import type { Readable } from 'svelte/store'
import { repository, pubkey } from '@welshman/app'
import { load } from '@welshman/net'
import { deriveEvents } from '@welshman/store'
import type { TrustedEvent } from '@welshman/util'
import * as nip19 from 'nostr-tools/nip19'
import QRCode from 'qrcode'
import { DEFAULT_RELAYS, isMobile, nativeBrowserOpen, nativeBrowserInApp } from './core'
import {
    loginWithExtension,
    loginWithSecretKey,
    loginWithBunker,
    loginWithNostrConnect,
    logout,
    handoffToServer,
    logoutServer,
} from './session'
import {
    spaceChoices,
    activeSpace,
    activeSpaceView,
    setActiveSpace,
    displayRelayUrl,
    loadUserGroupList,
    loadSpaceRooms,
    listenRoomMembers,
    deriveUserInRoom,
    joinRoom,
    leaveRoom,
    joinSpace,
    leaveSpace,
    parseInviteLink,
    loadSpaceInviteClaim,
    userSpaceUrls,
    isVereinRelay,
    type SpaceView,
} from './groups'
import {
    deriveSpaceDirectory,
    deriveSpaceRoles,
    deriveVereinAccess,
    deriveUserIsSpaceAdmin,
    refreshSpaceAdmin,
    loadSpaceDirectory,
    listenSpaceDirectory,
    loadMemberProfiles,
    loadBannedMembers,
    createRole,
    editRole,
    deleteRole,
    assignRole,
    unassignRole,
    removeSpaceMember,
    banSpaceMember,
    unbanSpaceMember,
    addSpaceMember,
    type DirectoryView,
    type MemberView,
    type RoleView,
    type SpaceRole,
    type BannedMember,
    type VereinAccess,
} from './members'
import {
    deriveRoomChat,
    listenRoom,
    loadRoomMessages,
    sendRoomMessage,
    deleteRoomMessage,
    readRoomLastRead,
    writeRoomLastRead,
    type ChatMessage,
} from './feeds'
import { signerHealth, signerHealthLabel, type SignerHealth } from './signer-health'
import { toast, flashToast } from './toast'

/** Alpine-Magics, die auf `this` einer Komponente verfügbar sind. */
type AlpineMagics = { $refs: Record<string, HTMLElement>; $nextTick: (cb: () => void) => void }

/** Öffnet/schließt ein Flux-Modal per Name (Flux lauscht auf modal-show/-close). */
const dispatchModal = (name: string, show = true): void => {
    document.dispatchEvent(new CustomEvent(show ? 'modal-show' : 'modal-close', { detail: { name } }))
}

/**
 * Ziel nach erfolgreichem welshman-Login. Web: NIP-98-Handoff → Redirect ins
 * Server-Gate. Mobile: kein Server-Gate (§7), direkt zu /spaces — die Insel
 * hält die Session selbst.
 */
async function postLoginRedirect(): Promise<string> {
    return isMobile ? '/spaces' : handoffToServer()
}

/** Generischer Adapter (für M2+): spiegelt einen Store in `this.value`. */
export function alpineFromStore<T>(store: Readable<T>) {
    return {
        value: undefined as T | undefined,
        _unsub: null as null | (() => void),
        init() {
            this._unsub = store.subscribe((v) => {
                this.value = v
            })
        },
        destroy() {
            this._unsub?.()
        },
    }
}

/**
 * Registriert Alpine-Komponenten. Wird in `alpine:init` aufgerufen (= vor dem
 * Alpine/Livewire-Start), damit `x-data="…"` die Komponenten kennt.
 */
type SmokeState = {
    events: TrustedEvent[]
    loading: boolean
    error: string
    _unsub: null | (() => void)
    init(): void
    destroy(): void
}

type AuthState = {
    pubkey: string | null
    npub: string
    hasExtension: boolean
    keyInput: string
    bunkerInput: string
    connectQr: string
    connectUri: string
    connecting: boolean
    mobile: boolean
    busy: boolean
    error: string
    _unsub: null | (() => void)
    _connectAbort: AbortController | null
    init(): void
    destroy(): void
    completeLogin(fn: () => void | Promise<void>): Promise<void>
    loginExtension(): Promise<void>
    loginNsec(): Promise<void>
    loginBunker(): Promise<void>
    startConnect(): Promise<void>
    stopConnect(): void
    openAmber(): void
    doLogout(): Promise<void>
}

type SpacesState = {
    space: SpaceView | null
    loading: boolean
    gatedOut: boolean
    _unsubView: null | (() => void)
    _unsubActive: null | (() => void)
    _unsubAccess: null | (() => void)
    _loaded: Set<string>
    init(): void
    destroy(): void
}

type VereinGateState = {
    show: boolean
    _access: VereinAccess
    _loaded: boolean
    _unsubActive: null | (() => void)
    _unsubAccess: null | (() => void)
    init(): void
    _refresh(): void
    openExternal(url: string, e: Event): void
    destroy(): void
}

/** Formular-Zustand einer Rolle (hue 0–360, lightness 0–1; '' id = neu). */
type RoleForm = { id: string; label: string; description: string; hue: number; lightness: number; order: number }

type DirectoryState = {
    ready: boolean
    members: MemberView[]
    roles: RoleView[]
    query: string
    gatedOut: boolean
    // Admin (NIP-86)
    isAdmin: boolean
    rolesFull: SpaceRole[]
    editingMember: MemberView | null
    roleForm: RoleForm
    banned: BannedMember[]
    inviteLink: string
    inviteBusy: boolean
    busy: boolean
    _url: string | null
    _controller: AbortController | null
    _unsubActive: null | (() => void)
    _unsubDir: null | (() => void)
    _unsubRoles: null | (() => void)
    _unsubAdmin: null | (() => void)
    _unsubAccess: null | (() => void)
    _loadedDir: Set<string>
    _loadedProfiles: Set<string>
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
    loadBanned(): Promise<void>
    unbanMember(pubkey: string): Promise<void>
    restoreMember(pubkey: string): Promise<void>
    loadInvite(): Promise<void>
    copyInvite(): void
}

type RoomChatState = {
    h: string
    messages: ChatMessage[]
    loading: boolean
    loadingMore: boolean
    hasMore: boolean
    atBottom: boolean
    unread: number
    firstPaintDone: boolean
    joined: boolean
    joining: boolean
    membershipReady: boolean
    draft: string
    sending: boolean
    sendError: string
    replyTo: { id: string; pubkey: string; name: string; text: string } | null
    activeId: string | null // Nachricht mit eingeblendeten Aktionen (Tap-to-toggle, Touch)
    flashId: string | null // kurz hervorgehobene Nachricht (Sprung zum Zitat)
    deleting: boolean
    pendingDelete: { id: string; createdAt: number } | null
    _url: string | null
    _lastRead: number
    _onViewport: null | (() => void)
    _unsubActive: null | (() => void)
    _unsub: null | (() => void)
    _unsubJoined: null | (() => void)
    _controller: AbortController | null
    _loadedProfiles: Set<string>
    init(): void
    setup(url: string): void
    teardown(): void
    loadOlder(): void
    onScroll(): void
    scrollToBottom(): void
    scrollToMessage(id: string): void
    autoGrow(el: HTMLTextAreaElement): void
    markRead(): void
    setReply(m: ChatMessage): void
    clearReply(): void
    send(): Promise<void>
    askDelete(m: ChatMessage): void
    confirmDelete(): Promise<void>
    remove(id: string, createdAt: number): Promise<void>
    join(): Promise<void>
    leave(): Promise<void>
    destroy(): void
}

type SignerBannerState = {
    message: string
    _unsubHealth: null | (() => void)
    _unsubPubkey: null | (() => void)
    _pk: string | null
    _health: SignerHealth
    init(): void
    destroy(): void
}

type SpaceSettingsState = {
    spaces: { url: string; label: string; joined: boolean }[]
    active: string | null
    activeJoined: boolean
    activeIsVerein: boolean
    busy: boolean
    _joined: string[]
    _choices: string[]
    _unsubChoices: null | (() => void)
    _unsubActive: null | (() => void)
    _unsubJoined: null | (() => void)
    init(): void
    destroy(): void
    choose(url: string): void
    joinActive(): Promise<void>
    leaveActive(): Promise<void>
}

type InviteState = {
    space: string
    label: string
    claim: string
    joining: boolean
    error: string
    done: boolean
    init(): void
    accept(): Promise<void>
}

export function registerNostrComponents(Alpine: {
    data: (name: string, factory: (...args: unknown[]) => unknown) => void
}) {
    // Space/Room-Navigation (M2, Single-Space §12): lädt die 10009-Membership,
    // zieht die Room-Metas (39000) des AKTIVEN Space nach und spiegelt genau
    // diesen einen Space nach Alpine. Kein Multi-Space-Layout, keine Rail.
    // AUTH gegen zooid läuft automatisch (Signer aus der Session).
    Alpine.data('nostrSpaces', (): SpacesState => ({
        space: null,
        loading: true,
        gatedOut: false,
        _unsubView: null,
        _unsubActive: null,
        _unsubAccess: null,
        _loaded: new Set<string>(),
        init() {
            loadUserGroupList()?.finally(() => {
                this.loading = false
            })
            // Aktiver Space → dessen Rooms laden (Wechsel baut Subs neu auf).
            this._unsubActive = activeSpace.subscribe((url: string) => {
                if (!this._loaded.has(url)) {
                    this._loaded.add(url)
                    loadSpaceRooms(url)
                }
                // Vereins-Relay & kein Mitglied → die Räume liefert der Relay gar
                // nicht aus. „gatedOut" ersetzt die falsche „keine Räume"-Meldung.
                this._unsubAccess?.()
                this.gatedOut = false
                this._unsubAccess = deriveVereinAccess(url).subscribe((a: VereinAccess) => {
                    this.gatedOut = a.gated && a.ready && !a.isMember
                })
            })
            this._unsubView = activeSpaceView.subscribe((view: SpaceView) => {
                this.space = view
            })
        },
        destroy() {
            this._unsubActive?.()
            this._unsubView?.()
            this._unsubAccess?.()
        },
    }))

    // Vereins-Gate: zeigt Nicht-Vereinsmitgliedern (nicht in der relay-signierten
    // 13534-Liste) auf einem EINUNDZWANZIG-Vereins-Relay den Beitritts-Hinweis.
    // `show` erst wenn relay.self da ist (Fix A) — kein falsches Aufblitzen.
    Alpine.data('nostrVereinGate', (): VereinGateState => ({
        show: false,
        _access: { gated: false, ready: false, isMember: false },
        _loaded: false,
        _unsubActive: null,
        _unsubAccess: null,
        init() {
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this._unsubAccess?.()
                this.show = false
                this._loaded = false
                this._access = { gated: isVereinRelay(url), ready: false, isMember: false }
                // Mitgliederliste (13534) laden — auf /spaces tut das sonst niemand.
                // Erst NACH EOSE steht fest, ob der User Mitglied ist → kein Flash
                // des Hinweises für echte Mitglieder.
                if (this._access.gated) {
                    loadSpaceDirectory(url).finally(() => {
                        this._loaded = true
                        this._refresh()
                    })
                }
                this._unsubAccess = deriveVereinAccess(url).subscribe((a: VereinAccess) => {
                    this._access = a
                    this._refresh()
                })
            })
        },
        _refresh() {
            this.show = this._access.gated && this._loaded && this._access.ready && !this._access.isMember
        },
        // Vereins-Beitritts-Link öffnen: in der nativen App via In-App-Browser
        // (Custom Tab / SFSafariViewController) — ein `target=_blank`-Link
        // verpufft in der WebView. Im Web bleibt das normale <a> (kein preventDefault).
        openExternal(url: string, e: Event) {
            if (isMobile) {
                e.preventDefault()
                void nativeBrowserInApp(url)
            }
        },
        destroy() {
            this._unsubActive?.()
            this._unsubAccess?.()
        },
    }))

    // Space-Directory (M3): Mitglieder + Rollen des AKTIVEN Space. Gated auf
    // relay.self (Fix A) — bis NIP-11 da ist, Skeleton statt „keine Mitglieder".
    // Client-Suche filtert über Name + npub. Kein Multi-Space (§12).
    Alpine.data('nostrDirectory', (): DirectoryState => ({
        ready: false,
        members: [],
        roles: [],
        query: '',
        gatedOut: false,
        isAdmin: false,
        rolesFull: [],
        editingMember: null,
        roleForm: { id: '', label: '', description: '', hue: 210, lightness: 0.5, order: 0 },
        banned: [],
        inviteLink: '',
        inviteBusy: false,
        busy: false,
        _url: null,
        _controller: null,
        _unsubActive: null,
        _unsubDir: null,
        _unsubRoles: null,
        _unsubAdmin: null,
        _unsubAccess: null,
        _loadedDir: new Set<string>(),
        _loadedProfiles: new Set<string>(),
        init() {
            // Aktiver Space → dessen Directory laden + Subs neu aufbauen.
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this._unsubDir?.()
                this._unsubRoles?.()
                this._unsubAdmin?.()
                this._unsubAccess?.()
                this._controller?.abort()
                this.ready = false
                this.members = []
                this.roles = []
                this.gatedOut = false
                this.editingMember = null
                this._url = url
                this._controller = new AbortController()
                // Vereins-Relay & kein Mitglied → Mitgliederliste liefert der Relay
                // nicht aus; Suche + falsche „keine Mitglieder"-Meldung ausblenden.
                this._unsubAccess = deriveVereinAccess(url).subscribe((a: VereinAccess) => {
                    this.gatedOut = a.gated && a.ready && !a.isMember
                })
                if (!this._loadedDir.has(url)) {
                    this._loadedDir.add(url)
                    loadSpaceDirectory(url)
                }
                listenSpaceDirectory(url, this._controller.signal)
                this._unsubDir = deriveSpaceDirectory(url).subscribe((view: DirectoryView) => {
                    this.ready = view.ready
                    this.members = view.members
                    this.roles = view.roles
                    // Falls das Rollen-Modal offen ist, die Auswahl frisch halten.
                    if (this.editingMember) {
                        this.editingMember =
                            view.members.find((m) => m.pubkey === this.editingMember!.pubkey) ?? this.editingMember
                    }
                    // Profile der (neuen) Mitglieder nachladen — einmal je pubkey.
                    const missing = view.members
                        .map((m) => m.pubkey)
                        .filter((pk) => !this._loadedProfiles.has(pk))
                    missing.forEach((pk) => this._loadedProfiles.add(pk))
                    loadMemberProfiles(url, missing)
                })
                this._unsubRoles = deriveSpaceRoles(url).subscribe((roles: SpaceRole[]) => {
                    this.rolesFull = roles
                })
                this._unsubAdmin = deriveUserIsSpaceAdmin(url).subscribe((admin: boolean) => {
                    this.isAdmin = admin
                })
            })
        },
        filtered() {
            const q = this.query.trim().toLowerCase()
            return q ? this.members.filter((m) => m.search.includes(q)) : this.members
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
        async loadBanned() {
            if (!this._url) {
                return
            }
            this.banned = await loadBannedMembers(this._url)
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
                navigator.clipboard?.writeText(this.inviteLink).then(() => toast('Link kopiert.', 'success'))
            }
        },
        destroy() {
            this._unsubActive?.()
            this._unsubDir?.()
            this._unsubRoles?.()
            this._unsubAdmin?.()
            this._unsubAccess?.()
            this._controller?.abort()
        },
    }))

    // Room-Chat (M4 lesen + M5 schreiben): Verlauf eines Raums im AKTIVEN Space.
    // Live-Sub (limit:0) + Cursor-Pagination. Senden/Löschen = kind 9/5 (optimistisch).
    // Beitreten/Verlassen = NIP-29 (kind 9021/9022) → relay-autoritative 39002-
    // Mitgliedschaft (persistent); der Composer ist an `joined` gekoppelt.
    Alpine.data('nostrRoomChat', (h: unknown): RoomChatState => ({
        h: String(h),
        messages: [],
        loading: true,
        loadingMore: false,
        hasMore: true,
        atBottom: true,
        unread: 0,
        firstPaintDone: false,
        joined: false,
        joining: false,
        membershipReady: false,
        draft: '',
        sending: false,
        sendError: '',
        replyTo: null,
        activeId: null,
        flashId: null,
        deleting: false,
        pendingDelete: null,
        _url: null,
        _lastRead: 0,
        _onViewport: null,
        _unsubActive: null,
        _unsub: null,
        _unsubJoined: null,
        _controller: null,
        _loadedProfiles: new Set<string>(),
        init() {
            // Aktiver Space → dessen Room-Feed (Wechsel baut Sub + Live neu auf).
            this._unsubActive = activeSpace.subscribe((url: string) => this.setup(url))
            // Mobil: Tastatur/Adressleiste ändern die Viewport-Höhe — am Ende dran bleiben.
            this._onViewport = () => {
                if (this.atBottom) {
                    this.scrollToBottom()
                }
            }
            window.visualViewport?.addEventListener('resize', this._onViewport)
        },
        setup(url: string) {
            this.teardown()
            this._url = url
            this.loading = true
            this.membershipReady = false
            this.messages = []
            this.unread = 0
            this.atBottom = true
            this.firstPaintDone = false
            this._lastRead = readRoomLastRead(url, this.h)
            this._controller = new AbortController()
            // Raum-Metas + Mitglieder (39002) laden; Live-Sub auf 39002, damit
            // Beitreten/Verlassen sofort reflektiert. `membershipReady` verhindert
            // ein Aufblitzen des Beitreten-Hinweises, bevor die 39002 da ist.
            loadSpaceRooms(url).finally(() => {
                this.membershipReady = true
            })
            listenRoomMembers(url, this._controller.signal)
            this._unsubJoined = deriveUserInRoom(url, this.h).subscribe((isMember: boolean) => {
                this.joined = isMember
            })
            listenRoom(url, this.h, this._controller.signal)
            loadRoomMessages(url, this.h).finally(() => {
                this.loading = false
            })
            this._unsub = deriveRoomChat(url, this.h, this._lastRead).subscribe((msgs: ChatMessage[]) => {
                const wasAtBottom = this.atBottom
                const prevIds = new Set(this.messages.map((m) => m.id))
                const prevNewest = this.messages.length ? this.messages[this.messages.length - 1].created_at : 0
                this.messages = msgs

                // Profile neuer Autoren nachladen (einmal je pubkey).
                const missing = msgs
                    .map((m) => m.pubkey)
                    .filter((pk) => !this._loadedProfiles.has(pk))
                if (missing.length > 0) {
                    missing.forEach((pk) => this._loadedProfiles.add(pk))
                    loadMemberProfiles(url, missing)
                }

                const magics = this as unknown as AlpineMagics
                magics.$nextTick(() => {
                    if (wasAtBottom) {
                        this.scrollToBottom()
                        return
                    }
                    // Nur wirklich am Ende angehängte Fremd-Nachrichten zählen: kein
                    // loadOlder-Prepend (created_at < prevNewest), keine eigenen.
                    this.unread += msgs.filter(
                        (m) => !prevIds.has(m.id) && !m.mine && m.created_at >= prevNewest,
                    ).length
                    this.firstPaintDone = true
                })
            })
        },
        // Ältere Nachrichten vor der aktuell ältesten laden; Scroll-Position halten.
        loadOlder() {
            if (this.loadingMore || !this._url || this.messages.length === 0) {
                return
            }
            this.loadingMore = true
            const el = (this as unknown as AlpineMagics).$refs.scroll
            const prevHeight = el?.scrollHeight ?? 0
            const oldest = this.messages[0].created_at
            loadRoomMessages(this._url, this.h, oldest)
                .then((events) => {
                    if (events.length === 0) {
                        this.hasMore = false
                    }
                })
                .finally(() => {
                    this.loadingMore = false
                    ;(this as unknown as AlpineMagics).$nextTick(() => {
                        if (el) {
                            el.scrollTop = el.scrollHeight - prevHeight
                        }
                    })
                })
        },
        onScroll() {
            const el = (this as unknown as AlpineMagics).$refs.scroll
            if (!el) {
                return
            }
            this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
            if (this.atBottom) {
                this.unread = 0
                this.markRead()
            }
            // Nahe am oberen Rand → nächstältere Seite automatisch nachladen (Button bleibt Fallback).
            if (el.scrollTop < 120 && this.hasMore && !this.loadingMore) {
                this.loadOlder()
            }
        },
        scrollToBottom() {
            const el = (this as unknown as AlpineMagics).$refs.scroll
            if (el) {
                el.scrollTop = el.scrollHeight
            }
            this.atBottom = true
            this.unread = 0
            this.firstPaintDone = true
            this.markRead()
        },
        // Zur zitierten Original-Nachricht springen + kurz hervorheben. Ist sie nicht
        // (mehr) geladen (älter als der Verlauf), passiert nichts — kein Nachladen (Scope).
        scrollToMessage(id: string) {
            const el = document.getElementById('msg-' + id)
            if (!el) {
                return
            }
            el.scrollIntoView({ block: 'center', behavior: 'smooth' })
            this.flashId = id
            // ponytail: schlichter Timeout-Highlight statt Animation-Lib
            setTimeout(() => {
                if (this.flashId === id) {
                    this.flashId = null
                }
            }, 1400)
        },
        // Composer-Textarea mit dem Inhalt wachsen lassen (bis ~9rem), dann scrollt sie.
        autoGrow(el: HTMLTextAreaElement) {
            el.style.height = 'auto'
            el.style.height = Math.min(el.scrollHeight, 144) + 'px'
        },
        // Last-Read-Grenze auf die jüngste Nachricht setzen (Divider beim nächsten Betreten).
        markRead() {
            if (!this._url || this.messages.length === 0) {
                return
            }
            const newest = this.messages[this.messages.length - 1].created_at
            if (newest > this._lastRead) {
                this._lastRead = newest
                writeRoomLastRead(this._url, this.h, newest)
            }
        },
        teardown() {
            this._controller?.abort()
            this._unsub?.()
            this._unsub = null
            this._unsubJoined?.()
            this._unsubJoined = null
        },
        // Setzt/räumt den Antwort-Kontext (Zitat der ausgewählten Nachricht).
        setReply(m: ChatMessage) {
            this.activeId = null
            this.replyTo = { id: m.id, pubkey: m.pubkey, name: m.name, text: m.html.replace(/<[^>]*>/g, '') }
            ;(this as unknown as AlpineMagics).$nextTick(() =>
                (this as unknown as { $refs: Record<string, HTMLElement> }).$refs.composer?.focus(),
            )
        },
        clearReply() {
            this.replyTo = null
        },
        // Nachricht senden (kind 9). Optimistisch: die Live-Sub echot sofort.
        // Fehler (Relay-Reject/AUTH) landen als Toast; der Text kehrt zurück.
        async send() {
            const content = this.draft.trim()
            if (!content || this.sending || !this._url) {
                return
            }
            this.sending = true
            this.sendError = ''
            const draft = this.draft
            const prevReply = this.replyTo
            const reply = prevReply ? { id: prevReply.id, pubkey: prevReply.pubkey } : undefined
            this.draft = ''
            this.replyTo = null
            try {
                const err = await sendRoomMessage(this._url, this.h, content, reply)
                if (err) {
                    // Fehlgeschlagen: Text + Zitat zurück, aktionable Hinweiszeile am Composer
                    // (kein Toast — der verpufft und wäre neben der Zeile doppelt).
                    this.sendError = err
                    this.draft = draft
                    this.replyTo = prevReply
                } else {
                    this.scrollToBottom()
                    const magics = this as unknown as AlpineMagics
                    magics.$nextTick(() => {
                        const c = magics.$refs.composer
                        if (c) {
                            c.focus()
                            c.style.height = 'auto'
                        }
                    })
                }
            } finally {
                this.sending = false
            }
        },
        // Löschen anfragen: Aktionsleiste zu, Merker setzen, Bestätigungs-Modal öffnen.
        askDelete(m: ChatMessage) {
            this.activeId = null
            this.pendingDelete = { id: m.id, createdAt: m.created_at }
            dispatchModal('delete-message')
        },
        // Bestätigt löschen: Modal zu, dann publishen (Busy verhindert Doppel-Klick).
        async confirmDelete() {
            const target = this.pendingDelete
            if (!target) {
                return
            }
            dispatchModal('delete-message', false)
            this.pendingDelete = null
            await this.remove(target.id, target.createdAt)
        },
        // Eigene Nachricht löschen (kind 5). Repository blendet sie sofort aus.
        async remove(id: string, createdAt: number) {
            if (!this._url || this.deleting) {
                return
            }
            this.deleting = true
            try {
                const err = await deleteRoomMessage(this._url, this.h, id, createdAt)
                if (err) {
                    toast(err)
                }
            } finally {
                this.deleting = false
            }
        },
        // Beitreten (kind 9021). Round-trip: `joined` flippt, sobald die vom Relay
        // aktualisierte 39002 über die Live-Sub eintrifft (kein optimistischer Fake).
        async join() {
            if (!this._url || this.joining) {
                return
            }
            this.joining = true
            try {
                const err = await joinRoom(this._url, this.h)
                if (err) {
                    toast(err)
                }
            } finally {
                this.joining = false
            }
        },
        // Verlassen (kind 9022). `joined` flippt mit der aktualisierten 39002.
        async leave() {
            if (!this._url || this.joining) {
                return
            }
            this.joining = true
            try {
                const err = await leaveRoom(this._url, this.h)
                if (err) {
                    toast(err)
                }
            } finally {
                this.joining = false
            }
        },
        destroy() {
            if (this._onViewport) {
                window.visualViewport?.removeEventListener('resize', this._onViewport)
            }
            this.markRead()
            this._unsubActive?.()
            this.teardown()
        },
    }))

    // Space-Auswahl (Einstellungen): listet die beigetretenen Spaces und lässt
    // den aktiven wechseln. Der einzige Ort, an dem gewechselt wird (§12).
    Alpine.data('nostrSpaceSettings', (): SpaceSettingsState => ({
        spaces: [],
        active: null,
        activeJoined: false,
        activeIsVerein: false,
        busy: false,
        _joined: [],
        _choices: [],
        _unsubChoices: null,
        _unsubActive: null,
        _unsubJoined: null,
        init() {
            loadUserGroupList()
            const rebuild = () => {
                this.spaces = this._choices.map((url: string) => ({
                    url,
                    label: displayRelayUrl(url),
                    joined: this._joined.includes(url),
                }))
                this.activeJoined = Boolean(this.active && this._joined.includes(this.active))
                // Vereins-Relays (lokaler Default-Space + group.einundzwanzig.space)
                // haben KEINEN NIP-29-Selbst-Beitritt — Zugang läuft über die
                // Vereinsmitgliedschaft. Dort den „Beitreten"-Button ausblenden.
                this.activeIsVerein = Boolean(this.active && isVereinRelay(this.active))
            }
            this._unsubJoined = userSpaceUrls.subscribe((urls: string[]) => {
                this._joined = urls
                rebuild()
            })
            this._unsubChoices = spaceChoices.subscribe((urls: string[]) => {
                this._choices = urls
                rebuild()
            })
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this.active = url
                rebuild()
            })
        },
        choose(url: string) {
            setActiveSpace(url)
            // Vereins-Relay gewählt → Hinweis als Toast (übersteht die Navigation).
            if (isVereinRelay(url)) {
                flashToast(
                    'EINUNDZWANZIG-Vereins-Relay — voller Zugang zu Räumen & Chat nur für Vereinsmitglieder. Mitglied werden: verein.einundzwanzig.space',
                    'info',
                )
            }
            // SPA-Navigation (welshman bleibt warm) statt Full-Reload.
            ;(window as unknown as { Livewire: { navigate: (u: string) => void } }).Livewire.navigate('/spaces')
        },
        // Aktiven Space beitreten/verlassen (Space-Ebene, kind 28934/28936).
        async joinActive() {
            if (!this.active || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await joinSpace(this.active)
                if (err) {
                    toast(err)
                }
            } finally {
                this.busy = false
            }
        },
        async leaveActive() {
            if (!this.active || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await leaveSpace(this.active)
                if (err) {
                    toast(err)
                }
            } finally {
                this.busy = false
            }
        },
        destroy() {
            this._unsubChoices?.()
            this._unsubActive?.()
            this._unsubJoined?.()
        },
    }))

    // Invite einlösen (/join?r=&c=): parst den Link, tritt dem Space bei (28934 +
    // Claim) und macht ihn zum aktiven Space. Der Signer signiert im Browser.
    Alpine.data('nostrInvite', (link: unknown): InviteState => ({
        space: '',
        label: '',
        claim: '',
        joining: false,
        error: '',
        done: false,
        init() {
            const data = parseInviteLink(String(link ?? window.location.href))
            if (data) {
                this.space = data.url
                this.label = displayRelayUrl(data.url)
                this.claim = data.claim
            } else {
                this.error = 'Ungültiger Einladungslink.'
            }
        },
        async accept() {
            if (!this.space || this.joining) {
                return
            }
            this.joining = true
            this.error = ''
            try {
                const err = await joinSpace(this.space, this.claim)
                if (err) {
                    this.error = err
                } else {
                    setActiveSpace(this.space)
                    this.done = true
                    ;(window as unknown as { Livewire: { navigate: (u: string) => void } }).Livewire.navigate('/spaces')
                }
            } finally {
                this.joining = false
            }
        },
    }))

    // Nostr-Login: spiegelt den welshman-`pubkey`-Store nach Alpine und bietet
    // die Signer-Pfade (Extension/nsec/Bunker). Signing bleibt im Browser.
    Alpine.data('nostrAuth', (): AuthState => ({
        pubkey: null,
        npub: '',
        hasExtension: false,
        keyInput: '',
        bunkerInput: '',
        connectQr: '',
        connectUri: '',
        connecting: false,
        mobile: isMobile,
        busy: false,
        error: '',
        _unsub: null,
        _connectAbort: null,
        init() {
            // NIP-07-Extensions (Alby, nos2x …) injizieren `window.nostr` asynchron —
            // oft erst NACH Alpine-init. Deshalb ~3 s pollen statt nur einmal prüfen.
            const hasNostr = () => typeof (window as unknown as { nostr?: unknown }).nostr !== 'undefined'
            this.hasExtension = hasNostr()
            if (!this.hasExtension) {
                let tries = 0
                const timer = setInterval(() => {
                    this.hasExtension = hasNostr()
                    if (this.hasExtension || ++tries > 15) {
                        clearInterval(timer)
                    }
                }, 200)
            }
            this._unsub = pubkey.subscribe((pk: string | undefined) => {
                this.pubkey = pk ?? null
                this.npub = pk ? nip19.npubEncode(pk) : ''
            })
        },
        // welshman-Login (Signer im Browser). Nach Erfolg zum Login-Ziel (siehe
        // postLoginRedirect). Schlägt es fehl, wird die welshman-Session
        // zurückgerollt, damit Browser- und (auf Web) Laravel-Zustand konsistent bleiben.
        async completeLogin(fn) {
            this.busy = true
            this.error = ''
            try {
                await fn()
                window.location.assign(await postLoginRedirect())
            } catch (e) {
                this.error = e instanceof Error ? e.message : String(e)
                logout()
            } finally {
                this.busy = false
            }
        },
        loginExtension() {
            return this.completeLogin(loginWithExtension)
        },
        loginNsec() {
            return this.completeLogin(() => loginWithSecretKey(this.keyInput))
        },
        loginBunker() {
            return this.completeLogin(() => loginWithBunker(this.bunkerInput))
        },
        // Amber-QR (nostrconnect://): QR anzeigen, im Hintergrund auf Amber warten,
        // nach Verbindung den NIP-98-Handoff wie bei jedem Login fahren.
        async startConnect() {
            if (this.connecting) {
                return
            }
            this.error = ''
            this.connectQr = ''
            this.connectUri = ''
            this.connecting = true
            const abort = new AbortController()
            this._connectAbort = abort
            try {
                await loginWithNostrConnect(async (url) => {
                    this.connectUri = url
                    if (isMobile) {
                        // Mobile: Amber SOFORT per nativem Intent öffnen (nostrconnect://
                        // auf demselben Gerät) — der erste Klick genügt, kein zweiter
                        // Button-Schritt. Rückkanal läuft über die Signer-Relais.
                        this.openAmber()
                    } else {
                        // Desktop: QR zum Scannen mit Amber (kein zweites Gerät im Web).
                        this.connectQr = await QRCode.toDataURL(url, { width: 256, margin: 1 })
                    }
                }, abort.signal)
                window.location.assign(await postLoginRedirect())
            } catch (e) {
                if (!abort.signal.aborted) {
                    this.error = e instanceof Error ? e.message : String(e)
                    logout()
                }
            } finally {
                if (this._connectAbort === abort) {
                    this.connecting = false
                    this.connectQr = ''
                    this._connectAbort = null
                }
            }
        },
        stopConnect() {
            this._connectAbort?.abort()
            this._connectAbort = null
            this.connecting = false
            this.connectQr = ''
            this.connectUri = ''
        },
        // Amber öffnen: die WebView reicht das nostrconnect://-Scheme nicht selbst
        // an externe Apps → nativer Intent DIREKT über die NativePHP-Bridge
        // (Browser.Open), nicht über einen `$wire`-Roundtrip. Genau der Roundtrip
        // schluckte den ersten Tap (Request-Pooling/Morph); der direkte Bridge-
        // fetch öffnet Amber beim ersten Klick. Rückkanal läuft über Signer-Relais.
        openAmber() {
            if (this.connectUri) {
                void nativeBrowserOpen(this.connectUri)
            }
        },
        async doLogout() {
            this.stopConnect()
            logout()
            // Mobile hat keine Laravel-Session (§7) — der Server-Logout ist ein No-op
            // gegen tote Routen; nur die welshman-Session (localStorage) räumen.
            if (!isMobile) {
                await logoutServer()
            }
            this.keyInput = ''
            this.bunkerInput = ''
            window.location.assign('/nostr-login')
        },
        destroy() {
            this._connectAbort?.abort()
            this._unsub?.()
        },
    }))

    // Globaler Signer-Health-Banner (M6): erscheint app-weit, wenn der (NIP-46-)
    // Signer nicht/langsam antwortet — besonders im Raum relevant, wo signiert
    // wird. Nur bei eingeloggtem User; sonst ist der Zustand bedeutungslos.
    Alpine.data('nostrSignerBanner', (): SignerBannerState => ({
        message: '',
        _unsubHealth: null,
        _unsubPubkey: null,
        _pk: null,
        _health: 'ok',
        init() {
            const refresh = () => {
                this.message = this._pk ? signerHealthLabel(this._health) : ''
            }
            this._unsubPubkey = pubkey.subscribe((pk: string | undefined) => {
                this._pk = pk ?? null
                refresh()
            })
            this._unsubHealth = signerHealth.subscribe((health: SignerHealth) => {
                this._health = health
                refresh()
            })
        },
        destroy() {
            this._unsubHealth?.()
            this._unsubPubkey?.()
        },
    }))

    // M0-Smoke: lädt kind:1-Notes ins `repository` und rendert sie live über
    // deriveEvents → subscribe → Alpine. Beweist die komplette Bridge-Kette.
    Alpine.data('nostrSmoke', (): SmokeState => ({
        events: [],
        loading: true,
        error: '',
        _unsub: null,
        init() {
            const store = deriveEvents({ repository, filters: [{ kinds: [1] }] })
            this._unsub = store.subscribe((evs: TrustedEvent[]) => {
                this.events = evs.slice(0, 30)
            })
            load({ filters: [{ kinds: [1], limit: 30 }], relays: DEFAULT_RELAYS })
                .then(() => {
                    this.loading = false
                })
                .catch((e: unknown) => {
                    this.error = String(e)
                    this.loading = false
                })
        },
        destroy() {
            this._unsub?.()
        },
    }))
}
