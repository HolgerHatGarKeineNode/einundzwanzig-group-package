/**
 * Pure-Tests für die Logik des Vereins-Onboardings (welshman-frei wie das Modul):
 *   node --test packages/einundzwanzig-group/js/vereinFlow.test.ts
 *
 * Der wichtigste Fall steht ganz oben und ist ausdrücklich **erschöpfend**: die
 * Zusicherung „ein Lesefehler ist kein ‚kein Mitglied'" wird nicht an drei
 * Beispielen geprüft, sondern an ALLEN 2^8 Eingabekombinationen. Ein Beispiel
 * belegt, dass der Autor an den Fall gedacht hat; eine Aufzählung belegt, dass
 * es keinen Fall gibt, an den er nicht gedacht hat — und genau darum geht es
 * hier: die Verwechslung ist unsichtbar, wenn sie passiert. Der Nutzer sieht
 * einen plausiblen Satz, der zufällig falsch ist.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    applicationBody,
    canPayInApp,
    clampRetryAfter,
    escapeLabel,
    followUpDelay,
    formatWait,
    FOLLOW_UP_SECONDS,
    isSafeExternalUrl,
    mapVereinError,
    nextFollowUpDelay,
    OPAQUE_REDIRECT_STATUS,
    parseRetryAfter,
    readConfig,
    readInvoice,
    readMe,
    RESUME_MIN_GAP_MS,
    RETRY_AFTER_MAX_SECONDS,
    RETRY_AFTER_MIN_SECONDS,
    safeExternalUrl,
    shouldFollowUpOnResume,
    STAGE_REQUIRES_DIRECTORY,
    vereinView,
    type VereinEscape,
    type VereinSnapshot,
} from './vereinFlow.ts'

/** Die acht booleschen Eingaben des Schritt-Entscheids, in fester Reihenfolge. */
const FLAGS = [
    'loaded',
    'statutesAccepted',
    'paid',
    'statutesConfirmed',
    'paymentSent',
    'exhausted',
    'dirGated',
    'dirReady',
    'dirMember',
    'dirFailed',
] as const

/** Alle 2^10 Kombinationen. */
const allSnapshots = (): VereinSnapshot[] => {
    const out: VereinSnapshot[] = []

    for (let mask = 0; mask < 1 << FLAGS.length; mask++) {
        const s = {} as Record<string, boolean>

        FLAGS.forEach((flag, i) => {
            s[flag] = Boolean(mask & (1 << i))
        })

        out.push(s as unknown as VereinSnapshot)
    }

    return out
}

// ── Die Zusicherung ──────────────────────────────────────────────────────────

test('KEINE Eingabe führt zu einer Mitgliedschafts-Aussage, solange die Liste nicht gelesen ist', () => {
    for (const s of allSnapshots()) {
        const view = vereinView(s)

        if (view.stage && STAGE_REQUIRES_DIRECTORY.has(view.stage)) {
            assert.equal(
                s.dirReady,
                true,
                `Stufe "${view.stage}" bei dirReady=false — Eingabe: ${JSON.stringify(s)}`,
            )
        }
    }
})

test('ein gescheiterter Lesevorgang landet IMMER in "lesefehler", nie in "freischaltung"', () => {
    for (const s of allSnapshots()) {
        // Der Fall, um den es geht: geladen, Statuten zugestimmt, bezahlt,
        // Vereins-Relay, Lesen gescheitert, und der Pubkey steht nicht drin.
        if (!(s.loaded && s.statutesAccepted && s.paid && s.dirGated && s.dirFailed && !s.dirMember)) {
            continue
        }

        const view = vereinView(s)
        assert.equal(view.phase, 'warten', JSON.stringify(s))
        assert.equal(view.stage, 'lesefehler', JSON.stringify(s))
    }
})

test('ungelesen ist ein eigener Zustand — weder "gelesen" noch "gescheitert"', () => {
    const base: VereinSnapshot = {
        loaded: true,
        statutesAccepted: true,
        paid: true,
        statutesConfirmed: true,
        paymentSent: true,
        exhausted: false,
        dirGated: true,
        dirReady: false,
        dirMember: false,
        dirFailed: false,
    }

    assert.deepEqual(vereinView(base), { phase: 'warten', stage: 'zugang-pruefen' })
    assert.deepEqual(vereinView({ ...base, dirFailed: true }), { phase: 'warten', stage: 'lesefehler' })
    assert.deepEqual(vereinView({ ...base, dirReady: true }), { phase: 'warten', stage: 'freischaltung' })
})

