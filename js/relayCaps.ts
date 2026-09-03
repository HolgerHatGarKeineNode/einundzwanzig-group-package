/**
 * Relay-Fähigkeiten aus dem NIP-11-Info-Doc. Bewusst OHNE welshman-Importe, damit
 * die Logik rein (ohne Browser-/Store-Runtime) testbar bleibt.
 */

/** NIP-29 = relaybasierte Gruppen. Nur ein solches Relay kann Räume tragen. */
const NIP29 = '29'

/**
 * **Buzz' zweite Chat-Nachricht: kind 40002** (`buzz-core/src/kind.rs:421`,
 * `KIND_STREAM_MESSAGE_V2`).
 *
 * Buzz kennt ZWEI Kinds für dieselbe Sache im selben Raum: das klassische NIP-29
 * `kind 9` und daneben `40002`. Buzz Desktop und Amethyst schreiben `40002`, unser
 * Client schrieb und las nur `9` — im Ergebnis zwei Zeitleisten nebeneinander: am
 * Prod-Relay lagen im Raum `general` ein `9` von uns und zwei `40002` von den anderen,
 * und keine Seite sah die andere vollständig.
 *
 * **Nur LESEN, nicht schreiben.** Buzz Desktop stellt unsere `9`-Nachrichten
 * nachweislich dar (Screenshot des Nutzers: „Hey Plebs!" steht dort zwischen den
 * 40002-Nachrichten). Wer `9` schreibt, wird also überall gesehen; wer `40002`
 * schreibt, verschwindet für reine NIP-29-Clients. Deshalb lesen wir beides und
 * schreiben weiter das interoperable `9`.
 *
 * Auf zooid ist die Konstante folgenlos — dort existiert kein 40002, der Filter
 * liefert schlicht nichts.
 */
export const BUZZ_MESSAGE_V2 = 40002

/**
 * Darf dieser Space in der Auswahl stehen? Ein Space ist genau dann brauchbar,
 * wenn sein Relay NIP-29 spricht (`supported_nips` enthält 29).
 * - Vereins-Relays sind per Definition Group-Relays → immer true (ihr NIP-11
 *   kann fehlen/langsam sein).
 * - Solange das Profil noch nicht geladen ist (`undefined`) → optimistisch true,
 *   damit beim Boot nichts wegflackert.
 * - Erst ein geladenes Profil OHNE 29 fällt raus.
 *
 * `supported_nips` ist von welshman auf `string[]` normalisiert (siehe fetchRelay).
 */
export const spaceSupportsRooms = (isVerein: boolean, profile?: { supported_nips?: string[] }): boolean => {
    if (isVerein || !profile) {
        return true
    }
    return profile.supported_nips?.includes(NIP29) ?? false
}

/**
 * Ist das ein **Buzz**-Relay (Block Inc., Rust) statt eines zooid-Relays?
 *
 * **Warum am `software`-Feld und nicht an `supported_nips`:** Die Space-Verwaltung
 * lief bisher über NIP-86 (`manageRelay`). Buzz hat NIP-86 nicht — am laufenden
 * Relay gemessen antwortet `POST /` mit `405 Method Not Allowed, allow: GET,HEAD`.
 * Man koennte also auf „86 fehlt in `supported_nips`" pruefen — nur advertised es
 * AUCH zooid nicht (zooid haengt nur `43`, `29`, `BUD-*`, `9a` an). Die Abwesenheit
 * von 86 unterscheidet die beiden also gerade NICHT. `software` dagegen ist bei
 * beiden gesetzt und eindeutig: zooid meldet `github.com/coracle-social/zooid`,
 * Buzz `https://github.com/block/buzz`.
 *
 * Bewusst eine **Positiv**-Erkennung auf Buzz: alles Unbekannte bleibt auf der
 * bestehenden zooid/NIP-86-Strecke, die sich dadurch nicht aendert. Fehlendes
 * Profil → false (noch nicht geladen ⇒ nicht „Buzz").
 *
 * Rein & welshman-frei → testbar (`relayCaps.test.ts`).
 */
export const isBuzzRelay = (profile?: { software?: string }): boolean =>
    (profile?.software ?? '').toLowerCase().includes('block/buzz')

