import asyncio
import html
import http.client
import json
import os
import re
import select
import socket
import ssl
import struct
import tempfile
import time
import uuid
from configparser import RawConfigParser
from pathlib import Path
from typing import Any, Optional

import decky

FLATPAK_ID = "com.moonlight_stream.Moonlight"
CONF_SUBPATH = Path("Moonlight Game Streaming Project") / "Moonlight.conf"
LIST_TIMEOUT = 30
HTTP_TIMEOUT = 5
DEFAULT_HTTP_PORT = 47989
DEFAULT_HTTPS_PORT = 47984
# Same placeholder id Moonlight uses, the host identifies clients by certificate
UNIQUE_ID = "0123456789ABCDEF"

DEFAULT_SETTINGS: dict[str, Any] = {
    # Host name as Moonlight knows it
    "host": None,
    # Optional address of the host ("ip" or "ip:port"), overrides the ones known by Moonlight
    "address": "",
    # Pass --quit-after to Moonlight, closing the app on the host when the stream ends
    "quitAfter": False,
    # Hidden non-Steam shortcut that launches Moonlight
    "shortcutAppId": None,
    # Last successfully refreshed app list per host
    "appCache": {},
    # Keep a "Moonbeam" collection with the games that can be streamed
    "collection": True,
    # Addresses of hosts found on the network, by host uuid
    "discovered": {},
    # Games whose main button launches Moonbeam, with the PC chosen in the launch selector ({appid: host})
    "preferred": {},
    # Take over Steam's own "Stream from <PC>" instead of adding a Moonbeam menu
    "replaceSteamStream": False,
    # Detailed log lines and game page snapshots for troubleshooting
    "debugLog": False,
}


# ---------------------------------------------------------------------------
# Moonlight.conf parsing (QSettings INI format)
# ---------------------------------------------------------------------------

def qt_unescape(value: str) -> str:
    """Unescapes a QSettings INI string value."""
    value = _unescape_text(value.strip())
    # Like Qt, type markers are handled after unescaping
    for prefix in ("@String(", "@ByteArray("):
        if value.startswith(prefix) and value.endswith(")"):
            return value[len(prefix):-1]
    return value


def _unescape_text(value: str) -> str:
    result = []
    in_quotes = False
    i = 0
    while i < len(value):
        char = value[i]
        if char == '"':
            in_quotes = not in_quotes
        elif char == "\\" and i + 1 < len(value):
            i += 1
            char = value[i]
            if char == "x":
                match = re.match(r"[0-9a-fA-F]{1,4}", value[i + 1:])
                if match:
                    result.append(chr(int(match.group(0), 16)))
                    i += len(match.group(0))
                else:
                    result.append("x")
            else:
                result.append({"n": "\n", "t": "\t", "r": "\r", "a": "\a", "b": "\b",
                               "f": "\f", "v": "\v", "0": "\0"}.get(char, char))
        else:
            result.append(char)
        i += 1
    return "".join(result)


def _read_conf(text: str) -> RawConfigParser:
    parser = RawConfigParser(strict=False, interpolation=None)
    parser.optionxform = str  # type: ignore[assignment]
    parser.read_string(text)
    return parser


def parse_moonlight_conf(text: str) -> list[dict[str, Any]]:
    """Returns hosts with their addresses and app lists, as cached by Moonlight."""
    parser = _read_conf(text)

    # Moonlight itself prefers the backup list if it exists
    for section in ("hostsbackup", "hosts"):
        if not parser.has_section(section):
            continue

        data = parser[section]

        def value(key: str, default: str = "") -> str:
            raw = data.get(key)
            return default if raw is None else qt_unescape(raw)

        hosts = []
        for i in range(1, int(data.get("size", "0") or 0) + 1):
            name = data.get(f"{i}\\hostname")
            if name is None:
                continue

            apps = []
            for j in range(1, int(data.get(f"{i}\\apps\\size", "0") or 0) + 1):
                app_name = data.get(f"{i}\\apps\\{j}\\name")
                hidden = data.get(f"{i}\\apps\\{j}\\hidden", "false").strip() == "true"
                if app_name is not None and not hidden:
                    apps.append(qt_unescape(app_name))

            addresses = []
            for kind in ("manual", "local", "remote", "ipv6"):
                address = value(f"{i}\\{kind}address")
                if address:
                    port = value(f"{i}\\{kind}port") or str(DEFAULT_HTTP_PORT)
                    addresses.append({"address": address, "port": int(port) or DEFAULT_HTTP_PORT})

            hosts.append({"name": qt_unescape(name),
                          "uuid": value(f"{i}\\uuid"),
                          "addresses": addresses,
                          "serverCert": value(f"{i}\\srvcert"),
                          "apps": apps})
        if hosts:
            return hosts
    return []