test('ein unfertiger /me-Abruf behauptet nichts — auch nicht "noch nicht bezahlt"', () => {
    const view = vereinView({
        loaded: false,
        statutesAccepted: false,
        paid: false,
        statutesConfirmed: false,
        paymentSent: false,
        exhausted: false,
        dirGated: true,
        dirReady: false,
        dirMember: false,
        dirFailed: false,
    })

    assert.deepEqual(view, { phase: 'laden', stage: null })
})

test('wer in der Liste steht, ist drin — das schlägt jeden anderen Zustand', () => {
    // Auch bei unfertigem `/me` und `paid=false`: die relay-signierte Liste ist
    // die Wahrheit über den ZUGANG, `/me` die über die Zahlung.
    for (const s of allSnapshots()) {
        if (s.dirMember) {
            assert.deepEqual(vereinView(s), { phase: 'freigeschaltet', stage: null }, JSON.stringify(s))
        }
    }
})

// ── Reihenfolge der Schritte ─────────────────────────────────────────────────

test('Statuten vor Antrag vor Zahlung vor Warten', () => {
    const s: VereinSnapshot = {
        loaded: true,
        statutesAccepted: false,
        paid: false,
        statutesConfirmed: false,
        paymentSent: false,
        exhausted: false,
        dirGated: true,
        dirReady: false,
        dirMember: false,
        dirFailed: false,
    }

    assert.equal(vereinView(s).phase, 'statuten')
    assert.equal(vereinView({ ...s, statutesConfirmed: true }).phase, 'antrag')
    assert.equal(vereinView({ ...s, statutesAccepted: true }).phase, 'zahlung')
    assert.equal(vereinView({ ...s, statutesAccepted: true, paymentSent: true }).stage, 'zahlung-offen')
    assert.equal(
        vereinView({ ...s, statutesAccepted: true, paymentSent: true, exhausted: true }).stage,
        'zahlung-geprueft',
    )
})

test('ohne Vereins-Relay im Space gibt es nichts freizuschalten', () => {
    // Ein anderer Space (kein Vereins-Relay) hat keine relay-signierte Liste —
    // dort wäre „warte auf Freischaltung" eine Aussage über etwas, das nie kommt.
    const view = vereinView({
        loaded: true,
        statutesAccepted: true,
        paid: true,
        statutesConfirmed: true,
        paymentSent: true,
        exhausted: false,
        dirGated: false,
        dirReady: false,
        dirMember: false,
        dirFailed: false,
    })

    assert.deepEqual(view, { phase: 'freigeschaltet', stage: null })
})

// ── Wartezeit ────────────────────────────────────────────────────────────────

const t = (key: string, replace?: Record<string, string | number>): string =>
    replace ? Object.entries(replace).reduce((s, [k, v]) => s.replace(`:${k}`, String(v)), key) : key

test('die Wartezeit kommt aus EINEM Wert — 1440 heute, 15 nach P1', () => {
    assert.equal(formatWait(1440, t), 'bis zu 24 Stunden')
    assert.equal(formatWait(15, t), 'bis zu 15 Minuten')
    assert.equal(formatWait(60, t), 'bis zu einer Stunde')
    assert.equal(formatWait(1, t), 'bis zu einer Minute')
    // Krumme Werte bleiben Minuten statt zu „1,5 Stunden" zu runden.
    assert.equal(formatWait(90, t), 'bis zu 90 Minuten')
})

test('keine Dauer ist besser als eine falsche', () => {
    assert.equal(formatWait(0, t), null)
    assert.equal(formatWait(-5, t), null)
    assert.equal(formatWait(Number.NaN, t), null)
})

// ── Nachfass-Plan ────────────────────────────────────────────────────────────

test('der Plan fasst neunmal nach, beginnt sofort und endet nach 20 Minuten', () => {
    assert.equal(FOLLOW_UP_SECONDS.length, 9)
    assert.equal(FOLLOW_UP_SECONDS[0], 0)
    assert.equal(FOLLOW_UP_SECONDS.at(-1), 1200)
})

