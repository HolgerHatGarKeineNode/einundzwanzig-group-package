/**
 * Adapter: Profil-Helfer aus `@welshman/util` (kind 0, NIP-01/NIP-05).
 *
 * **Warum diese Datei existiert.** Alle hier durchgereichten Namen verschwinden in
 * 0.9.5 aus `@welshman/util` — dort wandert die Profil-Logik in das neue Paket
 * `@welshman/domain` (`Profile`-Reader/-Writer). Das ist keine Umbenennung, sondern ein
 * anderer Zuschnitt; ohne diesen Adapter müsste P3 neun Dateien gleichzeitig umbauen.
 *
 * **Reine Durchreiche, keine Interpretation.**
 *
 * **Hier stehen nur die `@welshman/util`-Namen, nicht die App-Seite.** Die Stores und
 * Lader (`loadProfile`, `deriveProfile`, `profilesByPubkey`, …) kommen aus
 * `@welshman/app` und stehen in `js/welshmanApp.ts`. Die Trennung folgt dem Quellpaket,
 * nicht dem Thema — damit eine Datei, die nur den Typ braucht, nicht den ganzen
 * App-Kontext hereinzieht (siehe Begründung in `js/welshmanTags.ts`).
 */
export type { Profile, PublishedProfile } from '@welshman/util'
export {
    readProfile,
    makeProfile,
    createProfile,
    editProfile,
    isPublishedProfile,
    profileHasName,
    displayProfile,
    displayPubkey,
} from '@welshman/util'
