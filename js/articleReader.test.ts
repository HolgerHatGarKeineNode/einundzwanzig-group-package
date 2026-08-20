/**
 * Lesefortschritt und Teilen — die beiden reinen Entscheidungen der Vollansicht (P3).
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleReader.test.ts
 *
 * Zwei Zusagen tragen den größten Teil dieser Datei, beide aus der DoD:
 *
 *  1. **Kein `NaN`, wenn der Artikel kürzer ist als das Fenster.** Ein `NaN` in
 *     `style="width: NaN%"` stürzt nicht ab — die Leiste steht einfach still, und niemand
 *     merkt es. Bei 57 von 104 Artikeln ohne jede Überschrift ist das der Normalfall.
 *  2. **Ein Artikel ohne `d` hat keinen Link.** Die Fläche muss das tragen; ein Knopf, der
 *     auf `…/articles/` ohne Kennung zeigt, wäre schlimmer als keiner.
 *
 * Mutationsproben (von Hand gefahren, 2026-08-21, je zurückgebaut):
 *  · `strecke <= 0` → `strecke < 0`: **rot** (Kurzartikel liefert NaN bzw. Infinity).
 *  · `Math.min(100, …)` gestrichen: **rot** (Fortschritt läuft über 100).
 *  · `if (!naddr || !stamm)` → `if (!stamm)`: **rot** (Link ohne Kennung).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leseFortschritt, restMinuten, artikelTeilZiel, lesestandForm } from './articleReader.ts'

// ── Der Kurzartikel: der Normalfall, nicht der Rand ─────────────────────────────────

test('Artikel KUERZER als das Fenster: nicht verfolgbar, 0 % — und garantiert kein NaN', () => {
    // 57 der 104 Artikel haben nicht einmal eine Überschrift; viele passen ganz aufs Bild.
    const stand = leseFortschritt({ top: 180, height: 400, viewport: 900 })
    assert.equal(stand.verfolgbar, false)
    assert.equal(stand.prozent, 0)
    assert.equal(Number.isNaN(stand.prozent), false)
})

test('Artikel GENAU so hoch wie das Fenster: nicht verfolgbar — die Division waere durch null', () => {
    const stand = leseFortschritt({ top: 0, height: 900, viewport: 900 })
    assert.equal(stand.verfolgbar, false)
    assert.equal(stand.prozent, 0)
})

test('Hoehe 0 (Text noch nicht gerendert): nicht verfolgbar statt 0/0', () => {
    const stand = leseFortschritt({ top: 0, height: 0, viewport: 900 })
    assert.equal(stand.verfolgbar, false)
    assert.equal(Number.isFinite(stand.prozent), true)
})

test('unbrauchbare Messungen (NaN, Infinity) fallen fail-closed durch', () => {
    // Eine Messung vor dem ersten Layout liefert genau solche Werte. Der Zustand ist
    // „ich weiß es nicht" — und die ehrliche Anzeige dafür ist KEINE Leiste, nicht eine
    // auf 0.
    for (const messung of [
        { top: Number.NaN, height: 3000, viewport: 900 },
        { top: 0, height: Number.NaN, viewport: 900 },
        { top: 0, height: 3000, viewport: Number.NaN },
        { top: 0, height: Number.POSITIVE_INFINITY, viewport: 900 },
    ]) {
        const stand = leseFortschritt(messung)
        assert.equal(stand.verfolgbar, false, `verfolgbar bei ${JSON.stringify(messung)}`)
        assert.equal(Number.isNaN(stand.prozent), false, `NaN bei ${JSON.stringify(messung)}`)
    }
})

// ── Die drei Raender eines langen Artikels ──────────────────────────────────────────

test('Anfang: der Text steht noch unter der Fensterkante — 0 %, nicht negativ', () => {
    const stand = leseFortschritt({ top: 240, height: 3000, viewport: 900 })
    assert.equal(stand.verfolgbar, true)
    assert.equal(stand.prozent, 0)
})

test('Mitte: die Haelfte der Strecke ist 50 %', () => {
    // Strecke = 3000 − 900 = 2100; die Hälfte davon ist 1050 herausgescrollt.
    assert.equal(leseFortschritt({ top: -1050, height: 3000, viewport: 900 }).prozent, 50)
})

test('Ende: 100 %, sobald die LETZTE Zeile sichtbar ist — und nicht mehr als 100', () => {
    assert.equal(leseFortschritt({ top: -2100, height: 3000, viewport: 900 }).prozent, 100)
    // Überscrollen (elastisches Scrollen auf iOS, Sprungmarken) darf nicht über 100 laufen.
    assert.equal(leseFortschritt({ top: -9999, height: 3000, viewport: 900 }).prozent, 100)
})

test('der Fortschritt ist ganzzahlig — eine Leiste braucht keine Nachkommastellen', () => {
    const stand = leseFortschritt({ top: -333, height: 3000, viewport: 900 })
    assert.equal(Number.isInteger(stand.prozent), true)
})

// ── Restzeit statt Prozentzahl ──────────────────────────────────────────────────────

test('restMinuten zaehlt herunter und rundet AUF — nie zu optimistisch', () => {
    assert.equal(restMinuten(7, 0), 7)
    assert.equal(restMinuten(7, 50), 4) // 3,5 → 4
    assert.equal(restMinuten(7, 99), 1) // 0,07 → 1: solange etwas fehlt, steht dort nicht 0
    assert.equal(restMinuten(7, 100), 0)
})

test('restMinuten: KEINE Lesezeit (0) bleibt 0 — die Flaeche laesst die Zeile dann weg', () => {
    // Dieselbe Bedeutung wie in `ArticleRow.readingMinutes`: 0 heißt „keine Angabe", nicht
    // „null Minuten". Ein „noch 0 Min" über einem ungelesenen Artikel wäre eine Lüge.
    assert.equal(restMinuten(0, 0), 0)
    assert.equal(restMinuten(0, 50), 0)
})

test('restMinuten faengt unbrauchbare Eingaben ab, statt NaN weiterzureichen', () => {
    assert.equal(restMinuten(Number.NaN, 50), 0)
    assert.equal(restMinuten(7, Number.NaN), 0)
    assert.equal(restMinuten(7, -20), 7)
    assert.equal(restMinuten(7, 400), 0)
})

// ── Teilen: der Fall ohne `naddr` ───────────────────────────────────────────────────

test('Artikel OHNE naddr: nicht teilbar, und die URL ist leer — kein Link ins Nichts', () => {
    const ziel = artikelTeilZiel('https://app.example/articles', '', 'Ein Titel')
    assert.equal(ziel.teilbar, false)
    assert.equal(ziel.url, '')
    // Der Titel bleibt trotzdem stehen: die Fläche zeigt ihn im Grund-Satz des inerten
    // Knopfes, sie braucht ihn also auch in diesem Zweig.
    assert.equal(ziel.titel, 'Ein Titel')
})

test('Artikel MIT naddr: absolute Adresse aus Basis + Kennung', () => {
    const ziel = artikelTeilZiel('https://app.example/articles', 'naddr1abc', 'Ein Titel')
    assert.equal(ziel.teilbar, true)
    assert.equal(ziel.url, 'https://app.example/articles/naddr1abc')
})

test('eine Basis mit Schraegstrich am Ende erzeugt keinen Doppel-Schraegstrich', () => {
    // `route()` liefert je nach Konfiguration mit oder ohne — dieselbe Normalisierung wie
    // in `nostrArticles._base` (`bridge.ts`).
    assert.equal(artikelTeilZiel('https://app.example/articles//', 'naddr1abc', 'T').url, 'https://app.example/articles/naddr1abc')
})

test('ohne Basis ist nichts teilbar — lieber kein Link als ein relativer, der woanders bricht', () => {
    const ziel = artikelTeilZiel('', 'naddr1abc', 'T')
    assert.equal(ziel.teilbar, false)
    assert.equal(ziel.url, '')
})

// ── Die drei Formen des Lesestands ──────────────────────────────────────────────────

test('lesestandForm: ohne Strecke oder vor dem ersten Scrollen steht die GESAMTzeit', () => {
    assert.equal(lesestandForm(false, 0, 14), 'gesamt')
    assert.equal(lesestandForm(false, 80, 14), 'gesamt')
    assert.equal(lesestandForm(true, 0, 14), 'gesamt')
})

test('lesestandForm: waehrend des Lesens der REST', () => {
    assert.equal(lesestandForm(true, 1, 14), 'rest')
    assert.equal(lesestandForm(true, 50, 14), 'rest')
    assert.equal(lesestandForm(true, 99, 14), 'rest')
})

test('lesestandForm: bei 100 % das ENDE — nicht „noch 0 Min"', () => {
    // Am laufenden Client gemessen: bei 100 % stand dort „noch 0 Min". Richtig, und
    // trotzdem las es sich wie ein Defekt. Der dritte Zustand ersetzt genau diese Ausgabe.
    assert.equal(lesestandForm(true, 100, 14), 'ende')
    assert.equal(restMinuten(14, 100), 0)
})

test('lesestandForm: ohne Lesezeit-Angabe gibt es keinen Rest zu zeigen', () => {
    // `readingMinutes === 0` heißt „keine Angabe" — die Fläche blendet die Zeile ganz aus.
    assert.equal(lesestandForm(true, 50, 0), 'gesamt')
})