test('der Plan wird nie wieder dichter — und der dichteste Takt bleibt bei 3 Aufrufen/min', () => {
    let previous = 0

    for (let i = 0; i + 1 < FOLLOW_UP_SECONDS.length; i++) {
        const gap = FOLLOW_UP_SECONDS[i + 1] - FOLLOW_UP_SECONDS[i]

        // Monoton, nicht streng: die letzten drei Runden stehen bewusst auf
        // konstant 5 Minuten. Was zählt, ist dass der Plan nach dem Ausdünnen
        // NIE wieder dichter wird — sonst stiege die Signaturlast am Ende, also
        // genau dort, wo die Wahrscheinlichkeit einer Bestätigung am kleinsten ist.
        assert.ok(gap >= previous, `Abstand ${i} (${gap}s) ist dichter als der vorige (${previous}s)`)

        // Der Proxy-Eimer erlaubt 10/min pro Session-Pubkey. Ein Abstand unter
        // 20 s ergäbe mehr als 3 Aufrufe/min und ließe zu wenig Luft für den
        // `/me`-Abruf daneben und für einen Handgriff des Nutzers.
        assert.ok(gap >= 20, `Abstand ${i} (${gap}s) ist dichter als 20 s`)

        previous = gap
    }
})

test('neun Runden über 20 Minuten — mehr Signaturen kostet der Wartezustand nie von allein', () => {
    // Die Zahl ist die eigentliche Aussage: jede Runde ist ein NIP-98-Event, bei
    // NIP-46 ein Bunker-Roundtrip und teils eine Nutzerbestätigung. Ein 15-s-Takt
    // über zwei Minuten plus 60 s bis Minute 15 wären 23 Runden — dieselbe
    // Fläche, dreimal so viele Prompts.
    assert.equal(FOLLOW_UP_SECONDS.length, 9)

    let sum = 0
    for (let i = 0; i < FOLLOW_UP_SECONDS.length; i++) {
        sum += nextFollowUpDelay(i) ?? 0
    }

    // Die Summe aller Abstände ist der Zeitpunkt der letzten Runde: 20 Minuten.
    assert.equal(sum, 1_200_000)
    assert.equal(nextFollowUpDelay(FOLLOW_UP_SECONDS.length), null)
})

test('die erste Runde läuft SOFORT, danach nach Plan, danach nie mehr', () => {
    // 0 ms: der Plan startet, nachdem `payInvoice` mit dem Preimage zurück ist —
    // die Zahlung ist dann settled, und 20 s Warten wären grundlos.
    assert.equal(nextFollowUpDelay(0), 0)
    assert.equal(nextFollowUpDelay(1), 20_000)
    assert.equal(nextFollowUpDelay(2), 25_000)
    assert.equal(nextFollowUpDelay(FOLLOW_UP_SECONDS.length), null)
    assert.equal(nextFollowUpDelay(99), null)
    assert.equal(nextFollowUpDelay(-1), null)
})

test('die Rückkehr in die App fasst nach — aber nicht bei jedem App-Wechsel', () => {
    assert.equal(shouldFollowUpOnResume(1_000, 1_000 + RESUME_MIN_GAP_MS), true)
    assert.equal(shouldFollowUpOnResume(1_000, 1_000 + RESUME_MIN_GAP_MS - 1), false)
    // Nie nachgefasst (0) → die Rückkehr ist der erste Anlass.
    assert.equal(shouldFollowUpOnResume(0, Date.now()), true)
})

// ── Fehler und ihre Auswege ──────────────────────────────────────────────────

test('jeder Fehlerzustand trägt einen Ausweg, und jeder Ausweg eine Beschriftung', () => {
    const stati = [300, 302, 401, 403, 404, 415, 419, 422, 429, 500, 503, 504]

    for (const status of stati) {
        const err = mapVereinError(status, null, null, t)

        assert.ok(err.escape, `Status ${status} ohne Ausweg`)
        assert.notEqual(escapeLabel(err.escape, t), '', `Ausweg ${err.escape} ohne Beschriftung`)
        assert.notEqual(err.message, '', `Status ${status} ohne Meldung`)
    }
})

test('alle Auswege haben eine Beschriftung — auch die, die heute kein Status erzeugt', () => {
    const alle: VereinEscape[] = [
        'neu-signieren',
        'neu-anmelden',
        'erneut',
        'korrigieren',
        'abwarten',
        'neue-rechnung',
        'checkout',
        'extern',
        'neu-laden',
        'zurueck',
    ]

    for (const escape of alle) {
        assert.notEqual(escapeLabel(escape, t), '')
    }
})

