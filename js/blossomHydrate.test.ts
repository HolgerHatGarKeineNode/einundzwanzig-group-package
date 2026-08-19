/**
 * Der Nachlade-Beobachter für in JS gebaute Bilder (`js/blossomHydrate.ts`) und die
 * Marker-Entscheidung darunter (`js/blossomMarkup.ts`).
 *
 * Ausführen:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/blossomHydrate.test.ts
 *
 * Geprüft wird hier die ZUSTANDSFOLGE ohne Browser: was passiert bei Erfolg, bei
 * Ablehnung, bei einem geworfenen Ladeweg, bei einem zweiten Lauf über dieselben
 * Bilder, beim Sitzungswechsel. Das echte Markup und der echte MutationObserver
 * stehen in `tests/e2e/blossom-content-hydration.spec.ts` — beides hat hier nichts zu
 * suchen, beides ist dort nicht gefaked.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLOSSOM_SRC_ATTR, BLOSSOM_STATE_ATTR, blossomMarkerFor } from './blossomMarkup.ts'
import { hydrateBlossomImages, startBlossomHydration, type BlossomImageEl, type BlossomRoot } from './blossomHydrate.ts'

/** Ein Element, das nur Attribute kann — genau die Fläche, die der Hydrator anfasst. */
const makeEl = (attrs: Record<string, string>): BlossomImageEl & { attrs: Record<string, string> } => ({
    attrs: { ...attrs },
    getAttribute(name: string): string | null {
        return name in this.attrs ? this.attrs[name] : null
    },
    setAttribute(name: string, value: string): void {
        this.attrs[name] = value
    },
    removeAttribute(name: string): void {
        delete this.attrs[name]
    },
    hasAttribute(name: string): boolean {
        return name in this.attrs
    },
})

/**
 * Eine Wurzel, die den Selektor NICHT nachbaut, sondern nur seine zwei Formen
 * unterscheidet („mit Zustand ausgeschlossen" vs. „alle"). Ein selbstgebauter
 * CSS-Parser wäre hier die zweite Fehlerquelle statt einer Prüfung.
 */
const makeRoot = (els: (BlossomImageEl & { attrs: Record<string, string> })[]): BlossomRoot & { calls: string[] } => ({
    calls: [],
    querySelectorAll(selector: string): Iterable<BlossomImageEl> {
        this.calls.push(selector)
        const mitMarker = els.filter((el) => BLOSSOM_SRC_ATTR in el.attrs)

        return selector.includes(':not(') ? mitMarker.filter((el) => !(BLOSSOM_STATE_ATTR in el.attrs)) : mitMarker
    },
})

test('blossomMarkerFor: markiert genau dann, wenn die Wache den Proxy verweigert hat', () => {
    // Der leere Rückgabewert von `proxifyImage` IST das Signal (mediaGuard.ts).
    assert.equal(blossomMarkerFor('https://buzz.test/media/a.jpg', ''), 'https://buzz.test/media/a.jpg')
    // Normalfall: der Proxy hat eine URL geliefert → kein Marker.
    assert.equal(blossomMarkerFor('https://image.nostr.build/a.jpg', '/img/msg?src=…'), '')
    // Leere Eingabe ist kein geschütztes Bild, sondern gar keines.
    assert.equal(blossomMarkerFor('', ''), '')
    assert.equal(blossomMarkerFor(undefined, ''), '')
    assert.equal(blossomMarkerFor(null, ''), '')
})

test('Erfolg: blob:-URL landet im src, data-full wird mitgezogen, Zustand ist ready', async () => {
    const bild = makeEl({ [BLOSSOM_SRC_ATTR]: 'https://buzz.test/media/a.jpg', 'data-full': '' })
    await hydrateBlossomImages(makeRoot([bild]), async () => 'blob:abc')

    assert.equal(bild.attrs.src, 'blob:abc')
    assert.equal(bild.attrs['data-full'], 'blob:abc')
    assert.equal(bild.attrs[BLOSSOM_STATE_ATTR], 'ready')
})

test('Ohne data-full (Emoji) entsteht KEIN data-full', async () => {
    const emoji = makeEl({ [BLOSSOM_SRC_ATTR]: 'https://buzz.test/media/e.png' })
    await hydrateBlossomImages(makeRoot([emoji]), async () => 'blob:e')

    assert.equal(emoji.attrs.src, 'blob:e')
    assert.equal('data-full' in emoji.attrs, false)
})

test('Kein Zugriff (kein Signer, kein Mitglied, 401): KEIN src, Endzustand none', async () => {
    const bild = makeEl({ [BLOSSOM_SRC_ATTR]: 'https://buzz.test/media/a.jpg', 'data-full': '' })
    await hydrateBlossomImages(makeRoot([bild]), async () => '')

    // Der Kern der Zusage: es entsteht kein `src` — also auch keine Anfrage.
    assert.equal('src' in bild.attrs, false)
    assert.equal(bild.attrs[BLOSSOM_STATE_ATTR], 'none')
})

test('Ein geworfener Ladeweg hinterlässt keinen hängenden Ladezustand', async () => {
    const bild = makeEl({ [BLOSSOM_SRC_ATTR]: 'https://buzz.test/media/a.jpg' })
    await hydrateBlossomImages(makeRoot([bild]), async () => {
        throw new Error('Netz weg')
    })

    assert.equal(bild.attrs[BLOSSOM_STATE_ATTR], 'none')
    assert.equal('src' in bild.attrs, false)
})

