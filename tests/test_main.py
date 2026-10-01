import http.server
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path

# Minimal stand-in for the module Decky provides at runtime
decky = types.ModuleType("decky")
decky.DECKY_PLUGIN_SETTINGS_DIR = "/tmp/moonbeam-test"
decky.logger = types.SimpleNamespace(info=print, warning=print, exception=print)
sys.modules["decky"] = decky
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402

CONF = r"""
[General]
certificate="@ByteArray(-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n)"
key="@ByteArray(-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n)"
latestsupportedversion-v1=0

[hosts]
1\apps\1\id=1
1\apps\1\name=Desktop
1\apps\2\name=ELDEN RING\x2122
1\apps\3\hidden=true
1\apps\3\name=Hidden App
1\apps\4\name="Tom Clancy's Rainbow Six, Siege"
1\apps\5\name=C:\\Games\\Thing
1\apps\size=5
1\hostname=GAMING-PC
1\localaddress=192.168.1.10
1\localport=47989
1\manualaddress=
1\remoteaddress=203.0.113.5
1\remoteport=47999
1\srvcert="@ByteArray(-----BEGIN CERTIFICATE-----\nSRV\n-----END CERTIFICATE-----\n)"
1\uuid=ABC-123
2\apps\size=0
2\hostname=Laptop
size=2
"""


# Standard modules available in Decky's PyInstaller bundle, checked against decky-loader's
# pyinstaller.spec (hidden imports) and the modules Decky itself imports. Anything else
# (e.g. xml.etree) may be missing there and would stop the backend from loading.
DECKY_MODULES = {"asyncio", "configparser", "html", "http.client", "json", "os", "pathlib", "re", "select",
                 "socket", "ssl", "struct", "tempfile", "time", "typing", "uuid", "decky"}


class ImportTest(unittest.TestCase):
    def test_only_bundled_modules(self):
        import ast
        tree = ast.parse((Path(__file__).resolve().parent.parent / "main.py").read_text())
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module)
        self.assertEqual(imported - DECKY_MODULES, set())


class ParseTest(unittest.TestCase):
    def test_hosts_and_apps(self):
        hosts = main.parse_moonlight_conf(CONF)
        self.assertEqual([h["name"] for h in hosts], ["GAMING-PC", "Laptop"])
        self.assertEqual(hosts[0]["uuid"], "ABC-123")
        self.assertEqual(hosts[0]["apps"], ["Desktop", "ELDEN RING\u2122",
                                            "Tom Clancy's Rainbow Six, Siege", "C:\\Games\\Thing"])
        self.assertEqual(hosts[0]["addresses"], [{"address": "192.168.1.10", "port": 47989},
                                                 {"address": "203.0.113.5", "port": 47999}])
        self.assertTrue(hosts[0]["serverCert"].startswith("-----BEGIN CERTIFICATE-----\nSRV\n"))
        self.assertEqual(hosts[1]["apps"], [])
        self.assertEqual(hosts[1]["addresses"], [])

    def test_backup_preferred(self):
        conf = CONF + "\n[hostsbackup]\n1\\hostname=Backup\n1\\apps\\size=0\nsize=1\n"
        self.assertEqual([h["name"] for h in main.parse_moonlight_conf(conf)], ["Backup"])

    def test_empty(self):
        self.assertEqual(main.parse_moonlight_conf("[General]\nfoo=1\n"), [])
        self.assertIsNone(main.parse_moonlight_identity("[General]\nfoo=1\n"))

    def test_identity(self):
        identity = main.parse_moonlight_identity(CONF)
        self.assertEqual(identity["certificate"], "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n")
        self.assertEqual(identity["key"], "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n")

    def test_parse_address(self):
        self.assertEqual(main.parse_address("192.168.1.10"), {"address": "192.168.1.10", "port": 47989})
        self.assertEqual(main.parse_address(" pc.lan:48000 "), {"address": "pc.lan", "port": 48000})
        self.assertEqual(main.parse_address("[fe80::1]:48000"), {"address": "fe80::1", "port": 48000})
        self.assertEqual(main.parse_address("fe80::1"), {"address": "fe80::1", "port": 47989})

    def test_app_list(self):
        xml = ('<?xml version="1.0" encoding="utf-8"?><root status_code="200">'
               '<App><AppTitle>Desktop</AppTitle><ID>1</ID></App>'
               '<App><AppTitle>Tom &amp; Jerry</AppTitle><ID>2</ID></App>'
               '<App><AppTitle/><ID>3</ID></App></root>')
        self.assertEqual(main.parse_app_list(xml), ["Desktop", "Tom & Jerry"])
        with self.assertRaises(RuntimeError):
            main.parse_app_list('<root status_code="401" status_message="The client is not authorized"/>')
        with self.assertRaises(RuntimeError):
            main.parse_app_list("<html>Not found</html>")

    def test_server_info(self):
        xml = ('<?xml version="1.0" encoding="utf-8"?>\n<root status_code="200">\n'
               '<hostname>GAMING-PC &amp; Co</hostname><appversion>7.1.431.-1</appversion>'
               '<uniqueid>ABC-123</uniqueid><HttpsPort>47984</HttpsPort><PairStatus>0</PairStatus></root>')
        self.assertEqual(main.parse_server_info(xml), {"name": "GAMING-PC & Co", "uuid": "ABC-123", "httpsPort": "47984"})
        with self.assertRaisesRegex(RuntimeError, "503"):
            main.parse_server_info("<root status_code='503' status_message='Busy'/>")