def parse_moonlight_identity(text: str) -> Optional[dict[str, str]]:
    """Returns Moonlight's client certificate and key (PEM), used for pairing with hosts."""
    parser = _read_conf(text)
    if not parser.has_section("General"):
        return None

    cert = parser["General"].get("certificate")
    key = parser["General"].get("key")
    if not cert or not key:
        return None
    return {"certificate": qt_unescape(cert), "key": qt_unescape(key)}


def parse_address(address: str) -> dict[str, Any]:
    """Parses "host", "host:port", "[ipv6]" or "[ipv6]:port"."""
    address = address.strip()
    match = re.fullmatch(r"\[(.+)\](?::(\d+))?", address) or re.fullmatch(r"([^:]+)(?::(\d+))?", address)
    if not match:
        # Bare IPv6 address
        return {"address": address, "port": DEFAULT_HTTP_PORT}
    return {"address": match.group(1), "port": int(match.group(2) or DEFAULT_HTTP_PORT)}


# The host's XML responses are small and flat. They are parsed with regular expressions
# since Decky's bundled Python does not include xml.etree.

def xml_text(xml: str, tag: str) -> Optional[str]:
    """Text of the first <tag>...</tag> element, None if missing."""
    match = re.search(rf"<{tag}(?:\s[^>]*)?>(.*?)</{tag}\s*>", xml, re.DOTALL)
    if match is None:
        return "" if re.search(rf"<{tag}(?:\s[^>]*)?/>", xml) else None
    return html.unescape(match.group(1)).strip()


def xml_root_attribute(xml: str, name: str) -> Optional[str]:
    match = re.search(r"<root\b([^>]*)>", xml) or re.search(r"<root\b([^>]*)/>", xml)
    if match is None:
        return None
    attribute = re.search(rf"\b{name}\s*=\s*(\"([^\"]*)\"|'([^']*)')", match.group(1))
    if attribute is None:
        return None
    return html.unescape(attribute.group(2) if attribute.group(2) is not None else attribute.group(3))


def check_status(xml: str, what: str) -> None:
    if "<root" not in xml:
        raise RuntimeError(f"Unexpected {what} response from host")
    status = xml_root_attribute(xml, "status_code") or "200"
    if status != "200":
        raise RuntimeError(f"Host refused the {what} request ({status}: {xml_root_attribute(xml, 'status_message') or ''})")


def parse_app_list(xml: str) -> list[str]:
    check_status(xml, "app list")
    apps = re.findall(r"<App(?:\s[^>]*)?>(.*?)</App\s*>", xml, re.DOTALL)
    return [title for title in (xml_text(app, "AppTitle") for app in apps) if title]


def parse_server_info(xml: str) -> dict[str, str]:
    check_status(xml, "server info")
    return {"name": xml_text(xml, "hostname") or "",
            "uuid": xml_text(xml, "uniqueid") or "",
            "httpsPort": xml_text(xml, "HttpsPort") or ""}


# ---------------------------------------------------------------------------
# Talking to the host directly (GameStream protocol, Moonlight's pairing)
# ---------------------------------------------------------------------------

def _http_host(address: str) -> str:
    return f"[{address}]" if ":" in address else address


def _get_https_port(address: str, port: int) -> int:
    https_port = get_server_info(address, port)["httpsPort"]
    return int(https_port) if https_port.isdigit() and int(https_port) else DEFAULT_HTTPS_PORT


def _pem_to_der(pem: str) -> Optional[bytes]:
    try:
        return ssl.PEM_cert_to_DER_cert(pem.strip() + "\n")
    except Exception:
        return None


def fetch_app_list_direct(address: str, port: int, identity: dict[str, str], server_cert_pem: str,
                          work_dir: Path) -> list[str]:
    """Fetches the app list from the host over HTTPS with Moonlight's client certificate."""
    https_port = _get_https_port(address, port)

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    # Hosts use self-signed certificates, pinned below instead
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE

    work_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=work_dir) as tmp:
        cert_path = Path(tmp) / "client.pem"
        key_path = Path(tmp) / "client.key"
        cert_path.write_text(identity["certificate"])
        key_fd = os.open(key_path, os.O_WRONLY | os.O_CREAT, 0o600)
        with os.fdopen(key_fd, "w") as key_file:
            key_file.write(identity["key"])
        context.load_cert_chain(cert_path, key_path)

    conn = http.client.HTTPSConnection(_http_host(address), https_port, timeout=HTTP_TIMEOUT, context=context)
    try:
        conn.connect()
        expected = _pem_to_der(server_cert_pem) if server_cert_pem else None
        actual = conn.sock.getpeercert(binary_form=True) if conn.sock else None
        if expected is not None and actual != expected:
            raise RuntimeError("Host certificate does not match the one paired with Moonlight")

        conn.request("GET", f"/applist?uniqueid={UNIQUE_ID}&uuid={uuid.uuid4().hex}")
        response = conn.getresponse()
        return parse_app_list(response.read().decode(errors="replace"))
    finally:
        conn.close()


