/**
 * **Der kind-0-Workspace-Riegel — die erste automatisierte Abdeckung, die ohne Stack läuft.**
 *
 * Ausführen (läuft in `npm run test:unit` mit, Repo-Root):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/welshmanWorkspaceRiegel.test.ts
 *
 * ── Warum es diese Datei gibt ─────────────────────────────────────────────────────
 *
 * `hostVon` und `istWorkspaceSocket` (`js/welshmanInstance.ts`) tragen Risiko R3 des
 * Sprung-Plans: kein kind 0 vom Workspace-Relay ins Repository. Buzz legt beim
 * Onboarding eigene Profile an; kind 0 ist ersetzbar, im Repository gewinnt der jüngste
 * Zeitstempel — ein durchgelassenes Buzz-Profil verdrängt app-weit das echte.
 *
 * **Bis zum 2026-08-29 hatte dieser Riegel NULL automatisierte Abdeckung** (paketweit
 * gesucht: beide Symbole kamen nur in ihrer eigenen Datei vor). Er ruhte auf
 * Handmessungen aus zwei Gate-Runden — gründlich, aber sie laufen nie wieder. Die
 * einzige E2E-Abdeckung (`workspaces.spec.ts:256`) hängt an einem Buzz-Stack, den kein
 * Lauf-Modus startet, und wird deshalb übersprungen statt ausgeführt.
 *
 * Die Lagen unten sind **die gemessenen** aus jenen Gate-Runden, hier als Unit
 * festgehalten. Jede Erwartung ist am installierten welshman nachgemessen (2026-08-29),
 * keine ist aus der Spezifikation abgeleitet.
 *
 * ── Warum der Riegel einen Parameter bekommen hat ────────────────────────────────
 *
 * `WORKSPACE` entsteht auf MODUL-TOPLEVEL aus `globalThis.__nostrWorkspace`
 * (`js/relayConfig.ts:89,138`). **Genau diese Kopplung ist der Grund, warum der Riegel
 * nie einen Test hatte** — eine Modulkonstante lässt sich je Fall nicht setzen.
 * `istWorkspaceSocket` nimmt den Workspace deshalb seit dem 2026-08-29 als zweiten
 * Parameter mit `= WORKSPACE` als Vorgabe: jede Aufrufstelle bleibt Zeichen für Zeichen
 * dieselbe, die Funktion wird rein.
 *
 * **Der Umweg, der NICHT trägt, und warum er hier steht:** der erste Entwurf lud je Fall
 * einen frischen Modulgraphen (`import('./welshmanInstance.ts?fall=N')`) und setzte
 * vorher `globalThis.__nostrWorkspace`. Gemessen: **die Query bustet nur den
 * Einstiegsknoten, nicht seine Abhängigkeiten.** `welshmanInstance.ts` importiert
 * `./relayConfig.ts` OHNE Query, alle Instanzen teilen sich also dieselbe — die des
 * ERSTEN Ladevorgangs. Der Fixture-Fehler sah aus wie ein Produktfehler (ein Fall, der
 * grün sein musste, war rot). Wer diese Technik hier wieder einführt, misst wieder sich
 * selbst.
 *
 * Die drei KONFIGURATIONSLAGEN und die „je genau einmal"-Warnungen hängen weiterhin an
 * Modul-Singletons; sie stehen deshalb unten in eigenen KINDPROZESSEN — ein Prozess, ein
 * Zustand, keine Cache-Frage.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hostVon, istWorkspaceSocket } from './welshmanInstance.ts'

const WORKSPACE = 'wss://buzz.example/'
const WORKSPACE_PORT = 'wss://buzz.example:7777/'

// ── Ebene 1: `hostVon` allein ──────────────────────────────────────────────────────

describe('hostVon: Host inklusive Port, ohne Wurzelpunkt', () => {
    const faelle: [string, string][] = [
        ['wss://buzz.example/', 'buzz.example'],
        // WHATWG kollabiert den Default-Port des Schemas — `wss:` ist 443.
        ['wss://buzz.example:443/', 'buzz.example'],
        ['wss://buzz.example:7777/', 'buzz.example:7777'],
        // Der Wurzelpunkt ist im DNS derselbe Name; er muss weg — mit UND ohne Port.
        ['wss://buzz.example./', 'buzz.example'],
        ['wss://buzz.example.:7777/', 'buzz.example:7777'],
        // Grossschreibung normalisiert die URL-API selbst.
        ['wss://BUZZ.EXAMPLE/', 'buzz.example'],
        // IDN wird zu Punycode — beide Schreibweisen landen auf demselben Wert.
        ['wss://büzz.example/', 'xn--bzz-hoa.example'],
        ['wss://xn--bzz-hoa.example/', 'xn--bzz-hoa.example'],
        // Ein Homoglyph ist ein ANDERER Name, und Punycode macht das sichtbar.
        ['wss://buzz.exаmple/', 'buzz.xn--exmple-4nf'],
        ['wss://[2001:db8::1]/', '[2001:db8::1]'],
        // `@` trennt Benutzerinfo vom Host — der Host ist, was DAHINTER steht.
        ['wss://buzz.example@evil.tld/', 'evil.tld'],
        // Der Backslash ist bei speziellen Schemata ein Pfadtrennzeichen, KEIN Teil der
        // Benutzerinfo: der Host endet davor. Zwei Zeichen Unterschied, zwei Hosts.
        ['wss://buzz.example\\@evil.tld/', 'buzz.example'],
    ]

    for (const [url, erwartet] of faelle) {
        test(`${url} → ${erwartet}`, () => {
            assert.equal(hostVon(url), erwartet)
        })
    }

    test('eine unbrauchbare URL ergibt den leeren Host', () => {
        assert.equal(hostVon('nicht mal eine url'), '')
        assert.equal(hostVon(''), '')
    })
})

// ── Ebene 2: der Riegel über die gemessenen Lagen ─────────────────────────────────

describe('istWorkspaceSocket: Workspace ohne Port', () => {
    const trifft: [string, string][] = [
        ['identisch', 'wss://buzz.example/'],
        ['anderer Pfad — genau die Lage, die den Riegel in P4 auf den Host umgestellt hat', 'wss://buzz.example/nostr'],
        ['Query-String', 'wss://buzz.example/?x=1'],
        ['Grossschreibung', 'wss://BUZZ.EXAMPLE/'],
        ['expliziter Default-Port :443', 'wss://buzz.example:443/'],
        ['Wurzelpunkt in der Socket-URL', 'wss://buzz.example./'],
        ['Backslash-Form: der Host endet vor dem Backslash', 'wss://buzz.example\\@evil.tld/'],
    ]

    const trifftNicht: [string, string][] = [
        ['anderer Port ist ein anderer Dienst', 'wss://buzz.example:7777/'],
        ['Subdomain', 'wss://sub.buzz.example/'],
        ['Präfix', 'wss://evilbuzz.example/'],
        ['Suffix — der Klassiker unter den Namensangriffen', 'wss://buzz.example.evil.tld/'],
        ['Homoglyph (kyrillisches а)', 'wss://buzz.exаmple/'],
        ['IDN-Unicode', 'wss://büzz.example/'],
        ['IDN-Punycode', 'wss://xn--bzz-qla.example/'],
        ['IPv6-Klammerform', 'wss://[2001:db8::1]/'],
        ['user@host: der Host ist evil.tld, nicht buzz.example', 'wss://buzz.example@evil.tld/'],
        ['fremder Relay', 'wss://relay.damus.io/'],
    ]

    for (const [name, url] of trifft) {
        test(`GREIFT — ${name}`, () => {
            assert.equal(istWorkspaceSocket(url, WORKSPACE), true, url)
        })
    }

    for (const [name, url] of trifftNicht) {
        test(`greift NICHT — ${name}`, () => {
            assert.equal(istWorkspaceSocket(url, WORKSPACE), false, url)
        })
    }
})

describe('istWorkspaceSocket: Workspace MIT Port — der Wurzelpunkt in beiden Richtungen', () => {
    /*
     * **Die Lage, an der die erste Normalisierung vorbeiging.** `host.replace(/\.$/, '')`
     * trifft nur einen Punkt am ZEICHENKETTENENDE. Steht ein Port dahinter, überlebt der
     * Punkt: `buzz.example.:7777` ≠ `buzz.example:7777` — der Riegel greift nicht, und der
     * Melder fällt mit ihm aus, weil er dieselbe Host-Gleichheit voraussetzt.
     *
     * Heute ohne erreichbare Wirkung (der Produktions-Workspace trägt keinen Port, der
     * Teststack keinen Wurzelpunkt) — aber es ist dieselbe Umgehung, gegen die die
     * Normalisierung überhaupt gebaut wurde, eine Ebene tiefer. Gemessen am 2026-08-29.
     */
    test('GREIFT — Wurzelpunkt in der SOCKET-URL, Port dahinter', () => {
        assert.equal(istWorkspaceSocket('wss://buzz.example.:7777/', WORKSPACE_PORT), true)
    })

    test('GREIFT — dieselbe Lage ohne Punkt (Gegenprobe: der Fall darüber misst den PUNKT)', () => {
        assert.equal(istWorkspaceSocket('wss://buzz.example:7777/', WORKSPACE_PORT), true)
    })

    test('greift NICHT — anderer Port trennt auch mit Wurzelpunkt', () => {
        assert.equal(istWorkspaceSocket('wss://buzz.example.:9999/', WORKSPACE_PORT), false)
    })
})

