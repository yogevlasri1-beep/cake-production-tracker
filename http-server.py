#!/usr/bin/env python3
"""שרver סטטי עם no-cache ל-index.html, sw.js, version.js — כדי שהאייפון יקבל עדכונים."""
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

NO_CACHE_PATHS = ('/', '/index.html')
NO_CACHE_SUFFIXES = ('index.html', 'sw.js', 'version.js', '.js', '.css')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        path = self.path.split('?', 1)[0]
        if path in NO_CACHE_PATHS or any(path.endswith(s) for s in NO_CACHE_SUFFIXES):
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
            self.send_header('Pragma', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(ROOT)
    server = HTTPServer(('0.0.0.0', PORT), Handler)
    print(f'Serving {ROOT} on http://0.0.0.0:{PORT} (no-cache for HTML/SW/version)')
    server.serve_forever()
