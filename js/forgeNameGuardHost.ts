/**
 * Ein Türöffner für `forge.ts` unter `node --test` — **kein Nachbau**.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 *
 * `forge.ts` ist die unreine Hälfte der Forge und zieht über `bridge`-nahe
 * Module `@welshman/store` nach, dessen `synced()` beim MODULLADEN auf
 * `localStorage` zugreift (`@welshman/store/dist/store/src/synced.js:8`). Unter
 * node gibt es das nur mit `--localstorage-file`, und dieses Flag steht nicht im
 * Testlauf (`npm run test:unit`). Ein `import` von `forge.ts` in einer
 * Prüfstandsdatei liesse deshalb die ganze Datei scheitern — nicht mit einer
 * Zusicherung, sondern beim Laden.
 *
 * Die Alternative wäre gewesen, den Riegel im Prüfstand NACHZUBAUEN. Genau das
 * war der Fehler, den N4 an dieser Sonde gefunden hat: ein nachgebauter Riegel
 * prüft sich selbst und sieht keine Regression an der echten Stelle. Deshalb
 * hier ein Polyfill statt einer Kopie — der Prüfstand bekommt die ECHTE
 * Funktion.
 *
 * ── Was das Polyfill ist, und was es nicht ist ──────────────────────────────
 *
 * Ein `Map` hinter der `Storage`-Oberfläche, im Speicher, ohne Rückschreiben.
 * Es macht `forge.ts` **ladbar**, nicht funktionsfähig: Netz, Relay und Signer
 * fehlen weiter, und keine Ableitung dieses Moduls wird hier ausgeführt.
 * Geprüft wird ausschliesslich {@link nameOf} — eine reine Funktion über einen
 * Schlüssel, die kein Netz braucht.
 */
if (typeof globalThis.localStorage === 'undefined') {
    const speicher = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string): string | null => speicher.get(key) ?? null,
            setItem: (key: string, value: string): void => void speicher.set(key, String(value)),
            removeItem: (key: string): void => void speicher.delete(key),
            clear: (): void => speicher.clear(),
            key: (index: number): string | null => [...speicher.keys()][index] ?? null,
            get length(): number {
                return speicher.size
            },
        },
    })
}

export { nameOf } from './forge.ts'
