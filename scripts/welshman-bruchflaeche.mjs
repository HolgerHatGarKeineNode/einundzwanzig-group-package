#!/usr/bin/env node
/**
 * welshman-bruchflaeche.mjs — misst, wie viele Dateien beim Sprung auf eine neuere
 * welshman-Version brechen würden.
 *
 * Für jede `.ts`/`.js`-Datei unter den Scan-Wurzeln werden per TypeScript-AST
 * (`ts.createSourceFile`, KEINE Textmuster) alle Modul-Referenzen auf `@welshman/*`
 * gesammelt: statische Importe, `export … from`, `import type`, dynamische
 * `import()`-Aufrufe und `require()`. Die dabei importierten Symbolnamen werden gegen
 * die Exportmenge der Zielversion geprüft. Eine Datei zählt als "gebrochen", sobald sie
 * mindestens ein Symbol importiert, das die Zielversion nicht mehr exportiert — oder
 * ein Paket importiert, das es in der Zielversion gar nicht mehr gibt.
 *
 * ── Herkunft der Zielversions-Symbolmenge ──────────────────────────────────────────
 * Sie wird NICHT aus einer gepflegten Liste gelesen, sondern aus den echten npm-
 * Tarballs der Zielversion. Reproduzierbar neu erzeugen (Beispiel 0.9.5):
 *
 *   D=/pfad/zu/scratchpad/w095
 *   mkdir -p "$D" && cd "$D"
 *   for p in app content domain editor feeds lib net signer store util; do
 *     npm pack "@welshman/$p@0.9.5"
 *     mkdir -p "node_modules/@welshman/$p"
 *     tar xzf "welshman-$p-0.9.5.tgz" -C "node_modules/@welshman/$p" --strip-components=1
 *   done
 *
 * `@welshman/router` ist bewusst NICHT dabei: das Paket existiert ab 0.9.x nicht mehr
 * (letzte Version auf npm: 0.9.0-pre1). Jedes daraus importierte Symbol gilt deshalb
 * als gebrochen — genau das soll die Messung zeigen.
 *
 * Die Exportmenge je Paket wird aus den `.d.ts`-Dateien über den TypeScript-Checker
 * gelesen (`getExportsOfModule`), damit `export * from …`-Ketten mit aufgelöst werden.
 * Die installierten 0.8.16-Pakete unter `node_modules/` werden dabei nicht angefasst.
 *
 * ── Aufruf ─────────────────────────────────────────────────────────────────────────
 *   node scripts/welshman-bruchflaeche.mjs --symbols=<dir-mit-node_modules> [optionen]
 *
 *   --symbols=<dir>   Verzeichnis, das `node_modules/@welshman/*` der ZIELVERSION
 *                     enthält (alternativ: Umgebungsvariable WELSHMAN_ZIEL_DIR).
 *   --root=<dir>      Scan-Wurzel, mehrfach erlaubt. Default: `js/` des Pakets.
 *   --json            Ergebnis als JSON statt als Textbericht.
 *   --details         Je gebrochener Datei die gebrochenen Symbole auflisten.
 */

import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {createRequire} from "node:module"

const hier = path.dirname(fileURLToPath(import.meta.url))
const paketWurzel = path.resolve(hier, "..")
const require_ = createRequire(import.meta.url)
const ts = require_("typescript")

// ── Argumente ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const argWert = (name) => {
  const treffer = argv.find((a) => a.startsWith(`--${name}=`))
  return treffer ? treffer.slice(name.length + 3) : undefined
}
const argFlag = (name) => argv.includes(`--${name}`)

const zielDir = argWert("symbols") ?? process.env.WELSHMAN_ZIEL_DIR
if (!zielDir) {
  console.error(
    "Fehlt: --symbols=<dir> (Verzeichnis mit node_modules/@welshman/* der Zielversion).\n" +
      "Wie das Verzeichnis entsteht, steht im Kopf dieser Datei.",
  )
  process.exit(2)
}
const wurzeln = argv.filter((a) => a.startsWith("--root=")).map((a) => path.resolve(a.slice(7)))
if (wurzeln.length === 0) wurzeln.push(path.join(paketWurzel, "js"))

// ── 1. Exportmenge der Zielversion ───────────────────────────────────────────────
const zielPakete = new Map() // paketname → Set<symbolname>