describe('istWorkspaceSocket: Wurzelpunkt in der KONFIGURATION — die Gegenrichtung', () => {
    /* Symmetrisch: steht der Punkt in `__nostrWorkspace`, kämen sonst alle gewöhnlichen
     * Schreibweisen durch. Beide Seiten laufen durch dieselbe Funktion, deshalb muss die
     * Zusage in beide Richtungen gelten. */
    test('GREIFT — Punkt in der Konfiguration, gewöhnliche Socket-URL', () => {
        assert.equal(istWorkspaceSocket('wss://buzz.example/', 'wss://buzz.example./'), true)
    })

    test('GREIFT — Punkt in der Konfiguration, mit Port auf beiden Seiten', () => {
        assert.equal(istWorkspaceSocket('wss://buzz.example:7777/', 'wss://buzz.example.:7777/'), true)
    })
})

// ── Ebene 3: die drei Konfigurationslagen, je im eigenen Prozess ──────────────────

/**
 * Eine Lage messen: `__nostrWorkspace` setzen, den echten Modulgraphen laden, und
 * `WORKSPACE`, die Zahl der Warnungen und den Riegel zurückgeben.
 *
 * **Ein Prozess je Lage, und das ist keine Bequemlichkeit.** `WORKSPACE`,
 * `WORKSPACE_ROH` und die beiden Warnungs-Flags sind Modul-Singletons; im selben Prozess
 * gibt es sie genau einmal. Der naheliegende Ausweg (`import(…?fall=N)`) trägt NICHT —
 * er bustet nur den Einstiegsknoten, nicht `relayConfig.ts` darunter (gemessen, siehe
 * Modulkopf). Ein eigener Prozess hat genau einen Zustand und keine Cache-Frage.
 */
