/**
 * Reaktivitäts-Bridge: welshman-Store (Svelte-Contract) → Alpine.
 *
 * welshman-Stores erfüllen den Svelte-Store-Contract (`subscribe(cb) => unsub`),
 * ohne Svelte-Compiler. `alpineFromStore` koppelt jeden Store an Alpine-State;
 * `init`/`destroy` folgen dem Alpine-Lifecycle (kein Doppel-Alpine).
 */
import { derived, get, type Readable } from 'svelte/store'
import { repository, pubkey, relaysByUrl, forceLoadRelay, deriveProfile, deriveHandleForPubkey, displayNip05, tracker, userProfile, loadUserProfile, getProfile, getZapper, forceLoadZapper } from '@welshman/app'
import { displayProfile, toNostrURI, getTagValue, getLnUrl, MESSAGE, RELAYS, type RelayProfile } from '@welshman/util'
import { randomId } from '@welshman/lib'
import { sanitizeUrl } from '@braintree/sanitize-url'
import { spaceBranding } from './relayCaps'
import { load } from '@welshman/net'
import { deriveEvents } from '@welshman/store'
import type { TrustedEvent } from '@welshman/util'
import * as nip19 from 'nostr-tools/nip19'
import QRCode from 'qrcode'
import { DEFAULT_RELAYS, isMobile, nativeBrowserOpen, nativeBrowserInApp, proxifyImage, storageReady } from './core'
import { sanitizeReturnUrl, isAuthed } from './auth-gate'
import { createLightboxZoom } from './lightbox'
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
    currentSignerLabel,
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
    roomsByUrl,
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
    createRoom,
    editRoomMeta,
    deleteRoom,
    addRoomMember,
    removeRoomMember,
    type SpaceView,
    type RoomView,
    type RoomInput,
} from './groups'
import {
    loadMeetupPresentations,
    meetupPresentationBySlug,
    type MeetupPresentation,
} from './meetups'
import { flagEmoji } from './meetupPresentation'
import { isStandardRoom } from './roomCategories'
import { roomsFingerprint, type RoomLike } from './roomFingerprint'
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
    banEvent,
    setRelayName,
    setRelayDescription,
    setRelayIcon,
    deriveRoomMemberViews,
    type RoomMemberView,
    type DirectoryView,
    type MemberView,
    type RoleView,
    type SpaceRole,
    type BannedMember,
    type VereinAccess,
} from './members'
import {
    deriveSpaceReports,
    loadSpaceReports,
    watchSpaceReports,
    deriveSpaceJoinRequests,
    loadSpaceJoinRequests,
    watchSpaceJoinRequests,
    type ReportView,
    type JoinRequestView,
} from './actionItems'
import {
    deriveRoomChat,
    deriveRoomMessages,
    listenRoom,
    loadRoomMessages,
    loadRoomReactions,
    loadRoomComments,
    loadRoomPolls,
    loadRoomDeletes,
    loadRoomZaps,
    sendRoomMessage,
    deleteRoomMessage,
    moderateDeleteMessage,
    editRoomMessage,
    bodyWithoutQuote,
    sendReaction,
    removeReaction,
    sendReport,
    sendPoll,
    sendPollResponse,
    sendGoal,
    deriveThread,
    loadThread,
    listenThread,
    sendComment,
    deriveSpaceThreads,
    loadSpaceThreads,
    loadRoomActivity,
    watchRoomActivity,
    evictChatMsgCache,
    type ChatMessage,
    type ReactionChip,
    type ThreadRoot,
    type SpaceThread,
} from './feeds'
import type { PollType } from './polls'
import { uploadAttachment, type Attachment } from './uploads'
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
import { readState, readStateReady, roomKey, threadKey, roomWatermark, setRead } from './readState'
import { deriveUnread, type UnreadView } from './unread'
import { createScroller, type Scroller } from './scroll'
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
import { warmZappers, canZap, canPay, chooseZapMethod, createZapInvoice, payZapAuto, payZapPlain, requestPlainInvoice, watchZapReceipt, mapZapError, DEFAULT_ZAP_CONTENT } from './zaps'
import { publishReceivingAddress, warmProfiles, type RelayPublishResult } from './profiles'

/** Alpine-Magics, die auf `this` einer Komponente verfügbar sind. */
type AlpineMagics = { $refs: Record<string, HTMLElement>; $nextTick: (cb: () => void) => void }

/** Zap-Feature-Flag (iOS-Kill-Switch): `window.__nostrZapsEnabled` (Default true). */
const zapsEnabled = (): boolean => (window as { __nostrZapsEnabled?: boolean }).__nostrZapsEnabled !== false

/**
 * sessionStorage-Marker „in diesem Tab wurde schon App-intern navigiert" (Rückweg).
 * Tab-lokal — ein frischer Deep-Link-Tab startet ohne ihn. Siehe Setzer beim
 * `livewire:navigate`-Listener und Leser in {@link hasInternalHistory}.
 */
const APP_NAV_KEY = 'appNav'

/**
 * Gibt es einen App-internen Vorgänger, auf den `history.back()` zielen darf?
 *
 * Zwei Bedingungen, beide nötig:
 * - der Tab hat schon einmal per `wire:navigate` navigiert (Marker), und
 * - der History-Stack hat überhaupt einen Vorgänger.
 *
 * Ist eine davon falsch, ist der Nutzer per Deep-Link/Kaltstart hier gelandet und
 * `history.back()` führte aus der App heraus (oder ins Leere) — dann gilt das
 * explizite UP-Ziel.
 */
const hasInternalHistory = (): boolean => {
    try {
        return sessionStorage.getItem(APP_NAV_KEY) === '1' && window.history.length > 1
    } catch {
        return false
    }
}

/**
 * Kurzes haptisches Feedback (Android-Web + Android-App-WebView; iOS-Safari kennt
 * `navigator.vibrate` nicht → wird still ignoriert). Für taktile Quittung von Taps
 * und Fehlern, damit der Nutzer spürt, dass ein Tap ankam bzw. warum nichts aufgeht.
 */
const haptic = (pattern: number | number[]): void => {
    try {
        navigator.vibrate?.(pattern)
    } catch {
        /* nicht unterstützt — egal */
    }
}

/**
 * Promise mit Zeitlimit: rejectet nach `ms`. welshmans LNURL-Fetch hat keinen Timeout —
 * ein hängender/CORS-blockierter Endpoint würde einen Tap sonst STUMM verschlucken.
 */
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms)
        p.then(
            (v) => {
                clearTimeout(t)
                resolve(v)
            },
            (e: unknown) => {
                clearTimeout(t)
                reject(e instanceof Error ? e : new Error(String(e)))
            },
        )
    })

/** Minimal-API des cropperjs-Instanz, die wir nutzen (C6a). */
type CropperLike = {
    setAspectRatio(r: number): void
    rotate(d: number): void
    scaleX(x: number): void
    getData(): { scaleX: number }
    getCroppedCanvas(o?: object): HTMLCanvasElement | null
    destroy(): void
}

// Die cropperjs-Instanz lebt BEWUSST außerhalb des Alpine-Zustands: Alpine wickelt
// reaktive Werte in einen Proxy, der cropperjs' interne DOM-/Layout-Mathematik
// (offset-Messungen, Element-Identität) verfälscht → versetzte Doppelanzeige. Es gibt
// nie mehr als einen offenen Cropper, darum genügt eine Modul-Variable.
let cropperInstance: CropperLike | null = null

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
    // Echten Kind aus dem Repository (Thread-Kommentar = 1111, Nachricht = 9, Poll = 1068 …);
    // die geteilte Row ruft copyNevent/openInfo auch auf Kommentaren → nicht hart MESSAGE annehmen.
    const kind = repository.getEvent(m.id)?.kind ?? MESSAGE
    return toNostrURI(nip19.neventEncode({ id: m.id, relays, author: m.pubkey, kind }))
}

/**
 * §4.2 „nach Login resume", Sheet-Pfad: Das Login-Sheet (P6) öffnet in-place und
 * navigiert NICHT auf `/nostr-login?return=…`, also fehlt der `?return`-Parameter
 * in der URL. `requireAuth` legt das (bereits sanitisierte) Gate-Ziel darum hier
 * ab, damit `postLoginRedirect` nach dem harten Login-Redirect trotzdem aufs
 * getappte Tab-Ziel springt statt aufs Default. Der Deep-Link-Fallback (`?return`
 * in der URL) bleibt unberührt.
 */
let pendingReturn: string | null = null

/**
 * Ziel nach erfolgreichem welshman-Login. Web: NIP-98-Handoff → Redirect ins
 * Server-Gate. Mobile: kein Server-Gate (§7), direkt zu /spaces — die Insel
 * hält die Session selbst.
 */
async function postLoginRedirect(): Promise<string> {
    // §4.2 „nach Login resume": tapte ein Gast eine gegatete Tab/Aktion, trägt der
    // Login-View `?return=<Zielpfad>` (vom authGate gesetzt) — nach dem Login exakt
    // dorthin, statt aufs Default. Sheet-Pfad → `pendingReturn`, Deep-Link → URL.
    // Open-Redirect-gehärtet (nur eigene Pfade).
    const ret = pendingReturn ?? sanitizeReturnUrl(new URLSearchParams(location.search).get('return'))
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
    signerLabel: string
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
    // Eigenes Profil des eingeloggten Users (für den Space-Kopf): reaktiv aus welshman
    // (deriveProfile/deriveHandleForPubkey), Fallback = gekürzter npub. Leer bei ausgeloggt.
    myName: string
    myPicture: string
    myNip05: string
    myAbout: string
    _unsub: null | (() => void)
    _unsubMyProfile: null | (() => void)
    _unsubMyHandle: null | (() => void)
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
    copy(text: string, label: string): void
    doLogout(): Promise<void>
}

type RelaysState = {
    relays: Array<{ url: string; read: boolean; write: boolean }>
    loading: boolean
    _unsub: null | (() => void)
    _unsubEvents: null | (() => void)
    init(): Promise<void>
    destroy(): void
}

type SpacesState = {
    space: SpaceView | null
    loading: boolean
    gatedOut: boolean
    tab: string // aktiver Tab („rooms"/„threads"), aus ?tab= gelesen + dorthin gespiegelt (verlinkbar)
    threads: SpaceThread[] // aktive Threads des Space (C6b, Startseiten-Übersicht)
    // Raum-Verwaltung (P4, Admin): anlegen/bearbeiten/löschen
    isAdmin: boolean
    roomForm: RoomInput // beim Anlegen mit frisch gemintetem stabilem `h` (retry-sicher)
    _roomEditing: boolean // Bearbeiten (true) vs. Anlegen (false) — h ist in beiden Fällen gesetzt
    _roomIconFile: File | null // neu gewähltes Raumbild (Upload erst beim Speichern)
    roomSaving: boolean
    pendingRoomDelete: RoomView | null // Zielraum der offenen Lösch-Bestätigung
    // Raum-Mitglieder (P4b): Liste + Hinzufügen/Entfernen
    membersRoom: RoomView | null // Raum des offenen Mitglieder-Modals
    roomMembers: RoomMemberView[]
    memberNpub: string // npub/hex-Eingabe zum Hinzufügen
    memberBusy: boolean
    _unsubRoomMembers: null | (() => void)
    // Meetup-Praesentations-Join (Plan E2): slug → {flag, portalLink, …}. Wird
    // EINMAL aus der Portal-Liste geladen; die Kachel joint per room.meetupSlug.
    meetups: Record<string, MeetupPresentation>
    meetup(slug: string): MeetupPresentation | null
    _unsubMeetups: null | (() => void)
    // ── P4: Raumübersicht-Filter (Text · Land · Typ), rein clientseitig ──────────
    roomQuery: string
    roomType: 'rooms' | 'meetups' // 'rooms' = Standard-Räume (Default), 'meetups' = Meetup-Modus
    roomCountry: string // ISO-3166-1-alpha-2 ('' = alle Länder)
    focusMode(): boolean
    meetupCount(): number
    standardCount(): number
    myCountry(): string
    countryName(iso: string): string
    countryFlag(iso: string): string
    fmtEventDate(iso: string): string
    isEventSoon(iso: string): boolean
    availableCountries(): Array<{ country: string; flag: string; name: string; count: number }>
    filteredMeetups(): RoomView[]
    filteredMine(): RoomView[]
    filteredOther(): RoomView[]
    filteredProposals(): RoomView[]
    proposalCount(): number
    _proposalPool(): RoomView[]
    activeFilterCount(): number
    visibleCount(): number
    selectCountry(iso: string): void
    resetRoomFilters(): void
    _pres(room: RoomView): MeetupPresentation | null
    _matches(room: RoomView, q: string): boolean
    _meetupPool(all: boolean): RoomView[]
    _dataSig(): string
    _ensureFiltered(): RoomFilterResult
    _url: string | null // aktive Space-URL (für die Admin-Mutationen)
    _unsubView: null | (() => void)
    _unsubActive: null | (() => void)
    _unsubAccess: null | (() => void)
    _unsubAdmin: null | (() => void)
    _unsubThreads: null | (() => void)
    _controller: AbortController | null
    init(): void
    roomName(h: string): string
    openRoomCreate(): void
    openRoomEdit(room: RoomView): void
    pickRoomPicture(input: HTMLInputElement): void
    saveRoom(): Promise<void>
    askDeleteRoom(room: RoomView): void
    confirmDeleteRoom(): Promise<void>
    openRoomMembers(room: RoomView): void
    closeRoomMembers(): void
    addRoomMemberByNpub(): Promise<void>
    kickRoomMember(pubkey: string): Promise<void>
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
    loadBanned(): Promise<void>
    unbanMember(pubkey: string): Promise<void>
    restoreMember(pubkey: string): Promise<void>
    loadInvite(): Promise<void>
    copyInvite(): void
    dismissReport(r: ReportView): Promise<void>
    removeReportedContent(r: ReportView): Promise<void>
    banReportedUser(r: ReportView): Promise<void>
    acceptJoin(j: JoinRequestView): Promise<void>
    rejectJoin(j: JoinRequestView): Promise<void>
    openSpaceEdit(): void
    _prefillSpace(profile?: RelayProfile): void
    pickSpaceIcon(input: HTMLInputElement): void
    saveSpace(): Promise<void>
}

/** Ein @-Mention-Vorschlag (Space-Mitglied) im Composer-Autocomplete. */
type MentionItem = { pubkey: string; npub: string; name: string; picture: string; search: string }

/** Roh-Event-Details für das Nachricht-Info-Modal (C4). */
type MessageInfo = { nevent: string; npub: string; json: string; createdAt: string; seenOn: string[] }

