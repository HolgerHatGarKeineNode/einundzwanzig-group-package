<?php

use Einundzwanzig\Group\Http\Controllers\LocaleController;
use Einundzwanzig\Group\Http\Controllers\NostrAuthController;
use Einundzwanzig\Group\Http\Middleware\ContentSecurityPolicy;
use Illuminate\Routing\RedirectController;
use Illuminate\Support\Facades\Route;

/*
 * Group-Routen des Packages. Alle Namen unter dem `group.`-Präfix — der Host
 * verlinkt via `route('group.spaces')` (Web-Client heute, Portal-Nav in P1).
 * CSP nur auf diesen Routen (Reibung 9), nicht global an die Host-web-Group.
 */
// `web` explizit: Package-Routen (loadRoutesFrom) erben die web-Group des Hosts
// nicht automatisch — ohne sie fehlen Session/Cookies/CSRF.
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

    // Geschützt durch das Nostr-Gate: aktiver Space + Raum-Liste (Single-Space §12).
    Route::middleware('nostr.auth')->group(function (): void {
        Route::livewire('/spaces', 'group::spaces')->name('spaces');
        // Benachrichtigungen („Neu", P4). Eigener Screen statt Bottom-Nav-Tab —
        // ein fünfter Tab bräche `bottom-nav.blade.php` still auf 3 Spalten und
        // wäre ein Drei-Repo-Release inkl. Play-Store. Statisches erstes Segment,
        // kollidiert also mit keinem `/rooms/{h}`.
        Route::livewire('/updates', 'group::updates')->name('updates');
        /*
         * Lesezeichen (P2, NIP-51 kind 10003/30003). Eigener Screen, KEIN
         * Bottom-Nav-Tab: die Spaltenklasse der Bar hängt an `count($items)`
         * (`bottom-nav.blade.php:77`), ein fünfter Eintrag fiele still auf drei
         * Spalten zurück — und der Tab-Satz lebt in drei Repos (Package, Web-Host,
         * Mobile-Host), ein neuer Tab wäre ein Drei-Repo-Release inkl. Play-Store.
         * Einstiege sind deshalb Befehlspalette, Rail-Fußzeile und das
         * Nachrichten-Menü. Statisches erstes Segment, kollidiert mit keinem
         * `/rooms/{h}`.
         */
        Route::livewire('/bookmarks', 'group::bookmarks')->name('bookmarks');
        /*
         * Encrypted conversations (P7, NIP-17). Own screen and NO bottom-nav tab, for the
         * same reason as the bookmarks route above: the bar's column class hangs on
         * `count($items)` (`bottom-nav.blade.php:77`), one more entry would silently fall
         * back to three columns, and the tab set lives in three repositories.
         *
         * **Why this is not the rail's DM surface.** A Buzz DM is a CHANNEL with an `h`
         * and is read by the ordinary chat surface. A NIP-17 conversation has no `h` and
         * no identity beyond the set of its participants — it cannot use `deriveRoomChat`
         * at all. Two transports, two surfaces; the old one stays untouched.
         *
         * Static first segment, so it collides with no `/rooms/{h}`.
         */
        Route::livewire('/messages', 'group::messages')->name('messages');
        Route::livewire('/directory', 'group::directory')->name('directory');
        // Longform-Artikel (P7, NIP-23). Eigener Screen, KEIN Bottom-Nav-Tab und kein
        // Rail-Eintrag: die Spaltenklasse der Bottom-Nav hängt an `count($items)`
        // (`bottom-nav.blade.php:77` — der Verweis stand bis P2 auf `:56` und zeigte
        // seit einem Blockverschub ins Leere) — ein vierter Tab wäre ein
        // Drei-Repo-Release; und
        // die Rail ist eine Sprungliste für RÄUME (`RailRoom` verlangt ein `h`), ein
        // Artikel hat keins. Einstiege sind deshalb Befehlspalette, Rail-Fußzeile und
        // eine Zeile auf der Übersicht. Statisches erstes Segment, kollidiert mit keinem
        // `/rooms/{h}`.
        Route::livewire('/articles', 'group::articles')->name('articles');
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
         * Forge (P6, NIP-34 + NIP-MP). Nur der Workspace-Arm trägt sie — der
         * zooid-Space kennt weder Repos noch Issues. Ob überhaupt ein Workspace
         * konfiguriert ist, entscheidet die SEITE (server-seitig, wie bei den
         * Artikeln); die Route existiert unabhängig davon, damit ein geteilter
         * Link nicht auf einen 404 läuft, sondern auf eine erklärende Fläche.
         *
         * Statisches erstes Segment, kollidiert mit keinem `/rooms/{h}`.
         */
        Route::livewire('/forge', 'group::forge')->name('forge');
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
        // Verschmolzener Settings-Screen (§6): der EINE Settings-Ort.
        Route::livewire('/settings', 'group::pages.settings')->name('settings');
        // Alte ad-hoc space.settings-Seite konsolidiert → Redirect auf den Hub.
        // Route-NAME beibehalten (Cross-Repo-Hardlinks: Mobile-`nav`-`match` +
        // layouts/mobile.blade.php verweisen darauf; Rename = 3 Repos). Entfällt
        // in P5, sobald der Mobile-Host keine space.settings-Referenz mehr hält.
        Route::redirect('/settings/space', '/settings')->name('space.settings');
        Route::livewire('/settings/wallet', 'group::settings.wallet')->name('wallet');
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
});
