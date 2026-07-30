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
 * bleibt ohne Browser-Runtime ladbar.
 */

let _regionNames: Intl.DisplayNames | null | undefined

const regionNames = (): Intl.DisplayNames | null => {
    if (_regionNames === undefined) {
        try {
            _regionNames = new Intl.DisplayNames(['de'], { type: 'region' })
        } catch {
            _regionNames = null // Uralt-WebView ohne Intl.DisplayNames → Code anzeigen
        }
    }

    return _regionNames
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
