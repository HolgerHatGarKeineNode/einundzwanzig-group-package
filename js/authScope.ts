/**
 * Who gets a NIP-42 AUTH, and when — three modes instead of "every challenge, or nothing".
 *
 * ── What welshman already does (0.13.1, read in `@welshman/net` `policy.js`/`auth.js`) ──
 * `makeSocketPolicyAuth` signs when a challenge arrives and `shouldAuth(socket)` agrees;
 * `socketPolicyAuthBuffer` keeps every REQ/EVENT sent before AUTH completes, withholds the
 * relay's `auth-required:` refusals of them and replays them once AUTH is `ok`. The retry
 * the brief asks for therefore exists — for a relay we AUTH to on its challenge.
 *
 * ── The two gaps this module closes ─────────────────────────────────────────────
 * 1. **A declined challenge jams the socket.** When `shouldAuth` says no (a guest, a
 *    metric relay), the status stays `requested` for the life of the connection. The buffer
 *    then withholds every EOSE ("wait for the replay's eose") and every `auth-required:`
 *    refusal, `authHold.ts` holds every REQ for ten seconds, and COUNT refuses to run
 *    (`count.js`: only `none`/`ok`). The caller sees silence until its own timeout — the
 *    hazard `welshmanAuthSwallow.test.ts` documents. Here a declined challenge is stored and
 *    the status put back to `none` (AUTH may still follow on demand) or to
 *    `denied_signature` (it never will), both of which let answers through.
 * 2. **AUTH only on demand for relays that are not ours.** Every relay that sends a
 *    challenge got a signed kind 22242 — the reader's pubkey tied to IP and filters, for
 *    relays they never chose, and on the app one Amber (NIP-55) round trip per relay per
 *    page load. Many relays challenge on connect without requiring anything. Now a foreign
 *    relay gets AUTH when it actually asks for it: a `CLOSED`/`OK false` with
 *    `auth-required:` (NIP-42), or an EOSE carrying the `"auth"` hint (NIP-67, the recent
 *    addition to NIP-42: "more results may be available if they authenticate"). The
 *    refused message is then replayed by welshman's buffer, so the caller gets its answer
 *    instead of a refusal.
 *
 * ── The modes (decided per challenge, at that moment) ───────────────────────────
 *  · `eager`     — signed as soon as the challenge arrives (the old behaviour): the host's
 *                  relays and the relays the user chose (own kind 10002, 10050, 10009).
 *  · `on-demand` — everyone else, while logged in.
 *  · `never`     — no user, or a relay `darfAuthBekommen` excludes (metric/calendar).
 */
import { on } from '@welshman/lib'
import {
    AuthStateEvent,
    AuthStatus,
    RelayReasonPrefix,
    SocketEvent,
    SocketStatus,
    isRelayClosed,
    isRelayEose,
    isRelayNegErr,
    isRelayOk,
    makeSocketPolicyAuth,
    matchReason,
    type Socket,
    type SocketPolicyAuthOptions,
} from '@welshman/net'

export type AuthMode = 'eager' | 'on-demand' | 'never'

/** How long a demand waits for a challenge the relay has not sent yet, ms. */
export const CHALLENGE_WAIT_MS = 3_000

/** Does this relay message ask us to authenticate? */
export const asksForAuth = (message: unknown): boolean => {
    const m = message as unknown[]
    if (!Array.isArray(m)) {
        return false
    }
    if ((isRelayClosed(m as never) || isRelayNegErr(m as never)) && typeof m[2] === 'string') {
        return matchReason(RelayReasonPrefix.AuthRequired, m[2])
    }
    if (isRelayOk(m as never) && m[2] === false && typeof m[3] === 'string') {
        return matchReason(RelayReasonPrefix.AuthRequired, m[3])
    }
    if (isRelayEose(m as never) && Array.isArray(m[2])) {
        return (m[2] as unknown[]).includes('auth')
    }

    return false
}

/**
 * The socket policy. `mode` is read at every decision, so a login or a changed relay list
 * takes effect at the next challenge or refusal without rebuilding anything.
 */
export const makeSocketPolicyAuthScope = (options: {
    sign: SocketPolicyAuthOptions['sign']
    mode: (socket: Socket) => AuthMode
}) => {
    const demanded = new WeakSet<Socket>()
    const mayAuthNow = (socket: Socket): boolean => {
        const mode = options.mode(socket)

        return mode === 'eager' || (mode === 'on-demand' && demanded.has(socket))
    }
    // welshman's own signer policy, with the same predicate this module decides by — so the
    // two can never disagree about a challenge (a disagreement would call `doAuth` on a
    // status that is no longer `requested`, which throws).
    const signing = makeSocketPolicyAuth({ sign: options.sign, shouldAuth: mayAuthNow })

    return (socket: Socket): (() => void) => {
        const stopSigning = signing(socket)
        let waitTimer: ReturnType<typeof setTimeout> | undefined

        const stopStatus = on(socket.auth, AuthStateEvent.Status, (status: AuthStatus) => {
            if (status !== AuthStatus.Requested || mayAuthNow(socket)) {
                return
            }
            // Declined for now: keep the challenge, end the "running round".
            socket.auth.setStatus(options.mode(socket) === 'never' ? AuthStatus.DeniedSignature : AuthStatus.None)
        })

        const stopReceiving = on(socket, SocketEvent.Receiving, (message: unknown) => {
            if (!asksForAuth(message)) {
                return
            }
            const status = socket.auth.status
            if (status !== AuthStatus.None && status !== AuthStatus.DeniedSignature) {
                // A round is running or done; welshman's buffer handles the rest.
                return
            }
            if (options.mode(socket) !== 'on-demand') {
                // Nobody will sign: hand the withheld refusal to the caller now.
                if (status === AuthStatus.None) {
                    socket.auth.setStatus(AuthStatus.DeniedSignature)
                }

                return
            }
            demanded.add(socket)
            if (socket.auth.challenge) {
                socket.auth.setStatus(AuthStatus.Requested)
            } else if (!waitTimer) {
                // NIP-42 says the challenge comes first; if it never does, do not hold the
                // refusal hostage — release it to the caller.
                waitTimer = setTimeout(() => {
                    waitTimer = undefined
                    if (!socket.auth.challenge && socket.auth.status === AuthStatus.None) {
                        socket.auth.setStatus(AuthStatus.DeniedSignature)
                    }
                }, CHALLENGE_WAIT_MS)
            }
        })

        const stopSocket = on(socket, SocketEvent.Status, (status: SocketStatus) => {
            if (status === SocketStatus.Closed || status === SocketStatus.Error) {
                demanded.delete(socket)
            }
        })

        return () => {
            clearTimeout(waitTimer)
            stopSigning()
            stopStatus()
            stopReceiving()
            stopSocket()
        }
    }
}
