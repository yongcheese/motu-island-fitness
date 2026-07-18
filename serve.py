import http.server, socketserver, sys
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript', '.mjs': 'text/javascript', '.task': 'application/octet-stream',
        '.wasm': 'application/wasm', '.css': 'text/css'}
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), H) as httpd:
    print(f'serving no-cache on {PORT}'); httpd.serve_forever()