/**
 * Setzt das Relay NIP-70 („protected events", `["-"]`-Tag) durch? Aus dem
 * NIP-11-`supported_nips` (von welshman auf `string[]` normalisiert). Rein &
 * welshman-frei → testbar. Fehlendes Profil → false (kein PROTECTED, wie beim
 * Referenz-Client).
 */
export const hasNip70 = (profile?: { supported_nips?: string[] }): boolean =>
    profile?.supported_nips?.includes('70') ?? false

/**
 * The relay software version out of the NIP-11 doc (`version`), trimmed. Missing doc or
 * missing field → `''`.
 *
 * **Why the field is worth reading.** A deployed relay is not its source, and this
 * project has already paid for that once: a zooid binary weeks older than its source
 * answered `OK true` to an unknown kind and did nothing. Buzz fills `version` from
 * `CARGO_PKG_VERSION` (`buzz-relay/src/nip11.rs:48`), so the running binary states its
 * own age instead of leaving it to be guessed. Measured against production on
 * 2026-09-03: `"version": "0.2.1"`, identical to `crates/buzz-relay/Cargo.toml:7` at
 * `fc0d2bc5` — this helper is built for the NEXT drift, not that one.
 *
 * Deliberately a plain string and no version comparison: NIP-11 puts no shape on the
 * field, and a helper that assumed semver would be exactly the guess it exists to
 * replace. Whoever needs ordering parses it at the call site and owns that assumption.
 *
 * Rein & welshman-frei → testbar.
 */
export const relayVersion = (profile?: { version?: string }): string => profile?.version?.trim() ?? ''

/**
 * Does the relay advertise a draft protocol extension in NIP-11 `supported_extensions`?
 * That is the field Buzz uses for drafts without a NIP number: `nip-er` (event
 * reminders, kind 30300) always, and `nip-pl` (push delivery) only when a push gateway
 * is configured (`buzz-relay/src/nip11.rs:165` and `:265-267`). Measured against
 * production on 2026-09-03: `["nip-er","nip-pl"]`.
 *
 * **The shape guard is load-bearing, not decoration.** welshman copies every
 * non-standard NIP-11 field through untouched — `Object.assign(this, json, …)` in
 * `@welshman/domain` `Relay.js:19-25`, with the comment "Copy every field, including
 * any non-standard NIP-11 ones" — and coerces **only** `supported_nips` into a string
 * array. What arrives here is therefore raw foreign JSON. Without the `Array.isArray`
 * check a relay answering `"supported_extensions": "nip-error"` would pass a substring
 * test, and a capability check that says yes because of `String.prototype.includes` is
 * worse than no check. Missing doc or wrong shape → false.
 *
 * The comparison ignores case and surrounding space: these identifiers are free-form
 * draft names with no registry and no spelling rule to lean on.
 *
 * `supported_extensions` is not part of welshman's `RelayInfo` type (it declares 15
 * standard fields, this is not one of them) — which is why the field is read here,
 * structurally, instead of at a call site that would not type-check.
 *
 * Rein & welshman-frei → testbar.
 */
export const hasRelayExtension = (
    extension: string,
    profile?: { supported_extensions?: string[] },
): boolean => {
    const wanted = extension.trim().toLowerCase()
    const advertised = profile?.supported_extensions
    if (!wanted || !Array.isArray(advertised)) {
        return false
    }
    return advertised.some((entry) => typeof entry === 'string' && entry.trim().toLowerCase() === wanted)
}

/** Space-Branding aus dem NIP-11-Info-Doc (Anzeigename, Avatar, Untertitel, Kopfbild). */
export type SpaceBranding = { label: string; icon: string; description: string; banner: string }

/**
 * Ein Space hat kein Meta-Event — sein „Name" kommt aus dem NIP-11-Info-Doc des
 * Relays: `name` als Anzeigename (Fallback: gekürzte Relay-URL), `icon` als
 * Space-Avatar, `description` als Untertitel, `banner` als Kopfbild.
 * Rein & welshman-frei → testbar.
 */
export const spaceBranding = (
    fallbackLabel: string,
    profile?: { name?: string; icon?: string; description?: string; banner?: string },
): SpaceBranding => ({
    label: profile?.name?.trim() || fallbackLabel,
    icon: profile?.icon?.trim() || '',
    description: profile?.description?.trim() || '',
    banner: profile?.banner?.trim() || '',
})
