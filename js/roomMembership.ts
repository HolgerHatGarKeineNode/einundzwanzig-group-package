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
 * Seit N3 zusätzlich: sie darf nicht ÄLTER sein — die Id-Regel allein setzt voraus,
 * dass genau ein Relay-Knoten antwortet (Begründung an {@link confirmsMembership}).
 *
 * Reines Modul: keine Imports, damit es unter `node --test` ohne welshman läuft.
 * (Die frühere Begründung „`@welshman/app` fasst beim Modul-Load `localStorage` an"
 * stimmt seit dem 2026-08-22 nicht mehr — gemessen lädt das Paket unter node
 * fehlerfrei. Reine Module bleiben trotzdem die billigere Bauform: kein Paket-Boot
 * im Test, keine Bindung an eine welshman-Version.).
 */

/** Was der Relay über die eigene Mitgliedschaft eines Raums zuletzt sagte. */
export type RoomMembershipRevocation = {
    /**
     * Die 39002, die im Moment des Entzugs galt — `''`, wenn keine bekannt war.
     * Nur eine ANDERE Liste kann die Marke aufheben.
     */
    staleListEventId: string
    /**
     * `created_at` dieser Liste — `0`, wenn keine bekannt war. Eine ÄLTERE Liste
     * darf die Marke nicht aufheben (siehe {@link confirmsMembership}).
     */
    staleCreatedAt: number
}

/** Das Ergebnis eines frischen 39002-Lesevorgangs für EINEN Raum. */
export type RoomMembershipRead = {
    /** Event-id der gelesenen 39002. */
    listEventId: string
    /** Steht der eigene Pubkey darin? */
    listsMe: boolean
    /** `created_at` der gelesenen 39002 (NIP-01, sekundengranular). */
    createdAt: number
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
 * Drei Bedingungen, und jede ist gemessen begründet:
 *  1. Die gelesene Liste muss den eigenen Pubkey enthalten. Tut sie es nicht (oder
 *     wurde gar nichts gelesen — der private Raum antwortet mit 0 Events), bleibt
 *     die Marke: „nichts gelesen" ist kein Mitgliedschaftsbeweis.
 *  2. Sie muss eine ANDERE sein als die zum Zeitpunkt des Entzugs. Sonst würde der
 *     Rennfall „Relay liefert direkt nach dem Austritt noch die alte Liste" die
 *     Marke sofort wieder aufheben — der Composer käme zurück, obwohl der Nutzer
 *     draußen ist.
 *  3. Sie darf nicht ÄLTER sein als die Liste beim Entzug (N3). Bedingung 2 allein
 *     verlässt sich darauf, dass jede andere Id auch die neuere Aussage ist — das
 *     gilt nur, solange genau EIN Relay-Knoten antwortet. Ein Lesereplikat, das
 *     hinterherhinkt, liefert eine andere Id mit KLEINEREM `created_at`; sie
 *     führte uns noch, und die Marke fiele fälschlich. Die Fehlerrichtung ist die
 *     teure: die App zeigte einen Composer für jemanden, der nicht mehr schreiben
 *     darf, und der Schreibversuch scheitert erst am Relay. Am Single-Node-
 *     Teststack ist der Fall nicht konstruierbar — die Ordnung kostet einen
 *     Vergleich und ist die einzige Absicherung, die ohne Replikat zu haben ist.
 *
 * **`>=` und nicht `>` — bewusst.** `created_at` ist sekundengranular (NIP-01),
 * und die gemessenen Abstände in diesem Pfad liegen darunter: das `CLOSED` kam
 * 11–61 ms nach dem 9001, die neue Liste +202 ms. Eine Wiederaufnahme in
 * DERSELBEN Sekunde ist damit der Normalfall und nicht die Ausnahme. Mit `>`
 * bliebe die Marke dort dauerhaft stehen (sie fällt nur durch ein `confirm`, und
 * jedes spätere Lesen liefert dieselbe Sekunde erneut) — der Nutzer wäre wieder
 * Mitglied und sähe bis zum nächsten Seitenaufbau keinen Composer. `>=` verwirft
 * das strikt Ältere und lässt den Gleichstand der Id-Regel aus Bedingung 2, also
 * genau dem Stand vor diesem Riegel.
 *
 * `staleListEventId === ''` (beim Entzug war keine Liste bekannt) lässt jede
 * lesende Bestätigung durch: ohne alte Liste war `joined` ohnehin `false`, und
 * eine Liste, die überhaupt erst jetzt eintrifft, ist die frischere Aussage.
 * `staleCreatedAt` ist dann `0` und Bedingung 3 damit für jede echte Liste erfüllt.
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
    if (read.listEventId === revocation.staleListEventId) {
        return false
    }

    return read.createdAt >= revocation.staleCreatedAt
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
    revoke: (key: string, staleListEventId: string, staleCreatedAt: number) => void
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
        revoke(key, staleListEventId, staleCreatedAt) {
            // Bewusst überschreibend: ein zweiter Entzug bezieht sich auf die dann
            // aktuelle Liste. Ohne Änderung kein Emit — sonst rechnet jede
            // wiederholte `CLOSED`-Zeile die ganze Mitgliedersicht neu. Verglichen
            // wird nur die Id: sie identifiziert das Ereignis, `created_at` ist
            // dann zwangsläufig dasselbe.
            const current = state.get(key)
            if (current && current.staleListEventId === staleListEventId) {
                return
            }
            const next = new Map(state)
            next.set(key, { staleListEventId, staleCreatedAt })
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
