#!/usr/bin/env python3
"""Boulpik dev server.

Serves the static SPA and proxies two kinds of upstream requests so the browser
never sees secrets and CORS never breaks us:

  /api/v1/engine/*   →  https://dev.palefo.dev/api/v1/engine/*
                        Injects X-API-Key from PALEFO_API_KEY in .env.

  /api/lottery/<id>  →  whatever upstream URL the lottery adapter declares
                        in LOTTERY_SOURCES below. The browser never knows the
                        real upstream — adapters are added/removed here AND in
                        js/lotteries/, in one symmetric pair.

Design mirrors piktrans/server.py so the two apps stay operationally consistent.

Usage:
    python server.py [port]            # default port 8080
"""
import http.server
import urllib.request
import urllib.error
import os
import re
import sys
import time
import traceback

VERBOSE = os.environ.get('BOULPIK_QUIET', '') == ''


def _ts(): return time.strftime('%H:%M:%S')
def _log(prefix, msg):
    if VERBOSE: print(f"{_ts()}  {prefix} {msg}", flush=True)
def _err(prefix, msg):
    print(f"{_ts()}  {prefix} {msg}", file=sys.stderr, flush=True)

def _preview(b, limit=300):
    if b is None: return '(empty)'
    if isinstance(b, (bytes, bytearray)):
        try: s = b.decode('utf-8', errors='replace')
        except Exception: return f'(binary, {len(b)} bytes)'
    else:
        s = str(b)
    s = s.replace('\n', ' ').replace('\r', '')
    if len(s) > limit: s = s[:limit] + f'…({len(s)} chars)'
    return s


PALEFO_BASE = "https://dev.palefo.dev"

# Server-side lottery source registry. Each entry maps a stable adapter id to
# the upstream URL the proxy will hit. Adding a new lottery = add an entry here
# AND drop a matching adapter file in js/lotteries/ with the same id. Removing
# one = delete both. Keep these in lockstep.
#
# This is a static map on purpose — anything more ceremonial (YAML, plugin
# loader) is overkill for "list of URLs by name."
LOTTERY_SOURCES = {
    # Mock JSON file served from the same origin (good default for development;
    # replace the URL with a real upstream once you wire one up).
    'demo':      '/mock/demo.json',
    # Real-world examples — replace with the actual endpoint you have access to.
    'loto_haiti':   'https://example.com/api/loto-haiti/latest',
    'megamillions': 'https://data.ny.gov/resource/5xaw-6ayf.json?$limit=1&$order=draw_date%20DESC',
}

_HOP_BY_HOP = {
    "transfer-encoding", "content-encoding", "connection", "keep-alive",
    "proxy-authenticate", "proxy-authorization", "te", "trailers", "upgrade",
}

# Only these paths may be served as static files.
_ALLOWED_STATIC = re.compile(
    r'^(/'
    r'|/index\.html'
    r'|/css/[\w.\-]+\.css'
    r'|/js/[\w.\-/]+\.js'
    r'|/mock/[\w.\-]+\.json'
    r'|/images/[\w.\-]+\.(svg|png|jpg|jpeg|webp|gif|ico)'
    r'|/favicon\.ico'
    r')$'
)

_SECURITY_HEADERS = [
    ('X-Content-Type-Options',  'nosniff'),
    ('X-Frame-Options',         'DENY'),
    ('X-XSS-Protection',        '1; mode=block'),
    ('Referrer-Policy',         'no-referrer'),
    # Mic allowed (this is the entire point of the app); camera disabled.
    ('Permissions-Policy',      'camera=(), microphone=(self), geolocation=(), payment=()'),
    ('Content-Security-Policy', (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: blob:; "
        "media-src 'self' data: blob:; "
        "connect-src 'self' data: blob:; "
        "object-src 'none'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'"
    )),
]


def _load_env():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    try:
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'): continue
                eq = line.find('=')
                if eq == -1: continue
                key, val = line[:eq].strip(), line[eq + 1:].strip()
                if key and val and key not in os.environ:
                    os.environ[key] = val
    except FileNotFoundError:
        pass


_load_env()
PALEFO_API_KEY = os.environ.get('PALEFO_API_KEY', '')


