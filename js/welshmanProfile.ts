/**
 * Adapter: Profil-Helfer (kind 0, NIP-01/NIP-05).
 *
 * ── Welche 0.9.5-API diese Datei vorwegnimmt — und warum nur eine ────────────────
 * Genau **ein** Name überlebt den Sprung unverändert: `displayPubkey` (von
 * `@welshman/util` nach `@welshman/domain`). Für den ist diese Datei eine reine
 * Weiterleitung, und P3 ändert nur den Importpfad.
 *
 * Alles andere ist in 0.9.5 kein Funktionspaar mehr, sondern ein **Reader/Writer-Paar**:
 * `Profile` ist dort eine `KindFactory<ProfileReader, ProfileWriter>`, und aus
 * `displayProfile(profile, fallback)` wird `reader.display(fallback)`, aus
 * `profile.name` wird `reader.name()`, aus `createProfile`/`editProfile` werden
 * `ProfileWriter.update(...)`/`.setName(...)`.
 *
 * **Diese Datei bildet dafür weiterhin 0.8.16 ab — bewusst.** Eine hier
 * handgeschriebene `ProfileReader`-Klasse wäre eine Erfindung: unsere Profile kommen
 * aus `app.use(Profiles)` als schlichte Datenobjekte, ein Reader wird in 0.9.5 dagegen
 * aus dem Ereignis gebaut und trägt seinen `KindContext` mit. Wir würden also die
 * Aufrufstellen zweimal umschreiben — einmal auf unsere Nachbildung, in P3 noch einmal
 * auf die echte, sobald deren Semantik abweicht. Und `reader.name()` statt
 * `profile.name` an jeder Anzeigestelle ist genau die Art Änderung, die unter „kein
 * Verhaltenswechsel" nicht mehr abgesichert wäre.
 *
 * ── Was P3 hier tun muss ─────────────────────────────────────────────────────────
 * `displayPubkey` auf `@welshman/domain` umhängen (fertig vorbereitet); für den Rest
 * die Aufrufstellen auf `ProfileReader`/`ProfileWriter` ziehen. Sie sind bekannt: alle
 * Importeure dieser Datei, plus die Feld-Lesungen an `app.use(Profiles)` (siehe
 * `js/welshmanApp.ts`).
 *
 * **Diese Datei importiert ausschließlich `@welshman/util`** — siehe Begründung in
 * `js/welshmanKinds.ts`.
 */

// Namensgleich in 0.9.5 (dort in `@welshman/domain`).
export { displayPubkey } from '@welshman/util'

// In 0.9.5 Methoden von `ProfileReader`/`ProfileWriter` — hier weiter 0.8.16, Grund oben.
export type { Profile, PublishedProfile } from '@welshman/util'
export {
    readProfile,
    makeProfile,
    createProfile,
    editProfile,
    isPublishedProfile,
    profileHasName,
    displayProfile,
} from '@welshman/util'