test('401 führt zu neu signieren, nie zu einem Retry mit demselben Ausweis', () => {
    // Der Verein brennt die Event-ID nach dem ersten Versuch für 150 s. „Erneut
    // versuchen" mit demselben Event ergäbe garantiert wieder 401.
    assert.equal(mapVereinError(401, null, null, t).escape, 'neu-signieren')
})

test('403 unterscheidet sich von 401 — fremdes Konto statt untauglicher Ausweis', () => {
    assert.equal(mapVereinError(403, null, null, t).escape, 'neu-anmelden')
})

test('422 reicht die Feldfehler unverfälscht durch', () => {
    const err = mapVereinError(422, { message: 'Ungültig', errors: { email: ['Keine gültige Adresse.'] } }, null, t)

    assert.equal(err.escape, 'korrigieren')
    assert.equal(err.message, 'Ungültig')
    assert.deepEqual(err.fields, { email: ['Keine gültige Adresse.'] })
})

test('429 nutzt Retry-After statt zu raten', () => {
    assert.equal(mapVereinError(429, null, '42', t).retryAfter, 42)
    // RFC 9110 erlaubt auch ein HTTP-Datum.
    const in90s = new Date(Date.now() + 90_000).toUTCString()
    const err = mapVereinError(429, null, in90s, t, Date.now())
    assert.ok(err.retryAfter !== undefined && err.retryAfter >= 89 && err.retryAfter <= 91, String(err.retryAfter))
    // Ohne Header wird NICHT geraten, sondern ein konservativer Wert genommen.
    assert.equal(mapVereinError(429, null, null, t).retryAfter, 30)
})

test('parseRetryAfter versteht Sekunden und Datum, und verweigert Müll', () => {
    assert.equal(parseRetryAfter('7'), 7)
    assert.equal(parseRetryAfter('  7  '), 7)
    assert.equal(parseRetryAfter(null), undefined)
    assert.equal(parseRetryAfter('bald'), undefined)
    // Ein Datum in der Vergangenheit ist 0, nicht negativ.
    assert.equal(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString()), 0)
})

test('ein 3xx ohne Location endet im Browser-Ausweg, nicht in Stille', () => {
    // Der Proxy hält den `Location`-Header bewusst zurück (er würde den Nutzer
    // an ein Ziel schicken, das der Verein bestimmt). Der Client kann damit
    // nichts anfangen — und sagt das, statt nichts zu tun.
    assert.equal(mapVereinError(302, null, null, t).escape, 'extern')
})

test('die Meldung des Vereins gewinnt gegen unseren eigenen Satz', () => {
    assert.equal(mapVereinError(503, { message: 'Wartung bis 18 Uhr' }, null, t).message, 'Wartung bis 18 Uhr')
    // Leere Meldung zählt nicht als Meldung.
    assert.notEqual(mapVereinError(503, { message: '' }, null, t).message, '')
})

// ── Rechnung: die Weiche in den Checkout ─────────────────────────────────────

test('fehlendes bolt11 und bolt11 === null führen BEIDE in den Checkout', () => {
    const fehlt = readInvoice({ data: { checkout_url: 'https://pay.example/i/1' } })
    const isNull = readInvoice({ data: { bolt11: null, checkout_url: 'https://pay.example/i/1' } })

    assert.equal(fehlt.bolt11, null)
    assert.equal(isNull.bolt11, null)
    assert.equal(canPayInApp(fehlt, true), false)
    assert.equal(canPayInApp(isNull, true), false)
    // Und der Checkout ist in beiden Fällen da — der Zweig ist also begehbar.
    assert.equal(fehlt.checkoutUrl, 'https://pay.example/i/1')
    assert.equal(isNull.checkoutUrl, 'https://pay.example/i/1')
})

test('eine leere Zeichenkette ist keine Rechnung', () => {
    // P3 sichert `null` statt `""` zu. Verlässt man sich darauf, sieht ein `""`
    // aus einer älteren Instanz aus wie eine Rechnung — und der Wallet-Knopf
    // führte gegen nichts.
    const leer = readInvoice({ data: { bolt11: '   ', checkout_url: 'https://pay.example/i/1' } })

    assert.equal(leer.bolt11, null)
    assert.equal(canPayInApp(leer, true), false)
})

