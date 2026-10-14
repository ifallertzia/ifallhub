# Playback Links & "Playback Error" — Full Inventory + Diagnosis

Yeh page do kaam karta hai:

1. **Poori list** — player (TUI aur web) kis-kis link/endpoint se data laata hai: provider APIs,
   CDN hosts, manifest/segment URLs, aur headers jo unke saath jaate hain.
2. **Diagnosis** — "video nahi chalta / playback error" ki asli wajah kya hoti hai, har cause
   ke saath ki usse kaise confirm karna hai aur kaise bachna hai.

Ready-to-run tester: [`scripts/check_playback_links.py`](../scripts/check_playback_links.py)
(Python 3.9+, koi dependency nahi).

---

## 1. Sabse pehle — 3 command me test

```bash
# 1) Poora chain: API hosts -> search -> play-info -> DASH/HLS manifest -> segments
python3 scripts/check_playback_links.py --query "Inception"

# 2) Sirf network/host reachability (jaldi, koi search nahi)
python3 scripts/check_playback_links.py --hosts-only

# 3) App logs / DevTools se copy kiya hua asli stream URL test karo
python3 scripts/check_playback_links.py \
  --url "https://sbcdn3.hakunaymatata.com/dash/<id>/index.mpd" \
  --cookie "Edge-Cache-Cookie=urlprefix=...:sign=...:t=1791308037"
```

Script signed MovieBox headers (`x-client-token`, `x-tr-signature` HMAC-MD5, `x-client-info`,
`x-forwarded-for`) khud banati hai, `signCookie` ko decode karti hai, aur `Referer:
https://sportslive.wine` ke saath manifest + init segment + first media segment probe karti hai.
Aakhir me `ffprobe` / `mpv` / `vlc` ke ready commands print karti hai.

> Note: jo machine test chalati hai, usi ke network ka result milta hai. BDIX hosts
> (`172.16.*`, `new.circleftp.net`) sirf Bangladesh ISP/BDIX network se access hote hain —
> warna fail dikhana normal hai.

---

## 2. Complete link inventory

### 2.1 MovieBox API (host pool)

`src/providers/moviebox/client.rs` — `HOST_POOL`:

| Host | Role |
| :--- | :--- |
| `https://api6.aoneroom.com` | primary API host |
| `https://api5.aoneroom.com` | failover |
| `https://api4.aoneroom.com` | failover |
| `https://api4sg.aoneroom.com` | Singapore mirror |
| `https://api3.aoneroom.com` | failover |
| `https://api6sg.aoneroom.com` | Singapore mirror |
| `https://api.inmoviebox.com` | legacy mirror |

Host rotation status codes: **403, 406, 407, 429, 500, 502, 503, 504** — inme se koi bhi aaye to
agla host try hota hai; 429 me `Retry-After` respect hota hai.

Endpoints (same for every host, sab signed):

| Method + path | Kaam |
| :--- | :--- |
| `POST /wefeed-mobile-bff/user-api/visitor-login` (body `{}`) | guest token (`Bearer`) |
| `POST /wefeed-mobile-bff/subject-api/search/v2` | search (`keyword`, `page`, `perPage`, `subjectType`) |
| `GET /wefeed-mobile-bff/subject-api/get?subjectId=…` | details |
| `GET /wefeed-mobile-bff/subject-api/season-info?subjectId=…` | series seasons/episodes |
| `GET /wefeed-mobile-bff/subject-api/play-info/v2?subjectId=…[&se=&ep=]` | **asli stream list** (signCookie yahin se) |
| `GET /wefeed-mobile-bff/subject-api/resource?subjectId=…[&se=&ep=]&page=&perPage=[&resolution=]` | extra mirrors/download releases |
| `GET /wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=…&resourceId=…` | subtitles |
| `GET /wefeed-mobile-bff/tab-operating?page=&tabId=&version=` | home page carousels |

Headers jo har request ke saath jaate hain (`src/providers/moviebox/crypto.rs`):

