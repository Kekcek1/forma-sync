"""Настольная оболочка «Форма»: локальный сервер + окно WebView2."""
import functools
import http.server
import os
import socketserver
import sys
import threading

import webview

APP = "Форма"


def web_root() -> str:
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    for candidate in (os.path.join(base, "web"), os.path.join(base, "..", "build", "sync")):
        if os.path.isdir(candidate):
            return os.path.abspath(candidate)
    raise SystemExit("Не найден каталог web с собранным приложением")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    root = web_root()
    handler = functools.partial(Quiet, directory=root)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    webview.create_window(
        APP,
        f"http://127.0.0.1:{port}/index.html",
        width=1280,
        height=880,
        min_size=(980, 700),
        text_select=True,
    )
    webview.start()


if __name__ == "__main__":
    main()
