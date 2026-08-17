/**
 * Nachführung der RAUM-Mitgliedschaft bei Änderungen, die NICHT vom Nutzer kommen.
 *
 * **Warum es das gibt.** Die eigene Mitgliedschaft steht in der relay-signierten
 * 39002-Liste (`d`=h, `p`=Mitglieder) und ist damit relay-autoritativ. Nachgeladen
 * wurde sie bis P9 aber nur nach dem EIGENEN Beitreten/Verlassen. Wirft ein Admin
 * einen Nutzer per kind 9001 hinaus, erfährt die Insel davon nichts — `joined`
 * blieb stale auf `true`, und die Fläche zeigte das Gate UND ein Eingabefeld,
 * dessen Absenden am Relay scheitert.
 *
 * **Am Buzz-Teststack gemessen (2026-08-17, `buzz-test:3001`, wiederverwendeter
 * Stack), und die Messung bestimmt die Bauform:**
 *
 * | Frage | Antwort des Relays |
 * |---|---|
 * | Kommt bei einem Fremd-Rauswurf von selbst ein Signal? | JA, genau eins: `["CLOSED","<sub>","restricted: channel access revoked"]`, 11–61 ms nach dem 9001 — noch VOR dem `OK` an den Admin. |
 * | Kommt eine aktualisierte 39002 über die laufende Live-Sub `{kinds:[39002],limit:0}`? | NEIN. In 10 s kam auf dieser Sub keine einzige Zeile. |
 * | Liefert ein aktives REQ `{kinds:[39002],"#d":[h]}` die neue Liste? | Im OFFENEN Raum ja, +202 ms nach dem Rauswurf, mit neuer Event-id und ohne den eigenen Pubkey. Im PRIVATEN Raum **gar nichts**: `EOSE`, 0 Events, sechs Versuche über 13,7 s. |
 *
 * **Daraus folgt die Fehlerrichtung.** Im privaten Raum gibt es keine „neue Liste
 * ohne mich" — es gibt nur Schweigen. Ein Nachladen allein kann den stale Zustand
 * dort also NIE korrigieren; die alte Liste bleibt im Repository liegen (sie wird
 * zudem in die IndexedDB persistiert) und behauptet weiter eine Mitgliedschaft.
 * Deshalb ist der Entzug selbst die Nachricht: Sobald der Relay den Zugriff auf
 * einen Raum verweigert oder entzieht, gilt die eigene Mitgliedschaft als
 * **unbestätigt**, und unbestätigt heißt hier **kein Mitglied**. Ein Composer,
 * dessen Absenden scheitert, ist schlechter als ein fehlender Composer.
 *
 * **Rehabilitiert wird nur durch eine frisch vom Relay GELESENE Liste** — nicht
 * durch das, was ohnehin schon im Repository/Cache liegt. Und auch dann nur, wenn
 * sie eine ANDERE ist als die zum Zeitpunkt des Entzugs: nach einem Austritt
 * liefert der Relay für einige hundert Millisekunden noch die alte Liste (gemessen
 * beim Join-Pfad, siehe `groups.ts reloadRoomMembership`), und die beweist nichts.
 *
 * Reines Modul: keine Imports, damit es unter `node --test` ohne welshman läuft
 * (`@welshman/app` fasst beim Modul-Load `localStorage` an).
 */

/** Was der Relay über die eigene Mitgliedschaft eines Raums zuletzt sagte. */
export type RoomMembershipRevocation = {
    /**
     * Die 39002, die im Moment des Entzugs galt — `''`, wenn keine bekannt war.
     * Nur eine ANDERE Liste kann die Marke aufheben.
     */
    staleListEventId: string
}

/** Das Ergebnis eines frischen 39002-Lesevorgangs für EINEN Raum. */
export type RoomMembershipRead = {
    /** Event-id der gelesenen 39002. */
    listEventId: string
    /** Steht der eigene Pubkey darin? */
    listsMe: boolean
}

/**
 * Schlüssel je (Space-URL, Raum-`h`). Trennzeichen ist ein NUL — es kann in
 * keiner der beiden Hälften vorkommen, anders als `:` oder `/` (die URL trägt
 * beides).
 */
