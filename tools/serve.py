"""Local server for the page and its checks: python3 -m http.server with a deep listen queue, on
localhost only. The page loads about twenty modules at once, and http.server's default queue of 5 drops
some of them on macOS (net::ERR_SOCKET_NOT_CONNECTED); a page whose module fails to load never starts,
so a check waiting for it times out at random.

Usage: python3 -I tools/serve.py [port, default 8000] [dir, default .]
"""
import functools
import http.server
import sys


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    folder = sys.argv[2] if len(sys.argv) > 2 else "."
    Server(("127.0.0.1", port), functools.partial(http.server.SimpleHTTPRequestHandler, directory=folder)).serve_forever()


if __name__ == "__main__":
    main()
