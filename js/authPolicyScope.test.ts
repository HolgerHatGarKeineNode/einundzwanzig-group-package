/**
 * **Der Wirkungsnachweis des AUTH-Riegels (P6, Sicherheitsbefund F2)** — Vertragstest
 * gegen die INSTALLIERTE welshman-Policy, nicht gegen einen Nachbau:
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/authPolicyScope.test.ts
 *
 * ── Warum das ein eigener Test ist ────────────────────────────────────────────────
 *
 * `js/articleMetrics.test.ts` prüft die REGEL (`darfAuthBekommen`) — welche URL gesperrt
 * gehört. Das ist die halbe Zusage. Die andere Hälfte ist die **Verdrahtung**: bekommt
 * `shouldAuth` überhaupt einen Socket, wird sein Rückgabewert ausgewertet, und wird bei
 * `false` wirklich **nicht** signiert?
 *
 * Genau daran hing der Befund. Der Bestandscode schrieb
 *
 * ```ts
 * shouldAuth: () => Boolean(pubkey.get())
 * ```
 *
 * — die Signatur **erlaubt** einen Socket-Parameter, der Code ignorierte ihn, und
 * `tsc` hatte daran nichts auszusetzen. Ein Test der Regel allein wäre grün geblieben,
 * während jeder fremde Relay weiterhin den Pubkey des Lesers bekommt.
 *
 * Gemessen wird deshalb am **echten** `makeSocketPolicyAuth` (`@welshman/net`): ein
 * minimaler Socket mit echtem `AuthState`-Ereignisstrom, `sign` als Zähler. Ändert
 * welshman die Signatur von `shouldAuth` oder den Zeitpunkt des Aufrufs, fällt dieser
 * Test um — und das ist erwünscht.
 *
 * **Was hier NICHT geprüft wird:** ob `js/core.ts` diese Policy auch wirklich einhängt.
 * Die Datei ist unter `node --test` nicht ladbar (Boot-Seiteneffekte, `localStorage`).
 * Dass die Verdrahtung produktiv greift, zeigt der E2E-Fall in
 * `tests/e2e/article-metrics.spec.ts`: dort ist der Board-Relay zugleich Metrik-Relay,
 * verlangt AUTH — und die Fläche bleibt nur dann gefüllt, wenn die Rückausnahme zieht.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { AuthState, AuthStatus, AuthStateEvent, SocketEvent, makeSocketPolicyAuth, type Socket } from '@welshman/net'
import { Emitter } from '@welshman/lib'
import { darfAuthBekommen } from './articleMetrics.ts'

const BOARD = 'ws://localhost:3335/'
const METRIK = 'wss://nos.lol/'

/**
 * Ein Socket, der nur so viel kann, wie der Pfad anfasst: `url`, ein Ereignisstrom und
 * ein `send`. `AuthState` ist die ECHTE Klasse aus `@welshman/net` — ein nachgebauter
 * Emitter hätte den Vertrag nachgeahmt statt geprüft.
 *
 * **`fordereAuth` schickt den echten Relay-Rahmen `["AUTH", challenge]`**, nicht ein
 * handgesetztes Statusereignis. Damit läuft die ganze Kette, die auch produktiv läuft:
 * Rahmen → `AuthState` setzt Challenge und Status → Policy hört → `doAuth` → `sign`.
 * Ein direkt emittierter Status hätte `doAuth` sofort werfen lassen („no challenge") und
 * den Test aus einem Grund grün gemacht, der mit dem Riegel nichts zu tun hat.
 */
const machSocket = (url: string): { socket: Socket; auth: AuthState; fordereAuth: () => void } => {
    const emitter = new Emitter()
    const socket = Object.assign(emitter, { url, send: () => {} }) as unknown as Socket
    const auth = new AuthState(socket)
    ;(socket as unknown as { auth: AuthState }).auth = auth

    return {
        socket,
        auth,
        fordereAuth: () => emitter.emit(SocketEvent.Receive, ['AUTH', `challenge-${url}`]),
    }
}