export const roomMembershipKey = (url: string, h: string): string => `${url}\u0000${h}`

/**
 * Hebt dieser Lesevorgang die Marke auf?
 *
 * Zwei Bedingungen, und beide sind gemessen begründet:
 *  1. Die gelesene Liste muss den eigenen Pubkey enthalten. Tut sie es nicht (oder
 *     wurde gar nichts gelesen — der private Raum antwortet mit 0 Events), bleibt
 *     die Marke: „nichts gelesen" ist kein Mitgliedschaftsbeweis.
 *  2. Sie muss eine ANDERE sein als die zum Zeitpunkt des Entzugs. Sonst würde der
 *     Rennfall „Relay liefert direkt nach dem Austritt noch die alte Liste" die
 *     Marke sofort wieder aufheben — der Composer käme zurück, obwohl der Nutzer
 *     draußen ist.
 *
 * `staleListEventId === ''` (beim Entzug war keine Liste bekannt) lässt jede
 * lesende Bestätigung durch: ohne alte Liste war `joined` ohnehin `false`, und
 * eine Liste, die überhaupt erst jetzt eintrifft, ist die frischere Aussage.
 */
export const confirmsMembership = (
    read: RoomMembershipRead | null | undefined,
    revocation: RoomMembershipRevocation | undefined,
): boolean => {
    if (!revocation) {
        return false // nichts aufzuheben
    }
    if (!read?.listsMe) {
        return false
    }
    return read.listEventId !== revocation.staleListEventId
}

/**
 * Der Bestand der Entzüge, als Store nach Svelte-Contract (`subscribe` liefert
 * sofort den aktuellen Wert und gibt den Abmelder zurück) — damit ihn `derived()`
 * in `groups.ts` als Abhängigkeit nehmen kann, ohne dass dieses Modul `svelte`
 * importieren muss.
 */
export type RoomMembershipRevocations = {
    subscribe: (run: (value: ReadonlyMap<string, RoomMembershipRevocation>) => void) => () => void
    /** Der Relay hat den Zugriff verweigert/entzogen → Mitgliedschaft unbestätigt. */
    revoke: (key: string, staleListEventId: string) => void
    /** Frisch gelesene Liste vorlegen. Liefert `true`, wenn die Marke dadurch fiel. */
    confirm: (key: string, read: RoomMembershipRead | null | undefined) => boolean
    /** Gilt für diesen Raum aktuell eine Marke? */
    has: (key: string) => boolean
    /** Aktueller Stand (Testbarkeit/Debug). */
    get: () => ReadonlyMap<string, RoomMembershipRevocation>
}

export const createRoomMembershipRevocations = (): RoomMembershipRevocations => {
    let state = new Map<string, RoomMembershipRevocation>()
    const subscribers = new Set<(value: ReadonlyMap<string, RoomMembershipRevocation>) => void>()

    // Neue Map je Änderung: `derived()` vergleicht nicht tief, aber Konsumenten
    // dürfen den Wert festhalten — eine mutierte Map wäre eine stille Falle.
    const emit = (next: Map<string, RoomMembershipRevocation>) => {
        state = next
        for (const run of subscribers) {
            run(state)
        }
    }

    return {
        subscribe(run) {
            subscribers.add(run)
            run(state)
            return () => {
                subscribers.delete(run)
            }
        },
        revoke(key, staleListEventId) {
            // Bewusst überschreibend: ein zweiter Entzug bezieht sich auf die dann
            // aktuelle Liste. Ohne Änderung kein Emit — sonst rechnet jede
            // wiederholte `CLOSED`-Zeile die ganze Mitgliedersicht neu.
            const current = state.get(key)
            if (current && current.staleListEventId === staleListEventId) {
                return
            }
            const next = new Map(state)
            next.set(key, { staleListEventId })
            emit(next)
        },
        confirm(key, read) {
            if (!confirmsMembership(read, state.get(key))) {
                return false
            }
            const next = new Map(state)
            next.delete(key)
            emit(next)
            return true
        },
        has: (key) => state.has(key),
        get: () => state,
    }
}