```
User-Agent: com.community.oneroom/<ver> (Linux; U; Android <v>; en_US; <device>; Build/...)
Accept: application/json
Content-Type: application/json
Connection: keep-alive
x-client-token: <ts>,<md5(reverse(ts))>
x-tr-signature: <ts>|2|<base64(HMAC-MD5(secret, canonical-string))>
x-client-info: {"package_name":"com.community.oneroom", …}
x-client-status: 0
x-forwarded-for: <spoofed IP>          # device identity spoof
Authorization: Bearer <guest token>    # login ke baad
```

### 2.2 MovieBox stream CDN (video/audio/subtitle files)

Manifest URL `play-info` ke `signCookie` se banti hai (`resolve_dash_manifest_from_policy`):

* `Edge-Cache-Cookie=urlprefix=<base64-url>:sign=<hex>:t=<unix expiry>`
* ya `CloudFront-Policy=<base64 JSON>` → `Statement[0].Resource`

Base64 se nikle path par rule:

| Pattern | Manifest |
| :--- | :--- |
| `…/dash/…` | `<base>/index.mpd` |
| `…/hls/…` | `<base>/index.m3u8` |
| `hakunaymatata.com`, `aoneroom.com`, `sacdn`, `sbcdn` (legacy) | `index.mpd`, par agar path me `hls` ho to `index.m3u8` |

CDN hosts jo codebase/tests me use hote hain:

| Host | Kya serve karta hai |
| :--- | :--- |
| `sbcdn3.hakunaymatata.com` | DASH (`/dash/…`) + HLS (`/hls/…`), CloudFront signed cookies |
| `sacdn.hakunaymatata.com` | DASH (`/dash/…`) |
| `macdn.aoneroom.com` | direct `.mp4`, aur "notice/deprecation" placeholder videos |
| `pacdn.aoneroom.com` | subtitles `.srt` |

Stream request ke saath ye headers zaroori hain (`moviebox_play_info_json_to_releases`):

```
Referer: https://sportslive.wine      # STREAM_REFERER
User-Agent: <wahi Android UA>
Cookie: <signCookie saaf karke>        # CloudFront signed
```

Placeholder/notice URLs (jinhe code filter karta hai — `is_deprecation_notice_url`):

* `…/1c7de0bd3393702d9191801f15f88f8d…`
* `…/9a0461bc39da389663bf3dbb17091d3f…`
* `…/b164fbfb4347792950bdfbfb563d39d9…`
* `…/notice.mp4`
* `macdn.aoneroom.com/other/…`
* subtitles me `aa348f2541d13ffe…` (aur ≤ 50 bytes wale entries)

### 2.3 4KHDHub / HubCloud

| Link | Kaam |
| :--- | :--- |
| `https://4khdhub.one/` (env `MOVIEBOX_FOURKHDHUB_URL` se override) | catalog/scrape |
| `hubcloud.*` / `hubdrive.*` `/drive/<id>`, `/file/<id>` | resolver pages |
| `pixeldrain.com/api/file/<id>?download`, `pixeldrain.dev/api/file/<id>` | direct mirror |
| `*.r2.cloudflarestorage.com`, `*.r2.dev`, `*.workers.dev` | Cloudflare mirrors |
| `storage.googleapis.com/**`, `*googleusercontent.com`, `*googlevideo.com` | Google mirrors |
| `hubcloud.cx/re/…`, `hubcloud.fans/re/…` | resolver variants |

Validation (`validate_playback_url`): sirf `https`, public IP, aur `.zip`/`login.php` jaise
non-media paths reject. Mirror priority: R2/seekable → storage → PixelDrain → Google/direct.

### 2.4 Dramachi (Asian dramas)

| Link | Kaam |
| :--- | :--- |
| `https://api.nodeobjects.com/` | API base |
| `https://static.nodeobjects.com/thumbnail/` | posters |
| `https://api.nodeobjects.com/cdn/<id>` (ya jo API de) | stream URL |

### 2.5 BDIX providers (Bangladesh ISP only)

| Link | Kaam |
| :--- | :--- |
| `http://new.circleftp.net:5000`, `/api/posts`, `/uploads/…` | CircleFTP gateway |
| `http://172.16.50.4/…`, `.7`, `.9`, `.12`, `.14` (`/DHAKA-FLIX-*`) | DhakaFlix nodes |