const messeLage = (cfg: string): { WORKSPACE: string; warnungen: number; riegel: boolean; text: string } => {
    const skript =
        `globalThis.__nostrWorkspace=${JSON.stringify(cfg)};` +
        'const w=[];console.warn=(...a)=>w.push(a.map(String).join(" "));' +
        `const m=await import(${JSON.stringify(new URL('./welshmanInstance.ts', import.meta.url).href)});` +
        `const rc=await import(${JSON.stringify(new URL('./relayConfig.ts', import.meta.url).href)});` +
        'console.log("ERGEBNIS "+JSON.stringify({WORKSPACE:rc.WORKSPACE,warnungen:w.length,' +
        'riegel:m.istWorkspaceSocket("wss://buzz.example/"),text:(w[0]||"").slice(0,60)}))'
    const aus = execFileSync(process.execPath, ['--experimental-strip-types', '-e', skript], {
        encoding: 'utf8',
        timeout: 60_000,
        cwd: fileURLToPath(new URL('..', import.meta.url)),
    })
    const zeile = aus.split('\n').find((z) => z.startsWith('ERGEBNIS '))
    assert.ok(zeile, `Kindprozess lieferte keine Messzeile. Ausgabe: ${aus.slice(0, 400)}`)

    return JSON.parse(zeile.slice('ERGEBNIS '.length)) as ReturnType<typeof messeLage>
}

describe('Die drei Konfigurationslagen — und die Richtung ihres Ausfalls', () => {
    test('konfiguriert & brauchbar → Riegel SCHARF, keine Warnung', () => {
        const lage = messeLage(WORKSPACE)
        assert.equal(lage.WORKSPACE, WORKSPACE)
        assert.equal(lage.riegel, true, 'der Riegel muss bei brauchbarer Konfiguration greifen')
        assert.equal(lage.warnungen, 0, `unerwartete Warnung: ${lage.text}`)
    })

    test('konfiguriert & UNBRAUCHBAR → Riegel aus, GENAU EINE Warnung', () => {
        // Der stille Ausfall, gegen den die Warnung gebaut ist: seit die Normalisierung
        // nachsichtig ist, sieht „kaputt konfiguriert" aus wie „gar nicht konfiguriert" —
        // der Workspace-Tab fehlt, der Riegel greift nie, und niemand erfährt es.
        const lage = messeLage('wss:// kaputt/')
        assert.equal(lage.WORKSPACE, '')
        assert.equal(lage.riegel, false)
        assert.equal(lage.warnungen, 1, 'genau eine Warnung — keine, die pro Event feuert, und keine, die schweigt')
        assert.match(lage.text, /Workspace konfiguriert, aber unbrauchbar/)
    })

    test('NICHT konfiguriert → Riegel aus, NULL Warnungen', () => {
        // Die Gegenprobe zur Zeile darüber: ohne sie prüfte „genau eine Warnung" nur,
        // dass überhaupt gewarnt wird — nicht, dass der Normalfall still bleibt.
        const lage = messeLage('')
        assert.equal(lage.WORKSPACE, '')
        assert.equal(lage.riegel, false)
        assert.equal(lage.warnungen, 0, `der Normalfall muss schweigen, bekam aber: ${lage.text}`)
    })
})

