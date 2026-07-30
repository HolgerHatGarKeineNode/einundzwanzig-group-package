/**
 * Die Space-Markierung an einer Raum-URL: `/rooms/{h}?space=workspace`.
 *
 * **Warum eine URL und kein Speicher.** Ein Raum lebt auf GENAU EINEM Relay, aber
 * `/rooms/{h}` allein sagt nicht, auf welchem. Die App entschied das bisher aus dem
 * Laufzeit-Zustand (`ephemeralSpaceUrl`, siehe `groups.ts`) — und der ist bewusst nicht
 * persistiert. Nach einem Reload stand der aktive Space damit wieder auf dem
 * Vereins-Relay, während der Raum im Workspace liegt: der Beitritt (kind 9021) ging ans
 * falsche Relay und kam als `invalid: group not found` zurück, der Verlauf blieb leer.
 *
 * Die Markierung in der URL löst das, ohne die Regel zu brechen, die den Zustand
 * ephemer hält: nichts wird geschrieben, die Zuordnung steht im Link. Reload, Bookmark
 * und geteilter Link öffnen denselben Raum auf demselben Relay.
 *
 * **Ein Wort, keine Relay-Adresse.** Der Wert ist der feste Bezeichner `workspace`, nicht
 * die URL des Relays. Es gibt genau einen konfigurierten Workspace (`hasWorkspace()`), und
 * ein Bezeichner kann nicht auf ein fremdes Relay zeigen — eine URL im Parameter wäre
 * eine offene Weiche, die jeder Link umlegen könnte.
 *
 * Kein Import: das Modul ist rein und ohne welshman/Alpine testbar
 * (`node --test packages/einundzwanzig-group/js/spaceParam.test.ts`).
 */

/** Der Query-Parameter, der die Space-Zuordnung einer Raum-URL trägt. */
export const SPACE_PARAM = 'space'

/** Sein einziger gültiger Wert: der konfigurierte zweite Space. */
export const SPACE_WORKSPACE = 'workspace'

/**
 * Liest die Space-Markierung aus einer Query (`window.location.search`).
 * Alles andere als der bekannte Wert ist Müll und wird verworfen — dieselbe
 * Whitelist-Haltung wie bei `?from=` (`readOrigin` in `updatesView.ts`).
 */
export const readSpaceParam = (search: string): typeof SPACE_WORKSPACE | null =>
    new URLSearchParams(search).get(SPACE_PARAM) === SPACE_WORKSPACE ? SPACE_WORKSPACE : null

/**
 * Hängt eine gültige Space-Markierung an ein Ziel an — das Gegenstück zu `withOrigin`.
 *
 * Nötig überall dort, wo aus einem Raum heraus eine neue URL entsteht (Thread-Deep-Link,
 * Rückweg aus dem Thread): ohne das Durchreichen verlöre die Adressleiste die Zuordnung,
 * und der nächste Reload landete wieder im falschen Space.
 *
 * Ein bereits vorhandenes `space=` bleibt unangetastet — zwei Zuordnungen an einer URL
 * wären keine.
 */
export const withSpace = (href: string, search: string): string => {
    const value = readSpaceParam(search)
    if (value === null || new RegExp(`[?&]${SPACE_PARAM}=`).test(href)) {
        return href
    }

    return `${href}${href.includes('?') ? '&' : '?'}${SPACE_PARAM}=${value}`
}

/** Die Raum-URL eines Workspace-Raums — der einzige Ort, der die Markierung SETZT. */
export const workspaceRoomHref = (h: string): string =>
    `/rooms/${encodeURIComponent(h)}?${SPACE_PARAM}=${SPACE_WORKSPACE}`