type RoomChatState = {
    h: string
    roomName: string // Anzeigename des Raums (Client-Meta 39000); Fallback = Server-Wert/`h`
    messages: ChatMessage[] // aufsteigend (Quelle): loadOlder/scrollToMessage arbeiten hierauf
    messagesReversed: ChatMessage[] // newest-first fürs `flex-col-reverse`-Rendering (neweste am Boden)
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
    attachment: Attachment | null // hochgeladener Bild-Anhang des HAUPT-Composers (C6a), wartet auf Senden
    threadAttachment: Attachment | null // eigener Bild-Anhang des THREAD-Composers (getrennt → kein Übersprechen)
    _cropSrc: string | null // Object-URL des zu croppenden Bilds (Crop-Overlay, sonst null)
    _cropForThread: boolean // beim Cropper-Öffnen erfasst: Ziel ist der Thread- (true) statt Haupt-Composer
    cropRatio: number // aktives Seitenverhältnis (NaN = frei) — für die Button-Hervorhebung
    uploadingImage: boolean // Crop→Upload läuft (Doppel-Klick-Guard, Busy-Anzeige)
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
    zapResolving: boolean // Zapper des offenen Modals wird noch aufgelöst → „Senden" disabled
    zapUnavailable: boolean // Empfänger nicht bezahlbar (kein erreichbarer LNURL-Endpoint) → Hinweis im Modal
    zapResolveFailed: boolean // Prüfung des Empfängers scheiterte bei UNS (Timeout/Netz) → erneut versuchen
    zapNostrless: boolean // Modal im Plain-Pay-Modus: Empfänger ohne NIP-57 → Zahlung ohne Nostr-Event
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
    _menuInThread: boolean // Mobile-Menü aus dem Thread geöffnet → Raum-only-Aktionen ausblenden, Antworten→setThreadReply
    infoFor: MessageInfo | null // Roh-Event-Details der offenen Nachricht-Info (C4)
    // Moderation (P1, NIP-86): nur wenn der Relay dem User Management-Methoden erlaubt.
    isAdmin: boolean // Admin des aktiven Space? (deriveUserIsSpaceAdmin, reaktiv)
    pendingAdminDelete: ChatMessage | null // Zielnachricht der offenen Admin-Löschen-Bestätigung (banevent)
    banAuthorFor: ChatMessage | null // Ziel-Autor der offenen Bannen-Bestätigung (banpubkey)
    moderating: boolean // banevent/banpubkey läuft (Doppel-Klick-Guard)
    // Thread-Ansicht (C6b, NIP-22): In-Room-Overlay statt eigener Route.
    threadRootId: string | null // Root-Event des offenen Threads (null = Overlay zu)
    threadRoot: ThreadRoot | null // aufgelöster Root (die zitierte Nachricht)
    threadComments: ChatMessage[] // flache chronologische Kommentare (ChatMessage-shaped, P3 4.2)
    threadCount: number // Anzahl Kommentare im offenen Thread
    threadReplyTo: { id: string; name: string } | null // Ziel-Kommentar der nächsten Antwort (null = am Root)
    threadDraft: string // Kommentar-Entwurf im Thread-Composer
    threadFull: boolean // Vollansicht (aus der Übersicht/Deep-Link) statt Modal-über-Chat (aus dem Feed)
    _threadUnsub: null | (() => void) // deriveThread-Subscription
    _threadController: AbortController | null // Live-Sub des offenen Threads
    _threadPrevUrl: string | null // Raum-URL VOR dem Thread-Open (Adressleiste kosmetisch gespiegelt); beim Schließen zurückgesetzt
    _deepThreadNevent: string | null // Deep-Link-nevent aus /rooms/{h}/thread/{nevent}, EINMAL in setup konsumiert
    mentionOpen: boolean // @-Autocomplete-Popover sichtbar (C4)
    mentionQuery: string // aktuelle @-Suchzeichenfolge (nach dem @)
    mentionItems: MentionItem[] // gefilterte Mitglieder-Vorschläge
    mentionIndex: number // hervorgehobener Vorschlag (Tastatur-Navigation)
    _mentionStart: number // Caret-Index des @ im Draft (für den Ersetz-Splice)
    _mentionTarget: 'main' | 'thread' // welcher Composer die @-Mention gerade füttert (draft vs threadDraft)
    _members: MentionItem[] // Space-Mitglieder als Mention-Quelle (Directory)
    _unsubMembers: null | (() => void)
    _unsubAdmin: null | (() => void) // deriveUserIsSpaceAdmin-Subscription (P1)
    _unsubRoomMeta: null | (() => void)
    _url: string | null
    _lastRead: number
    _onViewport: null | (() => void)
    _onVisible: null | (() => void) // App-Foreground → Live-Subs neu senden (WebView-Background killt den Socket)
    _hiddenAt: number // Zeitpunkt des Hintergrund-Gangs (0 = sichtbar) → Resync nur nach echtem Background
    _initialLoadDone: boolean // erster setup()-Load fertig? Gate gegen Resync mitten im Prewarm-Fenster
    _unsubActive: null | (() => void)
    _unsub: null | (() => void)
    _unsubJoined: null | (() => void)
    _controller: AbortController | null
    _loadedProfiles: Set<string>
    _loadedMsgIds: Set<string> // ROH geladene kind-9-IDs (Pagination-Terminierung, robust ggü. Anzeige-Filter wie Poll-Share-Quotes)
    _scroller: Scroller | null // Auto-Nachlade-Scroller (createScroller) statt Virtualizer; Teardown stoppt ihn
    _destroyed: boolean // Insel via wire:navigate abgebaut, während init() noch auf storageReady wartete (M3 P1)
    _pendingMsgs: ChatMessage[] | null // rAF-Coalescing: letzter Feed-Emit, der noch aufs Rendern wartet
    _rafMsgs: number // laufender requestAnimationFrame-Handle fürs Coalescing (0 = keiner)
    init(): void
    setup(url: string): void
    teardown(): void
    resync(): void
    retry(): void
    loadOlder(): void
    onScroll(): void
    scrollToBottom(): void
    scrollToMessage(id: string): void
    openChatLink(url: string, e: Event): void
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
    openMessageMenu(m: ChatMessage, inThread?: boolean): void
    closeMessageMenu(): void
    copyNevent(m: ChatMessage): void
    copyNpub(m: ChatMessage): void
    copyJson(m: ChatMessage): void
    openInfo(m: ChatMessage): void
    openThread(m: ChatMessage, full?: boolean, syncUrl?: boolean): void
    threadHref(m: ChatMessage): string
    closeThread(): void
    /** Kopf-Pfeil im RAUM: history.back() bei App-internem Vorgänger, sonst `upTarget`. */
    backFromRoom(upTarget: string): void
    backFromThread(): void
    setThreadReply(c: ChatMessage): void
    clearThreadReply(): void
    sendComment(): Promise<void>
    copy(text: string, label: string): void
    onComposerInput(el: HTMLTextAreaElement, target?: 'main' | 'thread'): void
    pickMention(item: MentionItem): void
    closeMentions(): void
    react(m: ChatMessage, content: string, emojiTag?: string[], label?: string): Promise<void>
    toggleReaction(m: ChatMessage, r: ReactionChip): Promise<void>
    send(): Promise<void>
    _openCropper(file: File): void
    pickImage(input: HTMLInputElement): void
    pasteImage(e: ClipboardEvent): void
    setCropRatio(r: number): void
    rotateCrop(): void
    flipCrop(): void
    confirmCrop(): Promise<void>
    cancelCrop(): void
    removeAttachment(): void
    askDelete(m: ChatMessage): void
    confirmDelete(): Promise<void>
    remove(id: string, createdAt: number): Promise<void>
    askReport(m: ChatMessage): void
    confirmReport(): Promise<void>
    askAdminDelete(m: ChatMessage): void
    confirmAdminDelete(): Promise<void>
    askBanAuthor(m: ChatMessage): void
    confirmBanAuthor(): Promise<void>
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
    profileNip05: string // roher nip05-Wert aus dem Profil ('' = keiner gesetzt)
    nip05Verified: boolean // true nur bei bestätigtem nostr.json↔pubkey-Match (welshman-Handle)
    nip05Settled: boolean // true, sobald die nostr.json-Prüfung abgeschlossen (verifiziert ODER Settle-Timeout) — trennt „prüft noch" von „geprüft, kein Match"
    profileReady: boolean // true erst nach der ersten aufgelösten Profil-Emission (kein „Nicht gesetzt"-Flash beim Laden)
    addressInput: string
    addressTouched: boolean
    savingAddress: boolean
    saveResults: RelayPublishResult[] // Per-Relay-Ergebnis des letzten Speicherns (Diagnose)
    showDiag: boolean // Profil-Diagnose-Panel ein-/ausgeklappt
    _destroyed: boolean
    _nip05Timer: ReturnType<typeof setTimeout> | null
    _unsubProfile: (() => void) | null
    _unsubHandle: (() => void) | null
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
    nip05State(): 'verified' | 'unverified' | 'missing' | 'pending'
    saveBlockedByNip05(): boolean
    shortRelay(url: string): string
    npubShort(): string
    copyNpub(): void
    pubkeyHexShort(): string
    copyPubkeyHex(): void
    copy(text: string, label: string): void
    destroy(): void
}

/**
 * „ResizeObserver loop completed with undelivered notifications" schlucken. Das ist eine
 * SPEC-KONFORME, harmlose Browser-Warnung: liefert ein ResizeObserver-Callback nicht alle
 * Messungen in einem Frame aus (weil es selbst Layout ändert), reicht der Browser sie im
 * NÄCHSTEN Frame nach — nichts bricht, kein sichtbarer Ruck. Jede measure-basierte
 * Virtualisierung (unser chatVirtualizer via `measureElement`, ebenso react-virtuoso/TanStack)
 * löst sie im Lade-Burst aus. Chrome dispatcht sie aber als window-`error`-Event → sie flutet
 * `window.onerror` und damit die laravel-boost-Browser-Logs. Nur GENAU diese eine Meldung
 * filtern (Capture-Phase + stopImmediatePropagation → vor boosts Handler), echte Fehler
 * bleiben unberührt. Einmalig (Guard), auch wenn registerNostrComponents mehrfach liefe.
 */
let resizeObserverFilterInstalled = false
function installResizeObserverLoopFilter(): void {
    if (resizeObserverFilterInstalled || typeof window === 'undefined') {
        return
    }
    resizeObserverFilterInstalled = true
    window.addEventListener(
        'error',
        (e) => {
            if (e.message && /ResizeObserver loop/.test(e.message)) {
                e.stopImmediatePropagation()
                e.preventDefault()
            }
        },
        true,
    )
}

// ── Meetup-Filter: Modul-Ebene-Caches (BEWUSST nicht-reaktiv) ────────────────
// Intl-Instanzen dürfen NICHT im Alpine-State liegen: Alpine wickelt den State in
// einen reactive()-Proxy, und `Intl.*.prototype.format/of` über einen Proxy wirft
// „incompatible receiver" (interne Slots brauchen das echte Objekt als this).
// Zugleich vermeidet der Modul-Scope reaktive Writes während des Renderns.
// Die Formatter sind zustandslos → prozessweit teilbar; die Filter-Caches sind
// per Schlüssel invalidiert (Single-Space-Seite → genau eine nostrSpaces-Insel).
let _regionNamesCache: Intl.DisplayNames | null | undefined
let _dateFmtCache: Intl.DateTimeFormat | null | undefined
let _myCCCache: string | undefined
// Aktivitäts-Feld der Datenschicht (`groups.ts lastMessageAtByUrl`). Räume ohne
// bekannte Aktivität sortieren ans Ende und fallen damit auf den Alphabet-Zweig.
const lastMsgAt = (room: RoomView): number => room.lastMessageAt ?? Number.NEGATIVE_INFINITY
type RoomFilterResult = { key: string; mine: RoomView[]; meetups: RoomView[]; other: RoomView[]; proposals: RoomView[] }
let _roomFilterCache: RoomFilterResult | null = null
type CountryOption = { country: string; flag: string; name: string; count: number }
let _countryCache: { key: string; list: CountryOption[] } | null = null

const regionNames = (): Intl.DisplayNames | null => {
    if (_regionNamesCache === undefined) {
        try {
            _regionNamesCache = new Intl.DisplayNames(['de'], { type: 'region' })
        } catch {
            _regionNamesCache = null
        }
    }
    return _regionNamesCache
}
const dateFmt = (): Intl.DateTimeFormat | null => {
    if (_dateFmtCache === undefined) {
        try {
            _dateFmtCache = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })
        } catch {
            _dateFmtCache = null
        }
    }
    return _dateFmtCache
}
const myCountryCode = (): string => {
    if (_myCCCache === undefined) {
        try {
            _myCCCache = new Intl.Locale(navigator.language).region?.toUpperCase() ?? ''
        } catch {
            _myCCCache = ''
        }
    }
    return _myCCCache
}

// ── Ungelesen-Punkt (P3): globaler Store + raumübergreifende Aktivität ──────
//
// Beides hängt bewusst NICHT an einer Seiten-Insel, sondern am Insel-Boot: der Punkt
// sitzt in der Bottom-Nav und damit auf JEDER Seite, nicht nur auf der Raumliste.

/** `h` der beigetretenen Räume des aktiven Space (relay-signierte 39002). */
const joinedRoomHs: Readable<string[]> = derived(activeSpaceView, ($view: SpaceView) =>
    $view.userRooms.map((room) => room.h),
)

let unreadWired = false
let activityKey = ''
let activityController: AbortController | null = null

/**
 * S1+S2 für die aktuelle Raum-Menge (neu senden, sobald sich Space ODER Mitgliedschaft
 * ändern). Der Schlüsselvergleich ist Pflicht, nicht Kosmetik: `joinedRoomHs` hängt an
 * `activeSpaceView`, und das emittiert seit `lastMessageAt` bei jeder Aktivitätswelle —
 * ohne ihn risse jede eingehende Nachricht die Live-Subscription ab und baute sie neu auf.
 */
const syncRoomActivity = (url: string, hs: string[]): void => {
    const key = url + '|' + [...hs].sort().join(',')
    if (key === activityKey) {
        return
    }
    activityKey = key
    activityController?.abort()
    activityController = null
    if (hs.length === 0) {
        return // Gast oder noch keine Mitgliedschaft geladen → kein REQ
    }
    activityController = new AbortController()
    void loadRoomActivity(url, hs)
    watchRoomActivity(url, hs, activityController.signal)
}

/**
 * Registriert den `unread`-Store und hält ihn am Leben. Der Vertrag zur Oberfläche:
 *
 *     Alpine.store('unread') → { rooms: Record<h, boolean>, threads: Record<rootId, boolean>, any: boolean }
 *
 * Der Store wird EINMAL angelegt und danach nur noch befüllt — Blade liest ihn defensiv
 * (`$store.unread?.rooms?.[…]`), ein fehlender Store bedeutet dort „kein Marker".
 * Der Guard trägt: `registerNostrComponents` kann mehrfach laufen (Muster:
 * installResizeObserverLoopFilter), zwei Subscriptions wären zwei Netzwerk-Subs.
 */
function wireUnread(Alpine: { store: (name: string, value?: unknown) => unknown }): void {
    if (unreadWired) {
        return
    }
    unreadWired = true
    const initial: UnreadView = { rooms: {}, threads: {}, any: false }
    Alpine.store('unread', initial)
    const store = Alpine.store('unread') as UnreadView
    let unsubUnread: (() => void) | null = null
    activeSpace.subscribe((url: string) => {
        // Space-Wechsel: erst leeren, dann neu ableiten — sonst blieben die Marker des
        // alten Space bis zum ersten Emit des neuen stehen.
        unsubUnread?.()
        store.rooms = {}
        store.threads = {}
        store.any = false
        unsubUnread = deriveUnread(url, joinedRoomHs).subscribe((view: UnreadView) => {
            store.rooms = view.rooms
            store.threads = view.threads
            store.any = view.any
        })
    })
    // Ohne diese Subscription bewegte sich der Punkt NUR beim Kaltstart aus dem Cache:
    // `watchSpaceRooms` holt bloß Raum-Metadaten, `listenRoom` nur den EINEN offenen Raum.
    joinedRoomHs.subscribe((hs: string[]) => syncRoomActivity(get(activeSpace), hs))
}