def make_cert(directory: Path, name: str) -> tuple[Path, Path]:
    cert, key = directory / f"{name}.pem", directory / f"{name}.key"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", f"/CN={name}", "-keyout", str(key), "-out", str(cert)],
                   check=True, capture_output=True)
    return cert, key


@unittest.skipIf(shutil.which("openssl") is None, "openssl is needed to create test certificates")
class DirectFetchTest(unittest.TestCase):
    """Runs a fake host: HTTP /serverinfo and HTTPS /applist requiring the client certificate."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.server_cert, server_key = make_cert(self.tmp, "server")
        client_cert, client_key = make_cert(self.tmp, "client")
        self.identity = {"certificate": client_cert.read_text(), "key": client_key.read_text()}

        test = self

        class HttpsHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                test.https_path = self.path
                body = (b'<root status_code="200"><App><AppTitle>Desktop</AppTitle></App>'
                        b'<App><AppTitle>ELDEN RING</AppTitle></App></root>')
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.https = http.server.HTTPServer(("127.0.0.1", 0), HttpsHandler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.server_cert, server_key)
        context.verify_mode = ssl.CERT_REQUIRED
        context.load_verify_locations(client_cert)
        self.https.socket = context.wrap_socket(self.https.socket, server_side=True)
        https_port = self.https.server_address[1]

        class HttpHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body = (f'<root status_code="200"><HttpsPort>{https_port}</HttpsPort>'
                        f'<uniqueid>PC-UUID</uniqueid></root>').encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.http = http.server.HTTPServer(("127.0.0.1", 0), HttpHandler)
        for server in (self.http, self.https):
            threading.Thread(target=server.serve_forever, daemon=True).start()

    def tearDown(self):
        for server in (self.http, self.https):
            server.shutdown()
            server.server_close()
        shutil.rmtree(self.tmp)

    def fetch(self, identity, server_cert_pem):
        return main.fetch_app_list_direct("127.0.0.1", self.http.server_address[1], identity,
                                          server_cert_pem, self.tmp / "work")

    def test_fetch_with_pinned_cert(self):
        self.assertEqual(self.fetch(self.identity, self.server_cert.read_text()), ["Desktop", "ELDEN RING"])
        self.assertTrue(self.https_path.startswith("/applist?uniqueid=0123456789ABCDEF&uuid="))

    def test_wrong_pinned_cert(self):
        other_cert, _ = make_cert(self.tmp, "other")
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            self.fetch(self.identity, other_cert.read_text())

    def test_refresh_falls_back_to_host(self):
        def ini_bytes(text: str) -> str:
            return '"@ByteArray(' + text.replace("\n", "\\n") + ')"'

        conf_dir = self.tmp / "home" / ".var" / "app" / main.FLATPAK_ID / "config" / main.CONF_SUBPATH.parent
        conf_dir.mkdir(parents=True)
        (conf_dir / main.CONF_SUBPATH.name).write_text(
            "[General]\n"
            f"certificate={ini_bytes(self.identity['certificate'])}\n"
            f"key={ini_bytes(self.identity['key'])}\n\n"
            "[hosts]\n"
            "1\\apps\\1\\name=Old App\n1\\apps\\size=1\n1\\hostname=GAMING-PC\n"
            f"1\\localaddress=127.0.0.1\n1\\localport={self.http.server_address[1]}\n"
            f"1\\srvcert={ini_bytes(self.server_cert.read_text())}\n"
            "size=1\n")

        decky.DECKY_USER_HOME = str(self.tmp / "home")
        decky.DECKY_PLUGIN_RUNTIME_DIR = str(self.tmp / "runtime")
        plugin = main.Plugin()
        plugin.settings_path = self.tmp / "settings" / "settings.json"
        try:
            import asyncio
            result = asyncio.run(plugin.refresh_apps("GAMING-PC"))
            self.assertEqual(result["source"], "host")
            self.assertEqual(result["apps"], ["Desktop", "ELDEN RING"])
            # Saved and used afterwards, even though Moonlight's own list is older
            state = asyncio.run(plugin.get_state())
            self.assertEqual(state["hosts"][0]["apps"], ["Desktop", "ELDEN RING"])
        finally:
            del decky.DECKY_USER_HOME
            del decky.DECKY_PLUGIN_RUNTIME_DIR

    def test_check_hosts(self):
        conf_dir = self.tmp / "home" / ".var" / "app" / main.FLATPAK_ID / "config" / main.CONF_SUBPATH.parent
        conf_dir.mkdir(parents=True)
        port = self.http.server_address[1]
        (conf_dir / main.CONF_SUBPATH.name).write_text(
            "[hosts]\n"
            f"1\\hostname=PC\n1\\uuid=PC-UUID\n1\\localaddress=127.0.0.1\n1\\localport={port}\n"
            # Another PC answering at that address now is not the paired one
            f"2\\hostname=OLD\n2\\uuid=OTHER\n2\\localaddress=127.0.0.1\n2\\localport={port}\n"
            "3\\hostname=OFF\n3\\uuid=OFF-UUID\n3\\localaddress=127.0.0.1\n3\\localport=9\n"
            "size=3\n")
        decky.DECKY_USER_HOME = str(self.tmp / "home")
        plugin = main.Plugin()
        plugin.settings_path = self.tmp / "settings" / "settings.json"
        try:
            import asyncio
            self.assertEqual(asyncio.run(plugin.check_hosts()), {"PC": True, "OLD": False, "OFF": False})
        finally:
            del decky.DECKY_USER_HOME

    def test_unpaired_client_rejected(self):
        stranger_cert, stranger_key = make_cert(self.tmp, "stranger")
        stranger = {"certificate": stranger_cert.read_text(), "key": stranger_key.read_text()}
        with self.assertRaises(Exception):
            self.fetch(stranger, self.server_cert.read_text())


def dns_name(name: str) -> bytes:
    return b"".join(bytes([len(label)]) + label.encode() for label in name.split(".")) + b"\0"


def mdns_answer(instance: str, target: str, port: int, address: str) -> bytes:
    """A response like Sunshine's, using name compression for the instance name."""
    import socket
    import struct
    header = struct.pack("!HHHHHH", 0, 0x8400, 0, 1, 0, 2)
    service = dns_name("_nvstream._tcp.local")
    ptr_rdata = bytes([len(instance)]) + instance.encode() + b"\xc0\x0c"  # -> service name at offset 12
    ptr = service + struct.pack("!HHIH", 12, 1, 120, len(ptr_rdata)) + ptr_rdata
    instance_offset = 12 + len(service) + 10
    srv_rdata = struct.pack("!HHH", 0, 0, port) + dns_name(target)
    srv = struct.pack("!H", 0xC000 | instance_offset) + struct.pack("!HHIH", 33, 0x8001, 120, len(srv_rdata)) + srv_rdata
    a = dns_name(target) + struct.pack("!HHIH", 1, 0x8001, 120, 4) + socket.inet_aton(address)
    return header + ptr + srv + a