// ── Ebene 4: die Verdrahtung — ruft der Ingest-Pfad den Riegel überhaupt? ─────────

describe('Verdrahtung: der Riegel hängt im Empfangspfad, vor dem Schreiben', () => {
    /*
     * **Warum hier Quelltext geprüft wird und nicht Verhalten.** Der ehrliche Test wäre,
     * ein kind 0 durch `app.pool` zu schicken und im Repository nachzusehen. Gemessen am
     * 2026-08-29: `app.pool.get(url)` baut eine ECHTE WebSocket-Verbindung auf, der
     * Prozess lief in den 2-Minuten-Deckel und beendete sich nicht. Ein Unit-Test, der
     * ins Netz telefoniert, ist keiner — und genau diese Klasse Fehler hat der Sprung
     * schon einmal in die Suite gebracht (Plan: „die Unit-Tests telefonierten nach dem
     * Sprung ins Internet").
     *
     * Also die kleinere, ehrliche Zusage: die Ebenen 1–3 messen die REGEL, dieser Fall
     * hält fest, dass sie im Empfangspfad überhaupt AUFGERUFEN wird. Ohne ihn bliebe die
     * ganze Datei grün, wenn jemand den Riegel aus `ingestMitWorkspaceRiegel` entfernt.
     * Das Verhaltensgegenstück dazu ist `workspaces.spec.ts:256` — und das läuft, seit
     * dieser Runde, im eigenen Lauf-Modus mit Buzz-Stack.
     */
    const quelle = (): string => execFileSync('cat', [fileURLToPath(new URL('./welshmanInstance.ts', import.meta.url))], { encoding: 'utf8' })

    test('ANKER: die Policy prüft kind 0 gegen den Workspace, bevor sie schreibt', () => {
        const text = quelle()
        const policy = text.slice(text.indexOf('const ingestMitWorkspaceRiegel'))
        const rumpf = policy.slice(0, policy.indexOf('\n}\n') + 1)
        assert.ok(rumpf.length > 100, 'Rumpf der Policy nicht gefunden — dieser Anker misst nichts mehr')

        const prof = rumpf.indexOf('event.kind === PROFILE')
        const riegel = rumpf.indexOf('istWorkspaceSocket(socket.url)')
        const schreiben = rumpf.indexOf('repository.publish')

        assert.ok(prof > -1, 'kein kind-0-Zweig mehr in der Ingest-Policy')
        assert.ok(riegel > -1, 'die Ingest-Policy ruft `istWorkspaceSocket` nicht mehr — der Riegel ist abgeklemmt')
        assert.ok(schreiben > -1, 'kein `repository.publish` mehr in der Policy — misst dieser Anker die richtige Stelle?')
        assert.ok(prof < riegel, 'der Riegel steht nicht im kind-0-Zweig')
        assert.ok(riegel < schreiben, 'der Riegel steht NACH dem Schreiben ins Repository — dann kommt das Profil trotzdem an')
    })
})

// ── Ein BEFUND, festgehalten statt gemeldet und vergessen ─────────────────────────

describe('BEFUND (2026-08-29): eine kaputte Socket-URL WIRFT, statt nicht zu treffen', () => {
    /*
     * **Das hier ist der IST-Zustand, nicht der Sollzustand.** Der Docblock von
     * `istWorkspaceSocket` sagt „Ein leerer Host (kaputte URL) trifft nie" — das stimmt
     * für `hostVon` (das fängt), aber `istWorkspaceSocket` ruft `normalizeRelayUrl` VOR
     * `hostVon`, und das wirft. Die Zusage gilt also eine Ebene zu hoch.
     *
     * **Heute ohne erreichbare Wirkung:** `socket.url` kommt aus dem Pool und ist dort
     * bereits normalisiert; eine unbrauchbare URL erreicht diesen Aufruf nicht. Deshalb
     * nur festgehalten und nicht behoben — eine Produktionsänderung war für diese Runde
     * nicht beauftragt.
     *
     * Wer das behebt (`try`/`catch` um die Normalisierung, Rückgabe `false`), macht diesen
     * Fall rot. Das ist dann die richtige Richtung: Erwartung umdrehen, Docblock nachziehen.
     */
    test('IST-Zustand: `istWorkspaceSocket` wirft bei unbrauchbarer Socket-URL', () => {
        assert.throws(() => istWorkspaceSocket('nicht mal eine url', WORKSPACE), /Invalid URL/)
        // Gegenprobe: `hostVon` allein fängt sehr wohl — die Lücke sitzt zwischen beiden.
        assert.equal(hostVon('nicht mal eine url'), '')
    })
})