test('Kein zweiter Versuch: ein abgelehntes Bild wird beim nächsten Lauf nicht erneut geladen', async () => {
    const bild = makeEl({ [BLOSSOM_SRC_ATTR]: 'https://buzz.test/media/a.jpg' })
    const root = makeRoot([bild])
    let versuche = 0
    const load = async (): Promise<string> => {
        versuche += 1

        return ''
    }
    await hydrateBlossomImages(root, load)
    await hydrateBlossomImages(root, load)
    await hydrateBlossomImages(root, load)

    assert.equal(versuche, 1)
})

test('Die Sperre greift SYNCHRON: ein zweiter Lauf während des Ladens fasst dasselbe Bild nicht an', async () => {
    const bild = makeEl({ [BLOSSOM_SRC_ATTR]: 'https://buzz.test/media/a.jpg' })
    const root = makeRoot([bild])
    let versuche = 0
    let freigeben = (_: string): void => {}
    const load = (): Promise<string> => {
        versuche += 1

        return new Promise<string>((resolve) => {
            freigeben = resolve
        })
    }
    // Erster Lauf startet und HÄNGT im Laden. Genau in diesem Fenster kommt der zweite
    // (im Betrieb: der Beobachter feuert, weil daneben eine Nachricht eingefügt wurde).
    const erster = hydrateBlossomImages(root, load)
    const zweiter = hydrateBlossomImages(root, load)
    // Auf den zweiten Lauf wird bewusst NICHT gewartet: würde die Sperre erst nach dem
    // ersten `await` gesetzt, liefe er in denselben hängenden Ladevorgang und dieser
    // Test endete in einem Timeout statt in einer Zusicherung. Ein paar Microtasks
    // durchlassen reicht, um einen zweiten Ladeversuch sichtbar zu machen.
    for (let i = 0; i < 5; i++) {
        await Promise.resolve()
    }
    assert.equal(versuche, 1)
    assert.equal(bild.attrs[BLOSSOM_STATE_ATTR], 'pending')

    freigeben('blob:abc')
    await Promise.all([erster, zweiter])
    assert.equal(bild.attrs[BLOSSOM_STATE_ATTR], 'ready')
})

test('Ein Marker ohne URL endet in none statt in einer Anfrage', async () => {
    const bild = makeEl({ [BLOSSOM_SRC_ATTR]: '' })
    let versuche = 0
    await hydrateBlossomImages(makeRoot([bild]), async () => {
        versuche += 1

        return 'blob:x'
    })

    assert.equal(versuche, 0)
    assert.equal(bild.attrs[BLOSSOM_STATE_ATTR], 'none')
})

test('startBlossomHydration: erster Lauf sofort, danach bei jeder Einfügung', async () => {
    const bild = makeEl({ [BLOSSOM_SRC_ATTR]: 'https://buzz.test/media/a.jpg' })
    const root = makeRoot([bild])
    let beobachtet: { childList: boolean; subtree: boolean } | null = null
    let ausloesen = (): void => {}
    const handle = startBlossomHydration(root, async () => 'blob:1', (onMutation) => {
        ausloesen = onMutation

        return {
            observe: (_target, options) => {
                beobachtet = options
            },
            disconnect: () => {},
        }
    }, {})
    await Promise.resolve()

    assert.equal(bild.attrs.src, 'blob:1')
    // Nur childList/subtree — Attribute NICHT, sonst löste das gesetzte `src` den
    // Beobachter erneut aus und der Lauf drehte sich im Kreis.
    assert.deepEqual(beobachtet, { childList: true, subtree: true })

    // Eine Einfügung: neues Bild, derselbe Beobachter.
    const zweites = makeEl({ [BLOSSOM_SRC_ATTR]: 'https://buzz.test/media/b.jpg' })
    const root2 = makeRoot([bild, zweites])
    Object.assign(root, { querySelectorAll: root2.querySelectorAll.bind(root2) })
    ausloesen()
    await Promise.resolve()
    await Promise.resolve()

    assert.equal(zweites.attrs.src, 'blob:1')
    handle.stop()
})

test('rescan (Sitzungswechsel): totes src fliegt raus, danach entscheidet die neue Identität neu', async () => {
    const bild = makeEl({ [BLOSSOM_SRC_ATTR]: 'https://buzz.test/media/a.jpg', 'data-full': '' })
    const root = makeRoot([bild])
    let antwort = 'blob:alice'
    const handle = startBlossomHydration(root, async () => antwort, () => ({ observe: () => {}, disconnect: () => {} }), {})
    await Promise.resolve()
    assert.equal(bild.attrs.src, 'blob:alice')

    // Abmelden: der Loader gibt die blob:-URLs frei, `load` liefert nichts mehr.
    antwort = ''
    handle.rescan()
    await Promise.resolve()
    await Promise.resolve()

    // Das tote `src` MUSS weg sein — sonst zeigte die Fläche ein kaputtes Bild statt
    // gar keines, und zwar dem NÄCHSTEN Nutzer.
    assert.equal('src' in bild.attrs, false)
    assert.equal(bild.attrs[BLOSSOM_STATE_ATTR], 'none')

    // Anmelden: derselbe Griff wirkt in die andere Richtung, ohne Seiten-Neuaufbau.
    antwort = 'blob:bob'
    handle.rescan()
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(bild.attrs.src, 'blob:bob')
})
