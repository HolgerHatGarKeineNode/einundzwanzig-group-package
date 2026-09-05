{{--
    Minimal-Head des Chat-Vollbild-Layouts für Fremdhosts (Portal). Bringt nur,
    was der Chat braucht: Meta + CSRF + __nostrSpace-Injektion + die Insel-Vite-
    Entries. OG/Favicons regelt der Host selbst. Aktiv via config('group.head_partial').
--}}
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="csrf-token" content="{{ csrf_token() }}" />

<title>{{ filled($title ?? null) ? $title.' – '.config('app.name') : config('app.name') }}</title>

{{-- Default-Space VOR @vite setzen (die Insel liest window.__nostrSpace beim Boot). --}}
@if (config('group.space_url'))
    {{-- `??`, nicht `=`: ein vorab gesetzter Wert GEWINNT — genau wie beim
         __nostrMobile-Flag darunter. Die E2E-Suite setzt den Space per
         addInitScript, also bevor diese Zeile läuft. --}}
    <script>window.__nostrSpace = window.__nostrSpace ?? @js(config('group.space_url'));</script>
@endif

{{-- Zweiter, fester Space für den Tab „Workspaces" (leer = Tab bleibt aus). Gleiche
     `??`-Regel wie oben, damit die E2E-Suite ihn per addInitScript setzen kann. --}}
@if (config('group.workspace_url'))
    <script>window.__nostrWorkspace = window.__nostrWorkspace ?? @js(config('group.workspace_url'));</script>
@endif

{{-- Quelle der Longform-Artikel (P7). Leer = der Artikel-Screen zeigt seinen
     Leerzustand und fragt keinen Relay. Gleiche `??`-Regel wie oben: ein per
     addInitScript vorbesetzter Wert gewinnt gegen die Konfiguration. --}}
@if (config('group.board_relay_url'))
    <script>window.__nostrBoard = window.__nostrBoard ?? @js(config('group.board_relay_url'));</script>
@endif

{{-- P6 — Relays der SOZIALSIGNALE (kind 7/9735/1111), kommagetrennt. Nur gesetzt, wenn
     konfiguriert; leer heißt „nur der Board". Gleiche `??`-Regel wie oben, damit ein
     E2E-Lauf sie per addInitScript auf seinen eigenen Relay ziehen — oder ausdrücklich
     leeren — kann. Die Artikel selbst kommen weiterhin NUR vom Board. --}}
@if (config('group.article_relay_urls'))
    <script>window.__nostrArticleRelays = window.__nostrArticleRelays ?? @js(config('group.article_relay_urls'));</script>
@endif

{{-- P2 — NIP-52 calendar: the relays a meetup's dates (kind 31923) and the RSVPs
     (kind 31925) live on, comma separated, plus the pubkeys whose dates count. BOTH
     values are needed; with one missing the date card asks no relay and keeps showing
     the HTTP date from the portal list. Same `??` rule as above, so an E2E run can pull
     them onto its own relay with addInitScript.

     **These two lines stand TWICE in the tree** — see the reasoning at the article
     block. `tests/Feature/CalendarRelaysTest.php` holds both together; it exists because
     exactly this mistake happened while building P2: the lines were in the package
     partial only, and the date card would have stayed silently on the HTTP fallback in
     normal web operation. --}}
@if (config('group.calendar_relay_urls'))
    <script>window.__nostrCalendarRelays = window.__nostrCalendarRelays ?? @js(config('group.calendar_relay_urls'));</script>
@endif
@if (config('group.calendar_authors'))
    <script>window.__nostrCalendarAuthors = window.__nostrCalendarAuthors ?? @js(config('group.calendar_authors'));</script>
@endif

{{-- Ziel der Profil-Verweise: die öffentliche Creator-Seite auf media.
     (`group.media_public_url`). Nur gesetzt, wenn konfiguriert — leer heißt „kein
     Verweis", und dann entfällt die Zeile auf beiden Flächen ganz. Gleiche `??`-Regel
     wie oben, damit ein E2E-Lauf die Basis per addInitScript setzen ODER ausdrücklich
     leeren kann. Gelesen in `js/bridge.ts` (`medienBasis`). --}}
@if (config('group.media_public_url'))
    <script>window.__nostrMedia = window.__nostrMedia ?? @js(config('group.media_public_url'));</script>
@endif

{{-- Plattform-Flag: auf dem Gerät gated die Insel client-seitig (kein NIP-98).
     Ein vorab gesetztes Flag gewinnt (E2E via addInitScript, wie __nostrRelays). --}}
<script>window.__nostrMobile = window.__nostrMobile ?? @js(\Einundzwanzig\Group\Chassis::istApp());</script>

{{-- P5 (Onboarding): Vereins-Basis-URL, Proxy-Origin, Wartezeit und die
     öffentliche Ausweichadresse. Die Basis-URL ist KEIN Geheimnis (der
     `X-Api-Key` bleibt im Proxy), muss aber in den Browser: der `u`-Tag des
     NIP-98-Ausweises zielt auf den VEREIN, nicht auf unsere Proxy-Route.
     Leeres `api` = der Flow existiert nicht, das Gate verlinkt nach außen.
     `proxy` ist für den Fremdhost/Mobile-Build gedacht, der den Proxy NICHT
     selbst registriert (er läuft nur in der gehosteten Web-Instanz). --}}
<script>window.__nostrVerein = window.__nostrVerein ?? @js([
    'api' => (string) config('group.verein_api_url'),
    'proxy' => (string) config('group.verein_proxy_base'),
    'activationMinutes' => (int) config('group.verein_activation_minutes'),
    'publicUrl' => (string) config('group.verein_public_url'),
]);</script>

{{-- P2: Übersetzungskatalog der aktiven Sprache für die Insel (`js/i18n.ts`).
     Muss VOR @vite stehen — siehe Begründung im Partial. --}}
@include('group::partials.i18n')

@vite(config('group.vite'))
@fluxAppearance
