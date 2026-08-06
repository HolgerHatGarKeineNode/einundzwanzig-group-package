/**
 * Pure(-ish)-Tests fuer `wireViewport`/`$store.viewport.mouse` (C1, PLAN4).
 * Laeuft ohne neue Dependency ueber Nodes eingebauten Test-Runner + TS-Type-Stripping:
 *   node --test packages/einundzwanzig-group/js/viewport.test.ts
 *
 * `viewport.ts` importiert nichts (kein welshman) — genau deshalb ist es hier direkt
 * ladbar. `window`/`matchMedia` gibt es unter `node --test` nicht: jeder Test, der sie
 * braucht, haengt einen Fake in `globalThis.window` und raeumt ihn per `t.after` wieder
 * ab — sonst blutet der Fake in den naechsten Test (Node haelt EINEN Prozess fuer die
 * ganze Datei).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wireViewport, DESKTOP_QUERY, POINTER_QUERY, type ViewportStore } from './viewport.ts'

type Listener = (e: { matches: boolean }) => void

/** Eine Fake-MediaQueryList je Query — merkt sich ihre `change`-Listener, um sie feuern zu koennen. */
class FakeMql {
    matches: boolean
    listeners: Listener[] = []
    constructor(matches: boolean) {
        this.matches = matches
    }
    addEventListener(type: string, cb: Listener) {
        if (type === 'change') {
            this.listeners.push(cb)
        }
    }
    removeEventListener() {}
    fire(matches: boolean) {
        this.matches = matches
        for (const cb of this.listeners) {
            cb({ matches })
        }
    }
}

/** Fake `window` mit `matchMedia`, das je Query dieselbe FakeMql-Instanz zurueckgibt (Memoisierung wie im Browser). */
function fakeWindow(initial: Partial<Record<string, boolean>>) {
    const mqls = new Map<string, FakeMql>()
    return {
        matchMedia(query: string): FakeMql {
            let mql = mqls.get(query)
            if (!mql) {
                mql = new FakeMql(initial[query] ?? false)
                mqls.set(query, mql)
            }
            return mql
        },
        _mqls: mqls,
    }
}

/** Fake-Alpine: `store(name)` liest, `store(name, value)` schreibt — wie im echten Alpine. */
function fakeAlpine() {
    const stores = new Map<string, unknown>()
    return {
        store(name: string, value?: unknown): unknown {
            if (value !== undefined) {
                stores.set(name, value)
                return value
            }
            return stores.get(name)
        },
    }
}

/** Haengt `win` als globales `window` fuer die Dauer EINES Tests ein und raeumt sicher wieder ab. */
function withWindow(t: import('node:test').TestContext, win: unknown): void {
    ;(globalThis as unknown as { window?: unknown }).window = win
    t.after(() => {
        delete (globalThis as unknown as { window?: unknown }).window
    })
}

// 1) Desktop + Maus, Web (kein NativePHP) — beide Flags true.
test('Desktop + Maus (Web): desktop=true, mouse=true', (t) => {
    withWindow(t, fakeWindow({ [DESKTOP_QUERY]: true, [POINTER_QUERY]: true }))
    const alpine = fakeAlpine()
    wireViewport(alpine)
    const store = alpine.store('viewport') as ViewportStore
    assert.equal(store.desktop, true)
    assert.equal(store.mouse, true)
})

// 2) Breiter Viewport, aber Touch-Bedienung (z.B. Touch-Laptop/Tablet im Querformat) — Web.
test('breiter Viewport + Touch (Web): desktop=true, mouse=false', (t) => {
    withWindow(t, fakeWindow({ [DESKTOP_QUERY]: true, [POINTER_QUERY]: false }))
    const alpine = fakeAlpine()
    wireViewport(alpine)
    const store = alpine.store('viewport') as ViewportStore
    assert.equal(store.desktop, true)
    assert.equal(store.mouse, false)
})

// 3) Desktop + Maus, aber NativePHP-App — `mouse` bleibt false trotz Zeigegeraet, weil
// die native App den Emoji-Knopf grundsaetzlich nicht zeigen soll (isMobile-Chassis).
test('Desktop + Maus, aber NativePHP: mouse bleibt false trotz pointer:fine', (t) => {
    withWindow(t, fakeWindow({ [DESKTOP_QUERY]: true, [POINTER_QUERY]: true }))
    const alpine = fakeAlpine()
    wireViewport(alpine, { nativeApp: true })
    const store = alpine.store('viewport') as ViewportStore
    assert.equal(store.desktop, true, 'nativeApp beeinflusst NUR mouse, nicht desktop')
    assert.equal(store.mouse, false)
})

// 4) Ohne `matchMedia` (Node-Tests, alte WebViews, SSR) — DIE Ausfallrichtung: beide
// Flags fallen auf ihre jeweils harmlose Seite, nie auf true.
test('ohne matchMedia (kein window.matchMedia): desktop=false UND mouse=false', (t) => {
    // Explizit KEIN Fake-window fuer diesen Test — das ist der Zustand, den `node --test`
    // von Haus aus hat, und genau den soll die Funktion abfangen.
    t.after(() => {
        delete (globalThis as unknown as { window?: unknown }).window
    })
    assert.equal(typeof (globalThis as unknown as { window?: unknown }).window, 'undefined', 'Vorbedingung: kein window in diesem Test')
    const alpine = fakeAlpine()
    wireViewport(alpine)
    const store = alpine.store('viewport') as ViewportStore
    assert.equal(store.desktop, false)
    assert.equal(store.mouse, false)
})

// 5) Nach einem `change`-Event auf die POINTER-Query aktualisiert sich NUR `mouse`,
// `desktop` bleibt unberuehrt vom Pointer-Wechsel (unabhaengige Fragen).
test('pointer-change-Event aktualisiert store.mouse live', (t) => {
    const win = fakeWindow({ [DESKTOP_QUERY]: true, [POINTER_QUERY]: false })
    withWindow(t, win)
    const alpine = fakeAlpine()
    wireViewport(alpine)
    const store = alpine.store('viewport') as ViewportStore
    assert.equal(store.mouse, false, 'Ausgangslage: Touch')

    // Ein Trackpad wird angesteckt / DevTools-Emulation wechselt.
    win._mqls.get(POINTER_QUERY)!.fire(true)
    assert.equal(store.mouse, true, 'Wechsel auf Zeigegeraet muss live ankommen')
    assert.equal(store.desktop, true, 'desktop bleibt vom Pointer-Wechsel unberuehrt')
})

// 6) Zweiter `wireViewport`-Aufruf ist idempotent: kein Reset des Stores, kein zweiter
// Listener (sonst feuerte ein einziges change-Event den Handler doppelt).
test('zweiter wireViewport-Aufruf ist idempotent (kein Reset, kein doppelter Listener)', (t) => {
    const win = fakeWindow({ [DESKTOP_QUERY]: true, [POINTER_QUERY]: true })
    withWindow(t, win)
    const alpine = fakeAlpine()
    wireViewport(alpine)
    wireViewport(alpine) // zweiter Lauf — z.B. registerNostrComponents nach wire:navigate

    // Nur EIN Listener pro Query — sonst liefe jedes change-Event mehrfach durch.
    assert.equal(win._mqls.get(DESKTOP_QUERY)!.listeners.length, 1, 'kein doppelter desktop-Listener')
    assert.equal(win._mqls.get(POINTER_QUERY)!.listeners.length, 1, 'kein doppelter pointer-Listener')

    const store = alpine.store('viewport') as ViewportStore
    assert.equal(store.desktop, true)
    assert.equal(store.mouse, true)
})
