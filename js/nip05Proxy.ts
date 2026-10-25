/**
 * NIP-05 lookups for the verified badge go through our own server, not to each domain.
 *
 * ── Why ──────────────────────────────────────────────────────────────────────────
 * welshman's `Handles` fetches `https://<domain>/.well-known/nostr.json` from the browser.
 * That only works where the domain answers CORS correctly, and many do not — measured
 * 2026-10-25 from the companion app (origin `http://127.0.0.1`): `primal.net` answers
 * `Access-Control-Allow-Origin: *, *` (duplicated, rejected), `0xchat.com` sends no header.
 * Those users lost their badge although their address is valid. The package route
 * `GET /nostr/nip05` (`Nip05Resolver`) asks from the server, where CORS does not exist,
 * under SSRF rules; every host that mounts the package answers it — on the device that is
 * the app's own PHP.
 *
 * ── Why the fetch is replaced and `dufflepudUrl` is NOT set ──────────────────────
 * welshman already has the seam: with `config.dufflepudUrl` set, `Handles` POSTs to
 * `<url>/handle/info`. But the same switch also reroutes `Zappers` to `<url>/zapper/info`
 * (`@welshman/app` `plugins/zappers.js`), which this server does not offer — setting it
 * would silently break every zap. So only the handle fetch is replaced, on the plugin
 * instance: `LoadableMapPlugin` looks `this.fetch` up at CALL time precisely so that a
 * subclass field can supply it (`plugins/base.js`), and an instance field is the same
 * lookup. A GET and not welshman's POST: no CSRF token, cacheable, and no race with
 * NativePHP's POST shim (`core.ts` `postShimReady`).
 *
 * The response shape is dufflepud's (`{data: [{handle, info}]}`), so switching to
 * `dufflepudUrl` later is a configuration change once `/zapper/info` exists.
 */
import { batcher, tryCatch } from '@welshman/lib'
import type { Handle } from '@welshman/util'

/** Handles per request — `Nip05Resolver::MAX_HANDLES` on the server. */
export const NIP05_BATCH = 30

/** The delay welshman's own `Handles.fetch` batches with. */
const BATCH_DELAY_MS = 800

const HEX64 = /^[0-9a-f]{64}$/

/**
 * The endpoint from the boot global `window.__nostrNip05Proxy` (`partials/globals`).
 *
 * `undefined` → the package route, because a page whose layout lacks the partial still
 * talks to a host that mounts the package. An explicit `''` switches the proxy off (the
 * E2E suite stubs `.well-known` in the browser and must not leave the machine).
 */
export const nip05ProxyBase = (raw: unknown = (globalThis as { __nostrNip05Proxy?: unknown }).__nostrNip05Proxy): string => {
    if (raw === undefined || raw === null) {
        return '/nostr/nip05'
    }

    return typeof raw === 'string' ? raw.trim() : ''
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>>

/**
 * Ask the server for these handles, in batches of {@link NIP05_BATCH}. Only an answer
 * whose `info.pubkey` is a 64-hex key counts; everything else is "no handle", which is
 * the state welshman's own fetch reports for a failure as well.
 */
export const fetchHandlesViaProxy = async (
    base: string,
    nip05s: string[],
    fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<Map<string, Handle>> => {
    const found = new Map<string, Handle>()
    const unique = [...new Set(nip05s.filter((nip05) => typeof nip05 === 'string' && nip05 !== ''))]

    for (let i = 0; i < unique.length; i += NIP05_BATCH) {
        const chunk = unique.slice(i, i + NIP05_BATCH)
        const query = chunk.map((nip05) => `h[]=${encodeURIComponent(nip05)}`).join('&')
        const body = await tryCatch(async () => {
            const response = await fetchImpl(`${base}?${query}`, {
                credentials: 'omit',
                headers: { accept: 'application/json' },
            })

            return response.ok ? ((await response.json()) as unknown) : undefined
        })
        const data = (body as { data?: unknown } | undefined)?.data
        if (!Array.isArray(data)) {
            continue
        }
        for (const entry of data as Array<{ handle?: unknown; info?: { pubkey?: unknown; relays?: unknown } | null }>) {
            const nip05 = entry?.handle
            const pubkey = entry?.info?.pubkey
            if (typeof nip05 !== 'string' || !chunk.includes(nip05) || typeof pubkey !== 'string' || !HEX64.test(pubkey)) {
                continue
            }
            const relays = Array.isArray(entry.info?.relays) ? entry.info.relays.filter((url): url is string => typeof url === 'string') : []
            found.set(nip05, { nip05, pubkey, relays } as Handle)
        }
    }

    return found
}

type HandlesLike = {
    fetch: (nip05: string) => Promise<Handle | undefined>
    set: (key: string, value: Handle) => void
}

/**
 * Replace a `Handles` instance's fetch with the server lookup; returns the undo.
 * Does nothing when the proxy is switched off ({@link nip05ProxyBase} is `''`).
 */
export const routeHandlesThroughProxy = (handles: HandlesLike, base: string, fetchImpl?: FetchLike): (() => void) => {
    if (!base) {
        return () => {}
    }
    const original = handles.fetch
    handles.fetch = batcher(BATCH_DELAY_MS, async (nip05s: string[]) => {
        const found = await fetchHandlesViaProxy(base, nip05s, fetchImpl)
        for (const [nip05, handle] of found) {
            handles.set(nip05, handle)
        }

        return nip05s.map((nip05) => found.get(nip05))
    })

    return () => {
        handles.fetch = original
    }
}
