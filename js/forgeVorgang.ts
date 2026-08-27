/**
 * P1 (GitHub-Parität) — die **Route eines einzelnen Vorgangs**:
 * `/forge/{naddr}/issues/{id}` bzw. `/forge/{naddr}/pulls/{id}`.
 *
 * Rein: kein Netz, kein Store, kein welshman, kein `window`. Der Node-Test-Runner
 * lädt das Modul unverändert
 * (`node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeVorgang.test.ts`).
 *
 * ── Warum jetzt Route und nicht mehr Query ──────────────────────────────────
 *
 * Bis 2026-08-27 adressierte ein Vorgangs-Link eine Query auf der Repo-Seite
 * (`?issue=<id>`, P2-Entscheid 2026-08-24, Vorbild Buzz). Diese Entscheidung
 * traf eine Aussage über die **ID-Form**: rohe Hex-Id statt `nevent` mit
 * Relay-Hints (ein Issue ist `kind 1621`, also nicht adressierbar — kein
 * `d`-Tag, und das Relay steht ohnehin in der Route). Diese Aussage bleibt
 * gültig — die Hex-Id wandert nur vom Query-Parameter ins Pfadsegment.
 *
 * Was sich geändert hat, ist die Prämisse: Eine Einzelansicht ist eine SEITE
 * mit eigenem Titel, eigener Historie und Zurück-Pfeil (Vorbild seither
 * GitHub, Nutzer-Weisung 2026-08-27 — Plan `2026-08-27T1950-forge-github-paritaet`),
 * nicht ein Aufklapp-Zustand auf einer Liste. Alt-Links der Query-Form bleiben
 * Türen: der Mount der Repo-Seite leitet sie serverseitig auf die Route
 * weiter (naddr im Pfad, Id im Query — mehr braucht das nicht).
 *
 * ── Die Regeln, und warum jede eine Ausfallrichtung hat ─────────────────────
 *
 * 1. **Nur eine 64-stellige Hex-Id gilt.** Dieselbe Whitelist-Haltung wie bei
 *    `?tab=` (`forgeTab.ts`) und `?space=`: was nicht passt, ist Müll und
 *    fällt auf die unveränderte Basis zurück. Ein ungeprüfter Wert liefe
 *    sonst als Adressat eines Relay-Filters oder — schlimmer — in eine
 *    `querySelector`-Abfrage.
 */

/** Die beiden Vorgangsarten, die eine eigene Adresse tragen. */
export type VorgangArt = 'issue' | 'pr'

/** Ein adressiertes Ziel, oder `null` für „kein (gültiges) Ziel". */
export type VorgangZiel = { art: VorgangArt; id: string }

/** Hex64-Whitelist — exportiert, weil die Insel sie vor dem Relay-Kontakt prüft. */
export const HEX64 = /^[0-9a-f]{64}$/

/**
 * Das Pfadsegment einer Art — `issues` im Plural, wie bei GitHub.
 *
 * (Bis P2 hiess diese Übersetzung `tabForVorgang` und benannte den LISTEN-Tab
 * der Repo-Seite. Die Route braucht dasselbe Wort als Segment; ein Tab folgt
 * aus der Art nicht mehr — die Einzelansicht ist ihre eigene Seite.)
 */
export const segmentForArt = (art: VorgangArt): 'issues' | 'pulls' => (art === 'issue' ? 'issues' : 'pulls')

/**
 * Die Route der Einzelansicht aus dem Pfad einer Repo-Seite.
 *
 * `repoPfad` ist der SITE-RELATIVE Pfad der Repo-Seite (`/forge/{naddr}`,
 * bereits `encodeURIComponent`-behandelt), wie ihn `zuGruppen` als Basis
 * baut und die Repo-Insel aus ihrem `_naddr` bildet. Angehängt wird
 * `/{issues|pulls}/{id}` — kleingeschrieben, geprüft, sonst nichts.
 *
 * **Kein `new URL`, kein Slicing der Id:** die Basis kommt von einer Stelle,
 * die sie schon richtig gebaut hat; hier wird nur das Ziel ergänzt. Wer die
 * Basis ändert, ändert sie für beide Flächen.
 */
export const vorgangPath = (repoPfad: string, ziel: VorgangZiel | null): string => {
    if (!ziel || !HEX64.test(ziel.id.toLowerCase())) {
        return repoPfad
    }

    return `${repoPfad}/${segmentForArt(ziel.art)}/${ziel.id.toLowerCase()}`
}
