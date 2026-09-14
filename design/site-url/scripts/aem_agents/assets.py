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
import json
import mimetypes
import os
import posixpath
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from .config import Settings
from .merge import latest_contribution_path


class AssetError(RuntimeError):
    """Raised when an asset cannot be fetched or uploaded."""


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

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class AssetReport:
    uploaded: list[AssetRecord] = field(default_factory=list)
    skipped: list[AssetRecord] = field(default_factory=list)
    failed: list[AssetRecord] = field(default_factory=list)
    manifest_path: str | None = None

    @property
    def ok(self) -> bool:
        return not self.failed

    def to_dict(self) -> dict[str, Any]:
        return {
            "uploaded": [record.to_dict() for record in self.uploaded],
            "skipped": [record.to_dict() for record in self.skipped],
            "failed": [record.to_dict() for record in self.failed],
            "manifest": self.manifest_path,
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
        except (urllib.error.URLError, OSError, ValueError) as error:
            raise AssetError(f"AEM {method} request failed: {error}") from error

    def csrf_token(self) -> str:
        """AEM rejects writes without both a CSRF token and a Referer header."""
        if self._csrf:
            return self._csrf
        path = str(self.config.get("csrf_token_path", "/libs/granite/csrf/token.json"))
        status, body = self._request(f"{self.base_url}{path}")
        if status != 200:
            raise AssetError(f"Could not fetch a CSRF token from {path} (HTTP {status}).")
        try:
            self._csrf = str(json.loads(body.decode("utf-8"))["token"])
        except (ValueError, KeyError, TypeError) as error:
            raise AssetError("AEM returned an invalid CSRF response.") from error
        if not self._csrf:
            raise AssetError("AEM returned an empty CSRF token.")
        return self._csrf

    def ensure_folder(self, dam_folder: str) -> None:
        """Create each missing segment; an upload into a missing folder 404s."""
        segments = [segment for segment in dam_folder.strip("/").split("/") if segment]
        current = ""
        for segment in segments:
            parent, current = current, f"{current}/{segment}"
            status, _ = self._request(f"{self.base_url}{current}.json")
            if status == 200:
                continue
            body = urllib.parse.urlencode(
                {":name": segment, "jcr:primaryType": "sling:Folder"}
            ).encode("utf-8")
            status, _ = self._request(
                f"{self.base_url}{parent}/*",
                method="POST",
                data=body,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "CSRF-Token": self.csrf_token(),
                },
            )
            if status not in (200, 201):
                raise AssetError(f"Could not create DAM folder {current} (HTTP {status}).")

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
        status, body = self._request(
            url,
            method="POST",
            data=b"".join(parts),
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "CSRF-Token": self.csrf_token(),
            },
            timeout=timeout,
        )
        if status not in (200, 201):
            raise AssetError(
                f"Upload of {name} to {dam_folder} failed (HTTP {status}): "
                f"{body[:200].decode('utf-8', 'replace')}"
            )

    def exists(self, dam_path: str) -> bool:
        status, _ = self._request(f"{self.base_url}{dam_path}.json")
        return status == 200


def _declared_assets(
    settings: Settings, evidence_dir: Path, components: list[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """Union of planner-declared and contribution-declared assets, deduplicated."""
    declared: dict[tuple[str, str], dict[str, Any]] = {}
    destinations: dict[str, str] = {}

    def add(entry: Any, owner: str) -> None:
        if not isinstance(entry, Mapping):
            raise AssetError(f"Invalid asset declaration from {owner}.")
        url = str(entry.get("source_url") or "").strip()
        if not url or urllib.parse.urlparse(url).scheme not in ("http", "https"):
            raise AssetError(f"Invalid asset source URL from {owner}.")
        dam_path = _dam_path(settings, entry)
        if dam_path in destinations and destinations[dam_path] != url:
            raise AssetError(f"Different sources request the same DAM destination: {dam_path}")
        destinations[dam_path] = url
        declared.setdefault(
            (url, dam_path),
            {"source_url": url, "dam_path": dam_path, "owners": []},
        )["owners"].append(owner)

    for component in components:
        owner = str(component.get("id", "?"))
        entries = component.get("assets") or []
        path = latest_contribution_path(settings, evidence_dir, owner)
        if path is not None:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                raise AssetError(f"Could not read current asset declarations: {path}") from error
            if not isinstance(data, Mapping) or data.get("component_id") != owner:
                raise AssetError(f"Asset contribution identity does not match {owner}.")
            entries = data.get("assets", entries)
        if not isinstance(entries, list):
            raise AssetError(f"Asset declarations from {owner} must be a list.")
        for entry in entries:
            add(entry, owner)

    return list(declared.values())


def _dam_path(settings: Settings, entry: Mapping[str, Any]) -> str:
    configured = entry.get("dam_path")
    if configured:
        path = str(configured)
        if not path.startswith("/content/dam/") or any(part in ("", ".", "..") for part in path.split("/")[1:]) or any(character in path for character in "\\\r\n\"?#"):
            raise AssetError(f"Invalid DAM destination: {path}")
        return path
    root = str(settings.migration.require("assets.dam_root")).rstrip("/")
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
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise AssetError(f"download failed: {error}") from error

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
    staging = evidence_dir / str(config.get("staging_dir", "assets"))
    staging.mkdir(parents=True, exist_ok=True)
    timeout = int(config.get("timeout_seconds", 60))
    downloads: dict[str, tuple[bytes, str, str, Path]] = {}

    for entry in entries:
        url = str(entry["source_url"])
        dam_path = _dam_path(settings, entry)
        folder, name = posixpath.split(dam_path)
        record = AssetRecord(
            source_url=url, dam_path=dam_path, local_path="", mime="", bytes=0,
            sha256="", status="PENDING",
        )
        try:
            if url not in downloads:
                payload, mime = _download(url, config.data)
                digest = hashlib.sha256(payload).hexdigest()
                local = staging / (digest + (mimetypes.guess_extension(mime) or ""))
                local.write_bytes(payload)
                downloads[url] = (payload, mime, digest, local)
            payload, mime, digest, local = downloads[url]

            record.local_path = settings.relative_to_repo(local)
            record.mime = mime
            record.bytes = len(payload)
            record.sha256 = digest

            if client.exists(dam_path):
                record.status = "SKIPPED"
                record.detail = "already present in DAM"
                report.skipped.append(record)
                continue

            client.ensure_folder(folder)
            client.upload(folder, name, payload, mime, timeout)
            if not client.exists(dam_path):
                raise AssetError("upload reported success but the asset is not readable")
            record.status = "UPLOADED"
            report.uploaded.append(record)
        except (AssetError, OSError, ValueError) as error:
            record.status = "FAILED"
            record.detail = str(error)
            report.failed.append(record)

    manifest = evidence_dir / str(config.get("manifest_file", "assets/manifest.json"))
    manifest.parent.mkdir(parents=True, exist_ok=True)
    report.manifest_path = settings.relative_to_repo(manifest)
    manifest.write_text(
        json.dumps(report.to_dict(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return report