export function registerNostrComponents(Alpine: {
    data: (name: string, factory: (...args: unknown[]) => unknown) => void
    magic: (name: string, callback: () => unknown) => void
    store: (name: string, value?: unknown) => unknown
}) {
    installResizeObserverLoopFilter()
    wireUnread(Alpine)

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
            // Gate-Ziel EINMAL bestimmen: das Sheet (P6) landet nach Login darüber
            // (pendingReturn, §postLoginRedirect), der Fallback-View über `?return`.
            const ret = sanitizeReturnUrl(intent.returnUrl ?? location.pathname + location.search)
            pendingReturn = ret
            const ev = new CustomEvent('open-login-sheet', { detail: { intent }, cancelable: true })
            window.dispatchEvent(ev)
            if (! ev.defaultPrevented) {
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

    // ── Rückweg: „gibt es einen App-internen Vorgänger?" ─────────────────────────
    // Der Kopf-Pfeil ist UP (Hierarchie), nicht BACK. Trotzdem soll er dorthin führen,
    // wo der Nutzer WAR — inklusive Filterzustand — statt stur auf die Raumliste zu
    // springen. Beides zusammen geht nur, wenn wir die eine Frage beantworten können,
    // die die History-API nicht beantwortet: ist der vorherige Eintrag UNSERER?
    //
    // Gemessen (Playwright/Host-Chromium, 2026-07-22):
    //   /spaces --Klick--> /rooms/welcome  → history.length 3→4 (wire:navigate PUSHT)
    //   dort history.back()                → /spaces, Alpine lebt (kein kalter Reboot)
    // `history.back()` trägt also — aber nur, wenn es einen eigenen Vorgänger gibt.
    // Beim Deep-Link-Kaltstart (Notification-Tap, geteilter Link) gibt es keinen, und
    // ein blindes back() führte aus der App heraus.
    //
    // Der Marker ist bewusst KEIN Pfad-Stack: ein selbst geführter Herkunfts-Stack wäre
    // eine zweite Navigationsgeschichte neben der echten und driftet garantiert
    // (Reload, Resume, Deep-Link). Gespeichert wird nur ein Bit — „in diesem Tab hat
    // schon einmal eine App-interne Navigation stattgefunden". sessionStorage ist
    // tab-lokal, ein frischer Deep-Link-Tab startet also korrekt ohne Marker.
    document.addEventListener('livewire:navigate', () => {
        try {
            sessionStorage.setItem(APP_NAV_KEY, '1')
        } catch {
            // sessionStorage nicht verfügbar (Private-Mode/Quota) → Marker bleibt aus,
            // der Rückweg fällt auf das explizite UP-Ziel zurück. Kein Fehler.
        }
    })

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
        profileNip05: '',
        nip05Verified: false,
        nip05Settled: false,
        profileReady: false,
        addressInput: '',
        addressTouched: false,
        savingAddress: false,
        saveResults: [],
        showDiag: false,
        _destroyed: false,
        _nip05Timer: null,
        _unsubProfile: null,
        _unsubHandle: null,
        async init() {
            // Z4 — Profil-lud16 (kind 0) als Empfangsadresse spiegeln. SYNCHRON vor
            // jedem `await` abonnieren: sonst könnte destroy() beim schnellen
            // wire:navigate vor der Zuweisung laufen (`?.()`-No-op) und die danach
            // angelegte Sub würde leaken. Das Feld folgt dem Profil, bis der User
            // selbst tippt (`addressTouched`) — so überschreibt ein spätes Update
            // keine Eingabe und ein bewusst geleertes Feld (Adresse entfernen) bleibt leer.
            this._unsubProfile = userProfile.subscribe((p) => {
                this.profileLud16 = p?.lud16 ?? ''
                this.profileNip05 = p?.nip05 ?? ''
                if (!this.addressTouched) {
                    this.addressInput = this.profileLud16
                }
            })
            // pubkey wird async aus localStorage hydratisiert (welshman `sync`) —
            // erst abwarten, sonst liest loadWallet() bei hartem Reload direkt auf
            // /settings/wallet einen leeren pubkey und eine verbundene Wallet erschiene
            // fälschlich als „nicht verbunden" (nostrAuth.init guardet dasselbe Muster).
            await authReady
            // `profileReady` gated „Nicht gesetzt" gegen den Lade-Flash — aber an den
            // ABGESCHLOSSENEN Lade-VERSUCH gekoppelt, nicht an ein vorhandenes Profil:
            // welshman hält `userProfile` für Nutzer OHNE kind-0 (gast-first, frisches
            // nsec) ewig `undefined` → sonst bliebe „Nicht gesetzt" für sie für immer
            // aus und die „Aktuell:"-Zeile leer. loadUserProfile() resolved nach dem
            // Relay-Versuch (mit oder ohne Ergebnis).
            void loadUserProfile().finally(() => {
                this.profileReady = true
            })
            // destroy() kann während `await authReady` gelaufen sein (schnelles wire:navigate);
            // dann NICHT mehr abonnieren, sonst leakt die Handle-Sub auf einer toten Komponente.
            if (this._destroyed) {
                return
            }
            // NIP-05-Verifikation (Diagnose): welshman löst nostr.json↔pubkey live auf und
            // liefert nur bei bestätigtem Match einen Handle → genau die Bedingung, die das
            // Member-Relay zum Publishen verlangt. Der Store emittiert erst `undefined` und
            // re-emittiert nach dem nostr.json-Fetch (800 ms-Batch + Netz). `profileReady`
            // wird aber schon nach dem kind-0-Laden true — deshalb `nip05Settled`: erst wenn
            // verifiziert ODER der Settle-Timeout abgelaufen ist, gilt die Prüfung als fertig.
            // Sonst blitzte „unverifiziert" bei EINEM gültigen NIP-05-Nutzer auf (Review-Fund).
            const pk = get(pubkey)
            if (pk) {
                this._unsubHandle = deriveHandleForPubkey(pk).subscribe((handle) => {
                    this.nip05Verified = Boolean(handle)
                    if (handle) {
                        this.nip05Settled = true
                    }
                })
                this._nip05Timer = setTimeout(() => {
                    this.nip05Settled = true
                }, 6000)
            } else {
                this.nip05Settled = true
            }
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
            this.saveResults = []
            try {
                const results = await publishReceivingAddress(this.addressInput, get(userSpaceUrls))
                this.saveResults = results
                const accepted = results.filter((r) => r.ok)
                const rejected = results.filter((r) => !r.ok)
                // Ebene 2: mind. EIN Relay akzeptiert ⇒ das kind-0 IST veröffentlicht.
                // Nur wenn KEIN Relay annimmt, ist es ein echter Fehlschlag.
                if (accepted.length === 0) {
                    this.showDiag = true
                    throw new Error('Auf keinem Relay gespeichert — Details in der Diagnose.')
                }
                this.addressTouched = false
                if (rejected.length > 0) {
                    // Teil-Erfolg: gespeichert, aber ein Relay (i. d. R. das Member-Relay
                    // mit NIP-05-Pflicht) hat abgelehnt. Diagnose aufklappen, damit der User
                    // sieht, WO und WARUM — und was zu tun ist (NIP-05-Hinweis unten).
                    this.showDiag = true
                    toast(`Gespeichert auf ${accepted.length}/${results.length} Relays.`, 'success')
                } else {
                    // Voller Erfolg → nichts zu diagnostizieren: das (evtl. auto-geöffnete) Panel
                    // wieder schließen, damit es nur auftaucht, wenn es etwas zu sehen gibt.
                    this.showDiag = false
                    toast('Empfangsadresse gespeichert', 'success')
                }
            } catch (e) {
                this.error = e instanceof Error ? e.message : 'Speichern fehlgeschlagen'
                toast(this.error)
            } finally {
                this.savingAddress = false
            }
        },
        nip05State() {
            if (!this.profileReady) {
                return 'pending'
            }
            if (this.nip05Verified) {
                return 'verified'
            }
            // NIP-05 gesetzt, aber noch nicht bestätigt UND die Prüfung läuft noch
            // (nostr.json-Fetch nicht durch) → „pending", nicht fälschlich „unverified".
            if (this.profileNip05 && !this.nip05Settled) {
                return 'pending'
            }
            return this.profileNip05 ? 'unverified' : 'missing'
        },
        // Hat ein Relay das Speichern konkret wegen fehlender NIP-05 abgelehnt? Dann
        // den gezielten Reparatur-Hinweis zeigen (statt nur der rohen Relay-Meldung).
        saveBlockedByNip05() {
            return this.saveResults.some((r) => !r.ok && /nip-?0?5/i.test(r.reason))
        },
        shortRelay(url: string) {
            return url.replace(/^wss?:\/\//, '').replace(/\/$/, '')
        },
        npubShort() {
            const pk = get(pubkey)
            if (!pk) {
                return ''
            }
            const npub = nip19.npubEncode(pk)
            return `${npub.slice(0, 12)}…${npub.slice(-6)}`
        },
        copyNpub() {
            const pk = get(pubkey)
            if (pk) {
                this.copy(nip19.npubEncode(pk), 'npub')
            }
        },
        // Der hex-Pubkey ist der Wert, der WÖRTLICH in die nostr.json (`names`-Map) gehört —
        // NICHT der npub. Genau das verlangt NIP-05 (welshman vergleicht names[name] === hex).
        pubkeyHexShort() {
            const pk = get(pubkey)
            return pk ? `${pk.slice(0, 10)}…${pk.slice(-8)}` : ''
        },
        copyPubkeyHex() {
            const pk = get(pubkey)
            if (pk) {
                this.copy(pk, 'Public Key (hex)')
            }
        },
        copy(text: string, label: string) {
            if (text) {
                void navigator.clipboard?.writeText(text).then(() => toast(`${label} kopiert.`, 'success'))
            }
        },
        destroy() {
            this._destroyed = true
            if (this._nip05Timer) {
                clearTimeout(this._nip05Timer)
            }
            this._unsubProfile?.()
            this._unsubHandle?.()
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
        // Tab aus der URL (?tab=threads) übernehmen → Startseite ist direkt verlinkbar.
        tab: new URLSearchParams(window.location.search).get('tab') === 'threads' ? 'threads' : 'rooms',
        threads: [],
        isAdmin: false,
        roomForm: { h: '', name: '', about: '', picture: '', isPrivate: false, isClosed: false, isHidden: false, isRestricted: false },
        _roomEditing: false,
        _roomIconFile: null,
        roomSaving: false,
        pendingRoomDelete: null,
        membersRoom: null,
        roomMembers: [],
        memberNpub: '',
        memberBusy: false,
        _unsubRoomMembers: null,
        meetups: {},
        _unsubMeetups: null,
        // Filterzustand aus der URL übernehmen — spiegelbildlich zu den $watch-Hooks in
        // init(). Ohne das war der Filter reiner Mount-State: aus einem Meetup-Raum
        // zurück landete man IMMER in der ungefilterten Standardliste, egal wie der
        // Zurück-Weg implementiert ist. Die URL ist der einzige Zustand, der eine
        // Navigation überlebt (Alpine wird bei wire:navigate neu aufgebaut).
        roomQuery: new URLSearchParams(window.location.search).get('q') ?? '',
        roomType: new URLSearchParams(window.location.search).get('rt') === 'meetups' ? 'meetups' : 'rooms',
        roomCountry: (new URLSearchParams(window.location.search).get('cc') ?? '').toUpperCase(),
        _url: null,
        _unsubView: null,
        _unsubActive: null,
        _unsubAccess: null,
        _unsubAdmin: null,
        _unsubThreads: null,
        _controller: null,
        // Raumname zu einem h-Tag (aus den bereits geladenen Space-Räumen) — für die Thread-Liste.
        roomName(h: string): string {
            const rooms = [...(this.space?.userRooms ?? []), ...(this.space?.otherRooms ?? [])]
            return rooms.find((r) => r.h === h)?.name || h
        },
        // Praesentations-Join fuer die Kachel: room.meetupSlug → {flag, portalLink,
        // country, nextEventStart, …}. Null-sicher (Warm-Render: Join-Daten fehlen
        // kurz, bis die Portal-Liste geladen ist) → die Kachel rendert dann ohne Flagge.
        meetup(slug: string): MeetupPresentation | null {
            return (slug && this.meetups[slug]) || null
        },
        // ── P4: Raumübersicht — Standard-Räume default, Meetups ein bewusster Schritt ─
        // Meetup-Modus = nur die Meetup-Liste (Suche/Land/Sort). Default sind die
        // Standard-Räume (Meine · Andere); Meetups öffnet man über die Entdecken-Karte.
        focusMode(): boolean {
            return this.roomType === 'meetups'
        },
        // Gesamtzahl der Meetup-Räume (für die Entdecken-Karte). Unabhängig vom Filter.
        meetupCount(): number {
            return this._meetupPool(true).length
        },
        // Standard-Räume im Default-View (Meine + Andere ohne kategorisierte Räume) —
        // für den „Räume"-Tab-Zähler. Ehrlich: nicht die 304 Meetups mitzählen (die
        // stecken hinter der Entdecken-Karte) und auch keine fremden Antragsräume
        // (Projektunterstützung). `userRooms` bleibt ungefiltert: was mir gehört,
        // zähle ich mit — sonst verschwände mein eigener Antragsraum aus der Liste.
        standardCount(): number {
            const mine = (this.space?.userRooms ?? []).filter((r) => !r.isProjectSupport).length
            const other = (this.space?.otherRooms ?? []).filter(isStandardRoom).length
            return mine + other
        },
        // Heimatland aus der Browser-Sprache (de-DE → DE) für „mein Land zuerst".
        myCountry(): string {
            return myCountryCode()
        },
        // ISO → Landesname (nativ, kein Datentable). '' → '', unbekannt → Code.
        countryName(iso: string): string {
            if (!iso) {
                return ''
            }
            try {
                return regionNames()?.of(iso) ?? iso
            } catch {
                return iso
            }
        },
        countryFlag(iso: string): string {
            return flagEmoji(iso)
        },
        // Nächster Termin → kurzes deutsches Datum („Heute"/„Morgen"/„Di, 4. Feb").
        fmtEventDate(iso: string): string {
            const t = Date.parse(iso)
            if (!iso || Number.isNaN(t)) {
                return ''
            }
            const d = new Date(t)
            const startOfToday = new Date().setHours(0, 0, 0, 0)
            const day = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - startOfToday) / 86400000)
            if (day === 0) {
                return 'Heute'
            }
            if (day === 1) {
                return 'Morgen'
            }
            const fmt = dateFmt()
            return fmt ? fmt.format(d) : ''
        },
        // Termin innerhalb der nächsten 7 Tage (und nicht > 1h vergangen) → Akzent.
        isEventSoon(iso: string): boolean {
            const t = Date.parse(iso)
            if (!iso || Number.isNaN(t)) {
                return false
            }
            const diff = t - Date.now()
            return diff >= -3600000 && diff <= 7 * 86400000
        },
        _pres(room: RoomView): MeetupPresentation | null {
            return this.meetup(room.meetupSlug)
        },
        // Texttreffer auf Name ODER Stadt (Stadt kommt aus dem async Join → null-tolerant).
        _matches(room: RoomView, q: string): boolean {
            if (!q) {
                return true
            }
            return room.name.toLowerCase().includes(q) || (this._pres(room)?.city ?? '').toLowerCase().includes(q)
        },
        // Meetup-Pool: im Fokus alle (auch beigetretene), sonst nur entdeckbare.
        // Positiv-Filter auf `isMeetup` → Antragsräume (Projektunterstützung) landen
        // hier nie; der Pool und alles, was daran hängt (meetupCount, Länderliste),
        // bleibt von der neuen Kategorie unberührt.
        _meetupPool(all: boolean): RoomView[] {
            const other = (this.space?.otherRooms ?? []).filter((r) => r.isMeetup)
            if (!all) {
                return other
            }
            const mine = (this.space?.userRooms ?? []).filter((r) => r.isMeetup)
            return [...mine, ...other]
        },
        // Antragsräume (Projektunterstützung) — eigene Sektion statt verstreut in
        // „Meine Räume". Wer Mitglied ist (userRooms), sieht seinen Antragsraum
        // IMMER; FREMDE Antragsräume (otherRooms) bekommt nur der Space-Admin
        // (Vorstand) zu sehen. Dedupliziert über `h`, falls ein Raum in beiden
        // Listen auftaucht.
        _proposalPool(): RoomView[] {
            const mine = (this.space?.userRooms ?? []).filter((r) => r.isProjectSupport)
            if (!this.isAdmin) {
                return mine
            }
            const seen = new Set(mine.map((r) => r.h))
            const other = (this.space?.otherRooms ?? []).filter((r) => r.isProjectSupport && !seen.has(r.h))
            return [...mine, ...other]
        },
        // Gesamtzahl der für mich sichtbaren Antragsräume (ungefiltert) — steuert,
        // ob die Sektion überhaupt existiert.
        proposalCount(): number {
            return this._proposalPool().length
        },
        // Datensignatur für die Filter-Memoisierung: ändert sich, sobald Filter,
        // die Räume ODER der Meetup-Join wechseln → dann (und nur dann) neu rechnen.
        // Die Getter laufen pro Render mehrfach; ohne Cache würde die 304er-Liste
        // je Tastendruck vielfach neu sortiert.
        //
        // Die Raum-Anteile sind FINGERABDRÜCKE über alle Felder (roomFingerprint.ts),
        // nicht bloß Längen: eine Umbenennung (9002 → neues 39000) ändert weder die
        // Anzahl noch einen Zeitstempel — mit reinen Längen blieb der alte Name bis
        // zum Reload stehen (Anlegen/Löschen fielen nie auf, die ändern die Länge).
        // `lastMessageAt` steckt als Raum-Feld mit drin, die Live-Sortierung nach
        // eingehenden Nachrichten bricht den Cache also weiterhin.
        _dataSig(): string {
            const s = this.space
            return [
                this.roomQuery.trim().toLowerCase(),
                this.roomCountry,
                this.roomType,
                // Der Antragsraum-Pool hängt an der Admin-Rolle (fremde Anträge nur
                // für den Vorstand), also gehört sie in den Schlüssel. `isAdmin` kommt
                // asynchron nach; im Kaltstart (Räume aus dem IndexedDB-Cache sofort,
                // Rolle erst nach dem Relay-Roundtrip) ist es der EINZIGE Teil, der
                // sich dann noch ändert. Im Normalfall bricht die Raum-Signatur den
                // Cache ohnehin mit — der E2E-Lauf bleibt deshalb auch ohne dieses Bit
                // grün; festgenagelt ist es in `roomFingerprint.test.ts` („allein
                // kippendes isAdmin bricht den Schlüssel").
                this.isAdmin ? 'a' : '-',
                roomsFingerprint(s?.userRooms as RoomLike[] | undefined),
                roomsFingerprint(s?.otherRooms as RoomLike[] | undefined),
                Object.keys(this.meetups).length,
            ].join('|')
        },
        _ensureFiltered() {
            const key = this._dataSig()
            if (_roomFilterCache && _roomFilterCache.key === key) {
                return _roomFilterCache
            }
            const q = this.roomQuery.trim().toLowerCase()
            const cc = this.roomCountry
            // Antragsräume raus aus „Meine Räume" — sie stehen in ihrer eigenen
            // Sektion (kategorisieren, nicht verstecken). Beigetretene MEETUPS
            // bleiben hier bewusst drin (dezentes Flaggen-Badge, gleiche Zeilenhöhe).
            const mineRooms = (this.space?.userRooms ?? []).filter((room) => !room.isProjectSupport && this._matches(room, q))
            const otherRooms = (this.space?.otherRooms ?? []).filter((room) => isStandardRoom(room) && this._matches(room, q))
            const meetupRows = this._meetupPool(true).filter((room) => {
                if (cc && this._pres(room)?.country !== cc) {
                    return false
                }
                return this._matches(room, q)
            })
            // Sortierung (Brief): primär letzte eingehende Nachricht (neueste zuerst),
            // sekundär alphabetisch. Robust: fehlt lastMessageAt (frische Räume / bis die
            // Datenschicht das Feld live liefert), fallen alle auf den Alphabet-Zweig.
            meetupRows.sort((a, b) => {
                const ta = lastMsgAt(a)
                const tb = lastMsgAt(b)
                if (ta !== tb) {
                    return tb - ta
                }
                return a.name.localeCompare(b.name, 'de')
            })
            // Antragsräume: alphabetisch — es sind wenige, und ein stabiler Platz
            // schlägt hier eine Aktivitäts-Sortierung, die die Zeilen springen lässt.
            const proposalRows = this._proposalPool()
                .filter((room) => this._matches(room, q))
                .sort((a, b) => a.name.localeCompare(b.name, 'de'))
            _roomFilterCache = { key, mine: mineRooms, meetups: meetupRows, other: otherRooms, proposals: proposalRows }
            return _roomFilterCache
        },
        // Real vertretene Länder (aus dem Gesamt-Pool), meins zuerst, dann nach Anzahl.
        // Memoisiert auf Pool-/Join-Größe: baut den Index nur neu, wenn Räume/Join wachsen.
        availableCountries() {
            const key = [this.space?.otherRooms.length ?? 0, this.space?.userRooms.length ?? 0, Object.keys(this.meetups).length, this.myCountry()].join('|')
            if (_countryCache && _countryCache.key === key) {
                return _countryCache.list
            }
            const by = new Map<string, number>()
            for (const room of this._meetupPool(true)) {
                const cc = this._pres(room)?.country
                if (cc) {
                    by.set(cc, (by.get(cc) ?? 0) + 1)
                }
            }
            const mine = this.myCountry()
            const list = Array.from(by.entries())
                .map(([country, count]) => ({ country, count, flag: flagEmoji(country), name: this.countryName(country) }))
                .sort(
                    (a, b) =>
                        (a.country === mine ? -1 : b.country === mine ? 1 : 0) ||
                        b.count - a.count ||
                        a.name.localeCompare(b.name, 'de'),
                )
            _countryCache = { key, list }
            return list
        },
        // Gefilterte + sortierte Meetup-Liste (mein Land → nächster Termin → Name).
        filteredMeetups(): RoomView[] {
            return this._ensureFiltered().meetups
        },
        filteredMine(): RoomView[] {
            return this._ensureFiltered().mine
        },
        filteredOther(): RoomView[] {
            return this._ensureFiltered().other
        },
        filteredProposals(): RoomView[] {
            return this._ensureFiltered().proposals
        },
        // Aktive, entfernbare Filter im Meetup-Modus (Suche + Land). Der Modus selbst
        // ist kein „Filter"-Chip — man verlässt ihn über „Räume anzeigen".
        activeFilterCount(): number {
            return (this.roomQuery.trim() ? 1 : 0) + (this.roomCountry ? 1 : 0)
        },
        // Land togglen; eine Landwahl setzt zugleich den Meetup-Modus.
        selectCountry(iso: string): void {
            this.roomCountry = this.roomCountry === iso ? '' : iso
            if (this.roomCountry) {
                this.roomType = 'meetups'
            }
        },
        resetRoomFilters(): void {
            this.roomQuery = ''
            this.roomCountry = ''
            this.roomType = 'rooms'
        },
        // Sichtbare Räume über die aktuell eingeblendeten Sektionen — steuert den
        // „keine Treffer"-Leerzustand. Rooms-Modus: Meine+Andere; Meetup-Modus: Liste.
        visibleCount(): number {
            return this.focusMode()
                ? this.filteredMeetups().length
                : this.filteredMine().length + this.filteredOther().length + this.filteredProposals().length
        },
        // ── P4: Raum-Verwaltung (Admin, NIP-29 9007/9002/9008) ─────────────────
        openRoomCreate() {
            // `h` EINMALIG minten (retry-sicher): schlägt ein Publish-Schritt fehl, füllt
            // ein erneutes Speichern denselben Raum weiter, statt einen zweiten anzulegen.
            this.roomForm = { h: randomId(), name: '', about: '', picture: '', isPrivate: false, isClosed: false, isHidden: false, isRestricted: false }
            this._roomEditing = false
            this._roomIconFile = null
            dispatchModal('room-form')
        },
        // Bearbeiten: alle Felder + Flags aus der RoomView vorbelegen (die einzeln
        // getragenen Flags verhindern, dass ein Speichern bestehende wegwirft).
        openRoomEdit(room: RoomView) {
            this.roomForm = {
                h: room.h,
                name: room.name,
                about: room.about,
                picture: room.picture,
                isPrivate: room.isPrivate,
                isClosed: room.isClosed,
                isHidden: room.isHidden,
                isRestricted: room.isRestricted,
            }
            this._roomEditing = true
            this._roomIconFile = null
            dispatchModal('room-form')
        },
        // Raumbild wählen: Datei merken + roomForm.picture als data-URL-Vorschau; der
        // echte Upload läuft erst in saveRoom (Abbrechen lädt nichts). `input.value`
        // leeren, damit dieselbe Datei erneut wählbar bleibt (wie pickSpaceIcon).
        pickRoomPicture(input: HTMLInputElement) {
            const file = input.files?.[0]
            input.value = ''
            if (!file || !file.type.startsWith('image/')) {
                return
            }
            this._roomIconFile = file
            const reader = new FileReader()
            reader.onload = (e) => {
                this.roomForm.picture = String(e.target?.result ?? '')
            }
            reader.readAsDataURL(file)
        },
        // Speichern: neues Bild vorher hochladen, dann anlegen (h leer) oder bearbeiten.
        // Der Live-Sub (watchSpaceRooms) reflektiert das relay-signierte 39000 selbst.
        async saveRoom() {
            const url = this._url
            if (!url || this.roomSaving || !this.roomForm.name.trim()) {
                return
            }
            this.roomSaving = true
            const editing = this._roomEditing
            try {
                if (this._roomIconFile) {
                    const uploaded = await uploadAttachment(this._roomIconFile)
                    this.roomForm.picture = uploaded.url
                    // Datei-Referenz lösen: bei einem Retry liegt die URL schon in
                    // roomForm.picture → kein zweiter Upload (Blossom ist ohnehin
                    // content-addressed, aber der Sign+Upload-Roundtrip entfällt).
                    this._roomIconFile = null
                }
                const input: RoomInput = { ...this.roomForm, name: this.roomForm.name.trim(), about: this.roomForm.about.trim() }
                const err = editing ? await editRoomMeta(url, input) : await createRoom(url, input)
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('room-form', false)
                    toast(editing ? 'Raum gespeichert.' : 'Raum erstellt.', 'success')
                }
            } catch {
                toast('Speichern fehlgeschlagen.')
            } finally {
                this.roomSaving = false
            }
        },
        askDeleteRoom(room: RoomView) {
            this.pendingRoomDelete = room
            dispatchModal('delete-room')
        },
        async confirmDeleteRoom() {
            const room = this.pendingRoomDelete
            if (!room || !this._url || this.roomSaving) {
                return
            }
            this.roomSaving = true
            try {
                const err = await deleteRoom(this._url, room.h)
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('delete-room', false)
                    this.pendingRoomDelete = null
                }
            } finally {
                this.roomSaving = false
            }
        },
        // Raum-Mitglieder (P4b): live-Liste der 39002 des Raums, +hinzufügen/-entfernen.
        openRoomMembers(room: RoomView) {
            this._unsubRoomMembers?.()
            this.membersRoom = room
            this.roomMembers = []
            this.memberNpub = ''
            if (this._url) {
                this._unsubRoomMembers = deriveRoomMemberViews(this._url, room.h).subscribe((m: RoomMemberView[]) => {
                    this.roomMembers = m
                })
            }
            dispatchModal('room-members')
        },
        closeRoomMembers() {
            this._unsubRoomMembers?.()
            this._unsubRoomMembers = null
            this.membersRoom = null
        },
        // Hinzufügen per npub/hex: erst Space-Zulassung (allowpubkey), dann Raum-Beitritt
        // (kind 9000). Ein noch nicht zugelassener Fremder wird so in EINEM Schritt Mitglied.
        async addRoomMemberByNpub() {
            const room = this.membersRoom
            const raw = this.memberNpub.trim()
            if (!room || !this._url || this.memberBusy || !raw) {
                return
            }
            let pubkey = ''
            try {
                pubkey = raw.startsWith('npub') ? (nip19.decode(raw).data as string) : /^[0-9a-f]{64}$/.test(raw) ? raw : ''
            } catch {
                pubkey = ''
            }
            if (!pubkey) {
                toast('Kein gültiger npub / Pubkey.')
                return
            }
            this.memberBusy = true
            try {
                const allowErr = await addSpaceMember(this._url, pubkey)
                if (allowErr) {
                    toast(allowErr)
                    return
                }
                const err = await addRoomMember(this._url, room.h, pubkey)
                if (err) {
                    toast(err)
                } else {
                    this.memberNpub = ''
                }
            } finally {
                this.memberBusy = false
            }
        },
        // Entfernen: kind 9001 (remove-user) → der Live-Sub aktualisiert die 39002-Liste.
        async kickRoomMember(pubkey: string) {
            const room = this.membersRoom
            if (!room || !this._url || this.memberBusy) {
                return
            }
            this.memberBusy = true
            try {
                const err = await removeRoomMember(this._url, room.h, pubkey)
                if (err) {
                    toast(err)
                }
            } finally {
                this.memberBusy = false
            }
        },
        init() {
            // Filter-Caches (Modul-Scope) beim (Re-)Mount leeren → keine Stale-Arrays
            // aus einer vorherigen Space-Navigation.
            _roomFilterCache = null
            _countryCache = null
            // Tab-Wechsel in die URL spiegeln (replaceState, keine Navigation) → verlinkbar,
            // Reload/Share landen im gleichen Tab. Default „rooms" ohne Param (sauberere URL).
            ;(this as unknown as { $watch(p: string, cb: (v: string) => void): void }).$watch('tab', (v: string) => {
                const u = new URL(window.location.href)
                if (v === 'rooms') {
                    u.searchParams.delete('tab')
                } else {
                    u.searchParams.set('tab', v)
                }
                window.history.replaceState(window.history.state, '', u)
            })
            // Dasselbe für den Filterzustand (Modus/Suche/Land): NUR replaceState, nie
            // pushState — ein eigener History-Eintrag pro Tastendruck im Suchfeld wäre
            // eine Zurück-Falle, und pushState auf einem Livewire-Eintrag löst beim
            // Zurück den kalten Insel-Reboot aus (siehe openThread, gleiche Begründung).
            // Kurze Parameternamen (rt/q/cc), weil sie an jeder Raum-URL mitlaufen.
            const syncFilterParam = (key: string, value: string, isDefault: boolean): void => {
                const u = new URL(window.location.href)
                if (isDefault) {
                    u.searchParams.delete(key)
                } else {
                    u.searchParams.set(key, value)
                }
                window.history.replaceState(window.history.state, '', u)
            }
            const watch = this as unknown as { $watch(p: string, cb: (v: string) => void): void }
            watch.$watch('roomType', (v: string) => syncFilterParam('rt', v, v !== 'meetups'))
            watch.$watch('roomQuery', (v: string) => syncFilterParam('q', v.trim(), v.trim() === ''))
            watch.$watch('roomCountry', (v: string) => syncFilterParam('cc', v, v === ''))
            loadUserGroupList()?.finally(() => {
                this.loading = false
            })
            // Aktiver Space → dessen Rooms als LIVE-Sub abonnieren (Wechsel baut neu
            // auf). Live statt One-Shot: überlebt langsames NIP-42-AUTH → Räume
            // erscheinen auch, wenn der Signer erst spät bestätigt.
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this._url = url
                this._controller?.abort()
                this._controller = new AbortController()
                watchSpaceRooms(url, this._controller.signal)
                // Admin-Status (P4): gatet „+ Raum" + die Kachel-Aktionen.
                this._unsubAdmin?.()
                this._unsubAdmin = deriveUserIsSpaceAdmin(url).subscribe((admin: boolean) => {
                    this.isAdmin = admin
                })
                // Threads-Übersicht des Space (C6b): Kommentare + Wurzeln laden, reaktiv anzeigen.
                this._unsubThreads?.()
                this._unsubThreads = deriveSpaceThreads(url).subscribe((t: SpaceThread[]) => {
                    this.threads = t
                })
                void loadSpaceThreads(url)
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
            // Meetup-Praesentation EINMAL laden (fail-soft) und den Index reaktiv nach
            // Alpine spiegeln — die Kachel joint dann per room.meetupSlug.
            void loadMeetupPresentations()
            this._unsubMeetups = meetupPresentationBySlug.subscribe((bySlug: Map<string, MeetupPresentation>) => {
                this.meetups = Object.fromEntries(bySlug)
            })
        },
        destroy() {
            this._unsubActive?.()
            this._unsubView?.()
            this._unsubAccess?.()
            this._unsubAdmin?.()
            this._unsubThreads?.()
            this._unsubRoomMembers?.()
            this._unsubMeetups?.()
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
        reports: [],
        joinRequests: [],
        spaceForm: { name: '', description: '' },
        _spaceInitial: { name: '', description: '' },
        spaceIconPreview: '',
        _spaceIconFile: null,
        spaceSaving: false,
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
                this._controller?.abort()
                this.ready = false
                this.profilesReady = false
                this._settleStarted = false
                this.reports = []
                this.joinRequests = []
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
        // ── P3: Melde-Queue (NIP-56 kind 1984) ─────────────────────────────────
        // Meldung verwerfen: den Report relay-seitig bannen (banevent) → er
        // verschwindet aus der Queue (optimistisch lokal via removeEvent). Der
        // gemeldete Inhalt bleibt unberührt. Gemeinsames busy-Gate wie die anderen
        // Admin-Mutationen (immer nur eine Aktion offen).
        async dismissReport(r: ReportView) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await banEvent(this._url, r.id, 'dismissed by admin')
                if (err) {
                    toast(err)
                } else {
                    repository.removeEvent(r.id)
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
                const err = (await banEvent(this._url, r.reportedId)) || (await banEvent(this._url, r.id))
                if (err) {
                    toast(err)
                } else {
                    repository.removeEvent(r.reportedId)
                    repository.removeEvent(r.id)
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
                const err = (await banSpaceMember(this._url, r.reportedPubkey)) || (await banEvent(this._url, r.id))
                if (err) {
                    toast(err)
                } else {
                    refreshSpaceAdmin(this._url)
                    repository.removeEvent(r.id)
                }
            } finally {
                this.busy = false
            }
        },
        // ── P4b: Beitritts-Queue (offene 9021 für closed-Räume) ────────────────
        // Annehmen: kind 9000 (put-user) → Relay trägt den Pubkey in die 39002 ein;
        // der Live-Sub reflektiert das → die Anfrage fällt aus der Queue (jetzt Mitglied).
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
                    // Den 9021-Request zurückziehen (wie beim Ablehnen). Sonst bliebe er
                    // im Repository und tauchte nach einem späteren Kick (9001, das kein
                    // 9022 erzeugt) erneut als „offen" auf, weil der Pubkey dann wieder aus
                    // der 39002 fällt. Best-effort: die Mitgliedschaft steht bereits.
                    void banEvent(this._url, j.id)
                    repository.removeEvent(j.id)
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
                    repository.removeEvent(j.id)
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
            this._prefillSpace(get(relaysByUrl).get(url))
            this._spaceIconFile = null
            dispatchModal('space-edit')
            void forceLoadRelay(url).then(() => {
                const pristine =
                    !this._spaceIconFile &&
                    this.spaceForm.name === this._spaceInitial.name &&
                    this.spaceForm.description === this._spaceInitial.description
                if (this._url === url && pristine) {
                    this._prefillSpace(get(relaysByUrl).get(url))
                }
            })
        },
        _prefillSpace(profile?: RelayProfile) {
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
                await forceLoadRelay(url)
                dispatchModal('space-edit', false)
                toast('Space gespeichert.', 'success')
            } catch {
                toast('Speichern fehlgeschlagen.')
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
            this._controller?.abort()
        },
    }))

    // Room-Chat (M4 lesen + M5 schreiben): Verlauf eines Raums im AKTIVEN Space.
    // Live-Sub (limit:0) + Cursor-Pagination. Senden/Löschen = kind 9/5 (optimistisch).
    // Beitreten/Verlassen = NIP-29 (kind 9021/9022) → relay-autoritative 39002-
    // Mitgliedschaft (persistent); der Composer ist an `joined` gekoppelt.
    Alpine.data('nostrRoomChat', (h: unknown, initialName?: unknown, nevent?: unknown): RoomChatState => ({
        h: String(h),
        _deepThreadNevent: nevent ? String(nevent) : null,
        // SSR-Fallback (Server-Read-Cache/Slug); die Client-Meta (39000) überschreibt
        // ihn reaktiv in setup(), sobald sie vom Relay da ist — der Server-Cache kann
        // den Namen am member-only-Relay ohne AUTH nicht lesen und zeigt sonst den Slug.
        roomName: String(initialName ?? h),
        messages: [],
        messagesReversed: [],
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
        attachment: null,
        threadAttachment: null,
        _cropSrc: null,
        _cropForThread: false,
        cropRatio: NaN,
        uploadingImage: false,
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
        zapResolving: false,
        zapUnavailable: false,
        zapResolveFailed: false,
        zapNostrless: false,
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
        _menuInThread: false,
        infoFor: null,
        isAdmin: false,
        pendingAdminDelete: null,
        banAuthorFor: null,
        moderating: false,
        threadRootId: null,
        threadRoot: null,
        threadComments: [],
        threadCount: 0,
        threadReplyTo: null,
        threadDraft: '',
        threadFull: false,
        _threadPrevUrl: null,
        _threadUnsub: null,
        _threadController: null,
        mentionOpen: false,
        mentionQuery: '',
        _mentionTarget: 'main',
        mentionItems: [],
        mentionIndex: 0,
        _mentionStart: -1,
        _members: [],
        _unsubMembers: null,
        _unsubAdmin: null,
        _unsubRoomMeta: null,
        _url: null,
        _lastRead: 0,
        _onViewport: null,
        _onVisible: null,
        _hiddenAt: 0,
        _initialLoadDone: false,
        _unsubActive: null,
        _unsub: null,
        _unsubJoined: null,
        _controller: null,
        _loadedProfiles: new Set<string>(),
        _loadedMsgIds: new Set<string>(),
        _scroller: null,
        _destroyed: false,
        _pendingMsgs: null,
        _rafMsgs: 0,
        init() {
            // Aktiver Space → dessen Room-Feed (Wechsel baut Sub + Live neu auf).
            // M3 P1: ERST wenn der Kaltstart-Cache in die repository gespiegelt ist
            // (storageReady) abonnieren — sonst misst der Warm-Peek in setup() ein noch
            // leeres Repo → Skeleton statt Instant-Paint. storageReady rejectet nie und
            // resolved auch ohne Cache/bei IDB-Fehler sofort → der kalte Pfad bleibt
            // unverändert schnell; es verschiebt das Abo nur um einen Micro-/IDB-Tick.
            // P3 zusätzlich `readStateReady`: setup() liest das Wasserzeichen EINMAL für die
            // „Neu"-Trennlinie. Liefe es davor, wäre das Wasserzeichen 0 und die Linie fehlte
            // die ganze Sitzung. Beide Promises starten beim Insel-Boot parallel, rejecten nie
            // und lösen auch ohne Speicher sofort auf → der kalte Pfad bleibt gleich schnell.
            void Promise.all([storageReady, readStateReady]).then(() => {
                if (this._destroyed) {
                    return // Raum schon verlassen, bevor der Cache-Load fertig war → nicht abonnieren
                }
                this._unsubActive = activeSpace.subscribe((url: string) => this.setup(url))
            })
            // Mobil: Tastatur/Adressleiste ändern die Viewport-Höhe — stand man am Boden,
            // dort bleiben. followOnAppend feuert nur bei count-Änderung, ein Viewport-Resize
            // ist keine → explizit re-sticken. WICHTIG: `this.atBottom` (Zustand VOR dem Resize,
            // gepflegt von onScroll/onChange) statt isAtEnd() NACH dem Resize — der geschrumpfte
            // Viewport (Tastatur ~300px) macht isAtEnd sofort false → kein Re-Stick, Nachricht
            // hinge hinter der Tastatur; und eine lockere Schwelle risse einen leicht Hochgescrollten
            // bei Adressleisten-Show/Hide nach unten (derselbe Fight wie das entfernte onMediaLoad).
            this._onViewport = () => {
                if (this.atBottom) {
                    const el = (this as unknown as AlpineMagics).$refs.scroll as HTMLElement | undefined
                    el?.scrollTo({ top: 0 }) // column-reverse: top:0 = Boden (neueste)
                }
            }
            window.visualViewport?.addEventListener('resize', this._onViewport)
            // App-Foreground-Resync: Im Android-WebView friert der Hintergrund die JS-Timer ein
            // und das OS kappt den WebSocket → welshmans Timer-Reconnect läuft nicht sauber an,
            // die Live-REQ (listenRoom) bleibt tot. Beim Zurückkommen (visibilitychange→visible)
            // die Live-Subs neu senden + Verpasstes nachladen, statt bis zum Raum-Neubetreten
            // blind zu bleiben. resync() ist bewusst leicht (kein teardown) → kein Rerender/Blank.
            // Dauer-Schwelle statt isMobile-Gate: ein echter App-Background dauert immer > 2 s, ein
            // kurzer Web-Tab-Blick nicht → im Web (wo welshman ohnehin selbst reconnectet) feuert
            // resync nicht bei jedem Tab-Wechsel (kein unnötiges Sub-Neusenden/Churn).
            this._onVisible = () => {
                if (document.visibilityState === 'hidden') {
                    this._hiddenAt = Date.now()
                    return
                }
                const wasBackgrounded = this._hiddenAt > 0 && Date.now() - this._hiddenAt > 2000
                this._hiddenAt = 0
                if (wasBackgrounded) {
                    this.resync()
                }
            }
            document.addEventListener('visibilitychange', this._onVisible)
        },
        setup(url: string) {
            this.teardown()
            this._url = url
            this._initialLoadDone = false // Resync erst nach diesem Load wieder erlauben (Prewarm-Race)
            this.loading = true
            this.membershipReady = false
            this.error = ''
            this.messages = []
            this.messagesReversed = []
            this.unread = 0
            this.atBottom = true
            this.hasMore = true // pro Raum zurücksetzen (sonst bliebe „Anfang erreicht" beim Space-Wechsel kleben)
            this.firstPaintDone = false
            // Trennlinien-Grenze EINMAL beim Betreten festhalten (Wall-Clock des letzten
            // Quittierens, `readState`). Bewusst ein Schnappschuss: markRead() schiebt das
            // Wasserzeichen während des Lesens weiter, die „Neu"-Linie darf einem dabei
            // aber nicht unter den Augen wegrutschen.
            this._lastRead = roomWatermark(get(readState), url, this.h)
            this._controller = new AbortController()
            // Deep-Link (C6b): /rooms/{h}/thread/{nevent} öffnet den Thread als Vollansicht —
            // eine DIREKT verlinkbare/teilbare URL (Reload/Bookmark öffnen denselben Thread).
            // Der nevent (bech32) wird zur Wurzel-id dekodiert; openThread lädt Wurzel+Baum
            // per id/#E selbst. EINMAL konsumiert: Reload = neue Insel-Instanz (öffnet erneut),
            // retry() im selben Leben nicht (kein ungewolltes Wieder-Aufpoppen nach Schließen).
            if (this._deepThreadNevent) {
                const nevent = this._deepThreadNevent
                this._deepThreadNevent = null
                try {
                    const dec = nip19.decode(nevent)
                    const rootId = dec.type === 'nevent' ? dec.data.id : dec.type === 'note' ? dec.data : ''
                    if (rootId) {
                        // push=false: die URL IST bereits /rooms/{h}/thread/{nevent} (Deep-Link/Reload) —
                        // kein zusätzlicher history-Eintrag. Back räumt via replaceState auf den Raum zurück.
                        this.openThread({ id: rootId } as ChatMessage, true, false)
                    }
                } catch {
                    // Kaputter nevent im Pfad → kein Thread, kein Fehler.
                }
            }
            // Kein Virtualizer mehr (Flotilla-Ansatz): der `flex-col-reverse`-Container pinnt den
            // Boden NATIV, ältere Nachrichten voranstellen verschiebt die Leseposition nicht → kein
            // Höhen-Messen, kein Spacer, kein Anker-Rechnen, kein Ruckeln. Ältere lädt ein schlichter
            // Scroller nach, sobald man nahe an den oberen (ältesten) Rand scrollt. Pro Raum frisch;
            // in $nextTick, damit $refs.scroll gemountet ist. Teardown stoppt ihn.
            const magics = this as unknown as AlpineMagics
            magics.$nextTick(() => {
                const el = magics.$refs.scroll as HTMLElement | undefined
                if (el && this._url === url) {
                    this._scroller?.stop()
                    this._scroller = createScroller(el, () => this.loadOlder())
                }
            })
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
            // Admin-Status des aktiven Space (P1): gatet die Moderations-Einträge im
            // Nachrichten-Menü. Relay-autoritativ (SupportedMethods), pubkey-abhängig →
            // beim Login-Wechsel/Space-Wechsel neu (setup läuft dann ohnehin erneut).
            this._unsubAdmin = deriveUserIsSpaceAdmin(url).subscribe((admin: boolean) => {
                this.isAdmin = admin
            })
            // Raum-Anzeigename aus der Client-Meta (39000) reaktiv nachziehen — der
            // SSR-Header trägt bei member-only-Relays nur den Slug (Server hat keine
            // AUTH). `url` ist bereits normalisiert (activeSpace), roomsByUrl ebenso.
            this._unsubRoomMeta = roomsByUrl.subscribe(($byUrl) => {
                const room = ($byUrl.get(url) ?? []).find((r) => r.h === this.h)
                if (room?.name) {
                    this.roomName = room.name
                    // Meta-/Tab-Titel clientseitig auf den echten Raumnamen setzen: der server-
                    // gerenderte Titel fällt bei SpaceCache-Miss auf die rohe Raum-id zurück
                    // (`# <h>`); sobald die Insel den Namen aus 39000/9007 auflöst, korrigieren.
                    document.title = `# ${room.name}`
                }
            })
            listenRoom(url, this.h, this._controller.signal)
            // Bestehende Reactions/Tombstones nachladen (Live-Sub liefert nur Neues).
            // Promise fürs Prewarm-Gate behalten: der Reveal wartet (budgetiert) darauf.
            const reactionsReady = loadRoomReactions(url, this.h)
            // Selbstreparatur: gespeicherte NIP-29-9005 (Admin-Löschungen) nachladen und
            // anwenden — holt eine Löschung nach, die dieser Client offline verpasst hat
            // (der Warm-Cache hätte die Nachricht sonst wieder auferstehen lassen).
            void loadRoomDeletes(url, this.h)
            // NIP-22-Kommentare (kind 1111) nachladen, damit die Antworten-Indikatoren
            // schon beim ersten Paint stimmen (Live-Sub = nur Neues). Ohne #h (flotilla-kompat).
            void loadRoomComments(url)
            // Poll-Responses (kind 1018) fürs Tally nachladen — NICHT die Poll-Karten (1068) selbst:
            // die kommen jetzt übers gepagte roomFilter (limit:50 + loadOlder), liegen also IMMER im
            // geladenen Fenster → sofort vermessen → kein Off-screen-Estimate → kein mittiger Sprung.
            // Goals (kind 9041) ebenso: kommen übers Paging, Beiträge über loadRoomZaps (Feed-IDs) —
            // kein eigener Bulk-Load mehr nötig. pollsReady bleibt im Reveal-Gate, damit das Tally
            // einer bodennah geladenen Poll am First Paint stimmt.
            const pollsReady = loadRoomPolls(url, this.h)
            // Custom-Emoji (NIP-30) des eigenen Profils vorwärmen, solange die
            // Relay-Verbindung frisch AUTH'd ist — beim späteren Picker-Öffnen
            // würde ein one-shot-Load gegen den member-only Relay sonst hängen.
            void loadUserCustomEmojis()
            // Feed-Subscription als Factory: erst NACH dem Viewport-Prewarm abonnieren, damit
            // der erste (synchrone, leading-edge) Emit schon Reaction-/Zap-Chips trägt → First
            // Paint und scrollToBottom sind warm; es folgt keine chip-einblendende zweite Welle.
            // (Handler-Body bewusst nicht umeingerückt gehalten → minimaler Diff.)
            const startFeed = () => {
            // rAF-Coalescing: `deriveRoomMessages` ist bewusst UNgedrosselt (instant own-message),
            // beim Kaltstart streamt der Verlauf aber als Event-Burst herein → ein Emit je Nachricht.
            // Jeder Emit rebuildet die ganze Liste UND morpht das komplette `x-for` (Full-DOM, kein
            // Virtualizer) → der Main-Thread pegt und Touches feuern erst, wenn alles geladen ist.
            // Wir merken nur den LETZTEN Emit und rendern höchstens einmal pro Frame; der Browser
            // arbeitet zwischen den Frames die Touch-Queue ab. Eigene/neue Nachricht: ≤1 Frame (~16ms).
            const applyMsgs = (msgs: ChatMessage[]) => {
                // column-reverse + Full-DOM: der Container pinnt den Boden NATIV — kein manueller
                // scrollTop-Pfad, kein Anker, keine Höhenmessung. Hier nur: Daten übernehmen (inkl.
                // reversed-Sicht fürs Rendering), Profile/Zaps nachladen, Ungelesen-Zähler pflegen.
                const prevIds = new Set(this.messages.map((m) => m.id))
                const prevNewest = this.messages.length ? this.messages[this.messages.length - 1].created_at : 0
                // Stand der Nutzer (nahe) am Boden? Dann klebt column-reverse automatisch an neuen
                // Nachrichten (→ nichts ungelesen); sonst zählen wir sie. atBottom pflegt onScroll.
                const atEnd = !this.firstPaintDone || this.atBottom

                this.messages = msgs
                // Reversed fürs `flex-col-reverse`-Rendering (newest-first als Flex-Items → neweste
                // am Boden). `this.messages` bleibt aufsteigend für loadOlder/scrollToMessage.
                this.messagesReversed = msgs.slice().reverse()

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

                // Nur wirklich am Ende angehängte Fremd-Nachrichten zählen (kein loadOlder-Prepend
                // via created_at, keine eigenen) — und nur, wenn wir NICHT am Boden klebten.
                if (!atEnd) {
                    this.unread += msgs.filter(
                        (m) => !prevIds.has(m.id) && !m.mine && m.created_at >= prevNewest,
                    ).length
                }
                if (!this.firstPaintDone) {
                    // column-reverse startet nativ am Boden (scrollTop 0 = neueste) — kein Settle,
                    // kein Anker, keine Messung nötig. Reveal erst nach dem Render (nextTick), damit
                    // kein leerer Frame aufblitzt (Liste ist bis firstPaintDone opacity-0); url-Guard
                    // gegen einen stale Raum bei schnellem Wechsel.
                    ;(this as unknown as AlpineMagics).$nextTick(() => {
                        if (this._url === url) {
                            this.firstPaintDone = true
                        }
                    })
                }
            }
            this._unsub = deriveRoomChat(url, this.h, this._lastRead).subscribe((msgs: ChatMessage[]) => {
                this._pendingMsgs = msgs
                if (this._rafMsgs) {
                    return // schon ein Frame eingeplant → nur den neuesten Stand merken
                }
                this._rafMsgs = requestAnimationFrame(() => {
                    this._rafMsgs = 0
                    const pending = this._pendingMsgs
                    this._pendingMsgs = null
                    if (pending && this._url === url) {
                        applyMsgs(pending)
                    }
                })
            })
            }
            // Viewport-Prewarm (Schritt 2): Verlauf laden, dann die Zap-Receipts des geladenen
            // Fensters sofort nachziehen und den Reveal kurz halten, bis Reactions (raumweit) +
            // Zaps da sind — mit hartem Zeitbudget, damit ein langsamer/abgelehnter Relay den
            // Verlauf nie blockiert. Erst danach startFeed(): der erste Emit ist warm.
            const signal = this._controller?.signal
            const PREWARM_BUDGET_MS = 700

            // Warme Rückkehr: liegt der Raum schon im welshman-Repository (A→B→A), sofort
            // abonnieren → Instant-Paint aus dem Cache (sonst blitzt das Skeleton für die volle
            // load()-Runde, obwohl alles da ist). Chips sind dann ebenfalls warm → kein Nachwachsen.
            // Nur bei KALTEM Repository gaten wir den Reveal über den Prewarm unten.
            let warm = false
            const peek = deriveRoomMessages(url, this.h).subscribe((evs) => {
                warm = evs.length > 0
            })
            peek()
            if (warm) {
                startFeed()
                this.loading = false
            }

            // Kaltstart-Race, siehe finally: kam der Verlauf LEER vom Relay zurück?
            let netloadEmpty = false
            loadRoomMessages(url, this.h)
                .then(
                    (events) => {
                        netloadEmpty = events.length === 0
                        if (signal?.aborted) {
                            return // Raumwechsel während Prewarm → keine verwaisten Loads/State-Bleed
                        }
                        // Zap-Receipts der noch nicht angeforderten IDs laden (statt erst im
                        // Emit-Handler). Filter über _zapLoadedIds: der warme Pfad hat via
                        // startFeed-Handler evtl. schon geladen+markiert → kein Doppel-Load.
                        const ids = events.map((e) => e.id)
                        // Roh geladene IDs merken → loadOlder-Terminierung (hasMore) vergleicht
                        // gegen die tatsächlich GELADENEN kind-9, nicht gegen die gefilterte Anzeige.
                        ids.forEach((id) => this._loadedMsgIds.add(id))
                        const newIds = ids.filter((id) => !this._zapLoadedIds.has(id))
                        newIds.forEach((id) => this._zapLoadedIds.add(id))
                        const zapsReady = loadRoomZaps(url, newIds).catch(() => [])
                        const authors = [...new Set(events.map((e) => e.pubkey))]
                        // Zapper der Autoren früh (fire-and-forget) anwärmen, damit der ⚡-Chip so
                        // früh wie möglich erscheint. BEWUSST NICHT im Reveal-Gate: welshmans
                        // fetchZapper hat ein fixes 800ms-Batch-Fenster (> Budget) nach einem
                        // loadProfile-Roundtrip → wäre nie rechtzeitig warm und würde den Reveal nur
                        // ans Zeitlimit pinnen statt bei Reactions+Zaps (~200-400ms) früh zu gewinnen.
                        warmZappers(authors)
                        // Profile (Name/Avatar) INS Gate (Schritt 4): anders als Zapper/NIP-05 ist der
                        // Server-Cache (GET /nostr/profiles, ProfileCache.php) schnell → Name+Avatar sind
                        // am First Paint warm, kein npub→Name-Flash und kein Breiten-Ruck (Badge/Uhrzeit).
                        // Budget-gekappt; warmProfiles rejectet nie (seedChunk fängt intern).
                        const profilesReady = warmProfiles(authors)
                        return Promise.race([
                            Promise.all([
                                reactionsReady.catch(() => []),
                                zapsReady,
                                profilesReady,
                                pollsReady.catch(() => []),
                            ]),
                            new Promise((resolve) => setTimeout(resolve, PREWARM_BUDGET_MS)),
                        ])
                    },
                    () => {
                        // welshman load() rejected NICHT bei totem/AUTH-ablehnendem Relay (es
                        // resolved leer) → dieser Zweig ist defensiv/selten. Guard trotzdem, damit
                        // ein spät rejectetes altes Room seinen Fehler nicht aufs neue Room klebt.
                        if (signal?.aborted) {
                            return
                        }
                        this.error = 'Der Verlauf konnte nicht geladen werden — Relay nicht erreichbar?'
                    },
                )
                .finally(() => {
                    if (signal?.aborted) {
                        return // Raum inzwischen gewechselt → weder abonnieren noch loading kippen
                    }
                    if (!warm) {
                        startFeed() // kalt: erst nach dem Prewarm → warmer First Paint
                    }
                    this.loading = false
                    this._initialLoadDone = true // ab jetzt darf ein Foreground-Resync greifen
                    // Kaltstart-Race: Ein Notification-Tap lädt die Seite NEU (MainActivity →
                    // webView.loadUrl), während Socket UND NIP-42-AUTH nach langer Pause tot sind.
                    // welshmans load() rejected dabei NICHT (siehe error-Zweig oben) — es resolved
                    // LEER. Ohne Gegenwehr bliebe der Verlauf für immer auf dem Cache-Stand und die
                    // Live-Sub (auf demselben toten Socket gesendet) stumm, bis der Raum neu betreten
                    // wird. Der visibilitychange-Resync greift hier NICHT: diese Insel wurde erst
                    // NACH dem Foreground geboren und sieht nie ein `hidden` (am Emulator gemessen).
                    // Ein leerer Netz-Load bei GEFÜLLTEM Cache ist der Widerspruch, der den Race
                    // verrät: das Relay muss mindestens die Nachrichten haben, die wir schon kennen.
                    // Ein wirklich leerer Raum hat auch keinen Cache → kein Fehlalarm.
                    // ponytail: EIN resync() (sendet die Live-Subs neu + holt nach und bringt seinen
                    // eigenen 2,5s-Nachzügler gegen den Socket-Race mit); kein Reconnect-Framework.
                    if (netloadEmpty && this.messages.length > 0) {
                        this.resync()
                    }
                })
        },
        // Ältere Nachrichten vor der aktuell ältesten laden; Scroll-Position halten.
        loadOlder() {
            // hasMore-Guard MUSS hier sitzen: der rAF-Scroller (createScroller) ruft loadOlder
            // ungebremst, sobald man nahe am ältesten Rand steht. Ohne den Guard würde er nach
            // erschöpfter History die Grenzseite endlos (~alle 300ms) neu vom Relay holen —
            // früher gaten das die entfernten Aufrufer (maybePrefetch/„Ältere laden"-Button).
            if (this.loadingMore || !this.hasMore || !this._url || this.messages.length === 0) {
                return
            }
            this.loadingMore = true
            const oldest = this.messages[0].created_at
            // KEINE eigene Scroll-Mathematik mehr (Schritt 5): der deriveRoomChat-Emit-Handler
            // kompensiert den Prepend anker-basiert (die erste sichtbare Nachricht bleibt an ihrem
            // Viewport-Offset) — EIN Owner für scrollTop, kein Race mit dem Handler, und
            // position-agnostisch, sodass Schritt 6 beliebig früh/off-screen prefetchen kann.
            // loadOlder triggert nur noch den Load; der Handler feuert ohnehin bei jedem Emit.
            loadRoomMessages(this._url, this.h, oldest)
                .then((events) => {
                    // Terminierung gegen die ROH geladenen IDs (welshmans `until` ist inklusiv +
                    // frischer Tracker pro Load → die Grenzseite kommt immer zurück; `length===0`
                    // wäre unerreichbar). Kein STRIKT neues kind-9 = Anfang erreicht. Roh-Vergleich,
                    // weil `this.messages` Poll-Share-Quotes wegfiltert → sonst nie hasMore=false.
                    const gotNew = events.some((e) => !this._loadedMsgIds.has(e.id))
                    events.forEach((e) => this._loadedMsgIds.add(e.id))
                    if (!gotNew) {
                        this.hasMore = false
                    }
                })
                .finally(() => {
                    this.loadingMore = false
                })
        },
        onScroll() {
            const el = (this as unknown as AlpineMagics).$refs.scroll as HTMLElement | undefined
            if (!el) {
                return
            }
            // column-reverse: Boden = scrollTop ≈ 0 (Vorzeichen browserabhängig → Math.abs).
            const offset = Math.abs(el.scrollTop)
            this.atBottom = offset < 60
            if (this.atBottom) {
                this.unread = 0
                this.markRead()
            }
            // WebView-Fallback fürs Nachladen: der rAF-Scroller (createScroller) läuft im Android-
            // WebView beim ersten Raum-Mount nicht immer an (rAF-Drosselung rund um wire:navigate +
            // hinter storageReady verzögertes setup()) → ältere Nachrichten würden bis zum Raum-
            // Neubetreten nie geladen. Das native Scroll-Event feuert dagegen zuverlässig (sonst
            // gäbe es den atBottom-abhängigen Scroll-Button nicht), also hier ebenfalls nahe am
            // ältesten (oberen) Rand nachladen. loadOlder ist per loadingMore/hasMore geguardet
            // (kein Doppel-Load), die Prepend-Anker-Kompensation macht der deriveRoomChat-Handler.
            if (offset + el.clientHeight + 1500 > el.scrollHeight) {
                this.loadOlder()
            }
        },
        // „Zum Ende"-Button + Composer-Fokus: column-reverse → top:0 ist der Boden (neueste).
        scrollToBottom() {
            const el = (this as unknown as AlpineMagics).$refs.scroll as HTMLElement | undefined
            el?.scrollTo({ top: 0, behavior: 'smooth' })
            this.atBottom = true
            this.unread = 0
            this.firstPaintDone = true
            this.markRead()
        },
        // Zur zitierten Original-Nachricht springen + kurz hervorheben. Full-DOM: der Knoten
        // #msg-{id} existiert, sobald die Nachricht geladen ist → scrollIntoView; sonst (älter als
        // der Verlauf) passiert nichts — kein Nachladen (Scope).
        scrollToMessage(id: string) {
            const node = document.getElementById('msg-' + id)
            if (!node) {
                return
            }
            node.scrollIntoView({ block: 'center' })
            this.flashId = id
            // ponytail: schlichter Timeout-Highlight statt Animation-Lib
            setTimeout(() => {
                if (this.flashId === id) {
                    this.flashId = null
                }
            }, 1400)
        },
        // Link aus dem Nachrichtentext öffnen. In der nativen App über den In-App-Browser
        // (Custom Tab / SFSafariViewController) — ein `target=_blank`-Anker verpufft in der
        // WebView WIRKUNGSLOS, genau darum waren Chat-Links auf dem Gerät „nicht klickbar"
        // (im Web hat immer alles funktioniert). Gleiche Behandlung wie der Vereins-Beitritts-
        // Link (nostrVereinGate.openExternal). Im Web kein preventDefault → normaler Anker.
        openChatLink(url: string, e: Event) {
            if (isMobile) {
                e.preventDefault()
                void nativeBrowserInApp(url)
            }
        },
        // Composer-Textarea mit dem Inhalt wachsen lassen (bis ~9rem), dann scrollt sie.
        autoGrow(el: HTMLTextAreaElement) {
            el.style.height = 'auto'
            el.style.height = Math.min(el.scrollHeight, 144) + 'px'
        },
        /**
         * Raum bis hierher gesehen quittieren — mit der **Wall-Clock dieses Geräts**,
         * nicht mit dem `created_at` der jüngsten Nachricht.
         *
         * `created_at` ist autorgesetzt (NIP-01): eine einzige Nachricht mit
         * `created_at = jetzt + 1 Jahr` quittierte vorher alles bis 2027 als gelesen,
         * und das Wasserzeichen ist der einzige Zustand, der die Navigation überlebt.
         * `setRead` schreibt monoton (`Math.max`) → eine rückwärts laufende Uhr kann
         * einen gelesenen Raum nie wieder auf ungelesen ziehen.
         *
         * Die Aufrufer sind alle am Boden geguardet (onScroll nur bei `atBottom`,
         * scrollToBottom setzt es selbst, destroy() prüft es) — „Raum betreten" allein
         * quittiert NICHT. Die frühere Bedingung `messages.length === 0` entfällt: mit
         * Wall-Clock ist „ich habe hingesehen, da war nichts" eine gültige Aussage.
         */
        markRead() {
            if (!this._url) {
                return
            }
            setRead(roomKey(this._url, this.h))
        },
        teardown() {
            this._controller?.abort()
            this._unsub?.()
            this._unsub = null
            if (this._rafMsgs) {
                cancelAnimationFrame(this._rafMsgs) // koaleszierten Render nicht in einen abgebauten/gewechselten Raum feuern
                this._rafMsgs = 0
            }
            this._pendingMsgs = null
            this._unsubJoined?.()
            this._unsubJoined = null
            this._unsubMembers?.()
            this._unsubMembers = null
            this._unsubAdmin?.()
            this._unsubAdmin = null
            this._unsubRoomMeta?.()
            this._unsubRoomMeta = null
            this._zapSub?.abort()
            this._zapSub = null
            this._zapLoadedIds.clear()
            evictChatMsgCache(this._loadedMsgIds) // Memo-Cache des verlassenen Raums freigeben (vor clear)
            this._loadedMsgIds.clear()
            this._scroller?.stop()
            this._scroller = null
            this.closeMentions()
            this.cancelCrop() // offenen Cropper + Object-URL freigeben (Raumwechsel)
            this.closeThread() // offenes Thread-Overlay + Live-Sub abbauen (Raumwechsel)
        },
        // App-Foreground-Resync (aus dem visibilitychange-Listener in init()): NUR die Live-
        // Subscriptions auf einem frischen AbortController neu senden + je EIN Catch-up-Load —
        // KEIN teardown, kein Zurücksetzen von messages/scroll/firstPaintDone. Der bestehende
        // deriveRoomChat-`_unsub` (reine Store-Subscription, im Hintergrund nie gestorben) malt
        // die nachgeladenen Events additiv → keine Bewegung/kein Rerender der Seite. Guard auf
        // `_unsub`: läuft erst NACH abgeschlossenem setup() (sonst würde das Abort den initialen
        // load()-Pfad kappen, bevor startFeed() lief). loading==true ⇒ setup arbeitet noch → skip.
        resync() {
            // Guard auf _initialLoadDone (NICHT bloß loading/_unsub): der warme setup()-Pfad setzt
            // loading=false + _unsub schon, während der initiale loadRoomMessages().then noch läuft;
            // ein Resync in diesem Fenster würde dessen Controller abbrechen → _loadedMsgIds bliebe
            // leer (kaputte Pagination-Terminierung). _initialLoadDone kippt erst im setup-finally.
            if (!this._url || this._destroyed || !this._initialLoadDone) {
                return
            }
            const url = this._url
            this._controller?.abort()
            this._controller = new AbortController()
            const signal = this._controller.signal
            // Live-Subs neu senden (der erste REQ-Send öffnet den Socket via socketPolicyConnectOnSend
            // wieder) …
            listenRoom(url, this.h, signal)
            listenRoomMembers(url, signal)
            watchSpaceDirectory(url, signal)
            // … + einmal nachladen, was im Hintergrund verpasst wurde. loadSpaceRooms backfillt die
            // 39002/39000 (Mitgliedschaft → joined/Composer, Raumname); listenRoomMembers ist limit:0
            // (nur Neues) und deckt das NICHT ab.
            void loadSpaceRooms(url)
            void loadRoomMessages(url, this.h)
            void loadRoomReactions(url, this.h)
            // Verpasste Admin-Löschungen (9005) nachholen — während der Client
            // im Hintergrund/getrennt war, kam kein Live-Broadcast an.
            void loadRoomDeletes(url, this.h)
            void loadRoomComments(url)
            void loadRoomPolls(url, this.h)
            // Zap-Receipts (kind 9735) haben KEINE Live-Sub (kein #h, nicht im listenRoom-Filter) und
            // werden sonst nur je NEUER Nachricht geladen → im Hintergrund auf SCHON geladene
            // Nachrichten eingetroffene Fremd-Zaps blieben stale. Fürs sichtbare Fenster nachladen.
            if (this.messages.length > 0) {
                void loadRoomZaps(url, this.messages.map((m) => m.id))
            }
            // Offenen Thread ebenso neu verdrahten (eigener Controller + Live-Sub, eigener _unsub)
            // inkl. Zap-Nachladen der Kommentare.
            if (this.threadRootId) {
                const rootId = this.threadRootId
                this._threadController?.abort()
                this._threadController = new AbortController()
                void loadThread(url, rootId)
                listenThread(url, rootId, this._threadController.signal)
                if (this.threadComments.length > 0) {
                    void loadRoomZaps(url, this.threadComments.map((c) => c.id))
                }
            }
            // WebView-Race: liefert der OS-Socket-Close erst NACH diesem Tick, sterben die obigen
            // One-shot-Loads leer (welshman autoClose bei Disconnect). Ein einmaliger Nachzügler holt
            // sie, sobald der Socket via connectOnSend/closeInactive wieder steht.
            // ponytail: EINE feste Nachzügler-Runde deckt den Race; kein Reconnect-Backoff-Framework.
            setTimeout(() => {
                if (this._destroyed || this._url !== url || document.visibilityState !== 'visible') {
                    return
                }
                void loadRoomMessages(url, this.h)
                void loadRoomReactions(url, this.h)
                void loadRoomDeletes(url, this.h)
                if (this.messages.length > 0) {
                    void loadRoomZaps(url, this.messages.map((m) => m.id))
                }
            }, 2500)
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
                // Ist ein Thread offen, gehört der Fokus dem Thread-Composer (der Cropper
                // kann aus beiden Composern geöffnet werden) — sonst dem Haupt-Composer.
                const c = (this.threadRootId ? magics.$refs.threadComposer : magics.$refs.composer) as HTMLElement | undefined
                if (c) {
                    c.focus()
                    c.style.height = 'auto'
                }
            })
        },
        // Interaktions-Menü öffnen (native App: Vollbild-Modal). Merkt die
        // Zielnachricht; die Einträge (Antworten … Reaktion/Löschen/Fork off! folgen
        // mit C1+) lesen `menuFor`. Web nutzt stattdessen das Zeilen-Popover.
        openMessageMenu(m: ChatMessage, inThread = false) {
            this.activeId = null
            this.menuFor = m
            this._menuInThread = inThread // gatet die Raum-only-Einträge im Mobile-Modal (Thread-Kommentar)
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
        // ── C6b: Thread-Ansicht (NIP-22 kind 1111 COMMENT) ─────────────────────
        // Öffnet das In-Room-Overlay zu EINER Nachricht: sie selbst ist die Thread-Wurzel
        // (Slack-Modell — jede Nachricht ist thread-fähig, nicht nur Quote-Only). Zeigt die
        // Wurzel + den verschachtelten Kommentar-Baum + Composer. Live-Sub hält ihn aktuell.
        // P2: Teilbarer Deep-Link zum Thread einer Nachricht (/rooms/{h}/thread/{nevent}).
        // Die Antworten-Pille öffnet den Thread WARM in der Insel (kein wire:navigate-Reboot) und
        // spiegelt die URL nur KOSMETISCH per replaceState (`syncUrl`) → teilbar, aber instant statt
        // kaltem Neu-Boot der ganzen Chat-Insel. Deep-Link/setup rufen mit syncUrl=false (URL steht
        // schon). Bech32 ohne `nostr:`-Präfix für den Routen-Param.
        threadHref(m: ChatMessage): string {
            return `/rooms/${encodeURIComponent(this.h)}/thread/${neventFor(m, this._url).replace(/^nostr:/, '')}`
        },
        openThread(m: ChatMessage, full = true, syncUrl = true) {
            this.activeId = null
            this.closeMessageMenu()
            const rootId = m.id
            if (!rootId || !this._url) {
                return
            }
            this.closeThread() // evtl. noch offenen Thread sauber abbauen (Wechsel)
            // Frischer Thread → eigener, leerer Anhang. Der Haupt-Composer-Anhang bleibt
            // unangetastet (getrennter State), damit ein Thread-Öffnen zum Lesen keinen
            // im Haupt-Composer wartenden Entwurf/Anhang verwirft.
            this.threadAttachment = null
            const url = this._url
            this.threadFull = full // Thread ist stets die volle, raum-erbende Vollansicht (eine Präsentation)
            this.threadRootId = rootId
            // URL nur KOSMETISCH spiegeln (teilbarer Deep-Link in der Adressleiste), OHNE einen eigenen
            // history-Eintrag zu pushen: `replaceState` mit UNVERÄNDERTEM `window.history.state`, nur die
            // URL wechselt. Kein pushState — denn ein Zurück landete sonst auf dem RAUM-Eintrag, den Livewire
            // per `wire:navigate` mit echtem State+Snapshot besitzt → `document.body.replaceWith` +
            // `Alpine.destroyTree` = kalter Insel-Reboot beim SCHLIESSEN (genau das, was hier weg soll).
            // Livewires State bleibt unangetastet → seine History-Integrität ist intakt; beim Schließen
            // (backFromThread) wird die gemerkte Raum-URL per replaceState wiederhergestellt. Deep-Link/
            // setup: syncUrl=false (die Adressleiste zeigt die Thread-URL bereits).
            if (syncUrl) {
                try {
                    this._threadPrevUrl = window.location.pathname + window.location.search
                    window.history.replaceState(window.history.state, '', this.threadHref(m))
                } catch {
                    /* threadHref/neventFor scheiterte (unvollständige Nachricht) → ohne URL-Sync öffnen */
                    this._threadPrevUrl = null
                }
            }
            this._threadController = new AbortController()
            // Root (per id) + bestehende Kommentare nachladen; die Live-Sub liefert nur Neues.
            void loadThread(url, rootId)
            listenThread(url, rootId, this._threadController.signal)
            this._threadUnsub = deriveThread(url, rootId, this.h).subscribe((v) => {
                // Vor dem Update messen: stand der Nutzer (nahe) am Boden — oder ist der
                // Container noch nicht gerendert (frisch geöffnet)? Dann nach dem Render ans
                // Ende scrollen, damit der Thread bei der LETZTEN Antwort startet (analog
                // wasAtBottom des Haupt-Chats). Wer bewusst hochgescrollt hat, bleibt oben.
                const magics = this as unknown as AlpineMagics
                const el = magics.$refs.threadScroll
                const stick = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80
                this.threadRoot = v.root
                this.threadComments = v.comments
                this.threadCount = v.count
                // Zap-Receipts (9735, tragen kein #h) der Kommentare per #e nachladen (je ID einmal,
                // teilt _zapLoadedIds mit dem Raum-Feed) → die ⚡-Chips der Kommentare stimmen.
                const newZapIds = v.comments.map((c) => c.id).filter((id) => !this._zapLoadedIds.has(id))
                if (newZapIds.length > 0) {
                    newZapIds.forEach((id) => this._zapLoadedIds.add(id))
                    void loadRoomZaps(url, newZapIds)
                }
                if (stick) {
                    magics.$nextTick(() => {
                        const s = magics.$refs.threadScroll
                        if (s) {
                            s.scrollTop = s.scrollHeight
                        }
                    })
                    // „Thread offen UND am Boden" ist hier eine Tatsache, keine Vermutung:
                    // `stick` heißt entweder „stand schon unten" oder „Container ist frisch
                    // und wird gleich ans Ende gescrollt" — in beiden Fällen sieht der Nutzer
                    // die jüngste Antwort. Wer bewusst hochgescrollt hat, fällt aus `stick`
                    // heraus und quittiert NICHT (gleiche Regel wie der Raum).
                    //
                    // Thread-Wasserzeichen sind vom Raum-Wasserzeichen ENTKOPPELT: unsere
                    // kind-1111-Kommentare erscheinen nicht im Raum-Feed (eigener, `#h`-loser
                    // Filter), Raum-Lesen kann sie also nicht mitquittieren (NIP-22).
                    setRead(threadKey(rootId))
                }
            })
        },
        closeThread() {
            this._threadController?.abort()
            this._threadController = null
            this._threadUnsub?.()
            this._threadUnsub = null
            this.threadRootId = null
            this.threadRoot = null
            this.threadComments = []
            this.threadCount = 0
            this.threadReplyTo = null
            this.threadDraft = ''
            this.threadFull = false
            this._threadPrevUrl = null
            // War ein Crop AUS dem Thread offen, aufräumen; sonst den Haupt-Cropper NICHT
            // anfassen (der lebt über einem geschlossenen Thread eigenständig weiter).
            if (this._cropForThread) {
                this.cancelCrop()
            }
            this.threadAttachment = null // wartenden Thread-Anhang verwerfen (Haupt bleibt)
        },
        // „Zurück" aus dem Thread (Kopf-Pfeil). Rein WARM: der Thread ist nur ein Ansichts-Wechsel
        // innerhalb derselben Insel (kein Overlay-Abbau, kein Reboot). Nur die Adressleiste wird
        // per replaceState zurückgesetzt — auf die vor dem Öffnen gemerkte Raum-URL, sonst die Raum-
        // Basis (Deep-Link). `window.history.state` bleibt unverändert (der echte Livewire-State des
        // Raum-Eintrags) → Livewires History-Integrität ist intakt, kein Snapshot-Restore/Reboot.
        // „Zurück" aus dem RAUM (Kopf-Pfeil, wenn kein Thread offen ist). Führt dorthin,
        // wo der Nutzer war — samt Filterzustand, der jetzt in der URL steht (rt/q/cc) —
        // statt stur auf die Raumliste zu springen.
        //
        // Warum nicht einfach immer `history.back()`: beim Deep-Link-Kaltstart
        // (Notification-Tap, geteilter Link) gibt es keinen eigenen Vorgänger; back()
        // führte dann aus der App heraus. Warum nicht immer `Livewire.navigate`: das war
        // das bisherige Verhalten und verwarf jeden Filter und jede Scroll-Position.
        //
        // Der Thread hat seinen EIGENEN Weg (backFromThread) und darf hier nie landen:
        // er pusht bewusst keinen History-Eintrag, ein back() spränge also am Raum vorbei
        // direkt in die Übersicht. Gemessen (Playwright, 2026-07-22): aus dem offenen
        // Thread führte history.back() auf /spaces statt auf /rooms/<h>. Die Verzweigung
        // in `⚡room.blade.php` ($backExpr) ist deshalb nicht optional.
        backFromRoom(upTarget: string) {
            if (hasInternalHistory()) {
                window.history.back()
                return
            }
            ;(window as unknown as { Livewire: { navigate(u: string): void } }).Livewire.navigate(upTarget)
        },
        backFromThread() {
            const prevUrl = this._threadPrevUrl
            this.closeThread() // setzt _threadPrevUrl zurück
            try {
                const target = prevUrl ?? '/rooms/' + encodeURIComponent(this.h)
                if (window.location.pathname + window.location.search !== target) {
                    window.history.replaceState(window.history.state, '', target)
                }
            } catch {
                /* history-API nicht verfügbar → Adressleiste bleibt, Thread ist trotzdem zu */
            }
        },
        // Auf einen bestehenden Kommentar antworten (verschachtelt): das nächste
        // Absenden hängt den Kommentar unter `c` statt unter den Root.
        setThreadReply(c: ChatMessage) {
            this.threadReplyTo = { id: c.id, name: c.name }
            ;(this as unknown as AlpineMagics).$nextTick(() =>
                (this as unknown as { $refs: Record<string, HTMLElement> }).$refs.threadComposer?.focus(),
            )
        },
        clearThreadReply() {
            this.threadReplyTo = null
        },
        // Kommentar publizieren (kind 1111). Ziel = Eltern-Kommentar (verschachtelt)
        // oder der Thread-Root. OPTIMISTISCH & nicht-blockierend (Slack-artig): der
        // Composer wird sofort geleert (der Kommentar liegt via publishThunk schon im
        // Repository → erscheint via deriveThread), der Relay-OK wird NICHT abgewartet.
        // Das sofortige Leeren verhindert auch Doppel-Senden (ein zweiter Enter trifft
        // auf leeren Draft). Fehler landen im Hintergrund als Toast (feeds rollt zurück).
        async sendComment() {
            if (!this._url || !this.threadRootId) {
                return
            }
            const content = this.threadDraft.trim()
            if (!content && !this.threadAttachment) {
                return
            }
            const root = repository.getEvent(this.threadRootId)
            let target = repository.getEvent(this.threadReplyTo?.id ?? this.threadRootId)
            if (!target) {
                toast('Bezugs-Nachricht noch nicht geladen — kurz warten.')
                return
            }
            // Antwort auf ein FREMDES Lotus-kind-10 (P4, Interop): das trägt nur lowercase
            // NIP-29-Marker (kein uppercase E/K/P), also würde welshmans tagEventForComment
            // unseren Kommentar fälschlich AUF das kind-10 rooten (E=kind10) → er fiele aus dem
            // `#E`-Thread-Feed + Root-Guard → unsichtbar. Stattdessen auf die echte kind-9-Wurzel
            // rooten (welshman self-rootet kind-9 korrekt, wie beim Top-Level-Reply). Der explizite
            // Parent-Link zum kind-10 entfällt — im flachen Slack-Modell (P3) kosmetisch.
            // ponytail: volle NIP-29→NIP-22-Parent-Übersetzung wäre mehr Code; bei Bedarf nachrüsten.
            if (target.kind === 10 && root) {
                target = root
            }
            // NIP-29-Scoping (Interop, P1): das `h` des Thread-ROOTS (kind 9) mitgeben, damit
            // Lotus/#h-scopende Relays den Kommentar sehen. Vom Root, NICHT vom target — ein
            // verschachtelter Reply-target ist ein h-loses kind-1111. Fehlt der Root (Race),
            // bleibt rootH undefined → kein leeres `["h",""]` (makeComment lässt h dann weg).
            const rootH = root ? getTagValue('h', root.tags) : undefined
            const url = this._url
            // Rohe (NICHT-reaktive) Kopie des Anhangs fürs Event — `imetaTag` ist sonst ein
            // Alpine-Proxy und bricht beim Signieren (DataCloneError), siehe C6a-Message-Send.
            const prevAttachment = this.threadAttachment
            const rawAttachment = prevAttachment
                ? { url: prevAttachment.url, imetaTag: [...prevAttachment.imetaTag] }
                : undefined
            this.threadDraft = ''
            this.threadReplyTo = null
            this.threadAttachment = null
            const err = await sendComment(url, target, content, rawAttachment, rootH)
            if (err) {
                toast(err)
            }
        },
        // ── C4: @-Mention-Autocomplete (NIP-08/NIP-27) ─────────────────────────
        // Bei jeder Composer-Eingabe: steht direkt vor dem Cursor ein `@wort`
        // (am Zeilen-/Wortanfang), Mitglieder-Vorschläge einblenden. `search` ist
        // `name npub` kleingeschrieben (Directory), Query case-insensitiv.
        onComposerInput(el: HTMLTextAreaElement, target: 'main' | 'thread' = 'main') {
            this._mentionTarget = target // merkt, welchen Draft pickMention später splicen muss
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
            const isThread = this._mentionTarget === 'thread'
            const draft = isThread ? this.threadDraft : this.draft
            const insert = `nostr:${item.npub} `
            const before = draft.slice(0, this._mentionStart)
            const after = draft.slice(this._mentionStart + 1 + this.mentionQuery.length)
            if (isThread) {
                this.threadDraft = before + insert + after
            } else {
                this.draft = before + insert + after
            }
            this.closeMentions()
            const magics = this as unknown as AlpineMagics
            magics.$nextTick(() => {
                const c = (isThread ? magics.$refs.threadComposer : magics.$refs.composer) as HTMLTextAreaElement | undefined
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
            // Zitieren (Quote-Only) ODER ein Bild-Anhang (C6a) darf ohne Kommentar gesendet
            // werden; eine reine Text-Nachricht/Reply nicht.
            if (!content && !this.sharing && !this.attachment) {
                return
            }
            this.sending = true
            this.sendError = ''
            const draft = this.draft
            const prevReply = this.replyTo
            const prevSharing = this.sharing
            const prevAttachment = this.attachment
            // Rohe (NICHT-reaktive) Kopie fürs Event: `this.attachment.imetaTag` ist ein
            // Alpine-Proxy-Array; landete es in den Event-Tags, scheiterte welshmans
            // Event-Klon (structuredClone/postMessage) an „Proxy could not be cloned".
            const rawAttachment = prevAttachment
                ? { url: prevAttachment.url, imetaTag: [...prevAttachment.imetaTag] }
                : undefined
            const reply = prevReply ? { id: prevReply.id, pubkey: prevReply.pubkey } : undefined
            this.draft = ''
            this.replyTo = null
            this.sharing = false
            this.attachment = null
            try {
                const err = await sendRoomMessage(this._url, this.h, content, reply, rawAttachment)
                if (err) {
                    // Fehlgeschlagen: Text + Zitat + Anhang zurück, aktionable Hinweiszeile am
                    // Composer (kein Toast — der verpufft und wäre neben der Zeile doppelt).
                    this.sendError = err
                    this.draft = draft
                    this.replyTo = prevReply
                    this.sharing = prevSharing
                    this.attachment = prevAttachment
                } else {
                    this.scrollToBottom()
                    this.refocusComposer()
                }
            } finally {
                this.sending = false
            }
        },
        // ── C6a: Bild-Anhang (Cropper + Blossom) ─────────────────────────────────
        // Bild-Datei (aus dem +-Menü-Picker ODER Copy&Paste) → Object-URL fürs Crop-
        // Overlay, cropperjs LAZY laden (nur wenn wirklich ein Bild angehängt wird —
        // kein Bundle-Ballast) samt eigenem CSS (co-lokalisiert im Lazy-Chunk → lädt
        // garantiert mit) und auf dem Overlay-<img> initialisieren.
        _openCropper(file: File) {
            if (!file.type.startsWith('image/')) {
                return
            }
            this.cancelCrop() // evtl. offenen Cropper + alte Object-URL freigeben (Re-Pick)
            // Ziel-Composer JETZT erfassen (nicht erst beim Bestätigen): so landet das Bild
            // deterministisch dort, wo der Cropper geöffnet wurde — auch wenn sich der aktive
            // Composer während des Uploads änderte. Thread offen → Thread-Anhang, sonst Haupt.
            this._cropForThread = Boolean(this.threadRootId)
            // `_cropSrc` steuert das Crop-Overlay (x-show) direkt — kein flux:modal, dessen
            // Transition den Cropper mit 0px-Container initialisieren könnte.
            const src = URL.createObjectURL(file)
            this._cropSrc = src
            this.cropRatio = NaN
            const magics = this as unknown as AlpineMagics
            magics.$nextTick(async () => {
                const [{ default: Cropper }] = await Promise.all([import('cropperjs'), import('cropperjs/dist/cropper.css')])
                // Abgebrochen, während der Lazy-Chunk lud (cancelCrop nullte `_cropSrc`)?
                // Dann KEINEN Zombie-Cropper auf dem versteckten <img> bauen.
                const img = magics.$refs.cropImg as HTMLImageElement | undefined
                if (this._cropSrc !== src || !img) {
                    return
                }
                cropperInstance?.destroy()
                cropperInstance = new Cropper(img, { viewMode: 1, autoCropArea: 1, background: false }) as unknown as CropperLike
            })
        },
        // Datei-Picker (+-Menü): Wert danach leeren, damit dieselbe Datei erneut wählbar bleibt.
        pickImage(input: HTMLInputElement) {
            const file = input.files?.[0]
            input.value = ''
            if (file) {
                this._openCropper(file)
            }
        },
        // Copy&Paste ins Eingabefeld: ein reines Bild (Screenshot) öffnet den Cropper.
        // Text hat Vorrang — Tabellenzellen (Excel/Sheets/Calc) legen Text UND ein
        // gerendertes Bild ab; dann NICHT kapern, sondern den normalen Text-Paste
        // durchlassen (kein preventDefault). Kein Bild → ebenfalls durchlassen.
        pasteImage(e: ClipboardEvent) {
            const items = Array.from(e.clipboardData?.items ?? [])
            if (items.some((i) => i.kind === 'string' && i.type === 'text/plain')) {
                return
            }
            const item = items.find((i) => i.type.startsWith('image/'))
            const file = item?.getAsFile()
            if (file) {
                e.preventDefault()
                this._openCropper(file)
            }
        },
        setCropRatio(r: number) {
            this.cropRatio = r
            cropperInstance?.setAspectRatio(r)
        },
        rotateCrop() {
            cropperInstance?.rotate(90)
        },
        // Horizontal spiegeln: aktuelles scaleX umkehren (getData liest den Ist-Zustand).
        flipCrop() {
            if (cropperInstance) {
                cropperInstance.scaleX(cropperInstance.getData().scaleX >= 0 ? -1 : 1)
            }
        },
        // Zuschnitt bestätigen: Canvas (max. 2048px) → WebP-Blob (q=0.85, ersetzt die
        // separate Kompression) → Blossom-Upload. Ergebnis wird zum wartenden Anhang;
        // Fehler bleibt im Overlay (Toast), damit der Nutzer neu zuschneiden/abbrechen kann.
        async confirmCrop() {
            if (!cropperInstance || this.uploadingImage) {
                return
            }
            this.uploadingImage = true
            try {
                const canvas = cropperInstance.getCroppedCanvas({ maxWidth: 2048, maxHeight: 2048 })
                const blob = canvas && (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85)))
                if (!blob) {
                    throw new Error('Bild konnte nicht verarbeitet werden.')
                }
                const up = await uploadAttachment(blob, `${canvas.width}x${canvas.height}`)
                // In den beim Öffnen erfassten Ziel-Composer schreiben (kein Übersprechen).
                if (this._cropForThread) {
                    this.threadAttachment = up
                } else {
                    this.attachment = up
                }
                this.cancelCrop()
                this.refocusComposer()
            } catch (e) {
                toast(String((e as Error)?.message ?? e))
            } finally {
                this.uploadingImage = false
            }
        },
        // Crop abbrechen/schließen: Cropper zerstören, Object-URL freigeben, Overlay zu
        // (das Nullen von `_cropSrc` blendet es via x-show aus).
        cancelCrop() {
            cropperInstance?.destroy()
            cropperInstance = null
            if (this._cropSrc) {
                URL.revokeObjectURL(this._cropSrc)
                this._cropSrc = null
            }
        },
        removeAttachment() {
            this.attachment = null
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
        // ── P1: Admin-Moderation (NIP-86) ──────────────────────────────────────
        // Fremde Nachricht entfernen (banevent): Ziel merken, Bestätigung öffnen.
        // Nur für Admins erreichbar (isAdmin gatet die Menü-Einträge).
        askAdminDelete(m: ChatMessage) {
            this.activeId = null
            this.pendingAdminDelete = m
            dispatchModal('admin-delete-message')
        },
        // Bestätigt: banevent publizieren; bei Erfolg lokal aus dem Repository nehmen
        // (der abgeleitete Feed re-emittiert dann ohne die Nachricht, wie beim Retract
        // eines fehlgeschlagenen Publish). Bei Fehler bleibt die Nachricht sichtbar.
        async confirmAdminDelete() {
            const m = this.pendingAdminDelete
            if (!m || !this._url || this.moderating) {
                return
            }
            this.moderating = true
            try {
                // Live-Propagierung zuerst: NIP-29 9005 (delete-event) ans Space-Relay —
                // andere offene Clients (listenRoom→honorDeleteEvent) lassen die Nachricht
                // sofort verschwinden. Danach der NIP-86-banEvent für die relay-seitige
                // Bann-Liste (verhindert Re-Publish). banEvent-Fehler entscheidet über den
                // Toast; das 9005 ist best-effort für die Live-Sync und blockiert den Erfolg
                // nicht (der Autor bleibt ohnehin lokal + relay-seitig via banEvent entfernt).
                void moderateDeleteMessage(this._url, this.h, m.id)
                const err = await banEvent(this._url, m.id)
                if (err) {
                    toast(err)
                } else {
                    repository.removeEvent(m.id)
                    dispatchModal('admin-delete-message', false)
                    this.pendingAdminDelete = null
                }
            } finally {
                this.moderating = false
            }
        },
        // Autor bannen (banpubkey): Ziel merken, Bestätigung öffnen. Der Ban entfernt
        // den Autor als Space-Mitglied UND löscht relay-seitig ALLE seine Events —
        // das Bestätigungs-Modal sagt das explizit.
        askBanAuthor(m: ChatMessage) {
            this.activeId = null
            this.banAuthorFor = m
            dispatchModal('ban-author')
        },
        async confirmBanAuthor() {
            const m = this.banAuthorFor
            if (!m || !this._url || this.moderating) {
                return
            }
            this.moderating = true
            try {
                const err = await banSpaceMember(this._url, m.pubkey)
                if (err) {
                    toast(err)
                } else {
                    // Admin-Cache invalidieren (Mitgliederliste änderte sich) + die lokal
                    // geladenen Nachrichten des Autors optimistisch ausblenden. ponytail:
                    // nur das geladene Fenster — ältere räumt der nächste Load/die Live-Sub.
                    refreshSpaceAdmin(this._url)
                    // Raum-Feed UND (falls offen) die Kommentare des aktuellen Threads:
                    // Thread-Kommentare (kind 1111) liegen NICHT in this.messages, sondern
                    // in threadComments (deriveThread) → sonst blieben die Antworten des
                    // Gebannten im offenen Overlay stehen (wie confirmAdminDelete am Ziel).
                    for (const msg of [...this.messages, ...this.threadComments]) {
                        if (msg.pubkey === m.pubkey) {
                            repository.removeEvent(msg.id)
                        }
                    }
                    dispatchModal('ban-author', false)
                    this.banAuthorFor = null
                }
            } finally {
                this.moderating = false
            }
        },
        // ── Z3: Zap (NIP-57) ────────────────────────────────────────────────────
        // Zap-Sheet öffnen: Zapper des Autors auflösen (Vorabgate — `getZapResponseFilter`
        // wirft ohne nostrPubkey), Betrag/Emoji auf Default, QR-Reste + alte Live-Sub weg,
        // Modal auf. Kann der Empfänger keine Nostr-Zaps → Info-Toast statt Sheet.
        async openZap(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            haptic(10) // Tap kam an — sofortige taktile Quittung
            // Mobile ohne verbundene Wallet: der Zap-Sheet-QR-Fallback ergibt keinen
            // Sinn (der QR liegt auf dem eigenen Gerät, nicht scanbar). Statt Modal
            // direkt in die Wallet-Einstellungen (group.wallet), wo NWC verbunden wird.
            if (isMobile && !(await loadWallet())) {
                location.assign('/settings/wallet')
                return
            }
            // Modal SOFORT öffnen — dass eine lud16 existiert, weiß der Feed bereits (m.zappable).
            // NICHT auf resolveZapper warten: dessen Profil-/Zapper-Fetch läuft über die OUTBOX-
            // Relays des Empfängers und löst dabei NIP-42-AUTH an ein Dutzend fremder Relays aus
            // (jeweils eine 22242-Signatur) → sekundenlang. Das früher davorgeschaltete `await`
            // ließ das Sheet erst nach dieser Lawine (oder gar nicht) aufgehen. Jetzt: Sheet auf,
            // Zapper im Hintergrund; „Senden" wartet über `zapResolving`.
            this._zapSub?.abort()
            this._zapSub = null
            this.zapFor = m
            this._zapper = null
            this.zapNostrless = false
            this.zapUnavailable = false
            this.zapResolveFailed = false
            this.zapResolving = true
            this.zapAmount = 21
            this.zapContent = DEFAULT_ZAP_CONTENT
            this.zapInvoice = ''
            this.zapQr = ''
            dispatchModal('zap-message')
            try {
                // Zapper des Empfängers auflösen — OHNE Outbox-Relays/loadProfile anzufassen.
                // Das Profil liegt bereits im Repository (der Name steht ja im Feed) → `getProfile`
                // liefert die lud16 SYNCHRON. Daraus die lnurl, dann:
                // 1) synchron aus dem gewärmten Zapper-Cache (feeds.ts `warmZappers`, gleicher Cache
                //    wie der ⚡-Tally), sonst
                // 2) den LNURL DIREKT laden (reiner HTTP-Fetch des .well-known/lnurlp, KEINE
                //    Relays, KEIN NIP-42-AUTH). Das frühere `resolveZapper` machte ein
                //    `await loadProfile` über die Outbox-Relays → hing hinter der AUTH-Lawine und
                //    meldete fälschlich „nicht erreichbar" bei validen Adressen (walletofsatoshi.com).
                //
                //    `forceLoadZapper`, NICHT `loadZapper`: `loadZapper` läuft über welshmans
                //    `makeLoadItem` (@welshman/store repository.js:275) mit EXPONENTIELLEM BACKOFF —
                //    nach n erfolglosen Versuchen liefert es innerhalb von 2^n Sekunden sofort
                //    `undefined` zurück, OHNE zu fetchen. Die Versuche verbraucht `warmZappers`
                //    im Hintergrund für jeden Feed-Autor; tippt der Nutzer danach auf ⚡, kam die
                //    Antwort aus dem Backoff statt vom Server → „Zahlungs-Endpoint nicht erreichbar"
                //    bei einer kerngesunden Adresse. Genau dieses „mal geht's, mal nicht".
                //    Ein expliziter Nutzer-Tap darf nie gedrosselt werden.
                const profile = getProfile(m.pubkey)
                const lnurl = getLnUrl(profile?.lud16 || profile?.lud06 || '')
                let zapper = lnurl ? getZapper(lnurl) : undefined
                // Timeout/Netzwerkfehler von UNSERER Seite streng trennen von „Empfänger kann
                // nichts empfangen". Beides in `zapUnavailable` zu werfen, log dem Nutzer eine
                // Aussage über den EMPFÄNGER auf, obwohl nur unser Fetch nicht durchkam — genau
                // das Muster hinter „mal geht's, mal nicht". `zapResolveFailed` sagt stattdessen,
                // dass es an der Prüfung lag, und bietet einen erneuten Versuch an.
                if (!zapper && lnurl) {
                    try {
                        // 15 s, nicht 8: der LNURL-Fetch des Empfängers braucht gemessen
                        // 1,3–1,6 s, mit Ausreißern bis 5,5 s — plus welshmans 800-ms-Batcher.
                        // Bei 8 s hätte ein langsamer Empfänger-Server als „nicht erreichbar" gegolten.
                        zapper = await withTimeout(forceLoadZapper(lnurl), 15000)
                    } catch {
                        if (this.zapFor === m) {
                            this.zapResolveFailed = true
                        }
                        return
                    }
                    if (this.zapFor !== m) {
                        return // Sheet zwischenzeitlich geschlossen/gewechselt
                    }
                }
                if (!canPay(zapper)) {
                    this.zapUnavailable = true // gültige lud16, aber kein erreichbarer LNURL-Endpoint
                } else {
                    this._zapper = zapper
                    // Gültiger LNURL, aber KEIN NIP-57 (allowsNostr/nostrPubkey) → Plain-Pay-Modus:
                    // zahlen möglich, erzeugt aber KEIN Nostr-Event (kein 9735) → im Raum unsichtbar.
                    this.zapNostrless = !canZap(zapper)
                }
            } finally {
                if (this.zapFor === m) {
                    this.zapResolving = false
                }
            }
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
                const hasWallet = Boolean(await loadWallet())
                // Ziel-Guard: Schließt/wechselt der Nutzer das Sheet während eines awaits
                // (Escape/Backdrop → closeZap, oder openZap einer anderen Nachricht), NICHT
                // weiterschreiben — sonst verwaiste QR-Sub bzw. fremde Rechnung im Sheet.
                if (this.zapFor !== m) {
                    return
                }
                // Plain-Pay-Modus (Empfänger ohne NIP-57): normale Lightning-Zahlung OHNE
                // 9734/9735 → es entsteht kein Nostr-Event, der „Zap" ist im Raum nicht
                // sichtbar. Kein Receipt-Warten im QR-Fallback (es kommt keins).
                if (this.zapNostrless) {
                    if (hasWallet) {
                        await payZapPlain({ zapper, sats, comment: this.zapContent })
                        if (this.zapFor === m) {
                            haptic(20)
                            toast('Zahlung gesendet ⚡ (ohne Nostr-Event — im Raum nicht sichtbar).', 'success')
                            this.closeZap()
                        }
                    } else {
                        const invoice = await requestPlainInvoice({ zapper, sats, comment: this.zapContent })
                        if (this.zapFor !== m) {
                            return
                        }
                        this.zapInvoice = invoice
                        this.zapQr = await QRCode.toDataURL(invoice.toUpperCase(), { width: 256, margin: 1 })
                        ;(this as unknown as AlpineMagics).$nextTick(() => (this as unknown as AlpineMagics).$refs.zapCopyBtn?.focus())
                    }
                    return
                }
                const input = {
                    pubkey: m.pubkey,
                    zapper,
                    sats,
                    content: this.zapContent.trim() || DEFAULT_ZAP_CONTENT,
                    eventId: m.id,
                    url: this._url,
                }
                if (chooseZapMethod(zapper, hasWallet) === 'auto') {
                    // Gezahlt ist gezahlt: `payZapAuto` wirft nach erfolgreicher Zahlung nicht
                    // mehr. Ob das 9735-Receipt schon da ist, ist eine SEPARATE Aussage —
                    // fehlt es, sagen wir das, statt einen Fehler zu melden (das Geld ist raus).
                    const { receiptSeen } = await payZapAuto(input)
                    toast(receiptSeen ? 'Zap gesendet ⚡' : 'Bezahlt ⚡ — Bestätigung steht noch aus.', 'success')
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
            this.zapResolving = false
            this.zapUnavailable = false
            this.zapResolveFailed = false
            this.zapNostrless = false
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
            this._destroyed = true // eine noch offene storageReady-Subscription (init) nicht mehr anlaufen lassen
            if (this._onViewport) {
                window.visualViewport?.removeEventListener('resize', this._onViewport)
            }
            if (this._onVisible) {
                document.removeEventListener('visibilitychange', this._onVisible)
            }
            // NUR quittieren, wenn der Nutzer wirklich unten stand. Die beiden anderen
            // markRead()-Aufrufer sind bereits so geguardet (onScroll nur bei atBottom,
            // scrollToBottom setzt es selbst) — destroy() war der einzige unbedingte und
            // damit inkonsistent: wer hochgescrollt liest, während neue Nachrichten
            // einlaufen, und dann weg navigiert, hätte genau diese ungelesenen Nachrichten
            // stillschweigend als gelesen markiert. Das Wasserzeichen ist der einzige
            // Zustand, der die Navigation überlebt — es hier falsch zu setzen ist nicht
            // reparierbar.
            if (this.atBottom) {
                this.markRead()
            }
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
        signerLabel: 'Nicht verbunden',
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
        myName: '',
        myPicture: '',
        myNip05: '',
        myAbout: '',
        _unsub: null,
        _unsubMyProfile: null,
        _unsubMyHandle: null,
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
                this.signerLabel = currentSignerLabel()
                // Eigenes Profil (Name/Avatar/nip05/about) für den Space-Kopf auflösen — dasselbe
                // Muster wie die profile-card: pro pubkey frische deriveProfile/-Handle-Subs, Fallback
                // = gekürzter npub, verifizierte nip05 nur bei bestätigtem welshman-Handle.
                this._unsubMyProfile?.()
                this._unsubMyProfile = null
                this._unsubMyHandle?.()
                this._unsubMyHandle = null
                if (pk) {
                    const fallback = `${this.npub.slice(0, 12)}…${this.npub.slice(-6)}`
                    this.myName = fallback
                    this.myPicture = ''
                    this.myAbout = ''
                    this.myNip05 = ''
                    this._unsubMyHandle = deriveHandleForPubkey(pk).subscribe((handle) => {
                        this.myNip05 = handle ? displayNip05(handle.nip05) : ''
                    })
                    this._unsubMyProfile = deriveProfile(pk).subscribe((p) => {
                        this.myName = displayProfile(p, fallback)
                        this.myPicture = p?.picture ?? ''
                        this.myAbout = p?.about ?? ''
                    })
                } else {
                    this.myName = this.myPicture = this.myAbout = this.myNip05 = ''
                }
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
        // npub o. Ä. in die Zwischenablage (Profil-Popover). Gleiches Muster wie profile-card.
        copy(text, label) {
            if (text) {
                void navigator.clipboard?.writeText(text).then(() => toast(`${label} kopiert.`, 'success'))
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
            this._unsubMyProfile?.()
            this._unsubMyHandle?.()
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

    // Netzwerk & Relays (App-Shell-Verschmelzung §6.4, read-only): zeigt die
    // NIP-65-Relayliste (kind 10002) des Nutzers. Parst die `r`-Tags direkt
    // (ohne Marker = Lesen+Schreiben) statt über den Router — robust auch, wenn
    // die Router-Relay-Selektion noch nicht warm ist. Editor folgt separat.
    Alpine.data('nostrRelays', (): RelaysState => ({
        relays: [],
        loading: true,
        _unsub: null,
        _unsubEvents: null,
        // pubkey wird async aus localStorage hydriert (@welshman/store sync) — erst
        // nach authReady ist er definitiv (sonst wäre die Liste beim harten Reload,
        // dem einzigen Weg hierher, dauerhaft leer). Danach reaktiv: Login/Logout
        // schaltet die Relay-Ansicht mit (gleiche Disziplin wie nostrWallet/nostrAuth).
        async init() {
            await authReady
            this._unsub = pubkey.subscribe((pk: string | undefined) => {
                this._unsubEvents?.()
                this._unsubEvents = null
                if (!pk) {
                    this.relays = []
                    this.loading = false

                    return
                }
                this.loading = true
                const store = deriveEvents({ repository, filters: [{ kinds: [RELAYS], authors: [pk] }] })
                this._unsubEvents = store.subscribe((evs: TrustedEvent[]) => {
                    const ev = evs[0]
                    if (!ev) {
                        return
                    }
                    // NIP-65: r-Tag [ "r", url, ("read"|"write")? ]; ohne Marker = beides.
                    this.relays = ev.tags
                        .filter((t: string[]) => t[0] === 'r' && Boolean(t[1]))
                        .map((t: string[]) => ({ url: t[1], read: !t[2] || t[2] === 'read', write: !t[2] || t[2] === 'write' }))
                    this.loading = false
                })
                load({ filters: [{ kinds: [RELAYS], authors: [pk] }], relays: DEFAULT_RELAYS }).finally(() => {
                    this.loading = false
                })
            })
        },
        destroy() {
            this._unsub?.()
            this._unsubEvents?.()
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

    Alpine.data('lightboxZoom', createLightboxZoom)
}