def get_server_info(address: str, port: int) -> dict[str, str]:
    """Reads the host's public info (no pairing needed)."""
    conn = http.client.HTTPConnection(_http_host(address), port, timeout=HTTP_TIMEOUT)
    try:
        conn.request("GET", f"/serverinfo?uniqueid={UNIQUE_ID}&uuid={uuid.uuid4().hex}")
        return parse_server_info(conn.getresponse().read().decode(errors="replace"))
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Host discovery (mDNS, like Moonlight)
# ---------------------------------------------------------------------------

MDNS_ADDRESS = "224.0.0.251"
MDNS_PORT = 5353
NVSTREAM_SERVICE = "_nvstream._tcp.local"
DNS_PTR, DNS_A, DNS_SRV = 12, 1, 33


def build_mdns_query(unicast_response: bool) -> bytes:
    question = b"".join(bytes([len(label)]) + label.encode() for label in NVSTREAM_SERVICE.split(".")) + b"\0"
    qclass = 0x8001 if unicast_response else 0x0001
    return struct.pack("!HHHHHH", 0, 0, 1, 0, 0, 0) + question + struct.pack("!HH", DNS_PTR, qclass)


def _read_dns_name(packet: bytes, offset: int) -> tuple[str, int]:
    labels = []
    end = None
    for _ in range(128):  # guards against compression loops
        length = packet[offset]
        if length == 0:
            offset += 1
            break
        if length & 0xC0 == 0xC0:
            pointer = struct.unpack_from("!H", packet, offset)[0] & 0x3FFF
            if end is None:
                end = offset + 2
            offset = pointer
            continue
        labels.append(packet[offset + 1:offset + 1 + length].decode(errors="replace"))
        offset += 1 + length
    return ".".join(labels), end if end is not None else offset


def parse_mdns_response(packet: bytes) -> dict[str, Any]:
    """Returns the nvstream instances, their SRV targets and the A records found in a packet."""
    _, flags, qdcount, ancount, nscount, arcount = struct.unpack_from("!HHHHHH", packet, 0)
    result: dict[str, Any] = {"instances": set(), "srv": {}, "a": {}}
    if not flags & 0x8000:  # not a response
        return result

    offset = 12
    for _ in range(qdcount):
        _, offset = _read_dns_name(packet, offset)
        offset += 4

    for _ in range(ancount + nscount + arcount):
        name, offset = _read_dns_name(packet, offset)
        rtype, _, _, rdlength = struct.unpack_from("!HHIH", packet, offset)
        offset += 10
        rdata_offset = offset
        offset += rdlength

        if rtype == DNS_PTR and name.lower() == NVSTREAM_SERVICE:
            result["instances"].add(_read_dns_name(packet, rdata_offset)[0])
        elif rtype == DNS_SRV:
            port = struct.unpack_from("!H", packet, rdata_offset + 4)[0]
            result["srv"][name] = (_read_dns_name(packet, rdata_offset + 6)[0], port)
        elif rtype == DNS_A and rdlength == 4:
            result["a"].setdefault(name.lower(), []).append(socket.inet_ntoa(packet[rdata_offset:rdata_offset + 4]))
    return result


