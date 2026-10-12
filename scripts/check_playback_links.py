#!/usr/bin/env python3
"""Playback link tester for Ifallhub / MovieBox-Tui.

Yeh script woh saare link/endpoint check karti hai jahan se player ko data milta
hai -- provider APIs (moviebox, 4khdhub, dramachi, bdix), unke CDN hosts, aur
actual resolved stream (MPD / M3U8 / file) -- with the exact signed headers,
Referer aur CloudFront cookie jo app bhejta hai.

Isse pata chalta hai ki "playback error" ki wajah network/CDN/expired-cookie
hai ya codec/container (jise browser play nahi kar sakta).

Python 3.9+ only, koi dependency nahi. Examples:

    # Sab kuch (API + CDN + ek real stream resolve karke segment probe)
    python3 scripts/check_playback_links.py

    # Sirf static hosts, koi search nahi
    python3 scripts/check_playback_links.py --hosts-only

    # Kisi specific title ka stream test karo
    python3 scripts/check_playback_links.py --query "Inception"

    # Ek host ko force karo aur mirror CDN bhi probe karo
    python3 scripts/check_playback_links.py --api-host https://api3.aoneroom.com --query "Dune"

Exit code 0 = sab critical checks pass, 1 = kuch fail hua.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import http.client
import json
import re
import socket
import ssl
import sys
import time
import urllib.parse

# --------------------------------------------------------------------------- #
# Constants mirrored from the Rust code (src/providers/moviebox/crypto.rs)
# --------------------------------------------------------------------------- #

API_HOST_POOL = [
    "https://api6.aoneroom.com",
    "https://api5.aoneroom.com",
    "https://api4.aoneroom.com",
    "https://api4sg.aoneroom.com",
    "https://api3.aoneroom.com",
    "https://api6sg.aoneroom.com",
    "https://api.inmoviebox.com",
]

# src/providers/moviebox/crypto.rs (DEFAULT_SECRET_BYTES)
SECRET = bytes(
    [
        0xEF, 0xA8, 0x91, 0x97, 0x4E, 0xEC, 0xD3, 0x14,
        0x8D, 0xF6, 0x3A, 0xA6, 0x11, 0x60, 0x2D, 0xEF,
        0xD1, 0x01, 0x25, 0x9B, 0xA5, 0x21, 0x02, 0x2C,
        0x57, 0xAE, 0x05, 0x66, 0xBD, 0x8E,
    ]
)
SIGNATURE_BODY_MAX_BYTES = 102_400

USER_AGENT = (
    "com.community.oneroom/50020117 (Linux; U; Android 12; "
    "Redmi; Build/S1B.220414.015; Cronet/135.0.7012.3)"
)
CLIENT_INFO = json.dumps(
    {
        "package_name": "com.community.oneroom",
        "version_name": "4.0.01.0813.03",
        "version_code": 50020117,
        "os": "android",
        "os_version": "12",
        "install_ch": "ps",
        "device_id": "0" * 32,
        "install_store": "ps",
        "gaid": "00000000-0000-0000-0000-000000000000",
        "brand": "Redmi",
        "model": "2201117TY",
        "system_language": "en",
        "net": "NETWORK_WIFI",
        "region": "US",
        "timezone": "Asia/Kolkata",
        "sp_code": "40401",
        "X-Play-Mode": "2",
    },
    separators=(",", ":"),
)
SPOOFED_IP = "103.241.11.22"

# src/providers/moviebox/mod.rs (STREAM_REFERER)
STREAM_REFERER = "https://sportslive.wine"

# Static hosts used by the other providers / helpers
STATIC_HOSTS = [
    ("4khdhub.one", "https://4khdhub.one/", "4KHDHub catalog/scrape base"),
    ("api.nodeobjects.com", "https://api.nodeobjects.com/", "Dramachi API base"),
    ("static.nodeobjects.com", "https://static.nodeobjects.com/thumbnail/", "Dramachi image CDN"),
    ("pixeldrain.com", "https://pixeldrain.com/api/file/", "4KHDHub mirror (PixelDrain API)"),
    ("pixeldrain.dev", "https://pixeldrain.dev/api/file/", "4KHDHub mirror (PixelDrain dev)"),
    ("hubcloud.ist", "https://hubcloud.ist/", "HubCloud resolver host"),
    ("hubcloud.cx", "https://hubcloud.cx/", "HubCloud resolver host"),
    ("hubcloud.fans", "https://hubcloud.fans/", "HubCloud resolver host"),
    ("hubdrive.space", "https://hubdrive.space/", "HubDrive resolver host"),
    ("new.circleftp.net:5000", "http://new.circleftp.net:5000/api/posts", "BDIX CircleFTP API (HTTP, BDIX only)"),
    ("172.16.50.4", "http://172.16.50.4/", "BDIX DhakaFlix node 4 (private IP, only inside BDIX)"),
    ("172.16.50.7", "http://172.16.50.7/", "BDIX DhakaFlix node 7 (private IP)"),
    ("172.16.50.9", "http://172.16.50.9/", "BDIX DhakaFlix node 9 (private IP)"),
    ("172.16.50.12", "http://172.16.50.12/", "BDIX DhakaFlix node 12 (private IP)"),
    ("172.16.50.14", "http://172.16.50.14/", "BDIX DhakaFlix node 14 (private IP)"),
    ("v3-cinemeta.strem.io", "https://v3-cinemeta.strem.io/manifest.json", "Stremio addons default catalog"),
    ("sportslive.wine", "https://sportslive.wine/", "Referer host for MovieBox streams"),
    ("image.tmdb.org", "https://image.tmdb.org/t/p/w500/", "Poster CDN used by the web UI"),
]

CDN_HINT_HOSTS = [
    ("macdn.aoneroom.com", "MovieBox direct-file CDN (mp4)"),
    ("pacdn.aoneroom.com", "MovieBox subtitle CDN"),
    ("sacdn.hakunaymatata.com", "MovieBox DASH CDN"),
    ("sbcdn3.hakunaymatata.com", "MovieBox DASH/HLS CDN (CloudFront signed cookies)"),
]

OK, BAD, WARN, INFO = "OK", "FAIL", "WARN", "info"
_results: list[tuple[str, str, str]] = []
_quiet_pass = False


def record(status: str, label: str, detail: str = "") -> None:
    _results.append((status, label, detail))
    if _quiet_pass and status == OK:
        return
    mark = {OK: "  [ok]  ", BAD: "  [XX]  ", WARN: "  [!]   ", INFO: "  [..]  "}[status]
    print(f"{mark}{label}" + (f"  --  {detail}" if detail else ""), flush=True)


# --------------------------------------------------------------------------- #
# Tiny HTTP client (http.client so we can send any header, like the Rust client)
# --------------------------------------------------------------------------- #


class Response:
    def __init__(self, status, headers, body, url, elapsed):
        self.status = status
        self.headers = headers
        self.body = body
        self.url = url
        self.elapsed = elapsed

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", "replace")

    def json(self):
        try:
            return json.loads(self.text)
        except Exception:
            return None


def request(
    method,
    url,
    headers=None,
    body: bytes | None = None,
    timeout: float = 15.0,
    max_redirects: int = 4,
    read_limit: int = 400_000,
) -> Response:
    started = time.time()
    current = url
    current_method = method
    current_body = body
    for _ in range(max_redirects + 1):
        parts = urllib.parse.urlsplit(current)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ValueError(f"unsupported URL: {current}")
        port = parts.port or (443 if parts.scheme == "https" else 80)
        if parts.scheme == "https":
            ctx = ssl.create_default_context()
            conn = http.client.HTTPSConnection(parts.hostname, port, timeout=timeout, context=ctx)
        else:
            conn = http.client.HTTPConnection(parts.hostname, port, timeout=timeout)
        path = urllib.parse.urlunsplit(("", "", parts.path or "/", parts.query, ""))
        try:
            conn.putrequest(current_method, path, skip_host=True, skip_accept_encoding=True)
            sent_host = parts.hostname + (f":{port}" if port not in (80, 443) else "")
            conn.putheader("Host", sent_host)
            for key, value in (headers or {}).items():
                conn.putheader(key, value)
            if current_body is not None:
                conn.putheader("Content-Length", str(len(current_body)))
            conn.endheaders()
            if current_body is not None:
                conn.send(current_body)
            raw = conn.getresponse()
            data = raw.read(read_limit)
            response_headers = {k.lower(): v for k, v in raw.getheaders()}
        finally:
            conn.close()

        if response_headers.get("location") and current_method in ("GET", "HEAD") and raw.status in (301, 302, 303, 307, 308):
            current = urllib.parse.urljoin(current, response_headers["location"])
            if raw.status in (301, 302, 303):
                current_method, current_body = "GET", None
            continue
        return Response(raw.status, response_headers, data, current, time.time() - started)
    raise RuntimeError("too many redirects")


# --------------------------------------------------------------------------- #
# MovieBox request signing (mirror of src/providers/moviebox/crypto.rs)
# --------------------------------------------------------------------------- #


def md5_hex(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def x_client_token(ts_ms: int) -> str:
    return f"{ts_ms},{md5_hex(str(ts_ms)[::-1].encode())}"


def sorted_query(url: str) -> str:
    query = urllib.parse.urlsplit(url).query
    if not query:
        return ""
    grouped: dict[str, list[str]] = {}
    for key, value in urllib.parse.parse_qsl(query, keep_blank_values=True):
        grouped.setdefault(key, []).append(value)
    parts = []
    for key in sorted(grouped):
        for value in grouped[key]:
            parts.append(f"{key}={value}")
    return "&".join(parts)


def canonical_string(method, url, body, ts_ms, accept, content_type) -> str:
    parts = urllib.parse.urlsplit(url)
    query = sorted_query(url)
    canonical_url = parts.path + (f"?{query}" if query else "")
    if body is None:
        body_length, body_hash = "", ""
    else:
        trimmed = body[:SIGNATURE_BODY_MAX_BYTES]
        body_length, body_hash = str(len(body)), md5_hex(trimmed)
    return "\n".join(
        [method.upper(), accept or "", content_type or "", body_length, str(ts_ms), body_hash, canonical_url]
    )


def signed_headers(method, url, body: bytes | None = None, token: str | None = None) -> dict:
    ts = int(time.time() * 1000)
    accept = "application/json"
    content_type = "application/json"
    canonical = canonical_string(method, url, body, ts, accept, content_type)
    signature = hmac.new(SECRET, canonical.encode(), hashlib.md5).digest()
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": accept,
        "Content-Type": content_type,
        "Connection": "keep-alive",
        "x-client-token": x_client_token(ts),
        "x-tr-signature": f"{ts}|2|{base64.b64encode(signature).decode()}",
        "x-client-info": CLIENT_INFO,
        "x-client-status": "0",
        "x-forwarded-for": SPOOFED_IP,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def api_json(method, url, body: dict | None = None, token: str | None = None, timeout: float = 15.0):
    raw = json.dumps(body, separators=(",", ":")).encode() if body is not None else None
    response = request(method, url, signed_headers(method, url, raw, token), raw, timeout=timeout)
    payload = response.json()
    if isinstance(payload, dict) and "data" in payload:
        payload = payload["data"]
    return response, payload


# --------------------------------------------------------------------------- #
# Checks
# --------------------------------------------------------------------------- #


def check_static_hosts(timeout: float) -> None:
    print("\n=== 1. Provider / helper hosts (DNS + TLS + HTTP) ===")
    for name, url, purpose in STATIC_HOSTS:
        try:
            response = request("GET", url, {"User-Agent": "Mozilla/5.0 (link-check)"}, timeout=timeout, read_limit=2048)
            status = OK if response.status < 500 else WARN
            record(status, f"{name}", f"HTTP {response.status} in {response.elapsed*1000:.0f} ms · {purpose}")
        except (socket.gaierror, ssl.SSLError, OSError, ValueError) as error:
            detail = str(error) or error.__class__.__name__
            hint = ""
            if name.startswith("172.16."):
                hint = " (expected: BDIX/private IP, sirf Bangladesh ISP network ke andar chalta hai)"
            elif ":5000" in name:
                hint = " (expected: BDIX mirror, sirf ISP network ke andar)"
            record(BAD, f"{name}", f"{detail} · {purpose}{hint}")


def check_cdn_hosts(timeout: float) -> None:
    print("\n=== 2. MovieBox CDN hosts (manifest/segment hosts) ===")
    for name, purpose in CDN_HINT_HOSTS:
        try:
            response = request("GET", f"https://{name}/", {"User-Agent": USER_AGENT}, timeout=timeout, read_limit=1024)
            record(OK, f"{name}", f"reachable, HTTP {response.status} · {purpose}")
        except (socket.gaierror, ssl.SSLError, OSError) as error:
            record(WARN, f"{name}", f"{error} · {purpose} (host sirf signed URL ke saath hi respond karta hai)")


def check_api_pool(timeout: float) -> tuple[str | None, str | None]:
    """visitor-login on every host in the pool. Returns (host, token)."""
    print("\n=== 3. MovieBox API host pool + session (signed visitor-login) ===")
    best_host, best_token = None, None
    for host in API_HOST_POOL:
        url = f"{host}/wefeed-mobile-bff/user-api/visitor-login"
        try:
            response, payload = api_json("POST", url, {}, timeout=timeout)
            token = ""
            if isinstance(payload, dict):
                token = str(payload.get("token") or "")
            if response.status == 200 and token:
                record(OK, host, f"token milee ({len(token)} chars), {response.elapsed*1000:.0f} ms")
                if best_host is None:
                    best_host, best_token = host, token
            else:
                code = (payload or {}).get("code") if isinstance(payload, dict) else None
                record(WARN, host, f"HTTP {response.status} business-code={code} token nahi mila")
        except Exception as error:  # noqa: BLE001 - diagnostics script
            record(BAD, host, f"{error}")
    return best_host, best_token


def find_subject(payload) -> tuple[str, str, int] | None:
    """Recursively find the first {subjectId, title, subjectType} in a payload."""
    stack = [payload]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            subject_id = node.get("subjectId") or node.get("id")
            title = node.get("title") or node.get("name")
            if subject_id is not None and title:
                stype = node.get("subjectType") or node.get("stype") or 1
                try:
                    return str(subject_id), str(title), int(stype)
                except (TypeError, ValueError):
                    return str(subject_id), str(title), 1
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return None


def check_api_chain(host: str, token: str, query: str, timeout: float) -> dict | None:
    print(f"\n=== 4. MovieBox API endpoints on {host} ===")
    base = host

    # search/v2
    try:
        response, payload = api_json(
            "POST",
            f"{base}/wefeed-mobile-bff/subject-api/search/v2",
            {"keyword": query, "page": 1, "perPage": 15, "subjectType": 0},
            token,
            timeout,
        )
        found = find_subject(payload) if payload else None
        if response.status == 200 and found:
            record(OK, "POST /subject-api/search/v2", f'"{query}" -> {found[1]} (subjectId {found[0]})')
        else:
            record(BAD, "POST /subject-api/search/v2", f"HTTP {response.status}, result parse nahi hua")
            return None
    except Exception as error:  # noqa: BLE001
        record(BAD, "POST /subject-api/search/v2", str(error))
        return None

    subject_id, title, stype = found
    season = episode = 0

    # details
    try:
        response, payload = api_json(
            "GET", f"{base}/wefeed-mobile-bff/subject-api/get?subjectId={subject_id}", None, token, timeout
        )
        record(
            OK if response.status == 200 else BAD,
            "GET /subject-api/get",
            f"HTTP {response.status}, subjectType={stype}",
        )
    except Exception as error:  # noqa: BLE001
        record(BAD, "GET /subject-api/get", str(error))

    # series: season-info + first episode
    if stype == 2:
        try:
            response, payload = api_json(
                "GET", f"{base}/wefeed-mobile-bff/subject-api/season-info?subjectId={subject_id}", None, token, timeout
            )
            seasons = []
            if isinstance(payload, dict):
                for entry in payload.get("seasons") or payload.get("list") or []:
                    if isinstance(entry, dict):
                        seasons.append(entry.get("se") or entry.get("season") or entry.get("number"))
            if seasons and seasons[0] is not None:
                season, episode = int(seasons[0]), 1
            record(
                OK if response.status == 200 else WARN,
                "GET /subject-api/season-info",
                f"HTTP {response.status}, seasons={seasons[:6]}",
            )
        except Exception as error:  # noqa: BLE001
            record(WARN, "GET /subject-api/season-info", str(error))

    # play-info (the actual stream list)
    suffix = f"&se={season}&ep={episode}" if season and episode else ""
    play_info = None
    try:
        response, payload = api_json(
            "GET", f"{base}/wefeed-mobile-bff/subject-api/play-info/v2?subjectId={subject_id}{suffix}", None, token, timeout
        )
        streams = []
        if isinstance(payload, dict):
            streams = payload.get("streams") or []
        play_info = payload
        record(
            OK if response.status == 200 else BAD,
            "GET /subject-api/play-info/v2",
            f"HTTP {response.status}, {len(streams)} stream entries",
        )
        for stream in streams[:6]:
            if not isinstance(stream, dict):
                continue
            cookie = str(stream.get("signCookie") or "")
            raw_url = str(stream.get("url") or "")
            manifest = resolve_manifest_url(cookie)
            kind = "DASH" if manifest and manifest.endswith(".mpd") else (
                "HLS" if manifest and manifest.endswith(".m3u8") else "direct-file"
            )
            expiry = cookie_expiry(cookie)
            record(
                INFO,
                f"  stream id={stream.get('id')} format={stream.get('format')} codec={stream.get('codecName')} "
                f"res={stream.get('resolutions')} size={stream.get('size')}",
                f"{kind} · signCookie={'yes' if cookie else 'no'} · expiry={expiry or 'n/a'}"
                + (f" · url={'deprecation notice (ignore)' if is_deprecation_notice(raw_url) else raw_url[:60]}" if raw_url else ""),
            )
    except Exception as error:  # noqa: BLE001
        record(BAD, "GET /subject-api/play-info/v2", str(error))

    # resource list (used for extra mirrors / downloads)
    try:
        response, payload = api_json(
            "GET",
            f"{base}/wefeed-mobile-bff/subject-api/resource?subjectId={subject_id}&page=1&perPage=20",
            None,
            token,
            timeout,
        )
        count = len(payload.get("list") or []) if isinstance(payload, dict) else 0
        record(OK if response.status == 200 else WARN, "GET /subject-api/resource", f"HTTP {response.status}, {count} items")
    except Exception as error:  # noqa: BLE001
        record(WARN, "GET /subject-api/resource", str(error))

    # captions
    if isinstance(play_info, dict) and play_info.get("streams"):
        first_id = play_info["streams"][0].get("id")
        if first_id:
            try:
                response, payload = api_json(
                    "GET",
                    f"{base}/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId={subject_id}&resourceId={first_id}",
                    None,
                    token,
                    timeout,
                )
                captions = (payload or {}).get("extCaptions") if isinstance(payload, dict) else None
                record(
                    OK if response.status == 200 else WARN,
                    "GET /subject-api/get-ext-captions",
                    f"HTTP {response.status}, {len(captions or [])} subtitles",
                )
            except Exception as error:  # noqa: BLE001
                record(WARN, "GET /subject-api/get-ext-captions", str(error))

    return {
        "base": base,
        "token": token,
        "subject_id": subject_id,
        "title": title,
        "season": season,
        "episode": episode,
        "play_info": play_info,
    }


def is_deprecation_notice(url: str) -> bool:
    lower = url.lower()
    return (
        "1c7de0bd3393702d9191801f15f88f8d" in lower
        or "9a0461bc39da389663bf3dbb17091d3f" in lower
        or "b164fbfb4347792950bdfbfb563d39d9" in lower
        or "/notice.mp4" in lower
        or ("macdn.aoneroom.com" in lower and "/other/" in lower)
    )


def to_manifest_url(url: str) -> str | None:
    base = url.strip().rstrip("*").rstrip("/")
    if not base or not base.startswith(("http://", "https://")):
        return None
    if base.endswith((".mpd", ".m3u8", ".m3u")):
        return base
    if "/dash/" in base:
        return f"{base}/index.mpd"
    if "/hls/" in base:
        return f"{base}/index.m3u8"
    if any(token in base for token in ("hakunaymatata.com", "aoneroom.com", "sacdn", "sbcdn")):
        if "hls" in base.lower():
            return f"{base}/index.m3u8"
        return f"{base}/index.mpd"
    return None


def _b64(value: str) -> bytes | None:
    value = value.replace("-", "+").replace("_", "/")
    value += "=" * ((4 - len(value) % 4) % 4)
    try:
        return base64.b64decode(value)
    except Exception:  # noqa: BLE001
        return None


def resolve_manifest_url(sign_cookie: str) -> str | None:
    """Mirror of resolve_dash_manifest_from_policy() in src/providers/moviebox/adapt.rs."""
    if not sign_cookie:
        return None
    for part in sign_cookie.split(";"):
        trimmed = part.strip()
        idx = trimmed.find("urlprefix=")
        if idx >= 0:
            token = trimmed[idx + len("urlprefix="):].split(":")[0].strip()
            decoded = _b64(token)
            if decoded:
                manifest = to_manifest_url(decoded.decode("utf-8", "replace"))
                if manifest:
                    return manifest
        if trimmed.startswith("CloudFront-Policy="):
            raw = trimmed[len("CloudFront-Policy="):].strip()
            normalized = raw.replace("-", "+").replace("_", "=").replace("~", "/")
            decoded = _b64(normalized)
            if not decoded:
                continue
            try:
                policy = json.loads(decoded.decode("utf-8", "replace"))
            except Exception:  # noqa: BLE001
                continue
            resource = (
                policy.get("Statement", [{}])[0].get("Resource")
                if isinstance(policy.get("Statement"), list)
                else None
            )
            if isinstance(resource, str):
                manifest = to_manifest_url(resource)
                if manifest:
                    return manifest
    return None


def cookie_expiry(cookie: str) -> str | None:
    match = re.search(r":t=(\d{9,12})", cookie)
    if not match:
        return None
    expires = int(match.group(1))
    delta = expires - int(time.time())
    stamp = time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime(expires))
    return f"{stamp} ({'expired' if delta < 0 else f'{delta // 60} min left'})"


def provider_headers(cookie: str = "") -> dict:
    headers = {"Referer": STREAM_REFERER, "User-Agent": USER_AGENT}
    if cookie:
        cleaned = "; ".join(part.strip() for part in cookie.rstrip(";").split(";") if part.strip())
        headers["Cookie"] = cleaned
    return headers


def probe_manifest(url: str, cookie: str, timeout: float) -> None:
    print("\n=== 5. Stream manifest + segments (with provider headers) ===")
    headers = provider_headers(cookie)
    try:
        response = request("GET", url, headers, timeout=timeout, read_limit=2_000_000)
    except Exception as error:  # noqa: BLE001
        record(BAD, "manifest GET", f"{url} -> {error}")
        return

    content_type = response.headers.get("content-type", "?")
    record(
        OK if response.status == 200 else BAD,
        "manifest GET",
        f"HTTP {response.status} · {content_type} · {len(response.body)} bytes · {response.elapsed*1000:.0f} ms",
    )
    if response.status != 200:
        record(
            BAD,
            "manifest verdict",
            "403 = signed cookie/Referer expire ya galat host; 404 = path badal gaya; 5xx = CDN side problem",
        )
        return

    text = response.text
    if url.endswith(".mpd") or "dash+xml" in content_type:
        probe_dash(text, response.url, headers, timeout)
    else:
        probe_hls(text, response.url, headers, timeout)


def probe_dash(manifest: str, base_url: str, headers: dict, timeout: float) -> None:
    codecs = sorted(set(re.findall(r'codecs="([^"]+)"', manifest)))
    mime = sorted(set(re.findall(r'mimeType="([^"]+)"', manifest)))
    base_urls = re.findall(r"<BaseURL>([^<]+)</BaseURL>", manifest)
    heights = sorted(set(re.findall(r'height="(\d+)"', manifest)), key=lambda v: -int(v))
    record(INFO, "DASH rep info", f"mime={mime} codecs={codecs} heights={heights[:8]} BaseURL={base_urls[:3]}")

    hevc = [c for c in codecs if c.lower().startswith(("hvc1", "hev1"))]
    if hevc:
        record(
            WARN,
            "codec verdict",
            f"HEVC/H.265 ({', '.join(hevc)}) -- Chrome/Firefox browser is stream ko decode nahi kar sakte, "
            "'Playback error' yahi se aata hai. mpv/VLC thin. H.264 (avc1) wala release chuno.",
        )
    elif any(c.lower().startswith("avc1") for c in codecs):
        record(OK, "codec verdict", "H.264 (avc1) -- browser play kar sakta hai")

    hosts = sorted(set(re.findall(r"https?://([^/\"'<>\s]+)", manifest)))
    record(INFO, "hosts inside manifest", ", ".join(hosts[:10]) or "(relative URLs only)")

    # init segment (moov) -- chhota Range request, download nahi hoga
    init = re.search(r'initialization="([^"]+)"', manifest)
    if init:
        target = urllib.parse.urljoin(base_url, fill_template(init.group(1), "1"))
        try:
            response = request("GET", target, {**headers, "Range": "bytes=0-1023"}, timeout=timeout, read_limit=4096)
            record(
                OK if response.status in (200, 206) else BAD,
                "init segment (moov) GET",
                f"HTTP {response.status} · {response.headers.get('content-type', '?')} · {len(response.body)} bytes",
            )
        except Exception as error:  # noqa: BLE001
            record(BAD, "init segment (moov) GET", str(error))

    # a media segment (Range probe only, no full download)
    media = re.search(r'media="([^"]+)"', manifest)
    if media:
        template = media.group(1)
        time_match = re.search(r'<S t="(\d+)"', manifest)
        candidates = [fill_template(template, number="1")]
        if time_match and "Time" in template:
            candidates.append(fill_template(template, number="1", time_value=time_match.group(1)))
        for candidate in candidates[:2]:
            target = urllib.parse.urljoin(base_url, candidate)
            try:
                response = request("GET", target, {**headers, "Range": "bytes=0-2047"}, timeout=timeout, read_limit=8192)
                record(
                    OK if response.status in (200, 206) else BAD,
                    "media segment GET (Range)",
                    f"HTTP {response.status} · {len(response.body)} bytes · {urllib.parse.urlsplit(target).path[-48:]}",
                )
            except Exception as error:  # noqa: BLE001
                record(BAD, "media segment GET (Range)", f"{error} · {target[-64:]}")


def fill_template(template: str, number: str, time_value: str | None = None) -> str:
    """$Number$ / $Time$ / $RepresentationID$ / $Bandwidth$ ko ek value se bharo."""
    template = template.replace("$RepresentationID$", "1").replace("$Bandwidth$", "0")
    template = template.replace("$Number$", number)
    if time_value is not None:
        template = template.replace("$Time$", time_value)
    else:
        template = template.replace("$Time$", number)
    return re.sub(r"\$\{[^}]*\}|\$[A-Za-z]+\$", number, template)


def probe_hls(manifest: str, base_url: str, headers: dict, timeout: float) -> None:
    lines = [line.strip() for line in manifest.splitlines() if line.strip()]
    variant = None
    for index, line in enumerate(lines):
        if line.startswith("#EXT-X-STREAM-INF"):
            if index + 1 < len(lines) and not lines[index + 1].startswith("#"):
                variant = urllib.parse.urljoin(base_url, lines[index + 1])
                record(INFO, "HLS variant", f"{line[:80]} -> {lines[index + 1][:60]}")
                break
    segments = [line for line in lines if not line.startswith("#")]
    if variant:
        try:
            response = request("GET", variant, headers, timeout=timeout, read_limit=400_000)
            if response.status == 200:
                segments = [line.strip() for line in response.text.splitlines() if line.strip() and not line.strip().startswith("#")]
                base_url = response.url
            record(OK if response.status == 200 else BAD, "HLS variant GET", f"HTTP {response.status}")
        except Exception as error:  # noqa: BLE001
            record(BAD, "HLS variant GET", str(error))
    if not segments:
        record(WARN, "HLS segments", "playlist me koi segment nahi mila")
        return
    target = urllib.parse.urljoin(base_url, segments[0])
    try:
        response = request("GET", target, {**headers, "Range": "bytes=0-2047"}, timeout=timeout, read_limit=8192)
        record(
            OK if response.status in (200, 206) else BAD,
            "first HLS segment GET",
            f"HTTP {response.status} · {response.headers.get('content-type', '?')} · {len(response.body)} bytes",
        )
    except Exception as error:  # noqa: BLE001
        record(BAD, "first HLS segment GET", str(error))


def dry_run_commands(info: dict, manifest: str, cookie: str) -> None:
    print("\n=== 6. Apne player me manually test karne ke commands ===")
    headers = provider_headers(cookie)
    mpv_args = " ".join(f'--http-header-fields="{k}: {v}"' for k, v in headers.items())
    ffprobe_headers = "\\r\\n".join(f"{k}: {v}" for k, v in headers.items())
    print(f"\n# provider stream URL (short-lived, cookie signed):\n{manifest}\n")
    print(
        "# ffprobe -- sabse pehle codec/container check karo (H.265 = browser fail):\n"
        f"ffprobe -hide_banner -v error -headers $'{ffprobe_headers}\\r\\n' \\\n"
        "  -show_entries stream=index,codec_name,codec_type,width,height \\\n"
        f"  -of default=noprint_wrappers=1 '{manifest}'\n"
    )
    print(f"# mpv se play (TUI yehi karta hai):\nmpv {mpv_args} '{manifest}'\n")
    print(
        "# VLC se play:\n"
        f'vlc --http-referrer="{headers["Referer"]}" --http-user-agent="{headers["User-Agent"]}"'
        + (f' --http-header="{headers["Cookie"]}"' if cookie else "")
        + f" '{manifest}'\n"
    )
    if cookie:
        print(f"# raw cookie (CloudFront signed, expiry dekh lo):\n{cookie}\n")


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #


def main() -> int:
    global STREAM_REFERER, _quiet_pass

    parser = argparse.ArgumentParser(description="Ifallhub player link / playback-error tester")
    parser.add_argument("--query", default="Inception", help='search keyword (default: "Inception")')
    parser.add_argument("--api-host", default="", help="force ek API host (default: pool ke saare try hote hain)")
    parser.add_argument("--timeout", type=float, default=15.0, help="per-request timeout seconds (default 15)")
    parser.add_argument("--url", default="", help="seedha ek stream URL probe karo (app logs / DevTools se copy kiya hua)")
    parser.add_argument("--cookie", default="", help="--url ke saath bhejne wala Cookie header (Edge-Cache-Cookie / CloudFront-*)")
    parser.add_argument("--referer", default=STREAM_REFERER, help=f"Referer header (default: {STREAM_REFERER})")
    parser.add_argument("--hosts-only", action="store_true", help="sirf static host checks, koi search/stream nahi")
    parser.add_argument("--no-stream", action="store_true", help="API chain tak, manifest/segment probe nahi")
    parser.add_argument("--quiet-pass", action="store_true", help="pass hone wali lines hide karo (summary me dikhega)")
    parser.add_argument("--self-test", action="store_true", help="offline self-test (rust tests ke same vectors, koi network nahi)")
    args = parser.parse_args()

    STREAM_REFERER = args.referer
    _quiet_pass = args.quiet_pass

    print("Ifallhub / MovieBox-Tui -- playback link checker")
    print(f"time: {time.strftime('%Y-%m-%d %H:%M:%SZ', time.gmtime())} · python {sys.version.split()[0]}")

    if args.self_test:
        return self_test()

    if args.url:
        print("\n=== Direct stream probe (--url) ===")
        print(f"  url     : {args.url}")
        print(f"  referer : {args.referer}")
        print(f"  cookie  : {args.cookie[:120] or '(none)'}")
        probe_manifest(args.url, args.cookie, args.timeout)
        dry_run_commands({}, args.url, args.cookie)
        return summarise()

    check_static_hosts(args.timeout)
    check_cdn_hosts(args.timeout)

    if args.hosts_only:
        return summarise()

    hosts = [args.api_host] if args.api_host else API_HOST_POOL
    best_host, token = None, None
    print("\n=== 3. MovieBox API host pool + session (signed visitor-login) ===")
    for host in hosts:
        try:
            response, payload = api_json("POST", f"{host}/wefeed-mobile-bff/user-api/visitor-login", {}, timeout=args.timeout)
            token_value = str((payload or {}).get("token") or "") if isinstance(payload, dict) else ""
            if response.status == 200 and token_value:
                record(OK, host, f"token mila ({len(token_value)} chars), {response.elapsed*1000:.0f} ms")
                if best_host is None:
                    best_host, token = host, token_value
            else:
                record(WARN, host, f"HTTP {response.status} · token nahi mila")
        except Exception as error:  # noqa: BLE001
            record(BAD, host, str(error))

    if not best_host or not token:
        record(BAD, "session", "kisi bhi API host se token nahi mila -- playback isi wajah se fail hota hai (network/blocked/DNS)")
        return summarise()

    info = check_api_chain(best_host, token, args.query, args.timeout)
    if not info or args.no_stream:
        return summarise()

    manifest, cookie = None, ""
    streams = (info.get("play_info") or {}).get("streams") or []
    for stream in streams:
        if not isinstance(stream, dict):
            continue
        candidate_cookie = str(stream.get("signCookie") or "")
        candidate = resolve_manifest_url(candidate_cookie)
        if candidate:
            manifest, cookie = candidate, candidate_cookie
            break
    if not manifest:
        for stream in streams:
            raw_url = str(stream.get("url") or "")
            if raw_url.startswith("http") and not is_deprecation_notice(raw_url):
                manifest, cookie = raw_url, str(stream.get("signCookie") or "")
                break
    if not manifest:
        record(BAD, "stream resolve", "play-info se koi playable URL nahi bana (cookie decode fail ya sirf deprecation notice)")
        return summarise()

    record(INFO, "resolved manifest", manifest)
    print(f"\n  manifest: {manifest}")
    print(f"  cookie  : {cookie[:120]}{'…' if len(cookie) > 120 else ''}")
    probe_manifest(manifest, cookie, args.timeout)
    dry_run_commands(info, manifest, cookie)
    return summarise()


def self_test() -> int:
    """Offline checks: same vectors jo Rust tests (adapt.rs / crypto.rs) use karte hain."""
    failures = 0

    def expect(label, got, want):
        nonlocal failures
        if got == want:
            print(f"  [ok]  {label}")
        else:
            failures += 1
            print(f"  [XX]  {label}\n        got : {got}\n        want: {want}")

    print("\n=== Self-test (no network) ===")
    expect(
        "urlprefix -> dash mpd",
        resolve_manifest_url(
            "Edge-Cache-Cookie=urlprefix=aHR0cHM6Ly9zYmNkbjMuaGFrdW5heW1hdGF0YS5jb20vZGFzaC8zMjY0NzcyNTg4MzMzMTU3NDI0XzBfMF8xMDgwX2gyNjVfNTYwLw"
            ":sign=f1a522f7bf4c548c981ad6efa88925ad:t=1789908742"
        ),
        "https://sbcdn3.hakunaymatata.com/dash/3264772588333157424_0_0_1080_h265_560/index.mpd",
    )
    expect(
        "urlprefix -> hls m3u8",
        resolve_manifest_url(
            "Edge-Cache-Cookie=urlprefix=aHR0cHM6Ly9zYmNkbjMuaGFrdW5heW1hdGF0YS5jb20vaGxzLzUyODM0MjAzNzkzODAzMzU1NzYtMS0xLTcyMC05NDYv"
            ":sign=9d668fe770e7d41d067f80422544d47e:t=1791308037"
        ),
        "https://sbcdn3.hakunaymatata.com/hls/5283420379380335576-1-1-720-946/index.m3u8",
    )
    policy = json.dumps(
        {
            "Statement": [
                {
                    "Resource": "https://sacdn.hakunaymatata.com/dash/4179386086617137184_0_0_1080_h265_518/*",
                    "Condition": {"DateLessThan": {"AWS:EpochTime": 1788879894}},
                }
            ]
        },
        separators=(",", ":"),
    )
    expect(
        "CloudFront-Policy -> mpd",
        resolve_manifest_url(f"CloudFront-Policy={base64.b64encode(policy.encode()).decode()};CloudFront-Signature=abc;"),
        "https://sacdn.hakunaymatata.com/dash/4179386086617137184_0_0_1080_h265_518/index.mpd",
    )
    for slug, transform in [
        ("item1", lambda b: b),
        ("test_dash", lambda b: b.replace("+", "-")),
        ("test_underscore", lambda b: b.replace("=", "_")),
        ("test_tilde", lambda b: b.replace("/", "~")),
        ("test_pad", lambda b: b.rstrip("=")),
    ]:
        payload = json.dumps({"Statement": [{"Resource": f"https://sacdn.hakunaymatata.com/dash/{slug}/*"}]}, separators=(",", ":"))
        encoded = transform(base64.b64encode(payload.encode()).decode())
        expect(
            f"CloudFront-Policy variant {slug}",
            resolve_manifest_url(f"CloudFront-Policy={encoded};CloudFront-Signature=abc;"),
            f"https://sacdn.hakunaymatata.com/dash/{slug}/index.mpd",
        )
    expect("invalid policy -> None", resolve_manifest_url("CloudFront-Policy=invalid_base64;"), None)
    expect("notice filter (notice.mp4)", is_deprecation_notice("https://cdn.example.com/notice.mp4"), True)
    expect("notice filter (normal mp4)", is_deprecation_notice("https://cdn.example.com/movie.mp4"), False)
    expect("sorted query (Rust BTreeMap order)", sorted_query("https://x/y?b=2&a=1&c=3&a=0"), "a=1&a=0&b=2&c=3")
    expect(
        "canonical string shape",
        canonical_string("GET", "https://api.example.com/endpoint?b=2&a=1", None, 1700000000000, "application/json", "application/json"),
        "GET\napplication/json\napplication/json\n\n1700000000000\n\n/endpoint?a=1&b=2",
    )
    print(f"\nself-test: {'PASS' if failures == 0 else f'{failures} FAILED'}")
    return 1 if failures else 0


def summarise() -> int:
    failed = [entry for entry in _results if entry[0] == BAD]
    warned = [entry for entry in _results if entry[0] == WARN]
    print("\n=== Summary ===")
    print(f"  checks   : {len(_results)}")
    print(f"  failed   : {len(failed)}")
    print(f"  warnings : {len(warned)}")
    for status, label, detail in failed[:20]:
        print(f"  FAIL  {label}  --  {detail}")
    print(
        "\nSamjho:\n"
        "  * API host fail            -> network/DNS/ISP block, ya host pool rotate ho gaya\n"
        "  * manifest 403             -> signed cookie (Edge-Cache-Cookie t=...) expire / Referer missing\n"
        "  * manifest 200 + segment 403 -> CDN ne alag host block kiya (host allowlist / ganti cookie)\n"
        "  * sab 200 par browser me error -> codec HEVC (hvc1/hev1) ya MKV container; browser support nahi karta\n"
        "  * 172.16.x / new.circleftp.net fail -> normal hai, sirf BDIX (Bangladesh ISP) network me chalta hai\n"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\ninterrupted")
        sys.exit(130)