function ladeZielExporte(dir) {
  const welshmanDir = path.join(dir, "node_modules", "@welshman")
  if (!fs.existsSync(welshmanDir)) {
    console.error(`Kein node_modules/@welshman unter ${dir}`)
    process.exit(2)
  }
  const pakete = fs.readdirSync(welshmanDir).filter((p) => !p.startsWith("."))
  const eintraege = []
  for (const p of pakete) {
    const pkgPfad = path.join(welshmanDir, p, "package.json")
    if (!fs.existsSync(pkgPfad)) continue
    const pkg = JSON.parse(fs.readFileSync(pkgPfad, "utf8"))
    const typesRel = pkg.types ?? pkg.typings ?? pkg.exports?.["."]?.types
    if (!typesRel) {
      console.error(`WARNUNG: @welshman/${p}@${pkg.version} hat keinen types-Eintrag`)
      continue
    }
    eintraege.push({name: p, version: pkg.version, dts: path.join(welshmanDir, p, typesRel)})
  }

  const options = {
    noEmit: true,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
    baseUrl: dir,
    allowJs: false,
  }
  const program = ts.createProgram(
    eintraege.map((e) => e.dts),
    options,
  )
  const checker = program.getTypeChecker()
  for (const e of eintraege) {
    const sf = program.getSourceFile(e.dts)
    if (!sf) {
      console.error(`WARNUNG: ${e.dts} nicht ladbar`)
      continue
    }
    const modSym = checker.getSymbolAtLocation(sf)
    const namen = modSym ? checker.getExportsOfModule(modSym).map((s) => s.getName()) : []
    if (namen.length === 0) console.error(`WARNUNG: @welshman/${e.name} liefert 0 Exporte`)
    zielPakete.set(e.name, {version: e.version, symbole: new Set(namen)})
  }
}

ladeZielExporte(path.resolve(zielDir))

// ── 2. Quelldateien einlesen und Importe per AST sammeln ─────────────────────────
function dateienSammeln(wurzel) {
  const out = []
  const gehe = (d) => {
    for (const eintrag of fs.readdirSync(d, {withFileTypes: true})) {
      const p = path.join(d, eintrag.name)
      if (eintrag.isDirectory()) {
        if (eintrag.name === "node_modules" || eintrag.name === ".git") continue
        gehe(p)
      } else if (/\.(ts|tsx|mts|js|mjs)$/.test(eintrag.name) && !eintrag.name.endsWith(".d.ts")) {
        out.push(p)
      }
    }
  }
  if (fs.statSync(wurzel).isDirectory()) gehe(wurzel)
  else out.push(wurzel)
  return out.sort()
}

/** `@welshman/net/dist/…` → `net`; alles andere → undefined */
function paketAus(spezifizierer) {
  const m = /^@welshman\/([^/]+)(\/.*)?$/.exec(spezifizierer)
  return m ? {paket: m[1], unterpfad: m[2] ?? ""} : undefined
}

/**
 * Sammelt je Datei: Map paket → {symbole:Set, unterpfade:Set, namensraum:bool,
 * seiteneffekt:bool, dynamisch:bool}
 */
function importeAus(datei) {
  const quelle = fs.readFileSync(datei, "utf8")
  const sf = ts.createSourceFile(datei, quelle, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const treffer = new Map()
  const hol = (paket) => {
    if (!treffer.has(paket)) {
      treffer.set(paket, {
        symbole: new Set(),
        unterpfade: new Set(),
        namensraum: false,
        seiteneffekt: false,
        dynamisch: false,
      })
    }
    return treffer.get(paket)
  }

  const nimmBindings = (eintrag, bindings) => {
    if (!bindings) {
      eintrag.seiteneffekt = true
      return
    }
    if (ts.isNamespaceImport(bindings) || ts.isNamespaceExport(bindings)) {
      eintrag.namensraum = true
      return
    }
    if (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) {
      for (const el of bindings.elements) {
        eintrag.symbole.add((el.propertyName ?? el.name).text)
      }
      return
    }
    eintrag.namensraum = true
  }

  const besuche = (node) => {
    // import … from "…"  /  import "…"
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const info = paketAus(node.moduleSpecifier.text)
      if (info) {
        const eintrag = hol(info.paket)
        if (info.unterpfad) eintrag.unterpfade.add(info.unterpfad)
        const cl = node.importClause
        if (!cl) {
          eintrag.seiteneffekt = true
        } else {
          if (cl.name) eintrag.symbole.add("default")
          nimmBindings(eintrag, cl.namedBindings)
        }
      }
    }
    // export … from "…"
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const info = paketAus(node.moduleSpecifier.text)
      if (info) {
        const eintrag = hol(info.paket)
        if (info.unterpfad) eintrag.unterpfade.add(info.unterpfad)
        if (!node.exportClause) eintrag.namensraum = true
        else nimmBindings(eintrag, node.exportClause)
      }
    }
    // import("…") und require("…")
    if (ts.isCallExpression(node)) {
      const istDynImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const istRequire = ts.isIdentifier(node.expression) && node.expression.text === "require"
      const arg = node.arguments[0]
      if ((istDynImport || istRequire) && arg && ts.isStringLiteral(arg)) {
        const info = paketAus(arg.text)
        if (info) {
          const eintrag = hol(info.paket)
          if (info.unterpfad) eintrag.unterpfade.add(info.unterpfad)
          eintrag.dynamisch = true
          // `const {a, b} = await import("…")` — die Destrukturierung ist die Symbolliste
          let p = node.parent
          while (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent
          if (p && ts.isVariableDeclaration(p) && ts.isObjectBindingPattern(p.name)) {
            for (const el of p.name.elements) {
              const n = el.propertyName ?? el.name
              if (ts.isIdentifier(n)) eintrag.symbole.add(n.text)
            }
          } else {
            eintrag.namensraum = true
          }
        }
      }
    }
    // `import x = require("…")`
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const ausdruck = node.moduleReference.expression
      if (ts.isStringLiteral(ausdruck)) {
        const info = paketAus(ausdruck.text)
        if (info) hol(info.paket).namensraum = true
      }
    }
    ts.forEachChild(node, besuche)
  }
  besuche(sf)
  return treffer
}