def discover_hosts(timeout: float = 3.0, target: tuple[str, int] = (MDNS_ADDRESS, MDNS_PORT),
                   listen: bool = True) -> list[dict[str, Any]]:
    """Finds GameStream hosts (Sunshine/Apollo/Vibepollo) on the local network."""
    sockets = []
    # Shared listener on the mDNS port gets multicast answers (Avahi may use the port too)
    try:
        if not listen:
            raise OSError("disabled")
        listener = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        listener.bind(("", MDNS_PORT))
        listener.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP,
                            socket.inet_aton(MDNS_ADDRESS) + socket.inet_aton("0.0.0.0"))
        listener.sendto(build_mdns_query(False), (MDNS_ADDRESS, MDNS_PORT))
        sockets.append(listener)
    except OSError as err:
        decky.logger.warning(f"mDNS listener unavailable: {err}")

    # A query from another port gets unicast answers ("legacy unicast", RFC 6762)
    unicast = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    unicast.bind(("", 0))
    unicast.sendto(build_mdns_query(True), target)
    sockets.append(unicast)

    instances: dict[str, str] = {}  # instance -> sender address
    srv: dict[str, tuple[str, int]] = {}
    a_records: dict[str, list[str]] = {}
    deadline = time.monotonic() + timeout
    try:
        while (remaining := deadline - time.monotonic()) > 0:
            readable, _, _ = select.select(sockets, [], [], remaining)
            for sock in readable:
                packet, sender = sock.recvfrom(9000)
                try:
                    parsed = parse_mdns_response(packet)
                except (struct.error, IndexError):
                    continue
                for instance in parsed["instances"]:
                    instances.setdefault(instance, sender[0])
                srv.update(parsed["srv"])
                for name, addresses in parsed["a"].items():
                    a_records.setdefault(name, []).extend(addresses)
    finally:
        for sock in sockets:
            sock.close()

    hosts = []
    for instance, sender in instances.items():
        target, port = srv.get(instance, ("", DEFAULT_HTTP_PORT))
        addresses = a_records.get(target.lower()) or [sender]
        hosts.append({"instance": instance.split(".")[0], "address": addresses[0], "port": port})
    return hosts


# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------

def user_home() -> Path:
    return Path(getattr(decky, "DECKY_USER_HOME", None) or Path.home())


def moonlight_conf_paths() -> list[Path]:
    home = user_home()
    return [home / ".var" / "app" / FLATPAK_ID / "config" / CONF_SUBPATH,
            home / ".config" / CONF_SUBPATH]


def read_moonlight_conf() -> Optional[str]:
    for path in moonlight_conf_paths():
        if path.is_file():
            try:
                return path.read_text(encoding="utf-8", errors="replace")
            except Exception:
                decky.logger.exception(f"Failed to read {path}")
    return None


def read_moonlight_hosts() -> list[dict[str, Any]]:
    text = read_moonlight_conf()
    if text is None:
        return []
    try:
        return parse_moonlight_conf(text)
    except Exception:
        decky.logger.exception("Failed to parse Moonlight config")
        return []


def user_env() -> dict[str, str]:
    env = os.environ.copy()
    # Decky's bundled libraries break system binaries
    env.pop("LD_LIBRARY_PATH", None)
    env["HOME"] = str(user_home())
    runtime_dir = f"/run/user/{os.getuid()}"
    if os.path.isdir(runtime_dir):
        env.setdefault("XDG_RUNTIME_DIR", runtime_dir)
        env.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path={runtime_dir}/bus")
    return env


async def moonlight_list(host: str) -> list[str]:
    proc = await asyncio.create_subprocess_exec(
        "flatpak", "run", "--env=QT_QPA_PLATFORM=offscreen", "--command=moonlight",
        FLATPAK_ID, "list", host,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=user_env())
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=LIST_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise RuntimeError("Moonlight did not answer in time (is the PC on?)")

    if proc.returncode != 0:
        message = stderr.decode(errors="replace").strip().splitlines()
        raise RuntimeError(message[-1] if message else f"Moonlight exited with {proc.returncode}")
    return [line.strip() for line in stdout.decode(errors="replace").splitlines() if line.strip()]


# ---------------------------------------------------------------------------
# Plugin
# ---------------------------------------------------------------------------