test('in der App zahlen braucht BEIDES: Rechnung und Wallet', () => {
    const mit = readInvoice({ data: { bolt11: 'lnbc1...', checkout_url: 'https://pay.example/i/1' } })

    assert.equal(canPayInApp(mit, true), true)
    assert.equal(canPayInApp(mit, false), false)
})

test('die Antwort wird mit und ohne data-Hülle gelesen', () => {
    assert.equal(readInvoice({ bolt11: 'lnbc1...' }).bolt11, 'lnbc1...')
    assert.equal(readInvoice({ data: { bolt11: 'lnbc1...' } }).bolt11, 'lnbc1...')
    assert.equal(readInvoice(null).bolt11, null)
})

// ── /me und /config ──────────────────────────────────────────────────────────

test('/me: fehlende Felder sind "nicht bekannt", nie "nein"', () => {
    const leer = readMe({ data: {} })

    assert.equal(leer.paid, false)
    assert.equal(leer.statutesAccepted, false)
    assert.equal(leer.year, null)

    const voll = readMe({
        data: {
            statutes_accepted_at: '2026-01-02T10:00:00+00:00',
            current_year: { year: 2026, fee: 50, currency: 'CHF', paid: true, receipt_url: 'https://x/y' },
        },
    })

    assert.equal(voll.statutesAccepted, true)
    assert.equal(voll.paid, true)
    assert.equal(voll.year, 2026)
    assert.equal(voll.receiptUrl, 'https://x/y')
})

test('/me: paid gilt nur bei ausdrücklichem true', () => {
    // Ein `"true"` oder eine 1 aus einer anderen Serialisierung darf nicht als
    // Zahlung durchgehen — das ist die Bedingung für den ganzen Wartezustand.
    assert.equal(readMe({ data: { current_year: { paid: 'true' } } }).paid, false)
    assert.equal(readMe({ data: { current_year: { paid: 1 } } }).paid, false)
    assert.equal(readMe({ data: { current_year: { paid: true } } }).paid, true)
})

test('/config: das Jahr kommt aus der Antwort, nicht aus der Uhr', () => {
    // Der Invoice-Endpunkt nimmt genau dieses eine Jahr an. Am 1. Januar um
    // 00:05 wäre `new Date().getFullYear()` die falsche Quelle.
    const cfg = readConfig({
        data: {
            fee: 50,
            currency: 'CHF',
            year: 2026,
            statutes: { url: 'https://x/statuten.pdf', version: '2.1', adopted_at: '2025-03-01' },
            application: { application_text_max_length: 2000, optional_fields: ['email', 'nip05_handle'] },
        },
    })

    assert.equal(cfg.year, 2026)
    assert.equal(cfg.fee, 50)
    assert.equal(cfg.statutesVersion, '2.1')
    assert.deepEqual(cfg.optionalFields, ['email', 'nip05_handle'])
})

test('/config: ohne Angaben bleibt das Jahr null statt geraten', () => {
    assert.equal(readConfig({}).year, null)
    assert.equal(readConfig({}).applicationTextMax, 2000)
})

// ── Antrags-Body ─────────────────────────────────────────────────────────────

test('der Antrag trägt niemals einen Pubkey — das wäre beim Verein ein 403', () => {
    const body = applicationBody({ applicationText: 'Hallo', email: 'a@b.c' })
    const parsed = JSON.parse(body) as Record<string, unknown>

    assert.equal('pubkey' in parsed, false)
    assert.equal('npub' in parsed, false)
    assert.equal('key' in parsed, false)
    assert.equal(parsed.statutes_accepted, 'accepted')
})

test('leere optionale Felder werden weggelassen, nicht als leerer String gesendet', () => {
    const parsed = JSON.parse(applicationBody({ applicationText: '   ', email: '', nip05: '  ' })) as Record<string, unknown>

    assert.deepEqual(parsed, { statutes_accepted: 'accepted' })
})

test('no_email wird nur gesetzt, wenn es gewählt wurde', () => {
    assert.equal('no_email' in JSON.parse(applicationBody({})), false)
    assert.equal(JSON.parse(applicationBody({ noEmail: true })).no_email, true)
})