// ── 3. Auswerten ─────────────────────────────────────────────────────────────────
const dateien = wurzeln.flatMap(dateienSammeln)
const berichte = []
let mitWelshman = 0

for (const datei of dateien) {
  const treffer = importeAus(datei)
  if (treffer.size === 0) continue
  mitWelshman++
  const gebrochen = []
  const unbekannt = []
  for (const [paket, eintrag] of treffer) {
    const ziel = zielPakete.get(paket)
    if (!ziel) {
      // Paket existiert in der Zielversion nicht mehr
      const namen = eintrag.symbole.size ? [...eintrag.symbole] : ["<paket entfällt>"]
      for (const n of namen) gebrochen.push(`${paket}.${n}`)
      continue
    }
    if (eintrag.unterpfade.size) {
      for (const u of eintrag.unterpfade) unbekannt.push(`${paket}${u} (tiefer Pfad)`)
    }
    if (eintrag.namensraum) unbekannt.push(`${paket} (namensraum-/sternimport)`)
    for (const s of eintrag.symbole) {
      if (!ziel.symbole.has(s)) gebrochen.push(`${paket}.${s}`)
    }
  }
  berichte.push({
    datei: path.relative(paketWurzel, datei),
    test: /\.test\.ts$/.test(datei),
    pakete: [...treffer.keys()].sort(),
    gebrochen: gebrochen.sort(),
    unbekannt: unbekannt.sort(),
  })
}

const gebrochenListe = berichte.filter((b) => b.gebrochen.length > 0)
const prod = gebrochenListe.filter((b) => !b.test)
const test = gebrochenListe.filter((b) => b.test)
const alleSymbole = new Set(berichte.flatMap((b) => b.pakete.map(() => null)).filter(Boolean))
const gebrocheneSymbole = new Set(gebrochenListe.flatMap((b) => b.gebrochen))

if (argFlag("json")) {
  console.log(
    JSON.stringify(
      {
        zielversionen: Object.fromEntries([...zielPakete].map(([k, v]) => [k, v.version])),
        wurzeln,
        dateienMitWelshman: mitWelshman,
        dateienGebrochen: gebrochenListe.length,
        prod: prod.length,
        test: test.length,
        gebrocheneSymbole: [...gebrocheneSymbole].sort(),
        berichte,
      },
      null,
      2,
    ),
  )
} else {
  console.log(`Zielversion je Paket: ${[...zielPakete].map(([k, v]) => `${k}@${v.version}`).join(", ")}`)
  console.log(`(@welshman/router: in der Zielversion nicht vorhanden → alle Symbole gebrochen)`)
  console.log(`Scan-Wurzeln: ${wurzeln.join(", ")}`)
  console.log("")
  console.log(`Dateien mit @welshman-Import : ${mitWelshman}`)
  console.log(`davon mit gebrochenem Symbol : ${gebrochenListe.length}  (Produktion ${prod.length}, Test ${test.length})`)
  console.log(`verschiedene gebrochene Symbole: ${gebrocheneSymbole.size}`)
  console.log("")
  console.log("Gebrochene Dateien:")
  for (const b of gebrochenListe) {
    console.log(`  ${b.test ? "T" : "P"} ${b.datei}  (${b.gebrochen.length})`)
    if (argFlag("details")) console.log(`      ${b.gebrochen.join(", ")}`)
  }
  const mitUnbekannt = berichte.filter((b) => b.unbekannt.length > 0)
  if (mitUnbekannt.length) {
    console.log("")
    console.log("Nicht auflösbar (Stern-/Namensraum-Import oder tiefer dist-Pfad) — manuell prüfen:")
    for (const b of mitUnbekannt) console.log(`  ${b.datei}: ${b.unbekannt.join(", ")}`)
  }
}
