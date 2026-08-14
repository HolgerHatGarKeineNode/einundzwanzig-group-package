/**
 * ISO-3166-1-alpha-2 → Landesname, nativ über `Intl.DisplayNames` (kein Datentable).
 *
 * **Warum ein eigenes Modul.** Zwei Inseln brauchen dieselbe Auflösung: die Bühne
 * (`nostrSpaces`, Länder-Popover) und seit der gruppierten Rail auch der Navigator
 * (`nostrRail`, Länder-Chips). Ohne diese Extraktion stünde derselbe Cache zweimal.
 *
 * **Warum der Cache im Modul-Scope liegt und nicht im Alpine-State:** Alpine wickelt
 * seinen State in einen `reactive()`-Proxy, und `Intl.*.prototype.of/format` über
 * einen Proxy wirft „incompatible receiver" — die internen Slots brauchen das echte
 * Objekt als `this`. Die Formatter sind zustandslos und damit prozessweit teilbar.
 *
 * Keine relativen Imports mit Endung und keine welshman-Abhängigkeit — das Modul
 * bleibt ohne Browser-Runtime ladbar (`locale.ts` importiert selbst nichts).
 */
import { islandLocale } from './locale'

/**
 * Cache pro SPRACHE, nicht global (P3). Vorher stand hier fest `['de']` — ein
 * spanischer Nutzer las „Deutschland" statt „Alemania", und ein einmal gebauter
 * Formatter hätte die erste Sprache für immer festgehalten. Die Sprache kommt aus
 * derselben Quelle wie alle Formate der Insel: `locale.ts` → `<html lang>`.
 */
const _regionNames = new Map<string, Intl.DisplayNames | null>()

const regionNames = (): Intl.DisplayNames | null => {
    const locale = islandLocale()
    if (!_regionNames.has(locale)) {
        try {
            _regionNames.set(locale, new Intl.DisplayNames([locale], { type: 'region' }))
        } catch {
            _regionNames.set(locale, null) // Uralt-WebView ohne Intl.DisplayNames → Code anzeigen
        }
    }

    return _regionNames.get(locale) ?? null
}

/** '' → '', unbekannt oder ohne Intl → der Code selbst. Wirft nie. */
export const regionName = (iso: string): string => {
    if (!iso) {
        return ''
    }
    try {
        return regionNames()?.of(iso) ?? iso
    } catch {
        return iso
    }
}