class Handler(http.server.SimpleHTTPRequestHandler):

    def _is_palefo_api(self):  return self.path.startswith("/api/v1/engine/")
    def _is_lottery_api(self): return self.path.startswith("/api/lottery/")

    def _is_allowed_static(self):
        clean = self.path.split('?')[0].split('#')[0]
        return bool(_ALLOWED_STATIC.match(clean))

    def _dispatch(self, fn, *args):
        try:
            fn(*args)
        except Exception:
            _err('[!]', f'unhandled exception in {self.command} {getattr(self, "path", "?")}')
            traceback.print_exc()
            try: self.send_error(500, 'Internal server error (see server log)')
            except Exception: pass

    def do_GET(self):
        if self._is_palefo_api():
            self._dispatch(self._proxy_palefo, "GET")
        elif self._is_lottery_api():
            self._dispatch(self._proxy_lottery, "GET")
        elif self._is_allowed_static():
            _log('[static →]', f'GET {self.path}')
            self._dispatch(super().do_GET)
        else:
            _err('[404]', f'GET {self.path}')
            self.send_error(404)

    def do_POST(self):
        if self._is_palefo_api():
            self._dispatch(self._proxy_palefo, "POST")
        else:
            _err('[405]', f'POST {self.path}')
            self.send_error(405)

    def _proxy_palefo(self, method):
        url = PALEFO_BASE + self.path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None
        _log('[palefo →]', f'{method} {self.path}'
             + (f'  body={_preview(body)}' if body else ''))

        _FORWARD = ("Content-Type", "Accept", "Accept-Language", "User-Agent")
        headers = {}
        for key in _FORWARD:
            val = self.headers.get(key)
            if val: headers[key] = val

        if PALEFO_API_KEY:
            headers['X-API-Key'] = PALEFO_API_KEY
        else:
            val = self.headers.get("X-API-Key")
            if val: headers['X-API-Key'] = val

        self._do_proxy(method, url, body, headers, label='palefo')

    def _proxy_lottery(self, method):
        # /api/lottery/<id>[?...] — pull the id, look up the upstream URL.
        rest = self.path[len("/api/lottery/"):]
        adapter_id = rest.split('?')[0].split('/')[0]
        upstream = LOTTERY_SOURCES.get(adapter_id)
        if not upstream:
            _err('[lottery ✗]', f'404 unknown adapter id "{adapter_id}"')
            self.send_error(404, f'Unknown lottery adapter "{adapter_id}"')
            return

        # If the upstream is a same-origin path (e.g. /mock/demo.json), serve
        # it as a static file rather than re-fetching ourselves.
        if upstream.startswith('/'):
            _log('[lottery →]', f'{method} {self.path}  (local file: {upstream})')
            self.path = upstream
            return super().do_GET()

        _log('[lottery →]', f'{method} {self.path}  → {upstream}')
        # Forward query string from caller onto upstream (so future adapters
        # can pass through filters without server changes).
        qs = self.path.split('?', 1)
        if len(qs) > 1 and '?' not in upstream:
            upstream = upstream + '?' + qs[1]
        elif len(qs) > 1:
            upstream = upstream + '&' + qs[1]

        self._do_proxy(method, upstream, None, {'Accept': 'application/json'},
                       label='lottery')

    def _do_proxy(self, method, url, body, headers, *, label):
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                for h, v in resp.getheaders():
                    if h.lower() not in _HOP_BY_HOP:
                        self.send_header(h, v)
                self.end_headers()
                self.wfile.write(resp_body)
                _log(f'[{label} ←]', f'{resp.status} {method} {self.path}  ({len(resp_body)} bytes)')
        except urllib.error.HTTPError as e:
            resp_body = e.read()
            self.send_response(e.code)
            for h, v in e.headers.items():
                if h.lower() not in _HOP_BY_HOP:
                    self.send_header(h, v)
            self.end_headers()
            self.wfile.write(resp_body)
            _err(f'[{label} ✗]', f'{e.code} {method} {self.path}  body={_preview(resp_body)}')
        except urllib.error.URLError as e:
            _err(f'[{label} ✗]', f'502 {method} {self.path}  upstream URLError: {e.reason}')
            self.send_error(502, f"Upstream error: {e.reason}")

    def send_head(self):
        path = self.path.split('?')[0]
        self._add_cache_headers = path.endswith(('.js', '.css', '.html'))
        return super().send_head()

    def end_headers(self):
        for name, value in _SECURITY_HEADERS:
            self.send_header(name, value)
        if getattr(self, '_add_cache_headers', False):
            self.send_header('Cache-Control', 'no-store')
            self._add_cache_headers = False
        super().end_headers()

    def version_string(self): return ''
    def server_version(self): return ''
    def sys_version(self):    return ''
    def log_message(self, fmt, *args): return
    def log_request(self, code='-', size='-'): pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    if not PALEFO_API_KEY:
        print("WARNING: PALEFO_API_KEY not set. Copy .env.example to .env and add your key.")
    else:
        print(f"API key: {PALEFO_API_KEY[:4]}…")
    print(f"Registered lottery sources: {', '.join(LOTTERY_SOURCES.keys())}")
    server = http.server.HTTPServer(("", port), Handler)
    print(f"Boulpik dev server: http://localhost:{port}")
    server.serve_forever()
