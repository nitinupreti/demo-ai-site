"""Fetch source assets and upload them straight to AEM DAM.

Deliberately not an agent: downloading a URL and POSTing it to DAM is
deterministic work, so doing it in Python is faster, cheaper, and repeatable.
It also deduplicates — nine component agents referencing the same logo download
it once instead of nine times.

Assets are **never** written into ui.content. A FileVault package carrying
binaries makes every build, install, and remediation cycle slower for no
benefit, so the staging copy lives under the evidence directory and the upload
goes over the Assets HTTP API.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import mimetypes
import os
import posixpath
import re
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any, Callable, Mapping, TypeVar
from xml.etree import ElementTree

from PIL import Image

from .browser import browser_paths
from .config import Settings
from .merge import latest_contribution_path
from .console import emit

_RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}
_Value = TypeVar("_Value")
_VERIFIED_SVG_RECOVERIES: set[str] = set()


class AssetError(RuntimeError):
    """Raised when an asset cannot be fetched or uploaded."""

    def __init__(self, message: str, *, retryable: bool = False, critical: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.critical = critical


class AssetDeclarationError(AssetError):
    """A declaration needs repair by its component owner, not a transfer retry."""

    def __init__(self, message: str, owners: list[str], *, critical: bool = False) -> None:
        super().__init__(message, critical=critical)
        self.owners = owners


def _retry(operation: Callable[[], _Value], config: Mapping[str, Any], label: str) -> _Value:
    attempts = config.get("transfer_attempts", 3)
    delay = config.get("retry_delay_seconds", 1)
    if type(attempts) is not int or not 1 <= attempts <= 10 or type(delay) not in (int, float) or not 0 <= delay <= 30:
        raise AssetError("Invalid asset transfer retry settings.", critical=True)
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except AssetError as error:
            if not error.retryable or error.critical or attempt == attempts:
                raise
            emit(f"  asset retry {attempt + 1}/{attempts}: {label}", "yellow")
            time.sleep(min(delay * 2 ** (attempt - 1), 30))
    raise AssertionError("No asset transfer attempt was executed.")


@dataclass
class AssetRecord:
    source_url: str
    dam_path: str
    local_path: str
    mime: str
    bytes: int
    sha256: str
    status: str
    detail: str = ""
    source_file: str = ""
    supplied_from: str = ""
    owners: list[str] = field(default_factory=list)
    critical: bool = False

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class AssetReport:
    uploaded: list[AssetRecord] = field(default_factory=list)
    skipped: list[AssetRecord] = field(default_factory=list)
    failed: list[AssetRecord] = field(default_factory=list)
    manifest_path: str | None = None
    unresolved_path: str | None = None

    @property
    def ok(self) -> bool:
        return not self.failed

    def to_dict(self) -> dict[str, Any]:
        return {
            "uploaded": [record.to_dict() for record in self.uploaded],
            "skipped": [record.to_dict() for record in self.skipped],
            "failed": [record.to_dict() for record in self.failed],
            "manifest": self.manifest_path,
            "unresolved": self.unresolved_path,
        }


class AemClient:
    """Minimal authenticated client for the AEM Assets HTTP API."""

    def __init__(self, base_url: str, credentials: str, config: Mapping[str, Any]) -> None:
        self.base_url = base_url.rstrip("/")
        self._auth = urllib.parse.quote  # placeholder to keep credentials out of attributes
        token = f"Basic {self._encode(credentials)}"
        self._headers = {"Authorization": token, "Referer": self.base_url + "/"}
        self.config = config
        self._csrf: str | None = None

    @staticmethod
    def _encode(credentials: str) -> str:
        import base64

        return base64.b64encode(credentials.encode("utf-8")).decode("ascii")

    def _request(self, url: str, *, method: str = "GET", data: bytes | None = None,
                 headers: Mapping[str, str] | None = None, timeout: int = 60) -> tuple[int, bytes]:
        request = urllib.request.Request(  # noqa: S310 - fixed http(s) base URL
            url, data=data, method=method, headers={**self._headers, **(headers or {})}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                return int(response.status), response.read()
        except urllib.error.HTTPError as error:
            return int(error.code), error.read()
        except (urllib.error.URLError, OSError, http.client.HTTPException) as error:
            raise AssetError(f"AEM {method} request failed: {error}", retryable=True) from error

    def csrf_token(self) -> str:
        """AEM rejects writes without both a CSRF token and a Referer header."""
        if self._csrf:
            return self._csrf
        path = str(self.config.get("csrf_token_path", "/libs/granite/csrf/token.json"))
        status, body = self._request(f"{self.base_url}{path}")
        if status != 200:
            raise AssetError(f"Could not fetch a CSRF token from {path} (HTTP {status}).", retryable=status in _RETRYABLE_STATUS)
        try:
            self._csrf = str(json.loads(body.decode("utf-8"))["token"])
        except (ValueError, KeyError, TypeError) as error:
            raise AssetError("AEM returned an invalid CSRF response.") from error
        if not self._csrf:
            raise AssetError("AEM returned an empty CSRF token.")
        return self._csrf

    def _write(self, url: str, *, data: bytes, mime: str, timeout: int = 60) -> tuple[int, bytes]:
        for attempt in range(2):
            status, body = self._request(url, method="POST", data=data,
                                         headers={"Content-Type": mime, "CSRF-Token": self.csrf_token()}, timeout=timeout)
            if status != 403 or attempt:
                return status, body
            self._csrf = None
        raise AssertionError("No authenticated write was attempted.")

    def ensure_folder(self, dam_folder: str) -> None:
        """Create each missing segment; an upload into a missing folder 404s."""
        segments = [segment for segment in dam_folder.strip("/").split("/") if segment]
        current = ""
        for segment in segments:
            parent, current = current, f"{current}/{segment}"
            status, _ = self._request(f"{self.base_url}{current}.json")
            if status == 200:
                continue
            if status != 404:
                raise AssetError(f"Could not inspect DAM folder {current} (HTTP {status}).", retryable=status in _RETRYABLE_STATUS)
            body = urllib.parse.urlencode(
                {":name": segment, "jcr:primaryType": "sling:Folder"}
            ).encode("utf-8")
            status, _ = self._write(
                f"{self.base_url}{parent}/*",
                data=body,
                mime="application/x-www-form-urlencoded",
            )
            if status not in (200, 201):
                raise AssetError(f"Could not create DAM folder {current} (HTTP {status}).", retryable=status in _RETRYABLE_STATUS)

    def upload(self, dam_folder: str, name: str, payload: bytes, mime: str, timeout: int) -> None:
        boundary = f"----aem-migration-{uuid.uuid4().hex}"
        parts = [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'.encode(),
            f"Content-Type: {mime}\r\n\r\n".encode(),
            payload,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
        template = str(self.config.get("create_asset_path", "{folder}.createasset.html"))
        url = f"{self.base_url}{template.format(folder=dam_folder)}"
        status, body = self._write(
            url,
            data=b"".join(parts),
            mime=f"multipart/form-data; boundary={boundary}",
            timeout=timeout,
        )
        if status not in (200, 201):
            raise AssetError(
                f"Upload of {name} to {dam_folder} failed (HTTP {status}): "
                f"{body[:200].decode('utf-8', 'replace')}", retryable=status in _RETRYABLE_STATUS
            )

    def exists(self, dam_path: str) -> bool:
        status, _ = self._request(f"{self.base_url}{dam_path}.json")
        if status not in (200, 404):
            raise AssetError(f"Cannot inspect asset {dam_path} (HTTP {status}).", retryable=status in _RETRYABLE_STATUS)
        return status == 200

    def matches(self, dam_path: str, checksum: str) -> bool:
        status, payload = self._request(f"{self.base_url}{dam_path}")
        if status != 200:
            raise AssetError(f"Cannot read asset {dam_path} (HTTP {status}).", retryable=status in _RETRYABLE_STATUS)
        return hashlib.sha256(payload).hexdigest() == checksum


def _declared_assets(
    settings: Settings, evidence_dir: Path, components: list[Mapping[str, Any]], *, attempt: int | None = None
) -> list[dict[str, Any]]:
    """Union of planner-declared and contribution-declared assets, deduplicated."""
    declared: dict[tuple[str, str], dict[str, Any]] = {}
    destinations: dict[str, str] = {}

    def add(entry: Any, owner: str) -> None:
        if not isinstance(entry, Mapping):
            raise AssetError(f"Invalid asset declaration from {owner}.")
        url = str(entry.get("source_url") or "").strip()
        source_file = entry.get("source_file")
        if source_file:
            if url:
                raise AssetError(f"Asset from {owner} must declare source_url or source_file, not both.")
            try:
                _inline_svg(settings, evidence_dir, entry)
            except AssetError as error:
                raise AssetError(f"Invalid inline SVG from {owner}: {error}", critical=error.critical) from error
            identity = "sha256:" + str(entry["sha256"])
        else:
            parsed = urllib.parse.urlparse(url)
            if not url or parsed.scheme not in ("http", "https") or not parsed.hostname:
                raise AssetError(f"Invalid asset source URL from {owner}; use an HTTP(S) URL or a captured SVG source_file.")
            identity = url
        dam_path = _dam_path(settings, entry)
        if source_file and not dam_path.lower().endswith(".svg"):
            raise AssetError(f"Inline SVG from {owner} requires a .svg DAM destination.")
        if dam_path in destinations and destinations[dam_path] != identity:
            previous = declared[(destinations[dam_path], dam_path)]["owners"]
            raise AssetDeclarationError(f"Different sources request the same DAM destination: {dam_path}", [*previous, owner], critical=True)
        destinations[dam_path] = identity
        combined = declared.setdefault(
            (identity, dam_path),
            {"source_url": url, "dam_path": dam_path, "owners": [],
               **{name: entry[name] for name in ("recovery_source", "recovery_sha256") if name in entry},
             **({"source_file": source_file, "sha256": entry["sha256"]} if source_file else {})},
        )
        combined["owners"].append(owner)
        if entry.get("recovery_source"):
            source = Path(entry["recovery_source"])
            source = source if source.is_absolute() else evidence_dir / source
            combined.setdefault("verified_recoveries", []).append(str(source.resolve()))

    for component in components:
        owner = str(component.get("id", "?"))
        try:
            entries = component.get("assets") or []
            path = latest_contribution_path(settings, evidence_dir, owner, attempt=attempt)
            if path is not None:
                data = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(data, Mapping) or data.get("component_id") != owner:
                    raise AssetError(f"Asset contribution identity does not match {owner}.")
                entries = data.get("assets", entries)
            if not isinstance(entries, list):
                raise AssetError(f"Asset declarations from {owner} must be a list.")
            for entry in entries:
                if isinstance(entry, Mapping) and entry.get("recovery_source"):
                    if path is None:
                        raise AssetError("Recovered SVGs must be supplied in the component's contribution file.")
                    candidate = Path(str(entry.get("source_file", "")))
                    _asset_path(candidate if candidate.is_absolute() else evidence_dir / candidate, path.parent)
                add(entry, owner)
        except AssetDeclarationError:
            raise
        except (AssetError, OSError, ValueError, TypeError) as error:
            raise AssetDeclarationError(str(error), [owner], critical=getattr(error, "critical", False)) from error

    return list(declared.values())


def validate_asset_declarations(settings: Settings, evidence_dir: Path, components: list[Mapping[str, Any]], *, attempt: int | None = None) -> None:
    entries = _declared_assets(settings, evidence_dir, components, attempt=attempt)
    for component in components:
        owner = str(component["id"])
        verified = {path for entry in entries if owner in entry["owners"] for path in entry.get("verified_recoveries", [])}
        for recovery in component.get("svg_recoveries", []):
            source = recovery.get("recovery_source")
            if not source:
                raise AssetDeclarationError(f"Required SVG {recovery['selector']} has no captured recovery evidence; do not substitute artwork.", [owner])
            source = Path(source)
            source = source if source.is_absolute() else evidence_dir / source
            if str(source.resolve()) not in verified:
                raise AssetDeclarationError(f"Required SVG recovery omitted for {recovery['selector']} at {recovery['breakpoint']}px; use its supplied recovery_source and screenshot.", [owner])


def _asset_path(path: Path, root: Path) -> Path:
    root = root.resolve()
    if ".." in path.parts or not path.resolve().is_relative_to(root):
        raise AssetError("Asset file must remain inside its evidence directory.", critical=True)
    for candidate in (path, *path.parents):
        if candidate.is_symlink() or (candidate.exists() and getattr(candidate.lstat(), "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)):
            raise AssetError("Asset evidence cannot use symbolic links or junctions.", critical=True)
        if candidate.resolve() == root:
            break
    return path.resolve()


def _captured_asset(settings: Settings, evidence_dir: Path, source_file: Any, checksum: Any, suffix: str) -> bytes:
    if not isinstance(source_file, str) or not source_file or not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise AssetError("source_file and its captured sha256 are required.")
    root = evidence_dir.resolve()
    source = Path(source_file)
    if ".." in source.parts:
        raise AssetError("SVG paths cannot traverse directories.", critical=True)
    source = source if source.is_absolute() else root / source
    resolved = _asset_path(source, root / "discovery")
    if resolved.suffix.lower() != suffix:
        raise AssetError(f"Captured SVG evidence must be a {suffix} file inside this run's discovery directory.", critical=True)
    try:
        limit = int(settings.migration.get("assets.max_bytes", 26_214_400))
        with resolved.open("rb") as stream:
            payload = stream.read(limit + 1)
        if not payload or len(payload) > limit:
            raise AssetError("SVG is empty or exceeds assets.max_bytes.")
        if hashlib.sha256(payload).hexdigest() != checksum:
            raise AssetError("SVG checksum differs from the captured sha256.", critical=True)
        manifest_path = next((parent / "manifest.json" for parent in resolved.parents
                              if parent.is_relative_to(root / "discovery") and (parent / "manifest.json").is_file()), None)
        if manifest_path is None:
            raise AssetError("SVG has no discovery manifest.")
        manifest_path = _asset_path(manifest_path, root / "discovery")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, Mapping) or not isinstance(manifest.get("artifacts"), list):
            raise AssetError("Invalid SVG discovery manifest.", critical=True)
        relative = resolved.relative_to(manifest_path.parent).as_posix()
        if not any(isinstance(item, Mapping) and item.get("path") == relative and item.get("sha256") == checksum
                   and item.get("bytes") == len(payload) for item in manifest.get("artifacts", [])):
            raise AssetError("SVG is not registered in its discovery manifest.", critical=True)
    except (OSError, UnicodeError, ValueError, TypeError) as error:
        raise AssetError(f"Cannot read captured SVG evidence: {error}") from error
    return payload


def _static_svg(payload: bytes) -> ElementTree.Element:
    try:
        text = payload.decode("utf-8")
        if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper() or "<?" in text:
            raise AssetError("SVG declarations, entities and processing instructions are not supported.", critical=True)
        svg = ElementTree.fromstring(text)
    except (UnicodeError, ValueError, ElementTree.ParseError) as error:
        raise AssetError(f"Cannot read captured SVG: {error}") from error
    namespace = "{http://www.w3.org/2000/svg}"
    elements = {"svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "use", "symbol",
                "clipPath", "mask", "linearGradient", "radialGradient", "stop", "title", "desc"}
    attributes = {"id", "viewBox", "preserveAspectRatio", "d", "points", "x", "y", "x1", "y1", "x2", "y2", "width", "height",
                  "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "transform", "fill", "fill-rule", "fill-opacity", "clip-rule",
                  "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
                  "stroke-dasharray", "stroke-dashoffset", "opacity", "color", "display", "visibility", "overflow",
                  "clip-path", "mask", "mask-type", "maskUnits", "maskContentUnits", "clipPathUnits", "gradientUnits",
                  "gradientTransform", "spreadMethod", "offset", "stop-color", "stop-opacity", "vector-effect", "shape-rendering", "href"}
    if svg.tag != namespace + "svg":
        raise AssetError("Captured file must have an SVG root and namespace.")
    identities = {element.get("id") for element in svg.iter() if element.get("id")}
    references = []
    for element in svg.iter():
        if element.tag not in {namespace + name for name in elements}:
            raise AssetError(f"Unsupported SVG element: {element.tag}")
        for name, value in element.attrib.items():
            local = "href" if name == "{http://www.w3.org/1999/xlink}href" else name
            if local not in attributes or "\\" in value or any(ord(character) < 32 and character not in "\t\r\n" for character in value):
                raise AssetError(f"Unsupported SVG attribute: {name}")
            if local == "href":
                if not value.startswith("#"):
                    raise AssetError("SVG external references are not supported.")
                references.append(value[1:])
            elif "url" in value.lower():
                match = re.fullmatch(r"url\(\s*['\"]?#([^\s'\"()]+)['\"]?\s*\)", value)
                if match is None:
                    raise AssetError("SVG external paint references are not supported.")
                references.append(match.group(1))
            elif any(token in value.lower() for token in ("var(", "javascript:", "data:", "http:", "https:")):
                raise AssetError("SVG must be self-contained static artwork.")
    if any(reference not in identities for reference in references):
        raise AssetError("SVG references a definition outside the captured image.")
    return svg


def _inline_svg(settings: Settings, evidence_dir: Path, entry: Mapping[str, Any]) -> bytes:
    if entry.get("recovery_source"):
        return _recovered_svg(settings, evidence_dir, entry)
    payload = _captured_asset(settings, evidence_dir, entry.get("source_file"), entry.get("sha256"), ".svg")
    _static_svg(payload)
    return payload


def _recovered_svg(settings: Settings, evidence_dir: Path, entry: Mapping[str, Any]) -> bytes:
    context_bytes = _captured_asset(settings, evidence_dir, entry.get("recovery_source"), entry.get("recovery_sha256"), ".json")
    try:
        context = json.loads(context_bytes)
        if not isinstance(context, dict) or context.get("schema_version") != 1 or not context.get("unsupported_styles"):
            raise ValueError("Missing captured SVG recovery context")
        if any(row.get("animation_name") != "none" for row in context["unsupported_styles"]):
            raise AssetError("Animated source SVGs cannot be certified by a static recovery.")
        original_text = context["original_svg"]
        if any(marker in original_text.upper() for marker in ("<!DOCTYPE", "<!ENTITY", "<?")):
            raise ValueError("Unsupported declarations in source SVG")
        original = ElementTree.fromstring(original_text)
        source = Path(entry["source_file"])
        source = _asset_path(source if source.is_absolute() else evidence_dir / source, evidence_dir / "agents")
        if source.suffix.lower() != ".svg":
            raise ValueError("Recovered asset must be an SVG")
        with source.open("rb") as stream:
            payload = stream.read(int(settings.migration.get("assets.max_bytes", 26_214_400)) + 1)
        if not payload or len(payload) > int(settings.migration.get("assets.max_bytes", 26_214_400)):
            raise ValueError("Recovered SVG is empty or exceeds assets.max_bytes")
        if hashlib.sha256(payload).hexdigest() != entry.get("sha256"):
            raise AssetError("Recovered SVG checksum differs from sha256.", critical=True)
        candidate = _static_svg(payload)
        geometry = {"d", "points", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "href",
                    "{http://www.w3.org/1999/xlink}href"}
        shapes = {"path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use"}

        def vectors(document: ElementTree.Element) -> list[Any]:
            return [(element.tag, sorted((name, value) for name, value in element.attrib.items() if name in geometry))
                    for element in document.iter() if element.tag.rsplit("}", 1)[-1] in shapes]

        if not vectors(original) or vectors(original) != vectors(candidate) or original.get("viewBox") != candidate.get("viewBox"):
            raise AssetError("SVG recovery must preserve the original vector geometry and viewBox; redrawing is not permitted.")
        reference = _captured_asset(settings, evidence_dir, context.get("source_image"), context.get("source_image_sha256"), ".png")
        with Image.open(BytesIO(reference)) as image:
            width, height = image.size
            if image.format != "PNG" or not 0 < width * height <= 16_000_000:
                raise ValueError("Invalid recovery reference screenshot")
        runtime = browser_paths(settings)
        verifier = Path(__file__).resolve().parents[1] / "tools/svg-recovery.mjs"
        revision = hashlib.sha256(b"".join(path.read_bytes() for path in (verifier, verifier.with_name("browser.mjs"), verifier.with_name("package-lock.json")))).hexdigest()
        identity = hashlib.sha256(context_bytes + payload + reference + revision.encode()).hexdigest()
        if identity not in _VERIFIED_SVG_RECOVERIES:
            node = shutil.which("node")
            if not node:
                raise AssetError("Node.js is required to verify recovered SVGs.")
            directory = _asset_path(evidence_dir / "assets/svg-recovery", evidence_dir)
            directory.mkdir(parents=True, exist_ok=True)
            output = Path(tempfile.mkdtemp(prefix=identity[:12] + "-", dir=directory))
            (output / "candidate.svg").write_bytes(payload)
            (output / "source.png").write_bytes(reference)
            inputs = output / "input.json"
            inputs.write_text(json.dumps({"schema_version": 1, "background": context.get("background"),
                                          "width": width, "height": height}), encoding="utf-8")
            completed = subprocess.run([node, str(verifier), str(inputs)], cwd=verifier.parent,
                                       env={**os.environ, **runtime.environment()}, capture_output=True, text=True,
                                       encoding="utf-8", errors="replace", timeout=60, check=False, shell=False)
            if completed.returncode:
                raise AssetError("SVG recovery verification failed: " + completed.stderr.strip()[:1000])
            result_path = output / "result.json"
            measured = json.loads(result_path.read_text(encoding="utf-8"))
            matched, total = measured.get("matched_pixels"), measured.get("total_pixels")
            if type(matched) is not int or type(total) is not int or total != width * height or not 0 <= matched <= total:
                raise ValueError("Invalid SVG recovery pixel measurements")
            if matched / total < 0.99:
                raise AssetError(f"SVG recovery visual match {matched / total:.4f} is below 0.99; inspect {result_path}")
            _VERIFIED_SVG_RECOVERIES.add(identity)
        return payload
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError, ElementTree.ParseError, subprocess.SubprocessError) as error:
        raise AssetError(f"Cannot verify recovered SVG: {error}") from error


def _dam_path(settings: Settings, entry: Mapping[str, Any]) -> str:
    configured = entry.get("dam_path")
    if configured:
        path = str(configured)
        if not path.startswith("/content/dam/") or any(part in ("", ".", "..") for part in path.split("/")[1:]) or any(character in path for character in "\\\r\n\"?#"):
            raise AssetError(f"Invalid DAM destination: {path}")
        return path
    root = str(settings.migration.require("assets.dam_root")).rstrip("/")
    if entry.get("source_file"):
        return _dam_path(settings, {"dam_path": f"{root}/{entry['sha256'][:12]}-inline.svg"})
    name = posixpath.basename(urllib.parse.urlparse(str(entry["source_url"])).path) or "asset"
    digest = hashlib.sha256(str(entry["source_url"]).encode("utf-8")).hexdigest()[:12]
    return _dam_path(settings, {"dam_path": f"{root}/{digest}-{name}"})


def _download(url: str, config: Mapping[str, Any]) -> tuple[bytes, str]:
    request = urllib.request.Request(  # noqa: S310 - scheme validated by the caller
        url, headers={"User-Agent": str(config.get("user_agent", "aem-migration-assets/1.0"))}
    )
    timeout = int(config.get("timeout_seconds", 60))
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            max_bytes = int(config.get("max_bytes", 26_214_400))
            payload = response.read(max_bytes + 1)
            mime = (response.headers.get("Content-Type") or "").split(";")[0].strip()
    except urllib.error.HTTPError as error:
        raise AssetError(f"download returned HTTP {error.code}", retryable=error.code in _RETRYABLE_STATUS) from error
    except (urllib.error.URLError, OSError, http.client.HTTPException) as error:
        raise AssetError(f"download failed: {error}", retryable=True) from error
    except ValueError as error:
        raise AssetError(f"invalid download request: {error}") from error

    if len(payload) > int(config.get("max_bytes", 26_214_400)):
        raise AssetError(f"exceeds assets.max_bytes ({config.get('max_bytes')} bytes)")
    if not payload:
        raise AssetError("empty response body")

    if not mime:
        mime = mimetypes.guess_type(url)[0] or "application/octet-stream"
    allowed = [str(prefix) for prefix in config.get("allowed_mime_prefixes", [])]
    if allowed and not any(mime.startswith(prefix) for prefix in allowed):
        raise AssetError(f"MIME {mime!r} is not in assets.allowed_mime_prefixes")
    return payload, mime


def _resolution_file(evidence_dir: Path, config: Mapping[str, Any]) -> Path:
    name = str(config.get("unresolved_file", "assets/unresolved-assets.json"))
    return _asset_path(evidence_dir / name, evidence_dir)


def _load_resolutions(path: Path) -> dict[str, dict[str, Any]]:
    if not path.is_file() or path.is_symlink():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = data["assets"] if isinstance(data, dict) else data
    except (OSError, ValueError, KeyError) as error:
        raise AssetError(f"Asset decisions file is not valid JSON: {path}", critical=True) from error
    if not isinstance(rows, list):
        raise AssetError(f"Asset decisions file must hold an 'assets' list: {path}", critical=True)
    return {str(row["dam_path"]): row for row in rows if isinstance(row, dict) and row.get("dam_path")}


def _supplied_payload(dam_path: str, value: str, config: Mapping[str, Any]) -> tuple[bytes, str]:
    path = Path(value).expanduser()
    if path.is_symlink() or not path.is_file():
        raise AssetError(f"local_file for {dam_path} is not a readable file: {value}")
    payload = path.read_bytes()
    if not payload:
        raise AssetError(f"local_file for {dam_path} is empty: {value}")
    if len(payload) > int(config.get("max_bytes", 26_214_400)):
        raise AssetError(f"local_file for {dam_path} exceeds assets.max_bytes")
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    allowed = [str(prefix) for prefix in config.get("allowed_mime_prefixes", [])]
    if allowed and not any(mime.startswith(prefix) for prefix in allowed):
        raise AssetError(f"local_file for {dam_path} has MIME {mime!r}, which is not in assets.allowed_mime_prefixes")
    return payload, mime


def _write_unresolved(path: Path, failed: list[AssetRecord]) -> None:
    """Leave the operator an editable record of what could not be fetched."""
    if not failed:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "how_to": [
            "These assets could not be downloaded or uploaded. Nothing else in the run is affected.",
            "Fix an entry by downloading the file yourself and setting 'local_file' to its absolute path,",
            "or correct 'source_url' if it is wrong; leave both untouched to simply retry the same request.",
            "Then resume the run; entries that succeed are removed from this file automatically.",
        ],
        "assets": [{
            "dam_path": record.dam_path,
            "source_url": record.source_url,
            "owners": record.owners,
            "failure": record.detail,
            "critical": record.critical,
            "local_file": "",
        } for record in failed],
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _cached_download(url: str, staging: Path, config: Mapping[str, Any]) -> tuple[bytes, str]:
    receipt = _asset_path(staging / (hashlib.sha256(url.encode("utf-8")).hexdigest() + ".json"), staging)
    if receipt.is_file() and not receipt.is_symlink():
        try:
            cached = json.loads(receipt.read_text(encoding="utf-8"))
            checksum = cached["sha256"]
            if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
                raise ValueError("Invalid cache checksum")
            local = _asset_path(staging / (checksum + ".bin"), staging)
            limit = int(config.get("max_bytes", 26_214_400))
            mime = cached["mime"]
            allowed = config.get("allowed_mime_prefixes", [])
            if cached["source_url"] == url and isinstance(mime, str) and (not allowed or any(mime.startswith(prefix) for prefix in allowed)) and local.is_file() and not local.is_symlink() and 0 < local.stat().st_size <= limit:
                payload = local.read_bytes()
                if hashlib.sha256(payload).hexdigest() == checksum:
                    return payload, mime
        except (OSError, ValueError, KeyError, TypeError):
            pass
    payload, mime = _retry(lambda: _download(url, config), config, "source download")
    checksum = hashlib.sha256(payload).hexdigest()
    _asset_path(staging / (checksum + ".bin"), staging).write_bytes(payload)
    receipt.write_text(json.dumps({"source_url": url, "sha256": checksum, "mime": mime}), encoding="utf-8")
    return payload, mime


def fetch_assets(
    settings: Settings,
    evidence_dir: Path,
    components: list[Mapping[str, Any]],
    base_url: str,
) -> AssetReport:
    """Download every declared asset once and upload it to AEM DAM."""
    migration = settings.migration
    config = migration.section("assets")
    report = AssetReport()

    entries = _declared_assets(settings, evidence_dir, components)
    credentials_env = str(migration.get("aem.credentials_env", "AEM_CREDENTIALS"))
    credentials = os.environ.get(credentials_env) or str(
        migration.get("aem.default_credentials", "")
    )
    if not credentials:
        raise AssetError(
            f"No AEM credentials. Set the {credentials_env} environment variable."
        )

    client = AemClient(base_url, credentials, config.get("upload", {}))
    staging = _asset_path(evidence_dir / str(config.get("staging_dir", "assets")), evidence_dir)
    staging.mkdir(parents=True, exist_ok=True)
    timeout = int(config.get("timeout_seconds", 60))
    downloads: dict[str, tuple[bytes, str, str, Path]] = {}
    unresolved = _resolution_file(evidence_dir, config)
    resolutions = _load_resolutions(unresolved)

    for entry in entries:
        url = str(entry["source_url"])
        source_file = str(entry.get("source_file", ""))
        identity = "sha256:" + entry["sha256"] if source_file else url
        dam_path = _dam_path(settings, entry)
        folder, name = posixpath.split(dam_path)
        record = AssetRecord(
            source_url=url, dam_path=dam_path, local_path="", mime="", bytes=0,
            sha256="", status="PENDING", source_file=source_file, owners=entry["owners"],
        )
        try:
            supplied = str(resolutions.get(dam_path, {}).get("local_file", "")).strip()
            if supplied:
                payload, mime = _supplied_payload(dam_path, supplied, config.data)
                digest = hashlib.sha256(payload).hexdigest()
                local = _asset_path(staging / (digest + (mimetypes.guess_extension(mime) or "")), staging)
                local.write_bytes(payload)
                record.supplied_from = supplied
            else:
                if identity not in downloads:
                    payload, mime = (_inline_svg(settings, evidence_dir, entry), "image/svg+xml") if source_file else _cached_download(url, staging, config.data)
                    digest = hashlib.sha256(payload).hexdigest()
                    local = _asset_path(staging / (digest + (mimetypes.guess_extension(mime) or "")), staging)
                    local.write_bytes(payload)
                    downloads[identity] = (payload, mime, digest, local)
                payload, mime, digest, local = downloads[identity]

            record.local_path = settings.relative_to_repo(local)
            record.mime = mime
            record.bytes = len(payload)
            record.sha256 = digest

            def transfer() -> bool:
                if client.exists(dam_path):
                    if not client.matches(dam_path, digest):
                        raise AssetError("DAM destination contains different bytes; refusing to overwrite existing content.", critical=True)
                    return False
                client.ensure_folder(folder)
                client.upload(folder, name, payload, mime, timeout)
                if not client.exists(dam_path) or not client.matches(dam_path, digest):
                    raise AssetError("Upload is not yet readable with the expected bytes.", retryable=True)
                return True

            uploaded = _retry(transfer, config.data, "DAM transfer")
            record.status = "UPLOADED" if uploaded else "SKIPPED"
            record.detail = "" if uploaded else "matching bytes already present in DAM"
            (report.uploaded if uploaded else report.skipped).append(record)
        except (AssetError, OSError, ValueError) as error:
            record.critical = bool(getattr(error, "critical", False))
            record.status = "FAILED" if record.critical else "BLOCKED"
            record.detail = str(error)
            report.failed.append(record)
            emit(f"  asset {record.status.lower()}: {', '.join(record.owners)}: {record.detail}", "yellow")

    manifest = _asset_path(evidence_dir / str(config.get("manifest_file", "assets/manifest.json")), evidence_dir)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    report.manifest_path = settings.relative_to_repo(manifest)
    manifest.write_text(
        json.dumps(report.to_dict(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    _write_unresolved(unresolved, report.failed)
    report.unresolved_path = settings.relative_to_repo(unresolved) if report.failed else None
    return report