/** Zählt, wie oft welshman zu signieren versucht. */
const zaehlendePolicy = (metrik: string[], eigene: string[]) => {
    let signaturen = 0
    const policy = makeSocketPolicyAuth({
        // `doAuth` ruft `sign` — hier wird nur gezählt und ein Platzhalter geliefert.
        //
        // **Der Signierer darf NICHT werfen**, und das ist gemessen: welshmans `tryCatch`
        // (`@welshman/lib`) fängt nur synchrone Fehler, keine abgelehnte Promise. Ein
        // werfendes `sign` beendete deshalb den Testprozess mit einer unbehandelten
        // Rejection — die Fälle danach fielen um, und der Kernbeweis darüber war aus
        // demselben Grund „grün". Genau dafür steht die Gegenprobe unten.
        sign: async () => {
            signaturen += 1

            return { id: 'f'.repeat(64) } as never
        },
        // **Exakt die Verdrahtung aus `js/core.ts`**, inklusive des `socket`-Parameters,
        // dessen Fehlen der ganze Befund war.
        shouldAuth: (socket) => darfAuthBekommen(socket.url, metrik, eigene),
    })

    return { policy, signaturen: () => signaturen }
}

describe('P6/F2: der AUTH-Riegel wirkt, nicht nur die Regel', () => {
    test('KERNBEWEIS: ein Metrik-Relay bekommt KEINE Signatur', async () => {
        const { policy, signaturen } = zaehlendePolicy([METRIK], [])
        const { socket, fordereAuth } = machSocket(METRIK)

        policy(socket)
        fordereAuth()
        await new Promise((fertig) => setTimeout(fertig, 0))

        assert.equal(signaturen(), 0, 'ein fremdes Metrik-Relay darf den Pubkey des Lesers nicht bekommen')
    })

    test('GEGENPROBE: derselbe Aufbau OHNE Sperre signiert sehr wohl', async () => {
        // Ohne diesen Fall wäre der Kernbeweis wertlos: er wäre auch grün, wenn die
        // Policy gar nie signierte — etwa weil der Ereignisname nicht mehr stimmt.
        const { policy, signaturen } = zaehlendePolicy([], [])
        const { socket, fordereAuth } = machSocket(METRIK)

        policy(socket)
        fordereAuth()
        await new Promise((fertig) => setTimeout(fertig, 0))

        assert.equal(signaturen(), 1, 'ohne Sperre muss dieselbe Konstruktion signieren')
    })

    test('ein EIGENER Relay signiert weiter — auch wenn er zugleich Metrik-Relay ist', async () => {
        // Der Fall, der beim Bauen alle fünf E2E-Fälle rot gemacht hat: `board-fixtures.ts`
        // trägt den worker-eigenen zooid als Board UND als Metrik-Relay ein, und der
        // verlangt AUTH.
        const { policy, signaturen } = zaehlendePolicy([BOARD], [BOARD])
        const { socket, fordereAuth } = machSocket(BOARD)

        policy(socket)
        fordereAuth()
        await new Promise((fertig) => setTimeout(fertig, 0))

        assert.equal(signaturen(), 1, 'ein eigener Relay ohne Identität liefert nichts — und zwar stumm')
    })

    test('ein unbeteiligter Relay bleibt unberuehrt', async () => {
        const { policy, signaturen } = zaehlendePolicy([METRIK], [])
        const { socket, fordereAuth } = machSocket('wss://ein.anderer.relay/')

        policy(socket)
        fordereAuth()
        await new Promise((fertig) => setTimeout(fertig, 0))

        assert.equal(signaturen(), 1)
    })

    test('nur der Status Requested loest ueberhaupt etwas aus', async () => {
        // Schranke gegen einen Test, der aus dem falschen Grund grün ist: würde jede
        // Statusänderung signieren, wären die Fälle oben nicht aussagekräftig.
        const { policy, signaturen } = zaehlendePolicy([], [])
        const { socket, auth } = machSocket(METRIK)

        policy(socket)
        auth.emit(AuthStateEvent.Status, AuthStatus.None)
        auth.emit(AuthStateEvent.Status, AuthStatus.Ok)
        await new Promise((fertig) => setTimeout(fertig, 0))

        assert.equal(signaturen(), 0)
    })
})

