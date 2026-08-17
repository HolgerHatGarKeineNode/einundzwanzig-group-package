/**
 * P5 — die Forge-Zeitleiste nach Tagen. Rein, ohne Alpine, ohne DOM, ohne Netz.
 *
 * ── Warum überhaupt ─────────────────────────────────────────────────────────
 *
 * Bis hierher trug jede Zeile der Zeitleiste einen vollen absoluten Zeitstempel
 * („17. Aug. 2026, 02:31") und zusätzlich den Repo-Namen. Beides wiederholt sich
 * stumpf über die ganze Liste: zwanzig Zeilen, zwanzig Mal dieselbe Jahreszahl,
 * zwanzig Mal derselbe Repo-Name. Wiederholung ist kein Informationsgehalt — sie
 * kostet Blickzeit und verdeckt die Stelle, an der sich wirklich etwas ändert.
 *
 * ── Das Muster ist nicht neu, es wird NACHGEZOGEN ───────────────────────────
 *
 * `⚡updates.blade.php` löst dieselbe Aufgabe bereits: sein Modell liefert
 * gefüllte Buckets (HEUTE · GESTERN · DIESE WOCHE · ÄLTER), leere fallen raus,
 * der Bucket-Titel ist ein echtes `<h2>`. Genau diese vier Buckets, genau diese
 * vier Beschriftungen und genau dieselbe Kalender-Rechnung gelten hier. Eine
 * zweite Ordnung mit eigenen Wörtern („Letzte 7 Tage") wäre eine zweite Sprache
 * für dieselbe Sache — der Nutzer müsste zwei Systeme lernen, um dieselbe Frage
 * zu beantworten.
 *
 * Die Identität der Beschriftungen ist **getestet**, nicht behauptet:
 * `forgeTimeline.test.ts` vergleicht {@link timelineBucketLabels} Feld für Feld
 * mit `updatesView.BUCKET_LABELS`. Driftet eine der beiden Seiten, fällt der
 * Test — nicht erst der Nutzer.
 *
 * ── Kalendertage, keine 24-h-Fenster ────────────────────────────────────────
 *
 * „Heute" heißt: derselbe LOKALE Kalendertag. Um 00:05 Uhr ist ein Ereignis von
 * gestern 23:55 also „Gestern", obwohl es zehn Minuten her ist. Das ist die
 * Rechnung aus `updates.ts updateBucket` und aus `feeds.ts dayLabel` (der
 * Tagestrenner im Chat-Verlauf) — dieselbe Grenze in der ganzen Anwendung. Ein
 * gleitendes 24-h-Fenster ergäbe an derselben Stelle ein anderes Wort als der
 * Verlauf zwei Klicks weiter.
 *
 * `now` kommt IMMER von außen. Das ist nicht Testkosmetik: Bucket UND
 * Zeit-Label müssen aus DERSELBEN Uhr entstehen, sonst steht irgendwann eine
 * Zeile „vor 3 Std" unter der Überschrift „Gestern".
 */
import { t } from './i18n.ts'
import { formatTimestamp } from './locale.ts'

// ── Buckets ─────────────────────────────────────────────────────────────────

export type TimelineBucket = 'today' | 'yesterday' | 'week' | 'older'

/** Reihenfolge der Trenner, neueste zuerst. Identisch zu `updatesView.BUCKET_SEQUENCE`. */
export const TIMELINE_BUCKET_SEQUENCE: readonly TimelineBucket[] = ['today', 'yesterday', 'week', 'older']

/**
 * Die deutschen Quelltexte der vier Trenner — **normal geschrieben**, die
 * Versalien macht ausschließlich das Markup (`uppercase` am `<h2>`).
 *
 * Grund, wörtlich derselbe wie drüben: der Text im DOM ist der, den die
 * Sprachausgabe bekommt, und Versalien-Wörter werden uneinheitlich behandelt
 * (als Wort oder buchstabenweise vorgelesen).
 */
const BUCKET_SOURCE: Record<TimelineBucket, string> = {
    today: 'Heute',
    yesterday: 'Gestern',
    week: 'Diese Woche',
    older: 'Älter',
}

