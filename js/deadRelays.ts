/**
 * Abgelaufene Relay-Domains, die heute von Domain-Parkern betrieben werden.
 *
 * ── Warum das überhaupt ein Problem ist ────────────────────────────────────────
 *
 * welshman zieht zu JEDEM geöffneten Socket sofort die NIP-11-Info per HTTPS nach
 * (`@welshman/app`: `Pool.get().subscribe(socket => loadRelay(socket.url))`). Läuft
 * die Domain eines Relays ab und übernimmt ein Parker sie, antwortet sie auf
 * `Accept: application/nostr+json` mit HTML statt JSON — samt `<script src>` auf
 * eine Verkaufsseite (gemessen: `assets.abovedomains.com/javascript/forsale.min.js`
 * bzw. `sedoparking.com`). Virenscanner werten genau das als `JS/Redirector.TUJ`
 * und melden es dem Nutzer, obwohl weder er noch die App etwas falsch gemacht hat.
 *
 * Solche Sockets entstehen ungefragt: das Outbox-Routing (NIP-65) folgt den
 * Write-Relays der Autoren, deren Events angezeigt werden. In der Kontaktliste
 * EINES Nutzers steckten acht dieser Domains, verteilt auf fünf Profile.
 *
 * ── Der Hebel ─────────────────────────────────────────────────────────────────
 *
 * Güte 0 ⇒ `scoreRelay` in `@welshman/router` (`getUrls`) rechnet
 * `-(0 * … * random())` = `-0` ⇒ in JS **falsy** ⇒ das `.filter(scoreRelay)` in
 * derselben Zeile wirft die URL raus ⇒ kein Socket ⇒ kein NIP-11-Abruf.
 * Nachgemessen gegen das echte `getUrls()`, nicht aus der Doku übernommen.
 *
 * ── Wartung: wann ein Eintrag WIEDER RAUSFLIEGT ────────────────────────────────
 *
 * Sobald die Domain wieder als Relay antwortet. Prüfen mit
 *   curl -sH 'Accept: application/nostr+json' https://<host>/
 * — JSON mit `name`/`supported_nips` ⇒ Eintrag löschen. HTML (Parkseite) ⇒ bleibt.
 * Wer die Liste im Bestand nachsehen will, wer also überhaupt betroffen ist:
 *   scripts/who-uses-relay.sh <url>          (welche Profile schreiben dorthin)
 *   scripts/find-dead-relay-sources.sh <npub> (welche Kontakte bringen tote mit)
 *
 * ── Was diese Liste NICHT kann ────────────────────────────────────────────────
 *
 * Sie lernt nichts. Eine unbekannte tote Domain wird beim ERSTEN Kontakt trotzdem
 * abgerufen — die Liste verhindert nur die Wiederholung bekannter Fälle. Bewusst
 * so: eine lernende Sperrliste bräuchte Persistenz, Ablauf, Wiedereintritt und
 * Diagnose (verworfen). Den nutzereigenen, portablen Weg deckt NIP-51 kind 10006
 * ab — die Liste lädt `core.ts` beim Login, welshman honoriert sie in seinem
 * eigenen `getRelayQuality`, das hier unten weiterhin aufgerufen wird.
 */
import { normalizeRelayUrl } from '@welshman/util'

/** Je Eintrag am 2026-08-19 geprüft: HTTP 200 + HTML mit Parkseiten-Merkmal. */
export const DEAD_RELAYS = new Set(
    [
        'nostr.milou.lol',
        'abcdefg20240104205400.xyz',
        'blastr.f7z.xyz',
        'deschooling.us',
        'lbrygen.xyz',
        'nostr.member.cash',
        'nostr-relay.online',
    ].map(normalizeRelayUrl),
)

/**
 * Legt die Sperre über eine bestehende Güte-Funktion. Alles Ungelistete geht
 * unverändert an `base` — insbesondere welshmans eigene Bewertung inklusive der
 * Blocked-Relay-Liste des Nutzers (kind 10006).
 */
export const guardRelayQuality =
    (base: (url: string) => number) =>
    (url: string): number =>
        DEAD_RELAYS.has(url) ? 0 : base(url)