class DiscoveryTest(unittest.TestCase):
    def test_query(self):
        query = main.build_mdns_query(True)
        self.assertTrue(query.endswith(dns_name("_nvstream._tcp.local") + b"\x00\x0c\x80\x01"))

    def test_parse_response(self):
        parsed = main.parse_mdns_response(mdns_answer("GAMING-PC", "gaming-pc.local", 47989, "192.168.1.10"))
        self.assertEqual(parsed["instances"], {"GAMING-PC._nvstream._tcp.local"})
        self.assertEqual(parsed["srv"], {"GAMING-PC._nvstream._tcp.local": ("gaming-pc.local", 47989)})
        self.assertEqual(parsed["a"], {"gaming-pc.local": ["192.168.1.10"]})

    def test_ignores_queries(self):
        self.assertEqual(main.parse_mdns_response(main.build_mdns_query(False))["instances"], set())

    def test_discover_with_fake_responder(self):
        import socket
        responder = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        responder.bind(("127.0.0.1", 0))
        responder.settimeout(5)

        def respond():
            _, sender = responder.recvfrom(9000)
            responder.sendto(b"garbage", sender)
            responder.sendto(mdns_answer("GAMING-PC", "gaming-pc.local", 48000, "192.168.1.10"), sender)

        thread = threading.Thread(target=respond, daemon=True)
        thread.start()
        try:
            hosts = main.discover_hosts(timeout=1.0, target=responder.getsockname(), listen=False)
        finally:
            thread.join()
            responder.close()
        self.assertEqual(hosts, [{"instance": "GAMING-PC", "address": "192.168.1.10", "port": 48000}])


class SaveDebugTest(unittest.TestCase):
    def test_writes_to_log_dir_with_safe_name(self):
        import asyncio
        with tempfile.TemporaryDirectory() as tmp:
            decky.DECKY_PLUGIN_LOG_DIR = tmp
            try:
                path = asyncio.run(main.Plugin().save_debug("../gamepage 1/2.txt", "snapshot"))
            finally:
                del decky.DECKY_PLUGIN_LOG_DIR
            self.assertEqual(Path(path).parent, Path(tmp))
            self.assertEqual(Path(path).read_text(), "snapshot")


if __name__ == "__main__":
    unittest.main()