/**
 * Die Beschriftungen in der aktiven Sprache.
 *
 * Als FUNKTION und nicht als Modul-Konstante: `t()` liest den Katalog bei jedem
 * Aufruf frisch (`i18n.ts`), eine Konstante fröre dagegen ein, was beim
 * Modul-Boot galt. Im Browser fällt das nicht auf — der Katalog steht vor
 * `@vite` im `<head>` —, aber es ist eine Falle für jeden, der das Modul früher
 * lädt. Die AUSGABE ist identisch zu `updatesView.BUCKET_LABELS`.
 */
export const timelineBucketLabels = (): Record<TimelineBucket, string> => ({
    today: t(BUCKET_SOURCE.today),
    yesterday: t(BUCKET_SOURCE.yesterday),
    week: t(BUCKET_SOURCE.week),
    older: t(BUCKET_SOURCE.older),
})

/** Mitternacht des lokalen Kalendertags, in Millisekunden. `ts` ist eine Unix-SEKUNDE. */
const startOfLocalDay = (ts: number): number => {
    const d = new Date(ts * 1000)

    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

const DAY_MS = 86_400_000

/**
 * Kalendarischer Bucket. Grenzen sind lokale Tagesgrenzen, nicht 24-h-Fenster.
 *
 * `diffDays <= 0` fällt auf `today`: `created_at` ist autorgesetzt (NIP-01) und
 * kann in der Zukunft liegen — Buzz nimmt ein Ereignis bis +900 s an, eine
 * falsch gestellte Uhr liefert mehr. Einen Bucket „Morgen" gibt es nicht; die
 * Zeile steht dann oben unter „Heute", wo sie ohnehin hingehört (die Liste ist
 * nach `createdAt` absteigend sortiert).
 */
export const timelineBucket = (ts: number, now: number): TimelineBucket => {
    const diffDays = Math.round((startOfLocalDay(now) - startOfLocalDay(ts)) / DAY_MS)
    if (diffDays <= 0) {
        return 'today'
    }
    if (diffDays === 1) {
        return 'yesterday'
    }

    return diffDays < 7 ? 'week' : 'older'
}

// ── Zeit-Label der Zeile ────────────────────────────────────────────────────

/**
 * Die KURZE Angabe, die in der Zeile steht. Die absolute Angabe (mit Uhrzeit)
 * gehört ins `title` der Zeile, nicht in den Fließtext — sie beantwortet eine
 * Frage, die beim Überfliegen niemand stellt.
 *
 * Dieselbe Kaskade wie `updates.ts updateTimeLabel` und `feeds.ts relativeTime`:
 * unter 24 h gewinnt die relative Angabe, auch wenn der Zeitpunkt kalendarisch
 * schon „gestern" ist — „vor 23 Std" ist präziser als „gestern". Erst jenseits
 * von 24 h wird der Kalender maßgeblich.
 *
 * Der Rückfall ist das SHORT-Datum (`12. Aug. 2026`), nicht Datum + Uhrzeit: die
 * Jahreszahl muss mit (eine Zeile von 2024 ohne Jahr behauptet den falschen
 * Zeitraum), die Minute nicht.
 *
 * Zukünftige `created_at` werden auf 0 geklemmt → „gerade eben" statt einer
 * negativen Minutenzahl.
 */
export const timelineTimeLabel = (ts: number, now: number): string => {
    const s = Math.max(0, now - ts)
    if (s < 60) {
        return t('gerade eben')
    }
    const m = Math.floor(s / 60)
    if (m < 60) {
        return t('vor :count Min', { count: m })
    }
    const h = Math.floor(m / 60)
    if (h < 24) {
        return t('vor :count Std', { count: h })
    }

    return timelineBucket(ts, now) === 'yesterday'
        ? t('gestern')
        : formatTimestamp(ts, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Die volle Angabe für `title`/Tooltip — Datum UND Uhrzeit, wie bisher in der Zeile. */
export const timelineFullLabel = (ts: number): string =>
    formatTimestamp(ts, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// ── Gruppierung ─────────────────────────────────────────────────────────────

/**
 * Was die Gruppierung von einer Zeile braucht — und mehr nicht. Strukturell
 * statt auf `ActivityRow` getippt: `ActivityRow` lebt in `forge.ts` und hängt
 * dort an welshman; dieses Modul bliebe damit nicht mehr unter `node --test`
 * ladbar.
 */
export type TimelineEntry = {
    /** Stabil über Neuberechnungen — der `:key` der Liste. */
    id: string
    createdAt: number
    /** Anzeigename des Repos; `''`, wenn er (noch) nicht auflösbar ist. */
    repoName: string
}

/** Eine Zeile mit der Entscheidung, ob sie ihren Repo-Namen selbst nennt. */
export type TimelineRow<T> = T & { showRepoName: boolean }

export type TimelineGroup<T> = {
    bucket: TimelineBucket
    /** Der Trenner-Text, fertig übersetzt. */
    label: string
    items: TimelineRow<T>[]
}

export type TimelineOptions = {
    /**
     * Trägt diese Liste überhaupt Repo-Namen?
     *
     * `true` in der repo-ÜBERGREIFENDEN Übersicht, `false` in der Einzel-Repo-
     * Ansicht: dort ist der Name für ALLE Zeilen derselbe und steht bereits als
     * Seitentitel über der Liste — ihn je Zeile zu wiederholen wäre genau die
     * Redundanz, die diese Funktion abstellt. `false` setzt deshalb überall
     * `showRepoName: false` und nicht etwa „nur in der ersten Zeile".
     */
    repoNames?: boolean
}

/**
 * Zeilen → Bucket-Gruppen in fester Reihenfolge, **leere Buckets fallen raus**.
 *
 * Drei Eigenschaften, die absichtlich hier und nicht in der Oberfläche liegen:
 *
 *  1. **Iteriert wird über {@link TIMELINE_BUCKET_SEQUENCE}, nicht über die
 *     Eingabe.** Die Reihenfolge der Trenner hängt damit nicht daran, dass die
 *     Liste sortiert ankommt. Sie kommt sortiert an (`buildActivity`), aber eine
 *     Gruppierung, die bei unsortierter Eingabe „Heute" zweimal ausgäbe, wäre
 *     eine Falle für den nächsten Aufrufer — `x-for :key="bucket.label"` bräche
 *     daran sichtbar. Dieselbe Begründung wie in `updatesView.groupUpdates`.
 *
 *  2. **Innerhalb eines Buckets wird selbst sortiert** — absteigend nach
 *     `createdAt`, bei Gleichstand nach `id`. Das ist exakt die Ordnung aus
 *     `forgeActivity.buildActivity`; sie hier zu wiederholen kostet nichts und
 *     macht die Gruppe unabhängig von der Eingabereihenfolge. Der Gleichstand
 *     ist kein Sonderfall: `created_at` ist sekundengenau, und ein Push, der
 *     zwei Refs bewegt, erzeugt zwei Zeilen in derselben Sekunde.
 *
 *  3. **`showRepoName` entsteht GENAU HIER.** Der Repo-Name wird unterdrückt,
 *     solange er sich gegenüber der Vorgängerzeile nicht ändert — und die erste
 *     Zeile jeder Gruppe nennt ihn immer wieder. Das ist der Grund, warum die
 *     Entdopplung ohne die Gruppierung nicht sauber geht: über eine
 *     Trenner-Überschrift hinweg fortgeführte Unterdrückung ließe den Leser
 *     hinter „GESTERN" nach einem Namen suchen, der drei Zeilen weiter oben in
 *     einem anderen Abschnitt steht.
 *     Ein leerer Name (`''`) zeigt nichts an und SETZT den Vergleichswert
 *     trotzdem: die nächste benannte Zeile nennt ihr Repo wieder. Andernfalls
 *     stünde eine namenlose Zeile stillschweigend unter der Überschrift des
 *     Repos darüber — eine Zuordnung, die niemand behauptet hat.
 */
export function groupTimeline<T extends TimelineEntry>(
    items: readonly T[],
    now: number,
    options: TimelineOptions = {},
): TimelineGroup<T>[] {
    const withRepoNames = options.repoNames ?? false
    const labels = timelineBucketLabels()
    const out: TimelineGroup<T>[] = []

    for (const bucket of TIMELINE_BUCKET_SEQUENCE) {
        const inBucket = items
            .filter((item) => timelineBucket(item.createdAt, now) === bucket)
            .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
        if (inBucket.length === 0) {
            continue
        }

        let previousRepo = ''
        const rows: TimelineRow<T>[] = inBucket.map((item) => {
            const show = withRepoNames && item.repoName !== '' && item.repoName !== previousRepo
            previousRepo = item.repoName

            return { ...item, showRepoName: show }
        })

        out.push({ bucket, label: labels[bucket], items: rows })
    }

    return out
}
