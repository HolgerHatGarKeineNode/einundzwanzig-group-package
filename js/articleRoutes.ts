/**
 * **The target table of the article surface — one place, three routes.**
 *
 * Pure and import-free, like `railForge.ts` for the forge: no welshman, no DOM, no clock,
 * so it loads under `node --test` and can be asserted directly.
 *
 * ── Why this module exists (P7) ────────────────────────────────────────────────────
 *
 * Until P7 the three article islands built their targets out of the base they were handed
 * — `route('group.bereich.artikel')`, i.e. the LIST. Before P2 the list lived at
 * `/articles`, so `${base}/${naddr}` was the detail route and `${base}/autor/${npub}` the
 * author route, and both were right by accident of the path.
 *
 * P2 moved the list to `/bereich/artikel` (D3) and deliberately LEFT the object routes
 * where they were (`/articles/{naddr}`, `/articles/autor/{autor}` — shared links and other
 * clients point at them). From that moment every target built from the base was a 404:
 * measured in the P7 sweep, the share button put
 * `http://…/bereich/artikel/naddr1…` on the clipboard and the author link on the article
 * page carried `http://…/bereich/artikel/autor/npub1…`. Both are routes that do not exist.
 *
 * The same mistake stood in the forge (`js/forge.ts repoHref`), and it is the same lesson:
 * **the base of a list is not the prefix of its objects.** A route table belongs in one
 * place, and the islands ask it.
 */

/** The overview — the list, and the only place `route('group.bereich.artikel')` describes. */
export const ARTICLE_LIST_HREF = '/bereich/artikel'

/**
 * The detail route of an article — `''` for an article without a `naddr` (no `d` tag).
 *
 * `''` and not a broken link: the markup binds this through `:href="href(row) || null"`,
 * so a row without a target renders without an `href` and is not a tab stop.
 */
export const articleHref = (naddr: string): string =>
    naddr === '' ? '' : `/articles/${encodeURIComponent(naddr)}`

/**
 * The author route. The parameter is an npub, a hex key or a NIP-05 address — the route
 * accepts all three (`js/articleAuthor.ts` resolves them); what is shared is the npub.
 */
export const articleAuthorHref = (autor: string): string =>
    autor === '' ? '' : `/articles/autor/${encodeURIComponent(autor)}`
