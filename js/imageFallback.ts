/**
 * P7 (Proxy-Rückfall) — die Unterscheidung, die der Bild-Fallback braucht:
 * „Proxy konnte nicht" vs. „Ziel ist nicht proxyfähig".
 *
 * Seit PLAN4 IMG proxifiziert `proxifyImage` (core.ts) ALLES außer `data:`/`blob:`.
 * Der Proxy-Controller wiederum lehnt eine URL schon VOR jedem Fetch per POLICY ab
 * (`ImageProxyController::isSafeUrl`: absoluter `https`-Scheme + öffentlicher Host,
 * sonst 400): protokoll-relativ (`//evil.example/x.png`), `http:`, unbekannte
 * Schemata, relative Pfade, private/reservierte Hosts. Genau diese URLs dürfen im
 * Fehlerfall AUCH NICHT ROH geladen werden — sonst fragt der Browser des Lesers
 * direkt beim Angreifer-Host an (IP/UA-Leak ohne Klick, gemessen:
 * `docs/plans/…/p7-proxy-repro-vorher.log` im Host-Repo). Ein Fehlschlag des
 * Proxys bei einer URL, die die Policy PASSIERT (403 gegen unseren User-Agent,
 * zu groß, Timeout, kein Bild), ist dagegen ein Upstream-Problem — dann MUSS das
 * Original weiter angezeigt werden, sonst verlören wir legitime Bilder.
 *
 * Dieses Modul ist bewusst welshman-frei und Import-frei: es liegt in eigenem
 * Datei-, wird von `core.ts` neben `proxifyImage` re-exportiert und ist damit
 * unter `node --test` direkt testbar (`imageFallback.test.ts`) — die Alternative
 * (Vertrag im Test duplizieren, Muster `longform.test.ts`) ist für NEUEN Code
 * nicht nötig und würde driften.
 *
 * Grenze der Client-Seitigkeit — DNS: Ob ein HOSTNAME privat oder gar nicht
 * auflöst, kann der Client nicht wissen. Solche Ziele lehnt der Proxy zwar ab,
 * der Browser fragt im Roh-Rückfall aber nur seinen Resolver — eine Verbindung
 * zu einem nicht existierenden oder privaten Ziel entsteht dabei nicht. Dasselbe
 * Rest-Risiko trägt die Serverseite (DNS-Rebinding, `isSafeHost`-Doku).
 */
const INLINE_SRC = /^(?:data|blob):/i
const HTTPS_ABSOLUTE = /^https:\/\/([^\s/?#]+)/i
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const LOCALHOST_NAMES = /(^|\.)localhost$|\.local$|\.internal$/

/** Hostname- oder IPv4/IPv6-Literal-Anteil einer https-URL, Kleinbuchstaben. */
const hostOf = (url: string): string | null => {
    const match = url.match(HTTPS_ABSOLUTE)
    return match ? match[1].replace(/^\[|\]$/g, '').toLowerCase() : null
}

/** Private/reservierte IPv4-Bereiche — gespiegelt zu FILTER_FLAG_NO_PRIV_RANGE/_RES_RANGE. */
const isPrivateV4 = (host: string): boolean => {
    const match = host.match(IPV4)
    if (!match) {
        return false
    }
    const [a, b] = [Number(match[1]), Number(match[2])]
    return (
        a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||   // CGNAT 100.64/10
        (a === 169 && b === 254) ||             // link-local
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0) ||               // 192.0.0.0/24 + 192.0.2.0/24
        a >= 224                                // multicast + reserved
    )
}

/** Loopback/ULA/link-local eines IPv6-Literals; IPv4-mapped prüft dessen v4-Teil. */
const isPrivateV6 = (host: string): boolean => {
    if (host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)) {
        return true
    }
    const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
    return mapped ? isPrivateV4(mapped[1]) : false
}

/**
 * Darf der Browser diese Bild-URL im FEHLERFALL roh (ohne Proxy) nachladen?
 *
 * `true` nur für absolute `https`-URLs, deren Host nach Textlage öffentlich ist —
 * genau die Klasse, bei der ein Proxy-Fehler „Proxy konnte nicht" heißt und das
 * Original angezeigt werden MUSS. `false` für alles, was der Proxy per Policy
 * ablehnt (protokoll-relativ, `http:`, andere Schemata, relative Pfade) und für
 * `data:`/`blob:` (deren Fehlschlag ist am Inline-src endgültig — ein „Rückfall"
 * auf denselben Wert wäre ein zweiter Anlauf ins Nichts).
 */
export function mayFallbackToRaw(url: unknown): boolean {
    const src = typeof url === 'string' ? url.trim() : ''
    if (src === '' || INLINE_SRC.test(src)) {
        return false
    }
    const host = hostOf(src)
    if (host === null || host === '' || LOCALHOST_NAMES.test(host)) {
        return false
    }
    if (host.includes(':')) {
        return !isPrivateV6(host)
    }
    return !isPrivateV4(host)
}
