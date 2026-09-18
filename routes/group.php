<?php

use Einundzwanzig\Group\Http\Controllers\LegacyRedirect;
use Einundzwanzig\Group\Http\Controllers\LocaleController;
use Einundzwanzig\Group\Http\Controllers\NostrAuthController;
use Einundzwanzig\Group\Http\Controllers\PortalIndexController;
use Einundzwanzig\Group\Http\Middleware\ContentSecurityPolicy;
use Illuminate\Routing\RedirectController;
use Illuminate\Support\Facades\Route;

/*
 * The package's group routes. Every name under the `group.` prefix — a host links via
 * `route('group.start')`. CSP on these routes only (friction 9), not globally on the
 * host's `web` group.
 */
// `web` explicitly: package routes (`loadRoutesFrom`) do NOT inherit the host's `web`
// group automatically — without it there is no session, no cookies and no CSRF.
Route::middleware(['web', ContentSecurityPolicy::class])->name('group.')->group(function (): void {
    // M1 — Nostr-Login (Client-Signer) + NIP-98-Handoff an die Laravel-Session.
    Route::livewire('/nostr-login', 'group::nostr-login')->name('nostr-login');
    Route::get('/nostr/challenge', [NostrAuthController::class, 'challenge'])->name('nostr.challenge');
    Route::post('/nostr/login', [NostrAuthController::class, 'login'])->name('nostr.login');
    Route::post('/nostr/logout', [NostrAuthController::class, 'logout'])->name('nostr.logout');

    // P2 — Sprachwahl. BEWUSST außerhalb von `nostr.auth`: Sprache ist eine
    // Anzeige-Einstellung, kein Konto-Zustand; ein Gast auf der Login-Seite muss
    // sie umstellen können. Antwort ist ein 302 → volles Neuladen (der Cookie
    // muss vor dem nächsten Render stehen, `wire:navigate` reicht dafür nicht).
    Route::post('/locale', [LocaleController::class, 'update'])->name('locale');

    /*
     * ══ THE HUB ROUTES (Concept C "One Entrance", D3) ═══════════════════════════
     *
     * Start · Postfach · Bereich-* · Ich-* replace the old hub paths; the object
     * routes (`/rooms/{h}`, thread, `/articles/{naddr}`, `/forge/*`, `/join`,
     * `/verein/*`) keep their paths. The old hub paths answer with a 302 at the end
     * of this file.
     *
     * STATIC routes per area and NOT one `/bereich/{name}` dispatcher: the middleware
     * and the config gate differ per area, and a dispatcher would have to re-derive
     * both from a string at request time.
     */

    /*
     * Start (D4) — the one entrance. NO `nostr.auth`: a guest sees Start in guest
     * mode, public tiles navigate, gated tiles open the login sheet. The
     * guest/member split is decided in the island with a skeleton, never
     * server-rendered: on the app the login state lives only in `localStorage`, so a
     * server guess would flash the wrong state on every cold start.
     */
    Route::livewire('/start', 'group::start')->name('start');

    /*
     * Articles are readable WITHOUT a session since P2 (D4) — all three routes, not
     * just the list: a shared `naddr` and an author page are exactly what a guest
     * follows from outside. The board relay is `restricted_writes`, so what is
     * readable here is curated; the reader stays anonymous either way (`core.ts`
     * answers no NIP-42 challenge for these relays).
     */
    Route::livewire('/bereich/artikel', 'group::articles')->name('bereich.artikel');
    // Die Vollansicht adressiert über `naddr` (NIP-19), nicht über die Event-Id: ein
    // 30023 ist ersetzbar, seine Id wechselt mit jeder Überarbeitung — der `naddr`
    // (Kind + Autor + `d`) bleibt und funktioniert auch in fremden Clients.
    Route::livewire('/articles/{naddr}', 'group::article')->name('article');
    /*
     * Die Autorenseite (P4). Adressiert über eine **npub ODER eine NIP-05-Adresse** —
     * `npub1…` löst der Browser ohne Netz auf, `name@domain.tld` über eine
     * `.well-known/nostr.json`-Abfrage bei der genannten Domain. Beide Formen sind
     * das, was ein Mensch von einem anderen Client kopiert; nur eine davon
     * anzunehmen hieße, die halben geteilten Links abzuweisen.
     *
     * **Route und nicht Drawer.** Die Fremdvorlage `discover.einundzwanzig.space`
     * zeigt dieselbe Auskunft in einem JS-Drawer über einen API-Endpunkt und hat
     * dafür keine URL. Eine teilbare Adresse ist genau der Vorteil gegenüber dem
     * Original — und der Grund, warum diese Seite ein eigenes Segment bekommt.
     *
     * **Kein Konflikt mit `/articles/{naddr}`:** drei Segmente gegen zwei, Laravel
     * kann sie gar nicht verwechseln. `/articles/autor` OHNE Kennung landet dagegen
     * auf der Vollansicht und bekommt dort „Diesen Artikel gibt es nicht" — richtig,
     * denn ohne Autor gibt es keine Autorenseite, und eine Liste aller Autoren ist
     * bewusst nicht Teil dieses Vorhabens.
     *
     * Der Parameter wird server-seitig NICHT gedeutet: eine NIP-05-Auflösung im
     * Server wäre eine Verbindung zu einer vom Besucher gewählten fremden Domain,
     * aufgebaut aus dem Rechenzentrum. Sie gehört in den Browser des Lesers, und
     * dort steht sie (`js/articleAuthor.ts`).
     */
    Route::livewire('/articles/autor/{autor}', 'group::article-author')->name('articles.author');

    /*
     * ══ THE READ-ONLY PORTAL PAGES (D9, P4) ═════════════════════════════════════
     *
     * Meetups, their dates and the courses/lecturers of the association portal, readable
     * inside this client. Deliberately WITHOUT `nostr.auth`, and not as a courtesy: a
     * meetup page is what a guest follows from a shared link, and „come to our meetup"
     * behind a login is the opposite of what the surface is for (D4). Everything these
     * pages can do is READ — managing a meetup stays in the Portal (web) resp. in the
     * app's own editor sheets, reached through the `portal_detail_actions` slot.
     *
     * `?ansicht=` chooses the view (`liste`|`termine` and, where a host binds it, `karte`
     * — `config('group.meetup_views')`). One route per object, not one per view: the
     * address of a meetup must not change when someone switches to the map.
     */
    Route::livewire('/bereich/meetups', 'group::meetups')->name('bereich.meetups');
    Route::livewire('/bereich/meetups/{slug}', 'group::meetup')->name('bereich.meetups.show');
    Route::livewire('/bereich/kurse', 'group::kurse')->name('bereich.kurse');
    /*
     * The two detail routes carry NUMERIC ids because the Portal's courses and lecturers
     * have no slug (measured: `/api/courses/{id}`, `/api/lecturers/{id}`). `whereNumber`
     * keeps `/bereich/kurse/referenten/{id}` and `/bereich/kurse/{id}` apart even if a
     * future view token were added — three segments against four would already do it, but
     * a non-numeric id is a 404 here rather than a Portal request with a garbage path.
     */
    Route::livewire('/bereich/kurse/{id}', 'group::kurs')->whereNumber('id')->name('bereich.kurse.show');
    Route::livewire('/bereich/kurse/referenten/{id}', 'group::referent')->whereNumber('id')->name('bereich.referenten.show');

    /*
     * „Ich" and the settings hub carry NO server gate: their sections gate
     * client-side, for the same reason Start does. A guest who opens `/ich` sees the
     * login invitation, not a 302 to a login screen he did not ask for.
     */
    Route::livewire('/ich', 'group::ich')->name('ich');
    // Verschmolzener Settings-Screen (§6): der EINE Settings-Ort.
    Route::livewire('/ich/einstellungen', 'group::pages.settings')->name('ich.einstellungen');

    // Geschützt durch das Nostr-Gate: aktiver Space + Raum-Liste (Single-Space §12).
    Route::middleware('nostr.auth')->group(function (): void {
        /*
         * Area "Chat" — the room list. Until P2 this was `/spaces`; the old path forwards
         * here and carries `q` and `rt` along (search resp. focus mode).
         */
        Route::livewire('/bereich/chat', 'group::spaces')->name('bereich.chat');
        Route::livewire('/bereich/leute', 'group::directory')->name('bereich.leute');
        /*
         * Forge (P6, NIP-34 + NIP-MP). Nur der Workspace-Arm trägt sie — der
         * zooid-Space kennt weder Repos noch Issues. Ob überhaupt ein Workspace
         * konfiguriert ist, entscheidet die SEITE (server-seitig, wie bei den
         * Artikeln); die Route existiert unabhängig davon, damit ein geteilter
         * Link nicht auf einen 404 läuft, sondern auf eine erklärende Fläche.
         */
        Route::livewire('/bereich/forge', 'group::forge')->name('bereich.forge');
        Route::livewire('/bereich/wallet', 'group::settings.wallet')->name('bereich.wallet');

        /*
         * Postfach (D5) — ONE page with five segments (Alles · Erwähnungen · Threads ·
         * Direkt · Erinnerungen), chosen through `?ansicht=`. P2 ships the interim form:
         * the existing updates surface plus a reminders section; the segmentation itself
         * and the late decryption of the NIP-17 wraps are built in P3.
         */
        Route::livewire('/postfach', 'group::updates')->name('postfach');

        /*
         * Bookmarks (NIP-51 kind 10003/30003) and the association surface live under
         * „Ich": both belong to the user, not to the space.
         */
        Route::livewire('/ich/lesezeichen', 'group::bookmarks')->name('ich.lesezeichen');
        /*
         * Ich › Verein (D11). P2 showed the JOIN FLOW here as its interim state; since P5 this
         * is its own page — membership status, contribution year and receipts, read through the
         * session proxy on the web and through the signed app proxy in the app (P1 built it).
         * The flow keeps its own address (`/verein/beitritt`) and is reached from here: this
         * page answers „where do I stand?", the flow answers „how do I get in?".
         */
        Route::livewire('/ich/verein', 'group::ich-verein')->name('ich.verein');

        /*
         * Ein Repository, adressiert über `naddr` (NIP-19) — nicht über die
         * Event-Id: ein 30617 ist ersetzbar und seine Id wechselt mit jeder
         * Neuankündigung. Kind + Autor + `d` bleiben und funktionieren auch in
         * einem fremden Client. Gleiche Begründung wie beim Artikel.
         */
        Route::livewire('/forge/{naddr}', 'group::forge-repo')->name('forge.repo');
        /*
         * Die Einzelansicht eines Vorgangs (GitHub-Parität P1, 2026-08-27).
         *
         * Das `{id}`-Segment ist die ROHE Event-Id (64 Stellen Hex) — dieselbe
         * Form, die bis hierher im Query-Parameter lief (`?issue=`/`?pr=`,
         * P2-Entscheid 2026-08-24). Diese Entscheidung traf eine Aussage über
         * die ID-FORM (rohe Hex-Id statt `nevent` mit Relay-Hints) — die bleibt
         * gültig; die Hex-Id wandert nur vom Query-Parameter ins Pfadsegment.
         * Was sich geändert hat, ist die Prämisse: eine Einzelansicht ist eine
         * SEITE (eigener Titel, eigene Historie, Zurück-Pfeil), kein Aufklapp-
         * Zustand auf einer Liste. Vorbild ist GitHub (`/{owner}/{repo}/issues/{n}`).
         *
         * Keine Kollision mit `/forge/{naddr}`: drei Segmente gegen zwei.
         * Der Server deutet die Id NICHT — ob der Vorgang existiert, weiss nur
         * das Workspace-Relay hinter NIP-42; ungültige Formen fängt der Mount
         * der Repo-Seite (Alt-Link-Redirect) bzw. die Insel (Leerfläche).
         */
        Route::livewire('/forge/{naddr}/issues/{id}', 'group::forge-issue')->name('forge.issue');
        Route::livewire('/forge/{naddr}/pulls/{id}', 'group::forge-pull')->name('forge.pull');
        Route::livewire('/rooms/{h}', 'group::room')->name('room');
        // Direkt verlinkbarer Thread (C6b): dieselbe Room-SFC, öffnet den Thread als
        // Vollansicht. `{nevent}` = bech32-Referenz auf die Wurzel-Nachricht (portabel/teilbar).
        Route::livewire('/rooms/{h}/thread/{nevent}', 'group::room')->name('room.thread');
        Route::livewire('/join', 'group::join')->name('join');

        /*
         * P5 — Vereins-Onboarding. Statisches erstes Segment, kollidiert mit
         * keinem `/rooms/{h}`. Interstitial ohne Bottom-Nav (wie `/join`): der
         * Nutzer ist auf einer Strecke, kein Tab-Wechsel dazwischen.
         */
        Route::livewire('/verein/beitritt', 'group::verein')->name('verein.join');

        /*
         * Der Rücksprung aus dem BTCPay-Checkout.
         *
         * Ein eigener, statischer Pfad und keine Query-Variante des Flows: der
         * Verein prüft `return_url` gegen eine **serverseitige Allowlist**
         * (`app/Support/InvoiceReturnUrl.php` dort, P3). Was dort eingetragen
         * wird, muss zeichengenau und dauerhaft sein — `https://<host>/verein/zurueck`
         * ist genau ein Eintrag, eine Query-Variante wäre je nach Zustand eine
         * andere Zeichenkette und fiele mit 422 durch.
         *
         * Der Sprung landet im WARTEZUSTAND, nicht am Anfang: wer gerade bezahlt
         * hat, darf nicht auf einen Knopf schauen, der eine zweite Rechnung aus
         * einem Kontingent von drei pro Tag zieht.
         *
         * Aufgebaut wie `Route::redirect()`, aber als `GET` statt `ANY`: der
         * Rücksprung aus einem Browser-Checkout ist ein GET, und eine Route, die
         * jede Methode annimmt, ist eine Methode-Fläche ohne Zweck. Dieselbe
         * Bauart wie der Proxy nebenan (`routes/verein.php`) — dort ist die
         * Routentabelle die Erlaubnisliste, hier gilt derselbe Grundsatz.
         *
         * `RedirectController` statt einer Closure: Closures überleben
         * `route:cache` nicht, und der Mobile-Build cacht.
         */
        Route::get('/verein/zurueck', RedirectController::class)
            ->defaults('destination', '/verein/beitritt?schritt=warten')
            ->defaults('status', 302)
            ->name('verein.return');
    });

    /*
     * ══ THE OLD HUB PATHS (R7) ══════════════════════════════════════════════════
     *
     * Every row of the map in the plan's route section, as a 302 that KEEPS the query
     * string — `Route::redirect()` drops it, and `?c=`, `?rt=`, `?tab=`, `?q=` all
     * stand in links people have shared and in shipped app builds. Renames are
     * explicit (`c` → `an`), so the receiving page reads its own vocabulary.
     *
     * **301 since the P7 sweep** (302 until then): a 301 is cached by a browser
     * indefinitely and cannot be taken back, so it was switched only once every row had a
     * green test. The status itself lives in `LegacyRedirect`.
     *
     * OUTSIDE `nostr.auth` on purpose. A redirect is not a surface; forwarding a
     * guest to the new address and letting THAT route decide is one gate, not two —
     * and a login redirect that swallows the target would lose the query the row
     * exists to preserve.
     *
     * The old NAMES are deliberately not kept (`space.settings` excepted, below):
     * a reference this phase forgot to move now throws `Route [group.spaces] not
     * defined` in the suite instead of silently costing every internal link a
     * redirect hop.
     */
    /**
     * @param  array{behalte?: list<string>, umbenenne?: array<string, string>, weiche?: array{param: string, werte: array<string, string>}, name?: string}  $defaults
     */
    $legacy = static function (string $pfad, string $ziel, array $defaults = []): void {
        Route::get($pfad, LegacyRedirect::class)
            ->defaults('ziel', $ziel)
            ->defaults('behalte', $defaults['behalte'] ?? [])
            ->defaults('umbenenne', $defaults['umbenenne'] ?? [])
            ->defaults('weiche', $defaults['weiche'] ?? null)
            ->name($defaults['name'] ?? 'legacy.'.trim(str_replace('/', '.', $pfad), '.'));
    };

    // `?tab=workspaces` was the room list's workspace tab — it moved to `/forge`, and the
    // old link has to land there, not on the chat list.
    $legacy('/spaces', '/bereich/chat', [
        'behalte' => ['q', 'rt'],
        'weiche' => ['param' => 'tab', 'werte' => ['workspaces' => '/bereich/forge?tab=workspaces']],
    ]);
    $legacy('/updates', '/postfach');
    // `c` hieß die Unterhaltung im alten Nachrichten-Screen; im Postfach heißt sie `an`.
    $legacy('/messages', '/postfach?ansicht=direkt', ['umbenenne' => ['c' => 'an']]);
    $legacy('/bookmarks', '/ich/lesezeichen');
    $legacy('/directory', '/bereich/leute');
    $legacy('/articles', '/bereich/artikel');
    $legacy('/forge', '/bereich/forge', ['behalte' => ['tab']]);
    $legacy('/settings', '/ich/einstellungen');
    /*
     * The route NAME `space.settings` is kept: cross-repo hardlinks point at it (the
     * association embed and shipped app builds). A rename would be a three-repo release for
     * a string nobody reads.
     */
    $legacy('/settings/space', '/ich/einstellungen', ['name' => 'space.settings']);
    $legacy('/settings/wallet', '/bereich/wallet');
});

/*
 * ══ THE PALETTE INDEX (D6) ══════════════════════════════════════════════════════
 *
 * OUTSIDE the `web` group, and that is the point of the route: the answer depends on
 * nothing but the Portal's public lists, so it needs neither session nor cookie nor CSRF
 * token — the same reasoning as the host's image proxy (`routes/img.php`). Inside `web`
 * every palette open would write a session row, and on SQLite that serialises against
 * every other request of the instance (measured there: TTFB 0.4 s → 5 s).
 *
 * Its own throttle instead of the host's global one: this endpoint is answered from a
 * cache and is loaded ONCE per palette session, so a tight per-IP bucket is right — and a
 * host that shares an IP with a whole office must not lose its chat because someone opened
 * ⌘K. `throttle:60,1` is the Portal's own rate for its API, deliberately mirrored.
 *
 * No `ContentSecurityPolicy`: that middleware writes a policy for a DOCUMENT. On a JSON
 * body it would be a header nothing reads.
 */
Route::middleware('throttle:'.config('group.portal_index_rate', '60,1'))
    ->name('group.')
    ->get('/suche/portal-index', PortalIndexController::class)
    ->name('suche.portal-index');
