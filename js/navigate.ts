/**
 * Navigation through Livewire, with a hard fallback — and opening a room, once.
 *
 * ══ `navigateTo` ═════════════════════════════════════════════════════════════════
 *
 * The same six lines stood privately in `rail.ts` and in `palette.ts`. They are here now
 * because a third caller arrived (`dms.ts`, for the conversation list on the phone) and
 * three copies of a fallback is the point at which one of them silently stops matching.
 *
 * ══ `openRoomAt` — the side-effecting half of `roomNavModel.ts` ══════════════════
 *
 * The decision itself is pure and tested without a browser; what needs the app is the
 * ephemeral-space write and the navigation. Read `roomNavModel.ts` for WHY the switch
 * exists — the short version is that a room lives on exactly one relay, and opening it
 * against the other one gives an empty history and `invalid: group not found`.
 */

import { get } from 'svelte/store'
import { clearEphemeralSpace, ephemeralSpaceUrl, setActiveSpaceEphemeral } from './groups.ts'
import { WORKSPACE_URL } from './spaceCaps.ts'
import { planRoomNavigation } from './roomNavModel.ts'

/**
 * The address of the encrypted conversations (NIP-17).
 *
 * A constant rather than a string at every call site: THREE surfaces lead there — the
 * rail group, the list on the chat area and the profile card. Site-relative like
 * `/rooms/{h}` in `roomNavModel.ts`; the package is mounted at the root.
 *
 * Since P2 (Concept C) this is a SEGMENT of the Postfach, not a screen of its own: the
 * conversations are one of five views of the one inbox (D5). The old `/messages` path
 * answers with a 302 to exactly this address and renames its `c` parameter to `an`,
 * which is why the conversation key below travels as `an`.
 */
export const MESSAGES_PATH = '/postfach?ansicht=direkt'

/** Navigate through Livewire, with a hard fallback — at ONE place instead of three. */
export const navigateTo = (href: string): void => {
    if (href === '') {
        return
    }
    const w = window as unknown as { Livewire?: { navigate: (target: string) => void } }
    if (w.Livewire) {
        w.Livewire.navigate(href)
    } else {
        window.location.assign(href)
    }
}

/**
 * Open an encrypted conversation.
 *
 * @param key The `conversationKey` (`privateMessageModels.ts`) — the sorted,
 *            comma-joined participant list. It travels as a query parameter so that a
 *            jump from the rail opens the conversation that was clicked, and so a link
 *            still works when reopened in the same browser. The key holds public keys
 *            only, never content.
 */
export const openPrivateConversation = (key: string): void => {
    // `&` and not `?`: the path already carries its segment. One place decides the
    // address, so the separator is decided here too.
    navigateTo(key === '' ? MESSAGES_PATH : `${MESSAGES_PATH}&an=${encodeURIComponent(key)}`)
}

/**
 * Open a room row: set or clear the ephemeral space, then navigate.
 *
 * @param h              The room's `h` tag.
 * @param isWorkspaceRoom Whether the row came from the workspace relay. The rail answers
 *                        this by scanning its workspace view, a DM row by its own
 *                        `spaceUrl` — see the note in `roomNavModel.ts`.
 */
export const openRoomAt = (h: string, isWorkspaceRoom: boolean): void => {
    const plan = planRoomNavigation(h, isWorkspaceRoom, get(ephemeralSpaceUrl) !== null)

    // ── The only two mutations on this path, both asked for by the user ──────────
    if (plan.switch === 'workspace') {
        setActiveSpaceEphemeral(WORKSPACE_URL)
    } else if (plan.switch === 'home') {
        clearEphemeralSpace()
    }

    navigateTo(plan.href)
}