Yeh **plain HTTP** aur private/mirror IPs hain — sirf BDIX-enabled ISP network se reachable.
Public server se yeh links kabhi nahi khulenge (aur khul bhi gaye to browser mixed-content block
karega).

### 2.6 Stremio addons + Live TV

| Link | Kaam |
| :--- | :--- |
| `https://v3-cinemeta.strem.io/manifest.json` | default catalog addon |
| user ke add kiye addon manifests (`stremio://` → `https://`) | community streams |
| user ka M3U playlist URL (+ EPG URL) | Live TV channels |

### 2.7 Web player ke apne same-origin routes

`src/web_api.rs` + `deploy/server.mjs`:

| Route | Kaam |
| :--- | :--- |
| `GET /api/health` | engine status |
| `GET /api/providers`, `/api/collections`, `/api/discover`, `/api/search`, `/api/suggest` | catalog |
| `GET /api/details`, `/api/related`, `/api/meta` | title data |
| `GET /api/streams?provider=…&id=…&season=&episode=` | release list (60 min TTL stream set) |
| `POST /api/play` | session banao → `playback_url` deta hai |
| `GET /api/media/<token>/<scheme>/<host>/<path>` | **same-origin media proxy** (manifest + segments + ranges) |
| `GET/POST /api/library*`, `GET /api/library/events` | watchlist/progress/ratings + SSE |

`/api/play` ka jawab `{ playback_url: "/api/media/<token>/https/<cdn-host>/…", stream_type:
"dash" | "hls" | "file" }`. Browser usi URL ko `<video>`/shaka me deta hai; Rust server upar wale
CDN ko provider headers ke saath fetch karta hai. DASH/HLS manifest beech me rewrite hoke saare
segment URLs bhi `/api/media/…` ban jaate hain, aur manifest me mile saare hosts playback session
ki allow-list me add ho jaate hain.

### 2.8 TUI (native player) side

* `mpv` / `vlc` / `iina` ko direct URL + `--http-header-fields` (`Referer`, `User-Agent`, `Cookie`)
  ke saath launch.
* Auth wale streams ke liye loopback proxy: `http://127.0.0.1:<port>/…` (`src/proxy.rs`),
  DASH ke liye 95 KB range chunks, 60 s chunk idle timeout, 10 min watchdog.
* DASH downloads ke liye `yt-dlp` + `ffmpeg` (jab MovieBox DASH ho).

---

## 3. "Playback error" kyun aata hai — ranked causes

