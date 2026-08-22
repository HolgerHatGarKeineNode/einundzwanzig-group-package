/**
 * Der eigentliche Riegel hinter dem Import-Gate: **jedes Modul in `js/` lädt unter node.**
 *
 * `importEndungenGate.ts` prüft nur den Proxy (Import-Stil). P2 hat gezeigt, dass ein
 * Modul auch aus einem ganz anderen Grund scheitern kann — `js/toast.ts` hing an
 * `document.addEventListener` im Toplevel, kein einziger endungsloser Import beteiligt.
 * Ein Gate, das nur Importe zählt, hätte diesen Fall nie gesehen.
 *
 * Klassifiziert wird auf **Exit-Code**, nie auf Fehlertext: node gibt beim
 * `--experimental-strip-types`-Lauf teils Warnungen auf stderr aus (z. B. „localStorage is
 * not available because --localstorage-file was not provided"), die nichts mit einem
 * echten Ladefehler zu tun haben. Eine frühere Messung in diesem Haus hat genau daran
 * `displayPrefs.ts` fälschlich als „Browser-Global fehlt" eingestuft (Plan, Abschnitt „Die
 * Vorab-Messung"). `execFile` liefert den Exit-Code über resolve/reject — reject heißt
 * ungleich 0.
 */
import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export type Ladeergebnis = { datei: string; ladbar: boolean; fehler: string | null }

function ladeUnterNode(jsDir: string, dateiname: string): Promise<Ladeergebnis> {
    return new Promise((resolve) => {
        // Der Modul-Spezifizierer wird über `JSON.stringify` gebaut, NICHT als
        // Template-Literal mit direkt eingebettetem Anführungszeichen. Grund ist keine
        // Stilfrage: ein Literal wie `` `import('./${dateiname}')` `` enthält im
        // QUELLTEXT dieser Datei wörtlich `import('./`, und `importEndungenGate.ts`
        // scannt `js/*.ts` — inklusive dieser Datei. Genau das ist beim ersten Entwurf
        // passiert: das eigene Ladbarkeits-Gate hat sich selbst als endungslosen Import
        // gemeldet (gemessen, `npm run test:unit`, 2026-08-22).
        const geladenAusdruck = `await import(${JSON.stringify('./' + dateiname)})`
        execFile(
            process.execPath,
            ['--experimental-strip-types', '--input-type=module', '-e', geladenAusdruck],
            { cwd: jsDir, timeout: 10_000 },
            (fehler, _stdout, stderr) => {
                resolve({
                    datei: dateiname,
                    ladbar: fehler === null,
                    fehler: fehler === null ? null : stderr || String(fehler),
                })
            },
        )
    })
}

/**
 * Begrenzte Parallelität statt eines Subprozesses je Modul in Serie — 112 Module in Serie
 * kosten rund 100 s (gemessen 2026-08-22), das sprengt jedes Test-Tor. Ein simpler
 * Worker-Pool statt einer Bibliothek: `limit` Läufer ziehen sich Dateien von einem
 * gemeinsamen Index, bis die Liste leer ist.
 */
async function mapMitLimit<T, R>(eintraege: T[], limit: number, fn: (e: T) => Promise<R>): Promise<R[]> {
    const ergebnisse: R[] = new Array(eintraege.length)
    let naechsterIndex = 0
    async function laeufer(): Promise<void> {
        while (naechsterIndex < eintraege.length) {
            const i = naechsterIndex
            naechsterIndex += 1
            ergebnisse[i] = await fn(eintraege[i]!)
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, eintraege.length) }, laeufer))
    return ergebnisse
}

export const MIN_MODULE = 100

/** Module ohne eigenen Test — genau die 112, deckungsgleich mit der Plan-Messung. */
export function sammleModule(jsDir: string): string[] {
    return readdirSync(jsDir)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'))
        .sort()
}

export async function pruefeLadbarkeit(jsDir: string, parallelitaet = 8): Promise<Ladeergebnis[]> {
    const module = sammleModule(jsDir)
    if (module.length < MIN_MODULE) {
        throw new Error(
            `Das Ladbarkeits-Gate hat nur ${module.length} Module unter ${jsDir} gesehen ` +
                `(erwartet: mindestens ${MIN_MODULE}). Fail-closed statt „alle ladbar" zu behaupten.`,
        )
    }
    return mapMitLimit(module, parallelitaet, (datei) => ladeUnterNode(jsDir, datei))
}
