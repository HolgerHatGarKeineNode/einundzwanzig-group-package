/**
 * Reaktivitäts-Bridge: welshman-Store (Svelte-Contract) → Alpine.
 *
 * welshman-Stores erfüllen den Svelte-Store-Contract (`subscribe(cb) => unsub`),
 * ohne Svelte-Compiler. `alpineFromStore` koppelt jeden Store an Alpine-State;
 * `init`/`destroy` folgen dem Alpine-Lifecycle (kein Doppel-Alpine).
 */
import { get, type Readable } from 'svelte/store'
import { repository, pubkey, relaysByUrl, deriveProfile, deriveHandleForPubkey, displayNip05, tracker, userProfile } from '@welshman/app'
import { displayProfile, toNostrURI, MESSAGE, type RelayProfile } from '@welshman/util'
import { sanitizeUrl } from '@braintree/sanitize-url'
import { spaceBranding } from './relayCaps'
import { load } from '@welshman/net'
import { deriveEvents } from '@welshman/store'
import type { TrustedEvent } from '@welshman/util'
import * as nip19 from 'nostr-tools/nip19'
import QRCode from 'qrcode'
import { DEFAULT_RELAYS, isMobile, nativeBrowserOpen, nativeBrowserInApp, proxifyImage } from './core'
import { sanitizeReturnUrl, isAuthed } from './auth-gate'
import {
    loginWithExtension,
    loginWithSecretKey,
    loginWithBunker,
    loginWithNostrConnect,
    logout,
    handoffToServer,
    logoutServer,
    authReady,
    nip46PermsStale,
    loginWithNip55,
} from './session'
import { nip55Available, startNip55Login } from './nip55-signer'
import { schedulePortalHandoff } from './portal-handoff'
import {
    groupSpaceChoices,
    activeSpace,
    activeSpaceView,
    setActiveSpace,
    displayRelayUrl,
    ensureRelayProfile,
    loadUserGroupList,
    loadSpaceRooms,
    watchSpaceRooms,
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
    isVereinGatedOut,
    deriveUserIsSpaceAdmin,
    refreshSpaceAdmin,
    loadSpaceDirectory,
    watchSpaceDirectory,
    loadMemberProfiles,
    settleMemberProfiles,
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
    loadRoomReactions,
    loadRoomPolls,
    loadRoomGoals,
    loadRoomZaps,
    sendRoomMessage,
    deleteRoomMessage,
    editRoomMessage,
    bodyWithoutQuote,
    sendReaction,
    removeReaction,
    sendReport,
    sendPoll,
    sendPollResponse,
    sendGoal,
    readRoomLastRead,
    writeRoomLastRead,
    type ChatMessage,
    type ReactionChip,
} from './feeds'
import type { PollType } from './polls'
import { signerHealth, signerHealthLabel, type SignerHealth } from './signer-health'
import {
    loadEmojiGroups,
    loadUserCustomEmojis,
    loadRecentEmojis,
    pushRecentEmoji,
    searchEmojis,
    type CustomEmoji,
    type StdEmoji,
    type RecentEmoji,
} from './emoji'
import { toast, flashToast } from './toast'
import {
    getNwcModule,
    getWebLn,
    loadWallet,
    saveWallet,
    clearWallet,
    getWalletBalance,
    createInvoice,
    payInvoice,
    lnurlInvoice,
    fromMsats,
    type NWCInfo,
} from './wallet'
import { getWalletAddress, WalletType, type Wallet, type Zapper } from '@welshman/util'
import { resolveZapper, canZap, chooseZapMethod, createZapInvoice, payZapAuto, watchZapReceipt, mapZapError, DEFAULT_ZAP_CONTENT } from './zaps'
import { publishReceivingAddress } from './profiles'

/** Alpine-Magics, die auf `this` einer Komponente verfügbar sind. */
type AlpineMagics = { $refs: Record<string, HTMLElement>; $nextTick: (cb: () => void) => void }

/** Zap-Feature-Flag (iOS-Kill-Switch): `window.__nostrZapsEnabled` (Default true). */
const zapsEnabled = (): boolean => (window as { __nostrZapsEnabled?: boolean }).__nostrZapsEnabled !== false

/**
 * Öffnet/schließt ein Flux-Modal per Name (Flux lauscht auf modal-show/-close).
 * Beim Öffnen den auslösenden Fokus merken und beim Schließen zurückgeben — nur
 * `flux:modal.trigger` macht das von selbst; JS-geöffnete Modals (role-form,
 * member-roles, delete-message) ließen den Fokus sonst ins Leere fallen (A11y).
 * Hängt einmalig am nativen `close`-Event des <dialog> (feuert auch bei Escape/
 * Backdrop) → deckt jeden Schließweg ab, ohne pro Modal Markup zu berühren.
 */
const dispatchModal = (name: string, show = true): void => {
    if (show) {
        const trigger = document.activeElement
        const dialog = document.querySelector(`dialog[data-modal="${name}"]`)
        if (dialog && trigger instanceof HTMLElement) {
            dialog.addEventListener('close', () => trigger.focus(), { once: true })
        }
    }
    document.dispatchEvent(new CustomEvent(show ? 'modal-show' : 'modal-close', { detail: { name } }))
}

/**
 * `nostr:nevent…` einer Nachricht (NIP-19/21): gesehene Relays als Hints, sonst
 * das übergebene Fallback-Relay (Space-Relay). Teilbar/auflösbar in jedem Client.
 */
const neventFor = (m: ChatMessage, fallbackRelay: string | null): string => {
    const seen = [...tracker.getRelays(m.id)]
    const relays = seen.length ? seen : fallbackRelay ? [fallbackRelay] : []
    return toNostrURI(nip19.neventEncode({ id: m.id, relays, author: m.pubkey, kind: MESSAGE }))
}

/**
 * Ziel nach erfolgreichem welshman-Login. Web: NIP-98-Handoff → Redirect ins
 * Server-Gate. Mobile: kein Server-Gate (§7), direkt zu /spaces — die Insel
 * hält die Session selbst.
 */
async function postLoginRedirect(): Promise<string> {
    // §4.2 „nach Login resume": tapte ein Gast eine gegatete Tab/Aktion, trägt der
    // Login-View `?return=<Zielpfad>` (vom authGate gesetzt) — nach dem Login exakt
    // dorthin, statt aufs Default. Open-Redirect-gehärtet (nur eigene Pfade).
    const ret = sanitizeReturnUrl(new URLSearchParams(location.search).get('return'))
    if (isMobile) {
        // Single-Login: den Portal-Handoff für die Zielseite vormerken (das
        // Boot-Gate führt ihn dort aus). Direkt hier würde die folgende
        // window.location-Navigation ihn nach dem Signieren abreißen.
        schedulePortalHandoff()
        return ret ?? '/spaces'
    }
    // Web: NIP-98-Handoff MUSS laufen (setzt die Laravel-Session), das Ziel danach.
    // Bei Direkt-Hit auf eine gegatete Route liefert der Server `url.intended`; ein
    // client-gesetztes `?return` (Gast-Tab-Tap) hat Vorrang.
    const dest = await handoffToServer()
    return ret ?? dest
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
type ProfileCardState = {
    pubkey: string
    npub: string
    name: string
    picture: string
    banner: string
    about: string
    website: string // sanitized href ('' wenn keins/unsicher)
    lud16: string
    nip05: string // verifizierter NIP-05-Handle ('' = kein Häkchen)
    _unsub: null | (() => void)
    _unsubHandle: null | (() => void)
    open(pubkey: string): void
    copy(text: string, label: string): void
    destroy(): void
}

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
    reauthing: boolean
    reconnect: boolean
    _unsub: null | (() => void)
    _connectAbort: AbortController | null
    _reauthTried: boolean
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
    _controller: AbortController | null
    init(): void
    destroy(): void
}

type VereinGateState = {
    show: boolean
    _access: VereinAccess
    _unsubActive: null | (() => void)
    _unsubAccess: null | (() => void)
    _controller: AbortController | null
    init(): void
    _refresh(): void
    openExternal(url: string, e: Event): void
    destroy(): void
}

/** Formular-Zustand einer Rolle (hue 0–360, lightness 0–1; '' id = neu). */
type RoleForm = { id: string; label: string; description: string; hue: number; lightness: number; order: number }

type DirectoryState = {
    ready: boolean
    profilesReady: boolean
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
    loadBanned(): Promise<void>
    unbanMember(pubkey: string): Promise<void>
    restoreMember(pubkey: string): Promise<void>
    loadInvite(): Promise<void>
    copyInvite(): void
}

/** Ein @-Mention-Vorschlag (Space-Mitglied) im Composer-Autocomplete. */
type MentionItem = { pubkey: string; npub: string; name: string; picture: string; search: string }

/** Roh-Event-Details für das Nachricht-Info-Modal (C4). */
type MessageInfo = { nevent: string; npub: string; json: string; createdAt: string; seenOn: string[] }