| # | Cause | Kaise confirm karein | Fix |
| :- | :--- | :--- | :--- |
| 1 | **HEVC / H.265 DASH** (sabse common) — CDN path me `_h265_`, MPD me `codecs="hvc1…/hev1…"` | `ffprobe` chalao, ya script ke "codec verdict" line dekho; Shaka error **4032 CONTENT_UNSUPPORTED_BY_BROWSER** | **Fixed:** web player HEVC/H.265 releases ko ranking me peeche bhejta hai (H.264 pehle try hota hai), stream list me `⚠ H.265 browser me nahi` badge dikhata hai, aur fail hone par exact reason + "mpv/VLC me chalega" hint deta hai |
| 2 | **`.mkv` / x265 direct file** (4KHDHub mirrors) | `<video>` error code **4** (SRC_NOT_SUPPORTED), par `mpv` same URL chala deta hai | **Fixed:** `.mkv`/`.avi` releases ranking me sabse peeche, list me `⚠ container browser me nahi` badge, aur error message me download/mpv suggestion |
| 3 | **Expired signed cookie** — `Edge-Cache-Cookie … :t=<unix>` purana ho gaya | manifest GET par **403**; cookie ka `t=` compare karo | **Fixed:** browser ko HTTP 403/410 dikhe to engine khud `/api/streams` dobara laata hai, wahi release match karke naye cookie ke saath retry karta hai (per server ek refresh) |
| 4 | **Referer/UA strip ho gaya** — CDN sirf `Referer: https://sportslive.wine` ke saath deta hai | manifest 403 jabki browser DevTools me headers na dikhein | Web proxy aur player me headers forward hone chahiye (code already karta hai; reverse-proxy/CDN ke beech me mat girao) |
| 5 | **Segment host allow-list me nahi** — audio/video alag CDN par | proxy `403 "Media host is not part of this playback session"` | Manifest ke andar saare hosts allow-list me add hote hain; agar naya host HTML/redirect ke andar chhupa ho to fail hota hai — logs dekh ke resolve karo |
| 6 | **Stream set expire** (ab 60 min TTL, pehle 20 min) | `410 Stream list expired. Refresh the stream list and try again.` | **Fixed:** TTL 60 min + browser 410 par khud refresh karke retry karta hai; manually refresh ki zaroorat nahi |
| 7 | **Playback session expire / evict (6 h ya 512 sessions)** | beech playback me `404 Playback session expired` | Dobara play, ya `MAX_PLAYBACK_SESSIONS`/TTL badhao |
| 8 | **Start timeout** — engine sirf 6.5 s wait karta hai, phir 1.2 s stability | overlay: "The stream did not start before timeout" | Slow CDN/pehla segment late — next release try hota hai; server region/network check karo (message me reason ab overlay/LIVE status me dikhta hai) |
| 9 | **BDIX/private-IP ya `http://` source** | `172.16.*` / `new.circleftp.net:5000` unreachable, ya mixed-content block | Sirf BDIX ISP network me chalta hai; public deploy ke liye MovieBox/4KHDHub use karo |
| 10 | **Rate limit 429** — `MOVIEBOX_WEB_MEDIA_RATE_LIMIT` (default 1200/min), `MOVIEBOX_WEB_RATE_LIMIT` (300/min), Rust API `MOVIEBOX_WEB_API_RATE_PER_MIN` (300/min) | DevTools me `/api/media/...` par 429 | Limits badhao ya `0` karo; lambi DASH movie bahut segment requests karti hai |
| 11 | **API host pool exhaust / ISP block** | search/streams hi fail, `All hosts exhausted` | Alag network/VPN try karo; host pool update chahiye ho sakta hai |
| 12 | **Notice/deprecation placeholder video** — CDN `notice.mp4` bhej raha hai | "video chalti hai par galat content" | Code ise filter karta hai; agar phir bhi aaye to nayi notice URL add karni padegi |
| 13 | **Idle timeouts** — proxy 60 s chunk idle, web proxy 90 s body idle, manifest 20 s | Lambe pause ke baad stream band | Normal behaviour; pause lamba ho to dobara play |
| 14 | **Autoplay policy** | `NotAllowedError` | Engine mute karke retry karta hai (handled) |
| 15 | **Shaka load fail** (offline/CSP) | `shaka-player` import fail → "The stream could not be prepared" | Internet/CDN block check karo (npm vendor ya self-host) |

### Ek line ka rule of thumb

* Sab links 200 dete hain, phir bhi browser me error → **codec/container (HEVC/mkv)**.
* Manifest 403 → **cookie/Referer**.
* Media segment 403 → **host allow-list**.
* 410/404 mid-play → **TTL/session expire**.
* Kuch bhi reachable nahi → **network/ISP/host rotate**.

---

## 3.1 Web player ke behaviour fixes (code)

`web/src/player/engine.js` + `web/src/views/watch.js` me ye behaviour ab built-in hai:

- **Codec-aware ranking** — `unsupportedReason()` HEVC/H.265 (`hevc`, `h265`, `x265`, `hvc1`, `hev1`)
  aur unsafe containers (`.mkv`, `.avi`, `.wmv`, `.flv`, `.m2ts`, `.vob`) ko detect karta hai;
  `scoreRelease()` un releases ko +50/+60 penalty deta hai, isliye playable H.264 `.mp4` pehle try
  hota hai (release hataayi nahi jaati — download aur manual play ke liye list me rehti hai).
- **Asli reason UI me** — Shaka error codes (`4032` unsupported codec, `1001/1002/1003`
  HTTP/network with status + host) aur `<video>` MediaError (2 network, 3 decode, 4
  unsupported) human messages me convert hote hain; overlay/status me exact HTTP status aur
  codec hint aata hai.
