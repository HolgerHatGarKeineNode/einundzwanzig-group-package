{{--
    Minimal-Head des Chat-Vollbild-Layouts für Fremdhosts (Portal). Bringt nur,
    was der Chat braucht: Meta + CSRF + __nostrSpace-Injektion + die Insel-Vite-
    Entries. OG/Favicons regelt der Host selbst. Aktiv via config('chat.head_partial').
--}}
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="csrf-token" content="{{ csrf_token() }}" />

<title>{{ filled($title ?? null) ? $title.' – '.config('app.name') : config('app.name') }}</title>

{{-- Default-Space VOR @vite setzen (die Insel liest window.__nostrSpace beim Boot). --}}
@if (config('chat.space_url'))
    <script>window.__nostrSpace = @js(config('chat.space_url'));</script>
@endif

@vite(config('chat.vite'))
@fluxAppearance