class Plugin:
    settings_path = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "settings.json"

    def _read_settings(self) -> dict[str, Any]:
        settings = json.loads(json.dumps(DEFAULT_SETTINGS))
        try:
            if self.settings_path.is_file():
                settings.update(json.loads(self.settings_path.read_text()))
        except Exception:
            decky.logger.exception("Failed to read settings")
        return settings

    def _write_settings(self, settings: dict[str, Any]) -> None:
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings_path.write_text(json.dumps(settings, indent=2))

    def _hosts(self, settings: dict[str, Any]) -> list[dict[str, Any]]:
        """Hosts known by Moonlight, with app lists replaced by newer refreshed ones."""
        hosts = read_moonlight_hosts()
        for host in hosts:
            cached = settings["appCache"].get(host["name"])
            if cached is not None:
                host["apps"] = cached
        return [{"name": host["name"], "uuid": host["uuid"], "apps": host["apps"]} for host in hosts]

    async def get_state(self) -> dict[str, Any]:
        settings = self._read_settings()
        return {"settings": settings, "hosts": self._hosts(settings)}

    async def set_settings(self, update: dict[str, Any]) -> None:
        settings = self._read_settings()
        settings.update({key: value for key, value in update.items() if key in DEFAULT_SETTINGS})
        self._write_settings(settings)

    async def _fetch_direct(self, host_name: str, manual_address: str) -> list[str]:
        text = read_moonlight_conf()
        if text is None:
            raise RuntimeError("Moonlight config not found")

        identity = parse_moonlight_identity(text)
        if identity is None:
            raise RuntimeError("Moonlight has no pairing certificate yet")

        host = next((h for h in parse_moonlight_conf(text) if h["name"] == host_name), None)
        addresses = [parse_address(manual_address)] if manual_address.strip() else []
        if host is not None:
            discovered = self._read_settings()["discovered"].get(host["uuid"])
            if discovered:
                addresses.append(parse_address(discovered))
            addresses += host["addresses"]
        if not addresses:
            raise RuntimeError("No address known for the PC, enter it in the Moonbeam menu")

        errors = []
        for entry in addresses:
            try:
                return await asyncio.to_thread(fetch_app_list_direct, entry["address"], entry["port"], identity,
                                               host["serverCert"] if host else "",
                                               Path(decky.DECKY_PLUGIN_RUNTIME_DIR))
            except Exception as err:
                decky.logger.warning(f"Direct app list from {entry['address']}:{entry['port']} failed: {err}")
                errors.append(f"{entry['address']}: {err}")
        raise RuntimeError("; ".join(errors))

    async def refresh_apps(self, host: str) -> dict[str, Any]:
        """Gets the current app list: via Moonlight, then directly from the host, then the saved one."""
        settings = self._read_settings()
        errors = []
        apps: Optional[list[str]] = None
        source = "saved"

        try:
            apps = await moonlight_list(host)
            source = "moonlight"
        except Exception as err:
            decky.logger.warning(f"moonlight list failed: {err}")
            errors.append(f"Moonlight: {err}")

        if apps is None:
            try:
                # The address in the menu belongs to the preferred PC
                address = settings["address"] if host == settings["host"] else ""
                apps = await self._fetch_direct(host, address)
                source = "host"
            except Exception as err:
                decky.logger.warning(f"Direct app list failed: {err}")
                errors.append(f"Direct: {err}")

        if apps is not None:
            # Read again: other hosts may have been refreshed meanwhile
            settings = self._read_settings()
            settings["appCache"][host] = apps
            self._write_settings(settings)

        hosts = self._hosts(settings)
        if apps is None:
            apps = next((h["apps"] for h in hosts if h["name"] == host), [])
        return {"apps": apps, "hosts": hosts, "source": source,
                "error": None if source != "saved" else " | ".join(errors)}

    async def scan_hosts(self) -> list[dict[str, Any]]:
        """Finds hosts on the network and tells which of them are paired with Moonlight."""
        found = await asyncio.to_thread(discover_hosts)
        paired = {host["uuid"]: host["name"] for host in read_moonlight_hosts() if host["uuid"]}
        settings = self._read_settings()

        async def describe(entry: dict[str, Any]) -> dict[str, Any]:
            info = {"name": entry["instance"], "uuid": ""}
            try:
                info = await asyncio.to_thread(get_server_info, entry["address"], entry["port"])
            except Exception as err:
                decky.logger.warning(f"serverinfo from {entry['address']} failed: {err}")
            address = entry["address"] if entry["port"] == DEFAULT_HTTP_PORT else f"{entry['address']}:{entry['port']}"
            if info["uuid"] in paired:
                settings["discovered"][info["uuid"]] = address
            return {"name": paired.get(info["uuid"], info["name"] or entry["instance"]),
                    "address": address,
                    "paired": info["uuid"] in paired}

        hosts = list(await asyncio.gather(*(describe(entry) for entry in found)))
        self._write_settings(settings)
        decky.logger.info(f"Scan found: {hosts}")
        return sorted(hosts, key=lambda host: (not host["paired"], host["name"].lower()))

    async def save_debug(self, name: str, content: str) -> str:
        """Writes a debug file next to the plugin log, returns its path."""
        safe_name = re.sub(r"[^\w.-]", "_", name)[:80] or "debug.txt"
        path = Path(decky.DECKY_PLUGIN_LOG_DIR) / safe_name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content[:5_000_000], encoding="utf-8")
        decky.logger.info(f"Saved debug file {path}")
        return str(path)

    async def log(self, message: str) -> None:
        decky.logger.info(f"[frontend] {message}")

    async def _main(self):
        decky.logger.info("Moonbeam loaded")

    async def _unload(self):
        decky.logger.info("Moonbeam unloaded")