- **Expired link auto-recovery** — HTTP 403 (signed cookie khatam) ya 410 (stream set TTL)
  mile to engine us server ka cache clear karke `/api/streams` dobara fetch karta hai, wahi
  release (`matchReleaseIndex`) uthata hai aur fresh cookie ke saath retry karta hai — server
  per ek baar.
- **Badge** — stream list me unplayable releases par `⚠ H.265 browser me nahi` /
  `⚠ container browser me nahi` dikhta hai, taaki user aankh band karke click na kare.
- **"Playback links" panel (player page)** — player ko jo bhi link diya jaata hai (H.265/HEVC
  `.h265` DASH, `.mkv`, jo bhi) woh player ke neeche list me dikhta hai: provider · quality ·
  mirror · stream type, poora URL select karne layak field me, har row par **Copy link** aur
  panel me **Copy all**. Row par `⚠ H.265/HEVC — browser decode nahi kar sakta, mpv/VLC me
  chalega` note bhi aata hai. Yeh link select karke seedha `mpv`/`vlc` me paste kar sakte ho;
  page actions me **⧉ Copy link** abhi chal raha link copy karta hai (kuch play na ho to
  selected release ka link resolve karke). Links session-bound hain — expire hone par engine
  naya link deta hai, isliye panel purane daag dikhata hai ("retried ×N").

Rust side (`src/web_api.rs`):

- Stream set TTL **20 min → 60 min**.
- DASH manifest me **protocol-relative URLs** (`//cdn/seg/$Number$.m4s`) bhi ab `/api/media/...`
  se jaate hain, aur unka host media-host allow-list me register hota hai (pehle browser seedha
  CDN hit karta tha → CORS/Referer fail ya proxy 403).

## 4. Manual verification commands

```bash
# CDN manifest (headers ke saath) — status/content-type/bytes
curl -sS -D - -o /tmp/manifest.mpd \
  -H 'Referer: https://sportslive.wine' \
  -H 'User-Agent: com.community.oneroom/50020117 (Linux; U; Android 12; Redmi; Build/S1B.220414.015; Cronet/135.0.7012.3)' \
  -H 'Cookie: Edge-Cache-Cookie=urlprefix=…:sign=…:t=…' \
  'https://sbcdn3.hakunaymatata.com/dash/<id>/index.mpd'

# Codec/container check (H.265 = browser fail)
ffprobe -hide_banner -v error -headers $'Referer: https://sportslive.wine\r\nCookie: …\r\n' \
  -show_entries stream=codec_name,codec_type,width,height -of default=noprint_wrappers=1 \
  'https://sbcdn3.hakunaymatata.com/dash/<id>/index.mpd'

# Sirf TUI jaisa playback
mpv --http-header-fields="Referer: https://sportslive.wine" \
    --http-header-fields="Cookie: …" 'https://…/index.mpd'
```

Web app me problem ho to browser DevTools → Network me `/api/media/...` requests dekho:

* `403` → cookie/allow-list,
* `404` → playback session expire,
* `429` → rate limit,
* `200` par video error → **codec/container**.

Rust side logs: `MOVIEBOX_LOG=debug cargo run -- --web-api`.

---

## 5. Is repo me iske liye jo hai

* `scripts/check_playback_links.py` — yeh tester (hosts + signed API chain + manifest/segments + commands).
* `src/providers/moviebox/client.rs` — host pool + signed request loop.
* `src/providers/moviebox/crypto.rs` — signing (`x-client-token`, `x-tr-signature`).
* `src/providers/moviebox/adapt.rs` — `signCookie` decode, manifest URL, notice filter, release list.
* `src/web_api.rs` — `/api/play` + `/api/media` proxy, TTLs, host allow-list.
* `src/proxy.rs` — TUI loopback proxy (headers, DASH ranges, watchdog).
* `web/src/player/engine.js` — browser player, server rotation, codec ranking, error decoding,
  expired-link auto-refresh, timeouts (`web/tests/engine.test.js` inhe cover karta hai).