test('der Body ist EIN String — derselbe geht in den payload-Hash und ins fetch', () => {
    // Die Funktion ist deterministisch: zweimal aufgerufen ergibt sie
    // zeichengleiche Bytes. Wäre sie es nicht, könnte der Hash zum einen und
    // der Body zum anderen Ergebnis passen — ein 401, das wie ein
    // Signaturproblem aussieht.
    const input = { applicationText: 'Ä€😀 & <>', email: 'a@b.c', nip05: 'x@y.z', noEmail: false }

    assert.equal(applicationBody(input), applicationBody(input))
})

// ── Sicherheits-Gate: der Nachfass-Plan bleibt gedeckelt ─────────────────────
//
// Befund F1 des `security-auditor`, am laufenden Client gemessen: der
// 429-Ausweg hob die Deckelung auf. `_scheduleFollowUp` nahm `forced ??
// nextFollowUpDelay(attempts)` — lag ein `Retry-After` vor, wurde der Plan gar
// nicht mehr befragt, und der Plan ist die EINZIGE Abbruchbedingung. Gemessen:
// `Retry-After: 1` → 16 Runden in 16 s, unbegrenzt weiter; `Retry-After:
// 999999999999` → 1233 Aufrufe in 5 s, weil `setTimeout` bei Verzögerungen über
// 2^31−1 ms sofort feuert. Jede Runde kostet eine frische Signatur.

test('SICHERHEIT: unter Dauer-429 endet der Plan trotzdem nach neun Runden', () => {
    // Die gemessene Angriffsform, nachgestellt: der Verein antwortet jedes Mal
    // mit 429 und einem sehr kurzen `Retry-After`.
    let done = 0
    let forced: number | null = null
    let runden = 0

    for (;;) {
        const delay = followUpDelay(done, forced)

        if (delay === null) {
            break
        }

        runden += 1
        done += 1

        if (runden > 50) {
            assert.fail(`kein Abbruch nach ${runden} Runden — die Deckelung ist offen`)
        }

        const err = mapVereinError(429, null, '1', t)
        forced = (err.retryAfter ?? 0) * 1000
    }

    assert.equal(runden, FOLLOW_UP_SECONDS.length)
})

test('SICHERHEIT: ein Retry-After kann den Plan dehnen, aber nicht verlängern', () => {
    // Der Plan ist die OBERGRENZE. Nach der letzten Runde ist Schluss — auch
    // wenn der Verein noch eine Wartezeit vorgibt.
    assert.equal(followUpDelay(FOLLOW_UP_SECONDS.length, 1_000), null)
    assert.equal(followUpDelay(FOLLOW_UP_SECONDS.length, 600_000), null)
    assert.equal(followUpDelay(99, 1_000), null)
})

test('SICHERHEIT: beide Angaben sind untere Schranken — es gilt das Maximum', () => {
    // Der Plan sagt „nicht öfter als", `Retry-After` sagt „nicht vor". Ein
    // kurzes `Retry-After` darf den Plan deshalb NICHT beschleunigen.
    assert.equal(followUpDelay(1, 1_000), 20_000, 'kurzes Retry-After hat den Plan überstimmt')
    assert.equal(followUpDelay(1, 60_000), 60_000, 'langes Retry-After wurde nicht beachtet')
    assert.equal(followUpDelay(1, null), 20_000)
    // Ein 0 oder negativer Wert ist keine Wartezeit und darf die Bremse nicht lösen.
    assert.equal(followUpDelay(1, 0), 20_000)
    assert.equal(followUpDelay(1, -5_000), 20_000)
    assert.equal(followUpDelay(1, Number.NaN), 20_000)
})

