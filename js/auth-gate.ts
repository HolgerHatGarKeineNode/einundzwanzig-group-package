/**
 * Kontextueller Auth-Gate (§4.2). Bewusst welshman-app-frei — die
 * sicherheitsrelevante Kern-Logik ist als JS-Unit (tests/e2e/*-logic.spec.ts)
 * OHNE welshman-Boot prüfbar (wie `portal-auth-event`). Der Alpine-Store lebt in
 * `bridge.ts` und ruft nur diese reinen Funktionen.
 */

/**
 * Ist ein welshman-pubkey in localStorage? welshman `sync` schreibt den pubkey-
 * Store JSON-serialisiert — für Gäste landet dabei der ROH-String "undefined"
 * (`localStorage.setItem(k, JSON.stringify(undefined))` → Coercion zu "undefined")
 * bzw. "null" im Slot. `JSON.parse("undefined")` WIRFT (kein truthy-Fall!), darum
 * defensiv: leere/Sentinel-Werte sind Gäste, ein Parse-Fehler zählt als „nicht
 * eingeloggt". Ein echter pubkey steht als JSON-String (`"\"<hex>\""`) → truthy.
 */
export function isAuthed(raw: string | null | undefined): boolean {
    if (! raw || raw === 'undefined' || raw === 'null') {
        return false
    }
    try {
        return Boolean(JSON.parse(raw))
    } catch {
        return false
    }
}

/**
 * Same-Origin-Pfad aus `?return` (Open-Redirect-Schutz an der Trust-Grenze): nur
 * eigene absolute Pfade („/…") — kein „//host"/„/\host" (protokoll-relativ), kein
 * http(s):-Ziel, und KEINE Steuerzeichen. Steuerzeichen sind kritisch: der WHATWG-
 * Parser strippt Tab/CR/LF beim `location.assign`, „/\t//evil" würde sonst zu
 * „//evil" (fremde Origin). `null` = nichts Sicheres → der Aufrufer nimmt sein
 * Default (Chat/Spaces). Reine String-Logik (kein `location`), Node-Unit-prüfbar.
 */
export function sanitizeReturnUrl(raw: string | null | undefined): string | null {
    if (! raw || raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') {
        return null
    }
    for (let i = 0; i < raw.length; i++) {
        const code = raw.charCodeAt(i)
        if (code < 0x20 || code === 0x7f) {
            return null
        }
    }
    return raw
}
