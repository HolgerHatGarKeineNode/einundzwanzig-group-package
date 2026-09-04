/**
 * Which address a room row leads to, and what that does to the ephemeral space.
 *
 * **Why this is its own module.** The rule used to exist exactly once, inside
 * `nostrRail.openRoom` — and the header of `dms.ts` says in so many words why nothing
 * else copied it: *"A second copy of that decision in this store would be a second truth
 * about it."* That was the right call as long as the rail was the only surface with room
 * rows. It is not anymore: the conversation list on `/spaces` shows the same rows on a
 * phone, where the rail does not exist at all
 * (`app-frame.blade.php` renders it never in the NativePHP host, and only from `xl` in
 * the web host). Two surfaces, one rule — so the rule moves out, it does not get copied.
 *
 * **What goes wrong without it, measured by the rail before this module existed:** a
 * conversation of the WORKSPACE relay opened as `/rooms/{h}` without `?space=workspace`
 * and therefore against the HOME relay, which does not know the channel. Empty history,
 * and a join attempt answered with `invalid: group not found`.
 *
 * The reverse direction needs a line of its own and is the less obvious half: coming
 * FROM a workspace room back INTO a home room, `/rooms/{h}` sets nothing, and
 * `clearEphemeralSpace()` otherwise only runs on `/spaces`. Without the switch back the
 * home room would load against the workspace relay — the same failure, mirrored.
 *
 * **The two callers know "is this a workspace room?" differently, and that is not a
 * second truth.** The rail scans the workspace view's three room buckets because its
 * rows do not carry their origin; a DM row does carry it (`spaceUrl`, set by
 * `foldDmRooms` — see its note "Why the rows carry `spaceUrl`"). Different ways of
 * KNOWING, one decision about what follows.
 *
 * No import: the module is pure and testable without welshman or Alpine
 * (`node --test --experimental-strip-types packages/einundzwanzig-group/js/roomNavModel.test.ts`).
 * The side effects live in `navigate.ts`.
 */

import { workspaceRoomHref } from './spaceParam.ts'

/**
 * What has to happen to the ephemeral space before the navigation.
 *
 * `'none'` is not "do nothing because we are unsure" — it is the measured case where the
 * client already sits on the home space and stays there.
 */
export type SpaceSwitch = 'workspace' | 'home' | 'none'

export type RoomNavigation = {
    /** The target address, empty when there is nothing to open. */
    href: string
    switch: SpaceSwitch
}

/** The one answer both room surfaces act on. */
export const planRoomNavigation = (
    h: string,
    isWorkspaceRoom: boolean,
    inEphemeralSpace: boolean,
): RoomNavigation => {
    if (!h) {
        return { href: '', switch: 'none' }
    }

    // `workspaceRoomHref` stays the only place that WRITES the marker (its own note says
    // so); this module decides whether it is written, not how.
    if (isWorkspaceRoom) {
        return { href: workspaceRoomHref(h), switch: 'workspace' }
    }

    return { href: `/rooms/${encodeURIComponent(h)}`, switch: inEphemeralSpace ? 'home' : 'none' }
}
