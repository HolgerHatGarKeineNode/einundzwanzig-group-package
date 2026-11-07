// `?url`-Importe: Vite löst sie zum PFAD der Datei auf und kopiert sie unverändert ins
// Build, statt sie in ein JS-Modul zu transformieren. Warum das im Emoji-Pfad zählt,
// steht an `loadEmojiGroups()` — kurz: als JSON-Import blähte Vite die 600-kB-Datei im
// Dev-Server auf 4,2 MB JavaScript auf.
//
// AUSGESCHRIEBENE Pfade und keine Wildcard `'*?url'`: die greift hier nicht. TypeScript
// löst `emojibase-data/de/compact.json` zuerst als echtes JSON-Modul auf (resolveJson
// Module), scheitert dann am Query-Suffix und fällt NICHT mehr auf ein Wildcard-Modul
// zurück. Gilt auch für Vites eigene Deklarationen in `vite/client` — die stehen als
// Wildcard drin und lösen den Fall deshalb ebenso wenig (beides gemessen: `tsc` blieb
// bei TS2307). Wer eine dritte solche Datei einbindet, trägt sie hier ein.
declare module 'emojibase-data/de/compact.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/de/messages.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/en/compact.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/en/messages.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/es/compact.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/es/messages.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/hu/compact.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/hu/messages.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/nl/compact.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/nl/messages.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/pl/compact.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/pl/messages.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/pt/compact.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/pt/messages.json?url' {
    const url: string
    export default url
}

declare module 'emojibase-data/versions/emoji.json?url' {
    const url: string
    export default url
}
