/**
 * `nostrModerationAudit` — the moderation history under the report queue (P1).
 *
 * ── Why a separate island ───────────────────────────────────────────────────────────
 * No state in `nostrDirectory` (`bridge.ts`). The history has its own lifetime (it is
 * fetched when the moderation dialog opens and never before), its own data source (an
 * authenticated HTTP route, not the event repository) and its own failure discipline (a
 * 403 is an answer). The only thing `bridge.ts` knows about it is the registration line
 * in `registerNostrComponents` — same shape and same reason as the command palette
 * (`palette.ts`), the display switches (`displayPrefs.ts`) and the history search
 * (`roomSearch.ts`).
 *
 * There is exactly one seam to the directory island and it lies in the markup, not here:
 * the button that opens the dialog dispatches `moderation-audit-open`, which this island
 * listens for on `window`. A dispatched event is what an Alpine child can hear from a
 * sibling it cannot see in scope; the alternative would have been a second copy of the
 * dialog state.
 *
 * ── Why the fetch waits for the click ───────────────────────────────────────────────
 * Every call costs a NIP-98 signature (`buzzAdmin.ts nip98AuthHeader`), and a signature
 * is not free: with a NIP-46 bunker it is a roundtrip, with NIP-55 a prompt on the
 * device. Loading on `init()` would spend that on every visit to the member directory,
 * for a dialog most visitors never open. Same rule the ban list already follows
 * (`loadBanned()` on the trigger, `⚡directory.blade.php`).
 *
 * ── zooid answers nothing here, and is not asked ────────────────────────────────────
 * `/moderation/audit` is Buzz's native moderation API; zooid has no such route. The
 * check is {@link spaceIsBuzzAsync} — the *async* one, because the NIP-11 document may
 * still be in flight while the page renders and the synchronous snapshot reliably says
 * "not Buzz" in exactly that moment (the measured failure class behind
 * `einmal-snapshot-relay-art`). Same guard, same reason as `loadSpaceReports`.
 */
import { activeSpace } from './groups.ts'
import { buzzLoadAudit, spaceIsBuzzAsync } from './buzzAdmin.ts'
import { auditActionLabel, auditDays, auditTimeLabel, type AuditDay } from './moderationAuditModels.ts'
import { displayProfileByPubkey } from './spaceProfiles.ts'

type ModerationAuditState = {
    /** The history, newest day first. Empty is the normal state for a non-moderator. */
    days: AuditDay[]
    /** A fetch is in flight — keeps a second click from starting a second signature. */
    loading: boolean
    _url: string
    _unsubSpace: (() => void) | null
    init(): void
    load(): Promise<void>
    actionLabel(action: string): string
    timeLabel(ts: number): string
    nameOf(pubkey: string): string
    destroy(): void
}

const createModerationAudit = (): ModerationAuditState => ({
    days: [],
    loading: false,
    _url: '',
    _unsubSpace: null,

    init(): void {
        this._unsubSpace = activeSpace.subscribe((url: string) => {
            if (url === this._url) {
                return
            }
            // The history belongs to the space it was read from — leaving it standing
            // across a space switch would show foreign measures under a new name, the
            // same defect the ban list fixed in `nostrDirectory`.
            this._url = url
            this.days = []
        })
    },

    /**
     * Fetch the history. **Every failure ends as an empty list** — the decision itself
     * lives in `auditDays` (pure, `node --test`), so this method has no branch for it:
     * whoever may not read the log sees no section, not an error.
     */
    async load(): Promise<void> {
        const url = this._url
        if (this.loading || url === '') {
            return
        }
        this.loading = true
        try {
            if (!(await spaceIsBuzzAsync(url))) {
                this.days = []

                return
            }
            const result = await buzzLoadAudit(url)
            if (this._url !== url) {
                return
            }
            this.days = auditDays(result, Math.floor(Date.now() / 1000))
        } finally {
            this.loading = false
        }
    },

    actionLabel(action: string): string {
        return auditActionLabel(action)
    },

    timeLabel(ts: number): string {
        return auditTimeLabel(ts)
    },

    /**
     * Pubkey → the name on screen, **without pulling anything off the network**: the
     * directory page has already loaded the profiles of its members, and an unknown
     * pubkey falls back to its short npub inside `displayProfileByPubkey`. A history
     * that fetched profiles per row would turn one dialog into dozens of requests.
     */
    nameOf(pubkey: string): string {
        return displayProfileByPubkey(pubkey)
    },

    destroy(): void {
        this._unsubSpace?.()
        this._unsubSpace = null
    },
})

export function wireModerationAudit(Alpine: {
    data: (name: string, factory: (...args: unknown[]) => unknown) => void
}): void {
    Alpine.data('nostrModerationAudit', createModerationAudit as (...args: unknown[]) => unknown)
}