/**
 * ── Die VERDRAHTUNG in `core.ts`, strukturell geprüft ─────────────────────────────
 *
 * Die Fälle oben messen die Policy mit UNSERER Verdrahtung — aber sie können nicht
 * sehen, ob `js/core.ts` sie auch so einhängt. Die Datei ist unter `node --test` nicht
 * ladbar (Boot-Seiteneffekte, `localStorage`), und genau dort saß der Befund: eine
 * `shouldAuth`-Zeile ohne Socket-Parameter, die `tsc` anstandslos durchwinkt.
 *
 * Deshalb hier ein Strukturtest über den Quelltext — dieselbe Bauform, die
 * `zapTargetSources.test.ts` (Ebene 2) für die Herkunft von Profilfeldern fährt: die
 * Deklaration darf nicht bloß behauptet sein, sie muss im Code stehen.
 *
 * **Was er NICHT leistet:** er liest Text, keine Semantik. Wer `darfAuthBekommen` in
 * `core.ts` umbenennt und die Bedeutung dreht, kommt daran vorbei. Er fängt den Fall, der
 * eingetreten ist — den stillen Rückbau auf einen ignorierten Parameter.
 */
describe('P6/F2: core.ts hängt den Riegel auch wirklich ein', () => {
    const coreQuelle = (): string =>
        readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'core.ts'), 'utf8')

    /**
     * Derselbe Quelltext mit **zusammengefaltetem Weissraum** — Zeilenumbrueche und
     * Einrueckung werden zu je einem Leerzeichen.
     *
     * **Das ist kein Komfort, sondern die Reparatur eines Deckungslochs.** Der erste
     * Entwurf suchte die EINE Zeile mit `const METRIK_RELAYS`. Als die Deklaration beim
     * naechsten Fix ueber zwei Zeilen umbrach, wurde der Test rot — und zwar ohne jede
     * inhaltliche Aenderung. Aufgefallen ist das nur, weil eine Mutationsprobe daneben
     * lief: sonst waere das Rot ihr zugeschrieben worden und der Test haette als wirksam
     * gegolten, obwohl er nichts mehr prueft.
     *
     * Ein Strukturtest ueber Quelltext darf nicht an der Formatierung haengen — sonst
     * misst er den Zeilenumbruch statt der Zusage.
     */
    const coreGefaltet = (): string => coreQuelle().replace(/\s+/g, ' ')

    test('shouldAuth wertet den SOCKET aus, nicht nur den Pubkey', () => {
        const quelle = coreGefaltet()

        // Der Bestandscode war `shouldAuth: () => Boolean(pubkey.get())` — ein leeres
        // Parameterpaar ist damit das Fehlerbild, gegen das dieser Fall steht.
        assert.equal(
            /shouldAuth:\s*\(\s*\)\s*=>/.test(quelle),
            false,
            'shouldAuth ignoriert den Socket wieder — jeder fremde Relay bekäme den Pubkey des Lesers',
        )
        assert.match(quelle, /shouldAuth:\s*\(socket\)\s*=>/)
        assert.match(quelle, /darfAuthBekommen\(socket\.url\)/)
    })

    test('die Metrik-Relais werden aus der KONFIGURATION gelesen, nicht aus einer Literalliste', () => {
        const quelle = coreQuelle()

        // **Nur die DEKLARATION, nicht die ganze Datei.** Ein `includes('nos.lol')` über
        // den gesamten Quelltext war der erste Entwurf und schlug fehl — `nos.lol` steht
        // dort seit jeher in `DEFAULT_RELAYS` und `SIGNER_RELAYS`. Das wäre ein
        // Fehlalarm gewesen, der wie ein Befund aussieht.
        //
        // Ausgeschnitten wird über den GEFALTETEN Text bis zur schließenden Klammer,
        // nicht über eine Zeile — siehe `coreGefaltet`.
        // **Bis zum Ende der ANWEISUNG, nicht bis zur ersten passenden Klammer.** Der
        // erste Entwurf schnitt bei `\)` ab und hielt damit weniger, als der Kommentar
        // unten zusagt: ein `.concat([…])` oder ein zweites Set-Element dahinter blieb
        // ungeprüft. Der Kommentar behauptete „keine Literaladresse" für die ganze
        // Deklaration — geprüft war ein Ausschnitt. Ein Satz, der mehr zusagt als die
        // Prüfung, ist in diesem Vorhaben dreimal zum Blocker geworden.
        // **Bis zum Ende der ANWEISUNG — geklammert gezählt, nicht bis zum nächsten
        // `const`.** Der vorige Schnitt lief bis dorthin und umfasste 3885 Zeichen,
        // inklusive fremder Docblöcke: ein `wss://` in irgendeinem Kommentar dieser
        // Region hätte den Test grundlos rot gemacht. Und ein Test, der grundlos rot
        // wird, wird irgendwann entschärft — dann ist die Prüfung ganz weg.
        const ab = quelle.indexOf('const METRIK_RELAYS')
        let tiefe = 0
        let bis = ab
        for (let i = ab; i < quelle.length; i += 1) {
            const z = quelle[i]
            if (z === '(') {
                tiefe += 1
            } else if (z === ')') {
                tiefe -= 1
                if (tiefe === 0) {
                    bis = i + 1
                    break
                }
            }
        }
        const deklaration = ab < 0 ? undefined : quelle.slice(ab, bis)

        assert.ok(deklaration, 'METRIK_RELAYS nicht gefunden — der Riegel hat seine Quelle verloren')
        // Die Schranke gegen einen Schnitt, der wieder zu weit greift: die Deklaration
        // ist eine Zeile Code, kein Kapitel.
        assert.ok(deklaration.length < 400, `Der Schnitt umfasst ${deklaration.length} Zeichen — er greift über die Anweisung hinaus.`)
        assert.match(deklaration, /__nostrArticleRelays/)
        // **`…Nachsichtig` und nicht der strenge Leser.** `core.ts` wird ausschließlich
        // STATISCH importiert; ein Wurf im Modul-Toplevel reißt die ganze Client-Insel
        // beim Boot ab, stumm, ausgelöst von einem Betreiber-Tippfehler.
        assert.match(deklaration, /leseRelayListeNachsichtig\(/)
        // Eine eingebaute Fremdadresse wäre der Fehler, den P6 an anderer Stelle schon
        // einmal gemacht hat (und der jeden E2E-Lauf gegen den Relay-Wächter fahren ließe).
        assert.equal(/wss:\/\//.test(deklaration), false, 'die Metrik-Relais dürfen keine Literaladresse tragen')
    })

    test('KALIBRIERUNG: der Strukturtest sieht den Quelltext ueberhaupt', () => {
        // Die Schranke, ohne die jedes „passt" hier wertlos waere: findet der Leser die
        // Datei nicht oder liest er Leeres, meldet er ebenfalls nichts Auffaelliges.
        const quelle = coreGefaltet()

        assert.ok(quelle.length > 5_000, `core.ts wirkt zu kurz (${quelle.length} Zeichen) — liest der Test die richtige Datei?`)
        assert.match(quelle, /makeSocketPolicyAuth\(/)
        assert.match(quelle, /const METRIK_RELAYS/)
    })
})