test('SICHERHEIT: kein Retry-After wird je zu einem setTimeout-Überlauf', () => {
    // 2^31−1 ms ist die Grenze, ab der Browser die Verzögerung überlaufen lassen
    // und der Timer SOFORT feuert — aus „warte lange" wird „feuere in einer
    // Schleife". Der geklammerte Wert liegt um Größenordnungen darunter.
    const SET_TIMEOUT_MAX_MS = 2 ** 31 - 1

    for (const header of ['999999999999', '2147483648', '1e300', String(Number.MAX_SAFE_INTEGER)]) {
        const err = mapVereinError(429, null, header, t)

        assert.ok(err.retryAfter !== undefined, `kein retryAfter für ${header}`)
        assert.ok(err.retryAfter <= RETRY_AFTER_MAX_SECONDS, `${header} → ${err.retryAfter}s ist nicht geklammert`)
        assert.ok(err.retryAfter * 1000 < SET_TIMEOUT_MAX_MS, `${header} läuft in setTimeout über`)
    }

    // Und derselbe Wert, durch die Planung geschickt, bleibt ebenfalls darunter.
    for (let done = 0; done < FOLLOW_UP_SECONDS.length; done++) {
        const delay = followUpDelay(done, RETRY_AFTER_MAX_SECONDS * 1000)
        assert.ok(delay !== null && delay < SET_TIMEOUT_MAX_MS)
    }
})

test('SICHERHEIT: ein Retry-After von 0 löst die Bremse nicht', () => {
    // Gemessen wurde die Gegenrichtung (`Retry-After: 1` → 16 Runden in 16 s).
    // Die Klammer nach unten ist der zweite Riegel neben dem Plan.
    assert.equal(mapVereinError(429, null, '0', t).retryAfter, RETRY_AFTER_MIN_SECONDS)
    assert.equal(mapVereinError(429, null, '-99', t).retryAfter, RETRY_AFTER_MIN_SECONDS)
})

test('clampRetryAfter hält jeden Wert im brauchbaren Fenster', () => {
    assert.equal(clampRetryAfter(0), RETRY_AFTER_MIN_SECONDS)
    assert.equal(clampRetryAfter(42), 42)
    assert.equal(clampRetryAfter(42.2), 43)
    assert.equal(clampRetryAfter(99_999), RETRY_AFTER_MAX_SECONDS)
    assert.equal(clampRetryAfter(Number.NaN), RETRY_AFTER_MIN_SECONDS)
    assert.equal(clampRetryAfter(Number.POSITIVE_INFINITY), RETRY_AFTER_MIN_SECONDS)
})

// ── Sicherheits-Gate: Adressen aus dem Speicher sind Eingaben ───────────────

test('SICHERHEIT: nur http(s) darf in einen externen Öffnen-Aufruf', () => {
    // `checkoutUrl` überlebt den Checkout-Ausflug in localStorage — und der
    // gehört nicht uns allein. Was dort herauskommt, ist keine Antwort des
    // Vereins mehr, sondern eine Eingabe.
    for (const gut of ['https://pay.example/i/1', 'http://localhost:8000/x', 'HTTPS://PAY.EXAMPLE/i/1']) {
        assert.equal(isSafeExternalUrl(gut), true, gut)
        assert.equal(safeExternalUrl(gut), gut)
    }

    for (const schlecht of [
        'javascript:alert(1)',
        'JavaScript:alert(1)',
        ' javascript:alert(1)',
        'java\tscript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'file:///etc/passwd',
        'einundzwanziggroup://x',
        '//pay.example/i/1',
        '/relativ',
        '',
        null,
        undefined,
    ]) {
        assert.equal(isSafeExternalUrl(schlecht), false, String(schlecht))
        assert.equal(safeExternalUrl(schlecht), null, String(schlecht))
    }
})

// ── Punkt 6: der Umleitungs-Zweig ist erreichbar ────────────────────────────

test('eine undurchsichtige Umleitung landet im Browser-Ausweg, nicht im Sammelzweig', () => {
    // `redirect: 'manual'` liefert im BROWSER `status: 0`, `type:
    // 'opaqueredirect'` und abgeräumte Header — ein `status >= 300` kommt dort
    // nie an. (In Node liefert dieselbe Option `302`; daran ist eine frühere
    // Prüfung vorbeigelaufen.) `call()` normalisiert deshalb auf
    // OPAQUE_REDIRECT_STATUS, und der Zweig prüft darauf mit.
    const undurchsichtig = mapVereinError(OPAQUE_REDIRECT_STATUS, null, null, t)
    const echt302 = mapVereinError(302, null, null, t)

    assert.equal(undurchsichtig.escape, 'extern')
    assert.equal(echt302.escape, 'extern')
    assert.equal(undurchsichtig.message, echt302.message)

    // Und er ist NICHT im Sammelzweig gelandet.
    assert.notEqual(undurchsichtig.message, mapVereinError(500, null, null, t).message)
})
