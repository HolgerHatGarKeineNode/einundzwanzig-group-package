/**
 * **The article surface points at the article routes — not at children of its list.**
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleRoutes.test.ts
 *
 * The defect these cases pin down was measured in the P7 sweep, and it is the same one the
 * forge had (`js/forgeRepoTarget.test.ts`): the three article islands are handed
 * `route('group.bereich.artikel')` as their base and built every target out of it. That was
 * right while the list itself lived at `/articles`; P2 moved the list to `/bereich/artikel`
 * and left the object routes where shared links point (`/articles/{naddr}`,
 * `/articles/autor/{autor}`). From then on the share button put
 * `http://…/bereich/artikel/naddr1…` on the clipboard and the author link on the article
 * page carried `http://…/bereich/artikel/autor/npub1…` — two routes that do not exist.
 *
 * ── Why the existing reader cases did not catch it ──────────────────────────────────
 *
 * `articleReader.test.ts` passes `https://app.example/articles` as the base, i.e. the path
 * the list HAD. Appending to it yields the right address by accident, and the cases stayed
 * green through the whole rename. The load-bearing case here is therefore the one that
 * passes the base the application really passes today.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ARTICLE_LIST_HREF, articleAuthorHref, articleHref } from './articleRoutes.ts'
import { artikelTeilZiel } from './articleReader.ts'

describe('the article target table', () => {
    test('an article sits under /articles, the list under /bereich/artikel', () => {
        // Literal, next to the routes they have to match (`routes/group.php`:
        // `Route::livewire('/articles/{naddr}', …)` and `'/bereich/artikel'`).
        assert.equal(articleHref('naddr1abc'), '/articles/naddr1abc')
        assert.equal(ARTICLE_LIST_HREF, '/bereich/artikel')
        assert.notEqual(articleHref('naddr1abc'), `${ARTICLE_LIST_HREF}/naddr1abc`)
    })

    test('an article without a `naddr` has no target at all', () => {
        // `''` rather than a broken link: the markup binds `:href="href(row) || null"`, so
        // the row renders without an `href` and is not a tab stop.
        assert.equal(articleHref(''), '')
        assert.equal(articleAuthorHref(''), '')
    })

    test('the author page is a THIRD route, not a child of the list', () => {
        assert.equal(articleAuthorHref('npub1abc'), '/articles/autor/npub1abc')
        assert.equal(articleAuthorHref('admin@example.test'), '/articles/autor/admin%40example.test')
    })

    test('the share target keeps the origin of the base and takes its PATH from the table', () => {
        // The base the application really hands in since P2 — this is the case that fell.
        const ziel = artikelTeilZiel('http://127.0.0.1:8437/bereich/artikel', 'naddr1abc', 'Ein Titel')
        assert.equal(ziel.teilbar, true)
        assert.equal(ziel.url, 'http://127.0.0.1:8437/articles/naddr1abc')
        assert.equal(ziel.titel, 'Ein Titel')
    })

    test('a base that is no URL yields the path — never the old concatenation', () => {
        assert.equal(artikelTeilZiel('/bereich/artikel', 'naddr1abc', 'T').url, '/articles/naddr1abc')
    })

    test('without a `naddr` there is nothing to share', () => {
        assert.deepEqual(artikelTeilZiel('http://127.0.0.1:8437/bereich/artikel', '', 'T'), {
            teilbar: false,
            url: '',
            titel: 'T',
        })
    })
})