type RoomChatState = {
    h: string
    messages: ChatMessage[]
    loading: boolean
    loadingMore: boolean
    hasMore: boolean
    atBottom: boolean
    unread: number
    firstPaintDone: boolean
    error: string
    joined: boolean
    joining: boolean
    membershipReady: boolean
    draft: string
    sending: boolean
    sendError: string
    replyTo: { id: string; pubkey: string; name: string; text: string } | null
    sharing: boolean // Zitier-Modus (Quote-Only): Composer darf leer bleiben, Label „Zitieren"
    editingId: string | null // id der gerade bearbeiteten eigenen Nachricht (sonst null)
    activeId: string | null // Nachricht mit eingeblendeten Aktionen (Tap-to-toggle, Touch)
    flashId: string | null // kurz hervorgehobene Nachricht (Sprung zum Zitat)
    lightboxSrc: string | null // Vollbild eines angeklickten Inline-Bilds (Proxy `full`)
    deleting: boolean
    pendingDelete: { id: string; createdAt: number } | null
    reportFor: ChatMessage | null // Zielnachricht des offenen Melde-Modals
    reportReason: string // gewählter NIP-56-Grund (spam/profanity/impersonation/other)
    reportText: string // optionaler Freitext fürs „Fork off!"
    reporting: boolean
    zapFor: ChatMessage | null // Zielnachricht des offenen Zap-Modals (Z3)
    zapAmount: number // gewählter Zap-Betrag in Sats (Default 21 = EINUNDZWANZIG)
    zapContent: string // Zap-Kommentar/Emoji (Default '⚡')
    zapping: boolean // Zap läuft (Doppel-Klick-Guard)
    zapInvoice: string // bolt11 im QR-Fallback (leer = Auto-Pay/noch keine Rechnung)
    zapQr: string // Data-URL des bolt11-QR (QR-Fallback)
    zapsEnabled: boolean // Feature-Flag window.__nostrZapsEnabled (iOS-Kill-Switch)
    zapPresets: number[] // feste Sats-Presets für die Schnellauswahl
    _zapper: Zapper | null // aufgelöster Zapper der zapFor-Nachricht (Vorabgate bestanden)
    _zapSub: AbortController | null // Live-Receipt-Sub im QR-Fallback (Abort bei Close)
    _zapLoadedIds: Set<string> // Nachrichten, deren 9735-History schon geladen wurde
    pollTitle: string // Frage der zu erstellenden Poll (C5)
    pollOptionList: { id: string; value: string }[] // Antwortoptionen des Poll-Formulars
    pollTypeSel: PollType // Einfach-/Mehrfachwahl der zu erstellenden Poll
    pollEndsAt: string // optionales Enddatum (datetime-local-String, '' = kein Ende)
    pollBusy: boolean // Poll wird gerade publiziert
    goalTitle: string // Titel des zu erstellenden Zap-Goals (Z5)
    goalSummary: string // optionale Beschreibung des Zap-Goals
    goalTargetSats: number // Ziel-Betrag in Sats
    goalBusy: boolean // Goal wird gerade publiziert
    _draggedOption: string | null // id der per Griff gezogenen Option (Reorder), sonst null
    isMobile: boolean // native App? → Interaktions-Menü als Vollbild-Modal statt Popover
    menuFor: ChatMessage | null // Nachricht des offenen Interaktions-Menüs (Mobile-Modal)
    infoFor: MessageInfo | null // Roh-Event-Details der offenen Nachricht-Info (C4)
    mentionOpen: boolean // @-Autocomplete-Popover sichtbar (C4)
    mentionQuery: string // aktuelle @-Suchzeichenfolge (nach dem @)
    mentionItems: MentionItem[] // gefilterte Mitglieder-Vorschläge
    mentionIndex: number // hervorgehobener Vorschlag (Tastatur-Navigation)
    _mentionStart: number // Caret-Index des @ im Draft (für den Ersetz-Splice)
    _members: MentionItem[] // Space-Mitglieder als Mention-Quelle (Directory)
    _unsubMembers: null | (() => void)
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
    retry(): void
    loadOlder(): void
    onScroll(): void
    scrollToBottom(): void
    scrollToMessage(id: string): void
    autoGrow(el: HTMLTextAreaElement): void
    markRead(): void
    setReply(m: ChatMessage): void
    clearReply(): void
    share(m: ChatMessage): void
    canEdit(m: ChatMessage): boolean
    startEdit(m: ChatMessage): void
    cancelEdit(): void
    saveEdit(content: string): Promise<void>
    refocusComposer(): void
    openMessageMenu(m: ChatMessage): void
    closeMessageMenu(): void
    copyNevent(m: ChatMessage): void
    copyNpub(m: ChatMessage): void
    copyJson(m: ChatMessage): void
    openInfo(m: ChatMessage): void
    copy(text: string, label: string): void
    onComposerInput(el: HTMLTextAreaElement): void
    pickMention(item: MentionItem): void
    closeMentions(): void
    react(m: ChatMessage, content: string, emojiTag?: string[], label?: string): Promise<void>
    toggleReaction(m: ChatMessage, r: ReactionChip): Promise<void>
    send(): Promise<void>
    askDelete(m: ChatMessage): void
    confirmDelete(): Promise<void>
    remove(id: string, createdAt: number): Promise<void>
    askReport(m: ChatMessage): void
    confirmReport(): Promise<void>
    openZap(m: ChatMessage): Promise<void>
    confirmZap(): Promise<void>
    closeZap(): void
    votePoll(m: ChatMessage, optionId: string): Promise<void>
    openPollCreate(): void
    addPollOption(): void
    removePollOption(id: string): void
    pollDragStart(id: string): void
    pollReorder(targetId: string): void
    pollDragEnd(): void
    submitPoll(): Promise<void>
    openGoalCreate(): void
    submitGoal(): Promise<void>
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

type ReconnectBannerState = {
    stale: boolean
    _unsub: null | (() => void)
    init(): void
    destroy(): void
    reconnect(): void
}

type SpaceSettingsState = {
    ready: boolean
    spaces: { url: string; label: string; joined: boolean }[]
    active: string | null
    activeJoined: boolean
    activeIsVerein: boolean
    busy: boolean
    _joined: string[]
    _choices: string[]
    _relays: Map<string, RelayProfile>
    _unsubChoices: null | (() => void)
    _unsubActive: null | (() => void)
    _unsubJoined: null | (() => void)
    _unsubRelays: null | (() => void)
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

/** ZAPS.md Z0.4 — vollwertige Lightning-Wallet-Insel (Verbinden/Balance/Senden/Empfangen). */
type WalletState = {
    zapsEnabled: boolean
    connected: boolean
    walletType: '' | WalletType
    lud16: string
    relayUrl: string
    balanceSats: number | null
    weblnAvailable: boolean
    connectUrl: string
    busy: boolean
    error: string
    payReq: string
    payAmountSats: number | null
    paying: boolean
    recvAmountSats: number | null
    recvMemo: string
    recvInvoice: string
    recvQr: string
    receiving: boolean
    profileLud16: string
    addressInput: string
    addressTouched: boolean
    savingAddress: boolean
    _unsubProfile: (() => void) | null
    init(): Promise<void>
    _apply(w: Wallet): void
    connectNwc(): Promise<void>
    connectWebln(): Promise<void>
    disconnect(): Promise<void>
    refreshBalance(): Promise<void>
    openSend(): void
    sendPayment(): Promise<void>
    openReceive(): void
    createReceiveInvoice(): Promise<void>
    displayRelay(): string
    addressMismatch(): boolean
    useWalletAddress(): void
    saveReceivingAddress(): Promise<void>
    copy(text: string, label: string): void
    destroy(): void
}

export function registerNostrComponents(Alpine: {
    data: (name: string, factory: (...args: unknown[]) => unknown) => void
    magic: (name: string, callback: () => unknown) => void
    store: (name: string, value: unknown) => void
}) {
    // PLAN4 IMG — `$img(url)` proxifiziert jedes remote Bild (Zuschnitt/WebP) in
    // jedem Alpine-Ausdruck. Zweites Arg = Preset (Default 'avatar').
    Alpine.magic('img', () => (url: unknown, preset?: string) => proxifyImage(url, preset))

    // PLAN P4 — Kontextueller Auth-Gate (§4.2). EIN globaler Store, den jede
    // gegatete Tab/Aktion (nav-tab, später FAB/„Bearbeiten") konsultiert, statt
    // selbst zu prüfen/navigieren:
    //   eingeloggt → intent.resume() sofort (kein Sheet, kein Redirect).
    //   Gast       → `open-login-sheet` dispatchen (detail.intent). Fängt ein
    //                montiertes Login-Sheet (P6) das per preventDefault ab, bleibt
    //                der Nutzer in-place; sonst harter Fallback auf den Login-View
    //                mit `?return`, damit die Zielroute nach Login wieder aufgeht.
    // Mobile hat KEIN Server-Gate (EnsureNostrAuth lässt lokale single-user-
    // Instanzen durch) → dieser Client-Gate ist dort der EINZIGE Schutz für
    // Chat/Wallet; im Web ist er die sanfte Ebene über dem echten Server-Gate.
    // `intent.label` ist der Kontextzeilen-Vertrag fürs P6-Sheet (§5.4) — hier
    // nur durchgereicht, das Sheet rendert ihn.
    type AuthIntent = { label?: string; returnUrl?: string; resume?: () => void }
    const authGateStore = {
        requireAuth(intent: AuthIntent = {}): boolean {
            if (isAuthed(localStorage.getItem('pubkey'))) {
                intent.resume?.()
                return true
            }
            const ev = new CustomEvent('open-login-sheet', { detail: { intent }, cancelable: true })
            window.dispatchEvent(ev)
            if (! ev.defaultPrevented) {
                const ret = sanitizeReturnUrl(intent.returnUrl ?? location.pathname + location.search)
                location.assign('/nostr-login' + (ret ? '?return=' + encodeURIComponent(ret) : ''))
            }
            return false
        },
        // Aus der CAPTURE-Phase (mousedown/keydown, VOR dem wire:navigate-Commit):
        // nicht eingeloggt → SPA-Navigation blocken. Eine Methode statt der Logik
        // doppelt in beiden nav-tab-Handlern.
        gateTap(event: Event, intent: AuthIntent = {}): void {
            if (! this.requireAuth(intent)) {
                event.preventDefault()
                event.stopImmediatePropagation()
            }
        },
    }
    Alpine.store('authGate', authGateStore)

    // PLAN4 B3 — Autor-Profil-Karte (kind 0): öffnet ein Flux-Modal mit
    // display_name/about/website/banner/lud16. Ein `open-profile`-Window-Event
    // (aus Chat/Directory per `$dispatch`) trägt die pubkey herein — so triggert
    // dieselbe Karte aus beiden Inseln. Profil wird lazy via `deriveProfile`
    // geladen (welshman-Outbox); Felder füllen reaktiv nach.
    Alpine.data('nostrProfileCard', (): ProfileCardState => ({
        pubkey: '',
        npub: '',
        name: '',
        picture: '',
        banner: '',
        about: '',
        website: '',
        lud16: '',
        nip05: '',
        _unsub: null,
        _unsubHandle: null,
        open(pk: string) {
            if (!pk) {
                return
            }
            this._unsub?.()
            this._unsubHandle?.()
            this.pubkey = pk
            this.npub = nip19.npubEncode(pk)
            const fallback = `${this.npub.slice(0, 12)}…${this.npub.slice(-6)}`
            this.name = fallback
            this.picture = this.banner = this.about = this.website = this.lud16 = this.nip05 = ''
            // NIP-05: welshman verifiziert den Handle (nostr.json ↔ pubkey); der Store
            // liefert nur bei bestätigtem Match einen Wert → Häkchen erst dann.
            this._unsubHandle = deriveHandleForPubkey(pk).subscribe((handle) => {
                this.nip05 = handle ? displayNip05(handle.nip05) : ''
            })
            this._unsub = deriveProfile(pk).subscribe((p) => {
                this.name = displayProfile(p, fallback)
                this.picture = p?.picture ?? ''
                this.banner = p?.banner ?? ''
                this.about = p?.about ?? ''
                // Website ist untrusted (kind-0) → sanitizeUrl; 'about:blank' = verworfen.
                const href = p?.website ? sanitizeUrl(p.website) : ''
                this.website = href === 'about:blank' ? '' : href
                this.lud16 = p?.lud16 ?? ''
            })
            dispatchModal('profile-card')
        },
        copy(text: string, label: string) {
            if (text) {
                void navigator.clipboard?.writeText(text).then(() => toast(`${label} kopiert.`, 'success'))
            }
        },
        destroy() {
            this._unsub?.()
            this._unsubHandle?.()
        },
    }))

    // ZAPS.md Z0.4 — vollwertige Lightning-Wallet: Verbinden (NWC/WebLN), Hero-
    // Balance, Senden (bolt11 oder lud16) und Empfangen (Rechnung+QR). Der Secret
    // liegt gehärtet in `js/secure-storage.ts` (nie Klartext). Zahlung 100 % im
    // Browser. Der Feature-Flag `__nostrZapsEnabled` (Default true) kann die Wallet
    // hart abschalten (iOS-Build), ohne Code-Umbau.
    Alpine.data('nostrWallet', (): WalletState => ({
        zapsEnabled: zapsEnabled(),
        connected: false,
        walletType: '',
        lud16: '',
        relayUrl: '',
        balanceSats: null,
        weblnAvailable: Boolean(getWebLn()),
        connectUrl: '',
        busy: false,
        error: '',
        payReq: '',
        payAmountSats: null,
        paying: false,
        recvAmountSats: null,
        recvMemo: '',
        recvInvoice: '',
        recvQr: '',
        receiving: false,
        profileLud16: '',
        addressInput: '',
        addressTouched: false,
        savingAddress: false,
        _unsubProfile: null,
        async init() {
            // Z4 — Profil-lud16 (kind 0) als Empfangsadresse spiegeln. SYNCHRON vor
            // jedem `await` abonnieren: sonst könnte destroy() beim schnellen
            // wire:navigate vor der Zuweisung laufen (`?.()`-No-op) und die danach
            // angelegte Sub würde leaken. Das Feld folgt dem Profil, bis der User
            // selbst tippt (`addressTouched`) — so überschreibt ein spätes Update
            // keine Eingabe und ein bewusst geleertes Feld (Adresse entfernen) bleibt leer.
            this._unsubProfile = userProfile.subscribe((p) => {
                this.profileLud16 = p?.lud16 ?? ''
                if (!this.addressTouched) {
                    this.addressInput = this.profileLud16
                }
            })
            // pubkey wird async aus localStorage hydratisiert (welshman `sync`) —
            // erst abwarten, sonst liest loadWallet() bei hartem Reload direkt auf
            // /settings/wallet einen leeren pubkey und eine verbundene Wallet erschiene
            // fälschlich als „nicht verbunden" (nostrAuth.init guardet dasselbe Muster).
            await authReady
            // WebLN wird evtl. erst nach dem Factory-Aufruf injiziert → hier re-evaluieren.
            this.weblnAvailable = Boolean(getWebLn())
            const wallet = await loadWallet()
            if (wallet) {
                this._apply(wallet)
                void this.refreshBalance()
            }
        },
        _apply(w: Wallet) {
            this.connected = true
            this.walletType = w.type
            this.lud16 = getWalletAddress(w) ?? ''
            this.relayUrl = w.type === WalletType.NWC ? w.info.relayUrl : ''
        },
        async connectNwc() {
            if (this.busy) {
                return
            }
            this.busy = true
            this.error = ''
            try {
                const url = this.connectUrl.trim()
                if (!url.startsWith('nostr+walletconnect://')) {
                    throw new Error('Ungültige Verbindung (nostr+walletconnect://…)')
                }
                const { nwc } = await getNwcModule()
                const client = new nwc.NWCClient({ nostrWalletConnectUrl: url })
                const info = await client.getInfo() // validiert die Verbindung
                if (!info) {
                    throw new Error('Wallet nicht erreichbar')
                }
                const wallet: Wallet = { type: WalletType.NWC, info: client.options as unknown as NWCInfo }
                await saveWallet(wallet)
                this._apply(wallet)
                this.connectUrl = ''
                toast('Wallet verbunden', 'success')
                void this.refreshBalance()
            } catch (e) {
                this.error = e instanceof Error ? e.message : 'Verbindung fehlgeschlagen'
                toast(this.error)
            } finally {
                this.busy = false
            }
        },
        async connectWebln() {
            if (this.busy) {
                return
            }
            this.busy = true
            this.error = ''
            try {
                const webln = getWebLn()
                if (!webln) {
                    throw new Error('Keine WebLN-Erweiterung gefunden')
                }
                await webln.enable()
                const info = await webln.getInfo()
                if (!info?.supports?.includes('lightning')) {
                    throw new Error('Erweiterung unterstützt kein Lightning')
                }
                const wallet: Wallet = { type: WalletType.WebLN, info }
                await saveWallet(wallet)
                this._apply(wallet)
                toast('Wallet verbunden', 'success')
            } catch (e) {
                this.error = e instanceof Error ? e.message : 'Verbindung fehlgeschlagen'
                toast(this.error)
            } finally {
                this.busy = false
            }
        },
        async disconnect() {
            await clearWallet()
            this.connected = false
            this.walletType = ''
            this.lud16 = ''
            this.relayUrl = ''
            this.balanceSats = null
            toast('Wallet getrennt', 'success')
        },
        async refreshBalance() {
            if (this.walletType !== WalletType.NWC) {
                return
            }
            try {
                const res = await getWalletBalance()
                this.balanceSats = fromMsats(res.balance)
            } catch {
                // Balance-Fehler tolerant — Hero zeigt dann keinen Betrag.
                this.balanceSats = null
            }
        },
        openSend() {
            this.payReq = ''
            this.payAmountSats = null
            this.error = ''
            dispatchModal('wallet-send')
        },
        async sendPayment() {
            if (this.paying) {
                return
            }
            this.paying = true
            this.error = ''
            try {
                const req = this.payReq.trim()
                if (!req) {
                    throw new Error('Rechnung oder Lightning-Adresse eingeben')
                }
                const isBolt11 = /^ln(bc|tb)/i.test(req)
                let invoice = req
                if (!isBolt11) {
                    if (!this.payAmountSats || this.payAmountSats <= 0) {
                        throw new Error('Betrag (Sats) eingeben')
                    }
                    invoice = await lnurlInvoice(req, this.payAmountSats)
                }
                const { Invoice } = await import('@getalby/lightning-tools/bolt11')
                const parsed = new Invoice({ pr: invoice })
                // Betragslose bolt11 braucht einen expliziten Betrag — sonst ginge 0 msats
                // an payInvoice (dort falsy → kein amount → NWC lehnt kryptisch ab).
                if (parsed.satoshi <= 0 && (!this.payAmountSats || this.payAmountSats <= 0)) {
                    throw new Error('Betrag (Sats) eingeben')
                }
                // Betragslose bolt11 → msats mitgeben (WebLN kann das nicht, payInvoice wirft).
                await payInvoice(invoice, parsed.satoshi > 0 ? undefined : (this.payAmountSats ?? 0) * 1000)
                toast(`Gesendet: ${(parsed.satoshi || this.payAmountSats || 0).toLocaleString('de-DE')} Sats`, 'success')
                this.payReq = ''
                this.payAmountSats = null
                dispatchModal('wallet-send', false)
                void this.refreshBalance()
            } catch (e) {
                this.error = e instanceof Error ? e.message : 'Zahlung fehlgeschlagen'
                toast(this.error)
            } finally {
                this.paying = false
            }
        },
        openReceive() {
            this.recvAmountSats = null
            this.recvMemo = ''
            this.recvInvoice = ''
            this.recvQr = ''
            this.error = ''
            dispatchModal('wallet-receive')
        },
        async createReceiveInvoice() {
            if (this.receiving) {
                return
            }
            this.receiving = true
            this.error = ''
            try {
                if (!this.recvAmountSats || this.recvAmountSats <= 0) {
                    throw new Error('Betrag (Sats) eingeben')
                }
                const pr = await createInvoice({
                    sats: this.recvAmountSats,
                    description: this.recvMemo || 'Empfangen via Lightning',
                })
                this.recvInvoice = pr
                this.recvQr = await QRCode.toDataURL(pr.toUpperCase(), { width: 256, margin: 1 })
                toast('Rechnung erstellt', 'success')
            } catch (e) {
                this.error = e instanceof Error ? e.message : 'Rechnung fehlgeschlagen'
                toast(this.error)
            } finally {
                this.receiving = false
            }
        },
        displayRelay() {
            return displayRelayUrl(this.relayUrl)
        },
        // Z4 — verbundenes Wallet liefert eine lud16, die von einer BEREITS GESETZTEN
        // Profil-Empfangsadresse abweicht (Hinweis „übernehmen?"). Ohne Profil-Adresse
        // kein „andere Adresse"-Banner (widerspräche „Nicht gesetzt"); WebLN hat keine
        // lud16 → false. (flotilla-Guard: profil UND wallet UND ungleich.)
        addressMismatch() {
            return Boolean(this.profileLud16) && Boolean(this.lud16) && this.lud16 !== this.profileLud16
        },
        useWalletAddress() {
            if (this.lud16) {
                this.addressInput = this.lud16
                this.addressTouched = true
            }
        },
        async saveReceivingAddress() {
            if (this.savingAddress) {
                return
            }
            this.savingAddress = true
            this.error = ''
            try {
                const err = await publishReceivingAddress(this.addressInput, get(userSpaceUrls))
                if (err) {
                    throw new Error(err)
                }
                toast('Empfangsadresse gespeichert', 'success')
            } catch (e) {
                this.error = e instanceof Error ? e.message : 'Speichern fehlgeschlagen'
                toast(this.error)
            } finally {
                this.savingAddress = false
            }
        },
        copy(text: string, label: string) {
            if (text) {
                void navigator.clipboard?.writeText(text).then(() => toast(`${label} kopiert.`, 'success'))
            }
        },
        destroy() {
            this._unsubProfile?.()
        },
    }))

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
        _controller: null,
        init() {
            loadUserGroupList()?.finally(() => {
                this.loading = false
            })
            // Aktiver Space → dessen Rooms als LIVE-Sub abonnieren (Wechsel baut neu
            // auf). Live statt One-Shot: überlebt langsames NIP-42-AUTH → Räume
            // erscheinen auch, wenn der Signer erst spät bestätigt.
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this._controller?.abort()
                this._controller = new AbortController()
                watchSpaceRooms(url, this._controller.signal)
                // Vereins-Relay & kein Mitglied → die Räume liefert der Relay gar
                // nicht aus. „gatedOut" ersetzt die falsche „keine Räume"-Meldung.
                this._unsubAccess?.()
                this.gatedOut = false
                this._unsubAccess = deriveVereinAccess(url).subscribe((a: VereinAccess) => {
                    this.gatedOut = isVereinGatedOut(a)
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
            this._controller?.abort()
        },
    }))

    // Vereins-Gate: zeigt Nicht-Vereinsmitgliedern (nicht in der relay-signierten
    // 13534-Liste) auf einem EINUNDZWANZIG-Vereins-Relay den Beitritts-Hinweis.
    // `show` erst wenn relay.self da ist (Fix A) — kein falsches Aufblitzen.
    Alpine.data('nostrVereinGate', (): VereinGateState => ({
        show: false,
        _access: { gated: false, ready: false, isMember: false },
        _unsubActive: null,
        _unsubAccess: null,
        _controller: null,
        init() {
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this._unsubAccess?.()
                this._controller?.abort()
                this.show = false
                this._access = { gated: isVereinRelay(url), ready: false, isMember: false }
                // Directory (13534/33534) als LIVE-Sub laden — auf /spaces tut das
                // sonst niemand. Live statt One-Shot: überlebt langsames NIP-42-AUTH.
                // `access.ready` wird erst nach dem post-AUTH-EOSE wahr (siehe
                // deriveVereinAccess/spaceDirectoryLoaded) → kein verfrühter
                // „kein Mitglied"-Hinweis, und er verschwindet, sobald AUTH durch ist.
                if (this._access.gated) {
                    this._controller = new AbortController()
                    watchSpaceDirectory(url, this._controller.signal)
                }
                this._unsubAccess = deriveVereinAccess(url).subscribe((a: VereinAccess) => {
                    this._access = a
                    this._refresh()
                })
            })
        },
        _refresh() {
            this.show = isVereinGatedOut(this._access)
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
            this._controller?.abort()
        },
    }))

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
        _settleStarted: false,
        init() {
            // Aktiver Space → dessen Directory laden + Subs neu aufbauen.
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this._unsubDir?.()
                this._unsubRoles?.()
                this._unsubAdmin?.()
                this._unsubAccess?.()
                this._controller?.abort()
                this.ready = false
                this.profilesReady = false
                this._settleStarted = false
                this.members = []
                this.roles = []
                this.gatedOut = false
                this.editingMember = null
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
                this._unsubDir = deriveSpaceDirectory(url).subscribe((view: DirectoryView) => {
                    this.ready = view.ready
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
        error: '',
        joined: false,
        joining: false,
        membershipReady: false,
        draft: '',
        sending: false,
        sendError: '',
        replyTo: null,
        sharing: false,
        editingId: null,
        activeId: null,
        flashId: null,
        lightboxSrc: null,
        deleting: false,
        pendingDelete: null,
        reportFor: null,
        reportReason: 'spam',
        reportText: '',
        reporting: false,
        zapFor: null,
        zapAmount: 21,
        zapContent: '⚡',
        zapping: false,
        zapInvoice: '',
        zapQr: '',
        zapsEnabled: zapsEnabled(),
        zapPresets: [21, 210, 2100, 21000],
        _zapper: null,
        _zapSub: null,
        _zapLoadedIds: new Set<string>(),
        pollTitle: '',
        pollOptionList: [],
        pollTypeSel: 'singlechoice',
        pollEndsAt: '',
        pollBusy: false,
        goalTitle: '',
        goalSummary: '',
        goalTargetSats: 21000,
        goalBusy: false,
        _draggedOption: null,
        isMobile,
        menuFor: null,
        infoFor: null,
        mentionOpen: false,
        mentionQuery: '',
        mentionItems: [],
        mentionIndex: 0,
        _mentionStart: -1,
        _members: [],
        _unsubMembers: null,
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
            this.error = ''
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
            // Space-Directory (13534) als @-Mention-Quelle laden + live halten (C4).
            // Der Raum lädt es sonst nicht (nur die Directory-Seite tut das) → ohne
            // dies bliebe die Mitgliederliste leer. Profile lazy nachwärmen, damit
            // Vorschläge Namen statt npub zeigen.
            void loadSpaceDirectory(url)
            watchSpaceDirectory(url, this._controller.signal)
            this._unsubMembers = deriveSpaceDirectory(url).subscribe((dir: DirectoryView) => {
                this._members = dir.members.map((m) => ({
                    pubkey: m.pubkey,
                    npub: m.npub,
                    name: m.name,
                    picture: m.picture,
                    search: m.search,
                }))
                const missing = dir.members.map((m) => m.pubkey).filter((pk) => !this._loadedProfiles.has(pk))
                if (missing.length) {
                    missing.forEach((pk) => this._loadedProfiles.add(pk))
                    loadMemberProfiles(url, missing)
                }
            })
            this._unsubJoined = deriveUserInRoom(url, this.h).subscribe((isMember: boolean) => {
                this.joined = isMember
            })
            listenRoom(url, this.h, this._controller.signal)
            // Bestehende Reactions/Tombstones nachladen (Live-Sub liefert nur Neues).
            void loadRoomReactions(url, this.h)
            // Bestehende Polls (kind 1068) + Responses (kind 1018) nachladen (C5).
            void loadRoomPolls(url, this.h)
            // Bestehende Zap-Goals (kind 9041) nachladen — Beiträge kommen über loadRoomZaps (Z5).
            void loadRoomGoals(url, this.h)
            // Custom-Emoji (NIP-30) des eigenen Profils vorwärmen, solange die
            // Relay-Verbindung frisch AUTH'd ist — beim späteren Picker-Öffnen
            // würde ein one-shot-Load gegen den member-only Relay sonst hängen.
            void loadUserCustomEmojis()
            loadRoomMessages(url, this.h)
                .catch(() => {
                    // Relay nicht erreichbar / AUTH-Reject: persistenter Inline-Callout
                    // + Retry statt Dauer-Skeleton oder falschem „keine Nachrichten".
                    this.error = 'Der Verlauf konnte nicht geladen werden — Relay nicht erreichbar?'
                })
                .finally(() => {
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

                // Bestehende Zap-Receipts (9735) neuer Nachrichten laden (je ID einmal).
                // 9735 trägt kein `#h` → über `#e` der geladenen IDs (feeds.loadRoomZaps).
                const newZapIds = msgs.map((m) => m.id).filter((id) => !this._zapLoadedIds.has(id))
                if (newZapIds.length > 0) {
                    newZapIds.forEach((id) => this._zapLoadedIds.add(id))
                    void loadRoomZaps(url, newZapIds)
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
            this._unsubMembers?.()
            this._unsubMembers = null
            this._zapSub?.abort()
            this._zapSub = null
            this._zapLoadedIds.clear()
            this.closeMentions()
        },
        // Erneuter Ladeversuch nach einem Fehler (Callout-Button): Sub + Verlauf neu aufbauen.
        retry() {
            if (this._url) {
                this.setup(this._url)
            }
        },
        // Setzt/räumt den Antwort-Kontext (Zitat der ausgewählten Nachricht). Antworten
        // verdrängt Bearbeiten UND Zitieren → beide C3-Flags zurücknehmen (share() setzt
        // `sharing` danach erneut), sonst würde send() fälschlich in saveEdit verzweigen.
        setReply(m: ChatMessage) {
            this.activeId = null
            this.sharing = false
            this.editingId = null
            this.replyTo = { id: m.id, pubkey: m.pubkey, name: m.name, text: m.html.replace(/<[^>]*>/g, '') }
            ;(this as unknown as AlpineMagics).$nextTick(() =>
                (this as unknown as { $refs: Record<string, HTMLElement> }).$refs.composer?.focus(),
            )
        },
        clearReply() {
            this.replyTo = null
            this.sharing = false
        },
        // Zitieren (Quote-Only, C3): teilt eine sichtbare Nachricht ohne Kommentar.
        // Nutzt denselben q/p-Präfix-Mechanismus wie Reply — nur darf der Body leer
        // bleiben (send() erlaubt das bei `sharing`), und der Kontext heißt „Zitieren".
        share(m: ChatMessage) {
            this.closeMessageMenu()
            this.editingId = null
            this.setReply(m) // setzt Zitat-Kontext + Fokus (activeId=null, sharing=false)
            this.sharing = true // danach: Quote-Only-Modus (Body darf leer bleiben)
        },
        // Bearbeitbar? Eigene Nachricht und höchstens 30 Minuten alt. Technisch ginge es
        // dank Single-Space-Relay jederzeit; die Grenze ist eine bewusste UX-Konvention
        // (kein stilles Umschreiben alter History) — vom Referenz-5-min auf 30 min angehoben
        // (Auftraggeber). Zeit ist nicht reaktiv — im Menü bei jedem Öffnen frisch ausgewertet.
        // Polls (kind 1068) NICHT: der Edit-Pfad republisht als kind-9 und zerstörte die Umfrage.
        canEdit(m: ChatMessage): boolean {
            return m.mine && !m.poll && m.created_at >= Math.floor(Date.now() / 1000) - 1800
        },
        // Bearbeiten starten: Composer mit dem Klartext (ohne Zitat-Präfix) vorbefüllen,
        // Reply/Share verwerfen. Guard gegen zu alte Nachrichten (Menü zeigt es zwar nur
        // bei canEdit, aber die Zeitgrenze kann zwischen Render und Klick kippen).
        startEdit(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            if (!this.canEdit(m)) {
                toast('Diese Nachricht ist zu alt zum Bearbeiten.')
                return
            }
            const ev = repository.getEvent(m.id)
            if (!ev) {
                return
            }
            this.replyTo = null
            this.sharing = false
            this.editingId = m.id
            this.draft = bodyWithoutQuote(ev)
            this.sendError = ''
            const magics = this as unknown as AlpineMagics
            magics.$nextTick(() => {
                const c = magics.$refs.composer as HTMLTextAreaElement | undefined
                if (c) {
                    c.focus()
                    this.autoGrow(c)
                }
            })
        },
        cancelEdit() {
            this.editingId = null
            this.draft = ''
            this.sendError = ''
        },
        // Bearbeitung speichern (Delete des Alten + Re-Publish, gleiche created_at).
        // Leerer Text bricht nicht ab — der Senden-Button ist dann ohnehin deaktiviert.
        async saveEdit(content: string) {
            const id = this.editingId
            if (!id || !this._url || this.sending) {
                return
            }
            const original = repository.getEvent(id)
            if (!original) {
                this.cancelEdit()
                return
            }
            this.sending = true
            this.sendError = ''
            const draft = this.draft
            this.draft = ''
            this.editingId = null
            try {
                const err = await editRoomMessage(this._url, this.h, original, content)
                if (err) {
                    // Fehlgeschlagen: Text + Edit-Kontext zurück (aktionable Hinweiszeile).
                    this.sendError = err
                    this.draft = draft
                    this.editingId = id
                } else {
                    this.refocusComposer()
                }
            } finally {
                this.sending = false
            }
        },
        // Composer nach erfolgreichem Senden/Speichern: fokussieren und Höhe auf leer zurücksetzen.
        refocusComposer() {
            const magics = this as unknown as AlpineMagics
            magics.$nextTick(() => {
                const c = magics.$refs.composer
                if (c) {
                    c.focus()
                    c.style.height = 'auto'
                }
            })
        },
        // Interaktions-Menü öffnen (native App: Vollbild-Modal). Merkt die
        // Zielnachricht; die Einträge (Antworten … Reaktion/Löschen/Fork off! folgen
        // mit C1+) lesen `menuFor`. Web nutzt stattdessen das Zeilen-Popover.
        openMessageMenu(m: ChatMessage) {
            this.activeId = null
            this.menuFor = m
            dispatchModal('message-menu')
        },
        closeMessageMenu() {
            dispatchModal('message-menu', false)
            this.menuFor = null
        },
        // ── C4: Kopieren / Info (nur lesen, kein Publish) ──────────────────────
        // In die Zwischenablage + Bestätigungs-Toast (wie die Profilkarte).
        copy(text: string, label: string) {
            if (text) {
                void navigator.clipboard?.writeText(text).then(() => toast(`${label} kopiert.`, 'success'))
            }
        },
        // `nostr:nevent…` der Nachricht (mit gesehenen Relays als Hints, sonst dem
        // Space-Relay) — teilbar/auflösbar in jedem Nostr-Client (NIP-19/21).
        copyNevent(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            this.copy(neventFor(m, this._url), 'Event-Link')
        },
        // `npub…` des Autors.
        copyNpub(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            this.copy(nip19.npubEncode(m.pubkey), 'npub')
        },
        // Rohes signiertes Event als hübsches JSON (Debug/Verifikation).
        copyJson(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            const ev = repository.getEvent(m.id)
            if (ev) {
                this.copy(JSON.stringify(ev, null, 2), 'JSON')
            }
        },
        // Nachricht-Info-Modal: Roh-Event, Zeitpunkt, gesehene Relays (tracker).
        openInfo(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            const ev = repository.getEvent(m.id)
            if (!ev) {
                return
            }
            const seen = [...tracker.getRelays(m.id)]
            this.infoFor = {
                nevent: neventFor(m, this._url),
                npub: nip19.npubEncode(m.pubkey),
                json: JSON.stringify(ev, null, 2),
                createdAt: m.fullTime,
                seenOn: seen.map((u) => displayRelayUrl(u)),
            }
            dispatchModal('message-info')
        },
        // ── C4: @-Mention-Autocomplete (NIP-08/NIP-27) ─────────────────────────
        // Bei jeder Composer-Eingabe: steht direkt vor dem Cursor ein `@wort`
        // (am Zeilen-/Wortanfang), Mitglieder-Vorschläge einblenden. `search` ist
        // `name npub` kleingeschrieben (Directory), Query case-insensitiv.
        onComposerInput(el: HTMLTextAreaElement) {
            const caret = el.selectionStart ?? el.value.length
            const match = /(?:^|\s)@([^\s@]*)$/.exec(el.value.slice(0, caret))
            if (!match) {
                this.closeMentions()
                return
            }
            this.mentionQuery = match[1]
            this._mentionStart = caret - match[1].length - 1
            const q = this.mentionQuery.toLowerCase()
            this.mentionItems = this._members.filter((mem) => !q || mem.search.includes(q)).slice(0, 8)
            this.mentionIndex = 0
            this.mentionOpen = this.mentionItems.length > 0
        },
        // Vorschlag übernehmen: `@query` (ab dem @) durch `nostr:npub… ` ersetzen,
        // Cursor dahinter setzen. Der Render-Pfad löst das npub zu `@Name` auf.
        pickMention(item: MentionItem) {
            const insert = `nostr:${item.npub} `
            const before = this.draft.slice(0, this._mentionStart)
            const after = this.draft.slice(this._mentionStart + 1 + this.mentionQuery.length)
            this.draft = before + insert + after
            this.closeMentions()
            const magics = this as unknown as AlpineMagics
            magics.$nextTick(() => {
                const c = magics.$refs.composer as HTMLTextAreaElement | undefined
                if (c) {
                    const pos = before.length + insert.length
                    c.focus()
                    c.setSelectionRange(pos, pos)
                    this.autoGrow(c)
                }
            })
        },
        closeMentions() {
            this.mentionOpen = false
            this.mentionItems = []
            this._mentionStart = -1
        },
        // Reagiert auf eine Nachricht (kind 7). `content` = Unicode-Emoji bzw.
        // `:shortcode:` (+ `emojiTag` für Custom-Emoji, NIP-30). Optimistisch: die
        // kind-7 landet sofort im Repository → Chip erscheint via deriveRoomChat.
        async react(m: ChatMessage, content: string, emojiTag?: string[], label?: string) {
            this.activeId = null
            this.closeMessageMenu()
            const target = m ? repository.getEvent(m.id) : undefined
            if (!target || !this._url) {
                return
            }
            // MRU vormerken (Nutzung, nicht Relay-Erfolg) → nächstes Öffnen zeigt es
            // in der „Zuletzt benutzt"-Reihe. Custom trägt rohe url + proxifiziertes Bild.
            pushRecentEmoji(
                emojiTag
                    ? { custom: true, shortcode: emojiTag[1], url: emojiTag[2], src: proxifyImage(emojiTag[2], 'avatar') }
                    : { u: content, label: label ?? content },
            )
            const err = await sendReaction(this._url, target, content, emojiTag)
            if (err) {
                toast(err)
            }
        },
        // Chip-Klick: eigene Reaction zurücknehmen (kind 5 auf die eigene kind-7),
        // sonst mit demselben Emoji reagieren (Custom-Emoji originalgetreu nachbauen).
        async toggleReaction(m: ChatMessage, r: ReactionChip) {
            if (!this._url) {
                return
            }
            if (r.mine) {
                const reaction = repository.getEvent(r.mineId)
                if (!reaction) {
                    return
                }
                const err = await removeReaction(this._url, reaction)
                if (err) {
                    toast(err)
                }
            } else {
                await this.react(m, r.content, r.emojiTag ?? undefined, r.label)
            }
        },
        // Nachricht senden (kind 9). Optimistisch: die Live-Sub echot sofort.
        // Fehler (Relay-Reject/AUTH) landen als Toast; der Text kehrt zurück.
        async send() {
            if (this.sending || !this._url) {
                return
            }
            // Autocomplete zu (falls per Senden-Button bei offenem Popover ausgelöst) —
            // sonst zeigte `_mentionStart` gleich auf den geleerten Draft (Phantom-Mention).
            this.closeMentions()
            const content = this.draft.trim()
            // Bearbeiten: eigene Nachricht neu publizieren (braucht Text; leer → nichts tun).
            if (this.editingId) {
                if (content) {
                    await this.saveEdit(content)
                }
                return
            }
            // Zitieren (Quote-Only) darf ohne Kommentar gesendet werden, Nachricht/Reply nicht.
            if (!content && !this.sharing) {
                return
            }
            this.sending = true
            this.sendError = ''
            const draft = this.draft
            const prevReply = this.replyTo
            const prevSharing = this.sharing
            const reply = prevReply ? { id: prevReply.id, pubkey: prevReply.pubkey } : undefined
            this.draft = ''
            this.replyTo = null
            this.sharing = false
            try {
                const err = await sendRoomMessage(this._url, this.h, content, reply)
                if (err) {
                    // Fehlgeschlagen: Text + Zitat zurück, aktionable Hinweiszeile am Composer
                    // (kein Toast — der verpufft und wäre neben der Zeile doppelt).
                    this.sendError = err
                    this.draft = draft
                    this.replyTo = prevReply
                    this.sharing = prevSharing
                } else {
                    this.scrollToBottom()
                    this.refocusComposer()
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
        // Fork off! anfragen: Zielnachricht merken, Grund auf Default, Freitext leeren,
        // Fork-off!-Modal öffnen. Wird vom Menü aufgerufen (Web-Popover / native Modal).
        askReport(m: ChatMessage) {
            this.activeId = null
            this.reportFor = m
            this.reportReason = 'spam'
            this.reportText = ''
            dispatchModal('report-message')
        },
        // Bestätigt „Fork off!": kind-1984 publishen (Busy verhindert Doppel-Klick), Modal
        // zu. makeReport braucht nur id + pubkey — beide liegen auf m (kein Repository-Lookup).
        async confirmReport() {
            const m = this.reportFor
            if (!m || !this._url || this.reporting) {
                return
            }
            this.reporting = true
            try {
                const err = await sendReport(this._url, m, this.reportReason, this.reportText.trim())
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('report-message', false)
                    this.reportFor = null
                }
            } finally {
                this.reporting = false
            }
        },
        // ── Z3: Zap (NIP-57) ────────────────────────────────────────────────────
        // Zap-Sheet öffnen: Zapper des Autors auflösen (Vorabgate — `getZapResponseFilter`
        // wirft ohne nostrPubkey), Betrag/Emoji auf Default, QR-Reste + alte Live-Sub weg,
        // Modal auf. Kann der Empfänger keine Nostr-Zaps → Info-Toast statt Sheet.
        async openZap(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            const zapper = await resolveZapper(m.pubkey)
            if (!canZap(zapper)) {
                toast('Dieser Empfänger kann keine Zaps annehmen.', 'info')
                return
            }
            this._zapSub?.abort()
            this._zapSub = null
            this.zapFor = m
            this._zapper = zapper
            this.zapAmount = 21
            this.zapContent = DEFAULT_ZAP_CONTENT
            this.zapInvoice = ''
            this.zapQr = ''
            dispatchModal('zap-message')
        },
        // Zap senden: Zahlweg-Router (Z2). Wallet verbunden → Auto-Pay (zahlt + lädt das
        // 9735-Receipt), sonst QR-Fallback mit Live-Receipt-Sub. Busy-Guard verhindert
        // Doppel-Zap; Fehler bleiben (Toast) im offenen Modal (wie C2-Report).
        async confirmZap() {
            const m = this.zapFor
            const zapper = this._zapper
            if (!m || !zapper || !this._url || this.zapping) {
                return
            }
            const sats = Math.floor(Number(this.zapAmount))
            if (!Number.isFinite(sats) || sats <= 0) {
                toast('Bitte einen gültigen Betrag angeben.', 'warning')
                return
            }
            this.zapping = true
            try {
                const input = {
                    pubkey: m.pubkey,
                    zapper,
                    sats,
                    content: this.zapContent.trim() || DEFAULT_ZAP_CONTENT,
                    eventId: m.id,
                    url: this._url,
                }
                const hasWallet = Boolean(await loadWallet())
                // Ziel-Guard: Schließt/wechselt der Nutzer das Sheet während eines awaits
                // (Escape/Backdrop → closeZap, oder openZap einer anderen Nachricht), NICHT
                // weiterschreiben — sonst verwaiste QR-Sub bzw. fremde Rechnung im Sheet.
                if (this.zapFor !== m) {
                    return
                }
                if (chooseZapMethod(zapper, hasWallet) === 'auto') {
                    await payZapAuto(input)
                    toast('Zap gesendet ⚡', 'success')
                    if (this.zapFor === m) {
                        this.closeZap()
                    }
                } else {
                    // QR-Fallback: Rechnung holen + anzeigen, auf das 9735-Receipt lauschen
                    // (identischer Relay-Satz aus createZapInvoice — NICHT neu berechnen).
                    const { invoice, relays } = await createZapInvoice(input)
                    if (this.zapFor !== m) {
                        return
                    }
                    this.zapInvoice = invoice
                    this.zapQr = await QRCode.toDataURL(invoice.toUpperCase(), { width: 256, margin: 1 })
                    this._zapSub = new AbortController()
                    watchZapReceipt({
                        zapper,
                        pubkey: m.pubkey,
                        eventId: m.id,
                        relays,
                        signal: this._zapSub.signal,
                        onReceived: () => {
                            toast('Zahlung erhalten ⚡', 'success')
                            this.closeZap()
                        },
                    })
                    // Fokus in den neuen QR-Zustand (der „Zap senden"-Button ist jetzt
                    // ausgeblendet → Fokus fiele sonst auf <body>).
                    ;(this as unknown as AlpineMagics).$nextTick(() => (this as unknown as AlpineMagics).$refs.zapCopyBtn?.focus())
                }
            } catch (e) {
                toast(mapZapError(e))
            } finally {
                this.zapping = false
            }
        },
        // Zap-Sheet schließen: Live-Sub abbrechen (Leak-Schutz bei offener QR-Sub),
        // State + Modal zurücksetzen.
        closeZap() {
            this._zapSub?.abort()
            this._zapSub = null
            this.zapFor = null
            this._zapper = null
            this.zapInvoice = ''
            this.zapQr = ''
            dispatchModal('zap-message', false)
        },
        // ── C5: Poll-Vote (NIP-88 kind 1018) ───────────────────────────────────
        // Auf eine Poll-Option klicken. Einfachwahl setzt genau diese Option;
        // Mehrfachwahl toggelt sie in der bestehenden Auswahl. Optimistisch (die
        // Response landet sofort im Repository → Balken/eigener Vote aktualisieren).
        async votePoll(m: ChatMessage, optionId: string) {
            // Frische Poll-Sicht aus dem aktuellen Feed holen — das per x-for übergebene
            // `m` kann ein veralteter Closure-Stand sein (schnelles Mehrfach-Toggle läse
            // sonst eine alte Auswahl und verlöre die vorige Stimme).
            const fresh = this.messages.find((x) => x.id === m.id) ?? m
            if (!this._url || !fresh.poll || fresh.poll.closed) {
                return
            }
            const poll = repository.getEvent(m.id)
            if (!poll) {
                return
            }
            let selection: string[]
            if (fresh.poll.multi) {
                const current = fresh.poll.options.filter((o) => o.mine).map((o) => o.id)
                selection = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]
                // Mehrfachwahl komplett abgewählt → keine leere Response senden (wie der Referenz-Client).
                if (selection.length === 0) {
                    return
                }
            } else {
                selection = [optionId]
            }
            const err = await sendPollResponse(this._url, poll, selection)
            if (err) {
                toast(err)
            }
        },
        // Poll-Erstellen öffnen: Formular auf zwei leere Optionen zurücksetzen, Modal auf.
        openPollCreate() {
            this.pollTitle = ''
            this.pollOptionList = [
                { id: crypto.randomUUID(), value: '' },
                { id: crypto.randomUUID(), value: '' },
            ]
            this.pollTypeSel = 'singlechoice'
            this.pollEndsAt = ''
            dispatchModal('create-poll')
        },
        addPollOption() {
            this.pollOptionList.push({ id: crypto.randomUUID(), value: '' })
        },
        removePollOption(id: string) {
            this.pollOptionList = this.pollOptionList.filter((o) => o.id !== id)
        },
        // Optionen per Griff umsortieren (natives HTML5-DnD, wie der Referenz-Client —
        // kein Sortable-Dep). `pollReorder` verschiebt live beim Drüberziehen: die gezogene
        // Option wandert an die Position der überfahrenen.
        pollDragStart(id: string) {
            this._draggedOption = id
        },
        pollReorder(targetId: string) {
            const src = this.pollOptionList.findIndex((o) => o.id === this._draggedOption)
            const tgt = this.pollOptionList.findIndex((o) => o.id === targetId)
            if (src === -1 || tgt === -1 || src === tgt) {
                return
            }
            const [moved] = this.pollOptionList.splice(src, 1)
            this.pollOptionList.splice(tgt, 0, moved)
        },
        pollDragEnd() {
            this._draggedOption = null
        },
        // Poll publizieren (kind 1068). Validiert Frage + ≥2 nicht-leere Optionen +
        // Enddatum in der Zukunft; baut die Options-IDs des Formulars in die `option`-Tags.
        async submitPoll() {
            if (this.pollBusy || !this._url) {
                return
            }
            const title = this.pollTitle.trim()
            if (!title) {
                toast('Bitte gib eine Frage ein.')
                return
            }
            const options = this.pollOptionList
                .map((o) => ({ id: o.id, label: o.value.trim() }))
                .filter((o) => o.label !== '')
            if (options.length < 2) {
                toast('Bitte gib mindestens zwei Optionen an.')
                return
            }
            let endsAt: number | undefined
            if (this.pollEndsAt) {
                const ts = Math.floor(new Date(this.pollEndsAt).getTime() / 1000)
                if (!Number.isFinite(ts) || ts <= Math.floor(Date.now() / 1000)) {
                    toast('Das Enddatum muss in der Zukunft liegen.')
                    return
                }
                endsAt = ts
            }
            this.pollBusy = true
            try {
                const err = await sendPoll(this._url, this.h, { title, options, pollType: this.pollTypeSel, endsAt })
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('create-poll', false)
                    this.scrollToBottom()
                }
            } finally {
                this.pollBusy = false
            }
        },
        // ── Z5: Zap-Goal-Erstellen (NIP-75 kind 9041) ──────────────────────────
        // Goal-Formular zurücksetzen (Default-Ziel 21 000 Sats) + Modal auf.
        openGoalCreate() {
            this.goalTitle = ''
            this.goalSummary = ''
            this.goalTargetSats = 21000
            dispatchModal('create-goal')
        },
        // Goal publizieren (kind 9041). Validiert Titel + Ziel > 0; die Karte
        // erscheint optimistisch im Verlauf (wie eine Poll), Beitragen läuft über
        // den bestehenden Zap-Pfad (openZap auf die Goal-Nachricht).
        async submitGoal() {
            if (this.goalBusy || !this._url) {
                return
            }
            const title = this.goalTitle.trim()
            if (!title) {
                toast('Bitte gib dem Ziel einen Titel.')
                return
            }
            const targetSats = Math.floor(this.goalTargetSats)
            if (!Number.isFinite(targetSats) || targetSats <= 0) {
                toast('Bitte gib ein gültiges Ziel in Sats an.')
                return
            }
            this.goalBusy = true
            try {
                const err = await sendGoal(this._url, this.h, { title, summary: this.goalSummary.trim(), targetSats })
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('create-goal', false)
                    this.scrollToBottom()
                }
            } finally {
                this.goalBusy = false
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
        ready: false,
        spaces: [],
        active: null,
        activeJoined: false,
        activeIsVerein: false,
        busy: false,
        _joined: [],
        _choices: [],
        _relays: new Map(),
        _unsubChoices: null,
        _unsubActive: null,
        _unsubJoined: null,
        _unsubRelays: null,
        init() {
            // `ready` erst nach dem ersten Ladeversuch → kein „leer"-Flash vor der Emission (Fix A).
            loadUserGroupList()?.finally(() => {
                this.ready = true
            })
            const rebuild = () => {
                this.spaces = this._choices.map((url: string) => ({
                    url,
                    label: spaceBranding(displayRelayUrl(url), ensureRelayProfile(this._relays, url)).label,
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
            this._unsubChoices = groupSpaceChoices.subscribe((urls: string[]) => {
                this._choices = urls
                rebuild()
            })
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this.active = url
                rebuild()
            })
            this._unsubRelays = relaysByUrl.subscribe((byUrl: Map<string, RelayProfile>) => {
                this._relays = byUrl
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
            this._unsubRelays?.()
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
        reauthing: false,
        // Reconnect-Modus (?reconnect=1 vom Perms-Nudge): zeigt trotz aktivem pubkey
        // die Verbinden-Optionen und unterdrückt die Auto-Reauth, damit der Nutzer die
        // Amber/Bunker-Verbindung mit den vollständigen Perms neu aufsetzen kann.
        reconnect: new URLSearchParams(location.search).get('reconnect') === '1',
        _unsub: null,
        _connectAbort: null,
        _reauthTried: false,
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
            // Auto-Reauth: Kommt man mit wiederhergestellter Client-Session (localStorage)
            // auf die Login-Seite, ist meist nur die Laravel-Session weg (Reboot/Ablauf) —
            // das Server-Gate hat hierher geworfen. Handoff (NIP-98) nachholen statt in der
            // „Angemeldet"-Sackgasse zu stecken. Nur auf /nostr-login, einmal, nur wenn
            // wirklich eingeloggt. Web = Handoff; Mobile = direkt /spaces (kein Server-Gate).
            if (location.pathname.startsWith('/nostr-login') && !this.reconnect) {
                authReady.then(async () => {
                    if (this._reauthTried || !pubkey.get()) {
                        return
                    }
                    this._reauthTried = true
                    this.reauthing = true
                    try {
                        window.location.assign(await postLoginRedirect())
                    } catch (e) {
                        // Handoff scheitert (Signer offline / kein Mitglied) → Karte + Fehler.
                        this.reauthing = false
                        this.error = e instanceof Error ? e.message : String(e)
                    }
                })
            }
        },
        // welshman-Login (Signer im Browser). Nach Erfolg zum Login-Ziel (siehe
        // postLoginRedirect). Schlägt ein FRISCHER Login fehl, wird die welshman-Session
        // zurückgerollt, damit Browser- und (auf Web) Laravel-Zustand konsistent bleiben.
        // Im Reconnect-Modus NICHT rollen: dort besteht bereits eine gültige Session,
        // die ein gescheiterter Perms-Reconnect (Amber offline/abgelehnt) nicht zerstören
        // darf — der Nutzer soll weiter angemeldet bleiben.
        async completeLogin(fn) {
            this.busy = true
            this.error = ''
            try {
                await fn()
                window.location.assign(await postLoginRedirect())
            } catch (e) {
                this.error = e instanceof Error ? e.message : String(e)
                if (!this.reconnect) {
                    logout()
                }
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
            // Mobile + lokaler Amber → NIP-55 Offline-Login (App-zu-App, kein Relay,
            // kein nostrconnect-Pairing-Race). Amber öffnet sich für get_public_key; das
            // Ergebnis kommt in-page zurück (native-event, keine Navigation), dann Login.
            if (isMobile && (await nip55Available())) {
                try {
                    const pk = await startNip55Login()
                    loginWithNip55(pk)
                    window.location.assign(await postLoginRedirect())
                } catch (e) {
                    this.error = e instanceof Error ? e.message : String(e)
                    this.connecting = false
                }
                return
            }
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
                    // Reconnect-Modus: bestehende Session nicht wegen eines
                    // gescheiterten Perms-Reconnects zerstören (s. completeLogin).
                    if (!this.reconnect) {
                        logout()
                    }
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

    // Reconnect-Nudge: bestehende Amber/Bunker-Verbindungen behalten nach dem Perms-
    // Update ihre alten (unvollständigen) Rechte — welshman verhandelt beim Reload
    // nicht neu. Erkennt das (nip46PermsStale) und bietet einen Einmal-Reconnect an,
    // der die Verbindung mit der vollständigen Perm-Liste neu aufsetzt. Nur NIP-46.
    Alpine.data('nostrReconnectBanner', (): ReconnectBannerState => ({
        stale: false,
        _unsub: null,
        init() {
            // An pubkey koppeln: (Re-)Login/Logout ändern den relevanten Zustand.
            this._unsub = pubkey.subscribe(() => {
                this.stale = nip46PermsStale()
            })
        },
        destroy() {
            this._unsub?.()
        },
        reconnect() {
            window.location.assign('/nostr-login?reconnect=1')
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

    // C1-Emoji-Picker: das volle Standard-Set (emojibase, lazy) + ein erster Tab
    // mit den Custom-Emoji (NIP-30) DEINES Profils. Die schweren Emoji-Listen
    // liegen als Closure-Variablen (NICHT im Alpine-Proxy) — sonst würde jedes
    // Öffnen ~1900 Objekte reaktiv wrappen. Reaktiv sind nur `search`/`activeTab`
    // und die wenigen Tab-Metadaten; `results` liest daraus + den rohen Listen.
    // `react(m, …)` kommt per Scope-Chain von der `nostrRoomChat`-Insel.
    type PickerEmoji = (StdEmoji & { custom?: false }) | (CustomEmoji & { custom: true })
    type EmojiPickerState = {
        ready: boolean
        search: string
        activeTab: string
        tabs: { key: string; name: string; icon: string; custom: boolean }[]
        recent: RecentEmoji[]
        customReady: CustomEmoji[]
        customTotal: number
        init(): Promise<void>
        rebuildTabs(): void
        preloadCustom(): void
        readonly results: PickerEmoji[]
    }
    Alpine.data('emojiPicker', (): EmojiPickerState => {
        let groups: Awaited<ReturnType<typeof loadEmojiGroups>> = []
        let custom: CustomEmoji[] = []
        return {
            ready: false,
            search: '',
            activeTab: '',
            tabs: [],
            // „Zuletzt benutzt"-Reihe (MRU) — beim Öffnen aus localStorage; leer,
            // solange noch nichts benutzt wurde (dann keine Reihe).
            recent: loadRecentEmojis().slice(0, 8),
            // Custom-Emoji (NIP-30), deren Bild FERTIG geladen ist — nur diese kommen
            // ins Grid, progressiv (Reihenfolge = Ladereihenfolge). So sieht man nie
            // plumpe Shortcode-Alt-Texte, sondern eine sich aufbauende Bilderliste.
            customReady: [],
            // Erwartete Custom-Emoji-Zahl (für „lädt noch" vs. „wirklich keine").
            customTotal: 0,
            async init() {
                // Standard-Set zuerst (lokale JSON) → Grid sofort nutzbar. Die
                // Custom-Emoji (NIP-30) ziehen entkoppelt nach: ein hängender/leerer
                // Relay-Load (member-only AUTH) darf das Grid NIE blockieren. Der
                // Load ist beim Raum-Init vorgewärmt (loadUserCustomEmojis) → hier
                // i.d.R. ein Cache-Treffer, kein zweiter Relay-Roundtrip.
                groups = await loadEmojiGroups()
                this.rebuildTabs()
                this.ready = true
                void loadUserCustomEmojis().then((c) => {
                    custom = c
                    this.customTotal = c.length
                    this.rebuildTabs()
                    this.preloadCustom()
                })
            },
            // Jedes Custom-Bild vorladen; erst bei `onload` ans Grid anhängen (fehlende
            // Bilder werden nie gezeigt). Die Reihenfolge ist bewusst egal.
            preloadCustom() {
                this.customReady = []
                for (const emoji of custom) {
                    const img = new Image()
                    img.onload = () => this.customReady.push(emoji)
                    img.src = emoji.src
                }
            },
            // Tab-Leiste (neu) bauen: „Deine Emojis" (NIP-30) zuerst, dann die
            // Standard-Kategorien. Aktiven Tab behalten, solange er noch existiert.
            rebuildTabs() {
                this.tabs = [
                    ...(custom.length ? [{ key: 'custom', name: 'Deine Emojis', icon: '⚡', custom: true }] : []),
                    ...groups.map((g) => ({ key: g.key, name: g.name, icon: g.icon, custom: false })),
                ]
                if (!this.activeTab || !this.tabs.some((t) => t.key === this.activeTab)) {
                    this.activeTab = this.tabs[0]?.key ?? ''
                }
            },
            // Sichtbares Emoji-Segment: Suchtreffer, sonst der aktive Tab.
            get results() {
                if (!this.ready) {
                    return []
                }
                if (this.search.trim()) {
                    return searchEmojis(this.search, groups, this.customReady)
                }
                if (this.activeTab === 'custom') {
                    return this.customReady.map((c) => ({ ...c, custom: true as const }))
                }
                return groups.find((g) => g.key === this.activeTab)?.emojis ?? []
            },
        }
    })

    // Web-Popover für das Emoji-Panel: teleportiert ans <body> (kein Clipping im
    // Chat-Scroll-Container) und `fixed` mit Flip positioniert, damit das große
    // Panel nie aus dem Viewport ragt — öffnet nach oben, sonst nach unten. Der
    // Inhalt hängt an `x-if="open"` → nur die eine offene Instanz mountet den
    // schweren emojiPicker (kein DOM-Bloat über N Nachrichtenzeilen).
    type ReactionPopoverState = {
        open: boolean
        panelStyle: string
        toggle(): void
        reposition(): void
        closeUnless(event: Event): void
    }
    Alpine.data('reactionPopover', (): ReactionPopoverState => ({
        open: false,
        panelStyle: '',
        toggle() {
            this.open = !this.open
            if (this.open) {
                ;(this as unknown as AlpineMagics).$nextTick(() => this.reposition())
            }
        },
        reposition() {
            const refs = (this as unknown as AlpineMagics).$refs
            const trigger = refs.trigger
            const panel = refs.panel
            if (!trigger || !panel) {
                return
            }
            const t = trigger.getBoundingClientRect()
            const pw = panel.offsetWidth
            const ph = panel.offsetHeight
            const pad = 8
            const gap = 6
            const left = Math.min(Math.max(pad, t.right - pw), window.innerWidth - pw - pad)
            let top = t.top - ph - gap
            if (top < pad) {
                top = Math.min(t.bottom + gap, window.innerHeight - ph - pad)
            }
            this.panelStyle = `left:${Math.round(left)}px;top:${Math.round(Math.max(pad, top))}px`
        },
        closeUnless(event: Event) {
            const trigger = (this as unknown as AlpineMagics).$refs.trigger
            if (!trigger?.contains(event.target as Node)) {
                this.open = false
            }
        },
    }))
}
