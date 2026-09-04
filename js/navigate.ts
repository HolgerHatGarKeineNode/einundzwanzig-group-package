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
