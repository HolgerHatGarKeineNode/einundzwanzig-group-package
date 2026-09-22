{{-- The island's boot globals (`__nostrSpace`, `__nostrWorkspace`, `__nostrBoard`,
     `__nostrMedia`, `__nostrPortal`, `__nostrMobile`, `__nostrVerein`, `__nostrI18n`, …) —
     ONE partial for every layout that loads the island bundle.

     Must stand BEFORE the bundle's `@vite`: the modules read these values at top level
     once and freeze them. Until the v1.13.0 device sighting they stood only in
     `partials/head`, the package layout's head; a host layout that loaded the same bundle
     (twenty-one-companion's `layouts::mobile`) set none of them, and the island fell back
     to its code defaults — for the space that was `ws://localhost:3334/`, dialled on every
     page of that layout. A host includes this partial in its own head instead of copying
     the lines, so a new global reaches every layout at once. --}}
{{-- The default space (the island reads window.__nostrSpace at boot). Without it the island
     opens no space connection at all (`UNCONFIGURED_SPACE_URL`, `js/relayConfig.ts`). --}}
@if (config('group.space_url'))
    {{-- `??`, not `=`: a value set beforehand WINS — just like the __nostrMobile flag
         below. The E2E suite sets the space via addInitScript, i.e. before this line
         runs. --}}
    <script>window.__nostrSpace = window.__nostrSpace ?? @js(config('group.space_url'));</script>
@endif

{{-- Second, fixed space for the "Workspaces" tab (empty = the tab stays off). Same `??`
     rule as above, so the E2E suite can set it via addInitScript. --}}
@if (config('group.workspace_url'))
    <script>window.__nostrWorkspace = window.__nostrWorkspace ?? @js(config('group.workspace_url'));</script>
@endif

{{-- Source of the longform articles (P7). Empty = the article screen shows its empty
     state and asks no relay. Same `??` rule as above: a value preset via addInitScript
     wins against the configuration. --}}
@if (config('group.board_relay_url'))
    <script>window.__nostrBoard = window.__nostrBoard ?? @js(config('group.board_relay_url'));</script>
@endif

{{-- P6 — relays of the SOCIAL SIGNALS (kind 7/9735/1111), comma separated. Set only when
     configured; empty means "the board only". Same `??` rule as above, so an E2E run can
     pull them onto its own relay via addInitScript — or empty them explicitly. The
     articles themselves still come from the board ONLY. --}}
@if (config('group.article_relay_urls'))
    <script>window.__nostrArticleRelays = window.__nostrArticleRelays ?? @js(config('group.article_relay_urls'));</script>
@endif

{{-- P2 — NIP-52 calendar: the relays a meetup's dates (kind 31923) and the RSVPs
     (kind 31925) live on, comma separated, plus the pubkeys whose dates count. BOTH
     values are needed; with one missing the date card asks no relay and keeps showing
     the HTTP date from the portal list. Same `??` rule as above, so an E2E run can pull
     them onto its own relay with addInitScript.

     **These two lines stand TWICE in the tree** (here and in the web host's own head).
     `tests/Feature/CalendarRelaysTest.php` holds both together; it exists because exactly
     this mistake happened while building P2: the lines were in the package partial only,
     and the date card would have stayed silently on the HTTP fallback in normal web
     operation. --}}
@if (config('group.calendar_relay_urls'))
    <script>window.__nostrCalendarRelays = window.__nostrCalendarRelays ?? @js(config('group.calendar_relay_urls'));</script>
@endif
@if (config('group.calendar_authors'))
    <script>window.__nostrCalendarAuthors = window.__nostrCalendarAuthors ?? @js(config('group.calendar_authors'));</script>
@endif

{{-- Target of the profile links: the public creator page on media.
     (`group.media_public_url`). Set only when configured — empty means "no link", and the
     row disappears on both surfaces. Same `??` rule as above, so an E2E run can set the
     base via addInitScript OR empty it explicitly. Read in `js/bridge.ts`
     (`medienBasis`). --}}
@if (config('group.media_public_url'))
    <script>window.__nostrMedia = window.__nostrMedia ?? @js(config('group.media_public_url'));</script>
@endif

{{-- Portal origin for the client-side meetup join (`js/meetups.ts`): the list is fetched
     from here and the deep links point here. Without this line the island falls back to
     production — which is how the browser tests used to reach the live portal although they
     point `PORTAL_URL` at a dead port. Same `??` rule as above. --}}
@if (config('group.portal_url'))
    <script>window.__nostrPortal = window.__nostrPortal ?? @js(config('group.portal_url'));</script>
@endif

{{-- Platform flag: on the device the island gates client-side (no NIP-98). A flag set
     beforehand wins (E2E via addInitScript, like __nostrRelays). --}}
<script>window.__nostrMobile = window.__nostrMobile ?? @js(\Einundzwanzig\Group\Chassis::istApp());</script>

{{-- P5 (onboarding): association base URL, proxy origin, waiting time and the public
     fallback address. The base URL is NOT a secret (the `X-Api-Key` stays in the proxy),
     but it has to reach the browser: the `u` tag of the NIP-98 credential targets the
     ASSOCIATION, not our proxy route. Empty `api` = the flow does not exist, the gate links
     out. `proxy` is meant for the foreign host/mobile build that does NOT register the
     proxy itself (it runs only in the hosted web instance). --}}
<script>window.__nostrVerein = window.__nostrVerein ?? @js([
    'api' => (string) config('group.verein_api_url'),
    'proxy' => (string) config('group.verein_proxy_base'),
    'activationMinutes' => (int) config('group.verein_activation_minutes'),
    'publicUrl' => (string) config('group.verein_public_url'),
]);</script>

{{-- P2: translation catalogue of the active language for the island (`js/i18n.ts`).
     Must stand BEFORE @vite — see the reasoning in that partial. --}}
@include('group::partials.i18n')
