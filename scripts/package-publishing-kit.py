#!/usr/bin/env python3
"""Build the offline Chrome Web Store update kit for the existing item.

The extension archive must already have been built with ``npm run package``.
This builder verifies that archive against the current runtime files, refreshes
the embedded toolkit data, and creates a deterministic kit directory and ZIP.
Real browser screenshots are optional: when the local browser CI has produced
the expected PNGs they are validated and embedded; missing screenshots remain
missing rather than being invented.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import os
import re
import shlex
import shutil
import sys
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ARCHIVE_NAME = "browser-preference-switcher"
TOOLKIT_DATA_PATTERN = re.compile(
    r'(<script\s+id="toolkit-data"\s+type="application/json">)(.*?)(</script>)',
    re.DOTALL,
)
SCREENSHOTS = (
    ("accepted-1280x800.png", "Accepted popup screenshot"),
)


class BuildError(Exception):
    """An actionable publishing-kit build error."""


def _load_packager(root: Path):
    """Load the extension packager without making scripts a Python package."""

    module_path = root / "scripts" / "package-extension.py"
    spec = importlib.util.spec_from_file_location("browser_preference_packager", module_path)
    if spec is None or spec.loader is None:
        raise BuildError(f"could not load extension packager: {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _read(path: Path, label: str) -> bytes:
    try:
        data = path.read_bytes()
    except OSError as error:
        raise BuildError(f"{label} could not be read: {path}: {error}") from error
    if not data:
        raise BuildError(f"{label} is empty: {path}")
    return data


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _data_url(data: bytes, media_type: str) -> str:
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


def _load_toolkit(path: Path) -> tuple[str, dict]:
    html = _read(path, "publishing toolkit HTML").decode("utf-8")
    match = TOOLKIT_DATA_PATTERN.search(html)
    if match is None:
        raise BuildError(f'toolkit data script was not found in {path}')
    try:
        data = json.loads(match.group(2))
    except json.JSONDecodeError as error:
        raise BuildError(f"toolkit data is not valid JSON: {error}") from error
    if not isinstance(data, dict) or not isinstance(data.get("fields"), list):
        raise BuildError("toolkit data must contain a fields array")
    if not isinstance(data.get("assets"), dict):
        raise BuildError("toolkit data must contain an assets object")
    fields = data["fields"]
    ids = [field.get("id") for field in fields if isinstance(field, dict)]
    if len(ids) != len(fields) or any(not isinstance(field_id, str) for field_id in ids):
        raise BuildError("every toolkit field must have a string id")
    if len(set(ids)) != len(ids):
        raise BuildError("toolkit field ids must be unique")
    return html, data


def _set_field(data: dict, field_id: str, text: str, meta: str | None = None) -> None:
    for field in data["fields"]:
        if field["id"] == field_id:
            field["text"] = text
            if meta is not None:
                field["meta"] = meta
            return
    raise BuildError(f"toolkit field is missing: {field_id}")


def _refresh_toolkit_html(
    html: str,
    data: dict,
    *,
    root: Path,
    version: str,
    archive_path: Path,
    archive_data: bytes,
    digest: str,
    icon_data: bytes,
    screenshots: list[dict[str, str]],
) -> str:
    command = (
        "cd /path/to/browser-preference-switcher\n"
        "npm run ci && npm run package && python3 scripts/package-publishing-kit.py"
        f" && open {shlex.quote(os.path.relpath(archive_path.parent / f'publishing-kit-{version}' / 'index.html', root))}"
    )
    _set_field(data, "verify-command", command)
    _set_field(data, "zip-path", os.path.relpath(archive_path, root))
    _set_field(data, "screenshots-path", "store/screenshots")
    _set_field(
        data,
        "zip-checksum",
        digest,
        f"{len(archive_data):,} bytes · validated against current runtime files",
    )
    data["assets"] = {
        "zip": _data_url(archive_data, "application/zip"),
        "icon": _data_url(icon_data, "image/png"),
    }
    data["screenshots"] = screenshots

    match = TOOLKIT_DATA_PATTERN.search(html)
    if match is None:
        raise BuildError("toolkit data script disappeared while refreshing HTML")
    # Escape a closing script tag if a future copy field happens to contain it.
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return html[: match.start(2)] + payload + html[match.end(2) :]


def _validate_archive(packager, root: Path, archive_path: Path) -> tuple[str, bytes, str]:
    archive_data = _read(archive_path, "extension ZIP")
    try:
        manifest_raw, version = packager._validate_manifest(root)
        source_files = packager._validate_sources(root, manifest_raw)
    except packager.PackageError as error:
        raise BuildError(str(error)) from error
    expected = {relative: data for relative, _, data in source_files}
    try:
        with ZipFile(archive_path) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise BuildError("extension ZIP contains duplicate entries")
            if set(names) != set(expected):
                missing = sorted(set(expected) - set(names))
                extra = sorted(set(names) - set(expected))
                details = []
                if missing:
                    details.append(f"missing: {', '.join(missing)}")
                if extra:
                    details.append(f"unexpected: {', '.join(extra)}")
                raise BuildError("extension ZIP does not match its allowlist (" + "; ".join(details) + ")")
            for relative, expected_data in expected.items():
                actual = archive.read(relative)
                if actual != expected_data:
                    raise BuildError(f"extension ZIP entry differs from current source: {relative}")
    except BuildError:
        raise
    except OSError as error:
        raise BuildError(f"extension ZIP could not be inspected: {error}") from error
    except Exception as error:
        raise BuildError(f"extension ZIP is invalid: {error}") from error
    return version, archive_data, hashlib.sha256(archive_data).hexdigest()


def _collect_screenshots(packager, root: Path) -> list[dict[str, str]]:
    result = []
    directory = root / "store" / "screenshots"
    for name, label in SCREENSHOTS:
        path = directory / name
        if not path.exists():
            continue
        data = _read(path, f"screenshot {name}")
        try:
            packager._validate_png(data, (1280, 800), f"store/screenshots/{name}")
        except packager.PackageError as error:
            raise BuildError(str(error)) from error
        result.append({"name": name, "label": label, "dataUrl": _data_url(data, "image/png")})
    return result


def _copy_reference_docs(root: Path, staging: Path) -> None:
    files = [root / "PRIVACY.md", root / "docs" / "updating.md"]
    for source in files:
        if not source.is_file():
            raise BuildError(f"reference document is missing: {source}")
        if source == root / "PRIVACY.md":
            relative = Path("PRIVACY.md")
        else:
            relative = source.relative_to(root / "docs")
        _write(staging / "reference" / relative, _read(source, "reference document"))


def _write_deterministic_zip(source: Path, output: Path, root_name: str | None = None) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", prefix=f".{output.name}.", suffix=".tmp", dir=output.parent, delete=False
        ) as handle:
            temporary = Path(handle.name)
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for path in sorted(item for item in source.rglob("*") if item.is_file()):
                relative = path.relative_to(source).as_posix()
                if root_name is not None:
                    relative = f"{root_name}/{relative}"
                info = ZipInfo(relative)
                info.date_time = (1980, 1, 1, 0, 0, 0)
                info.compress_type = ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.internal_attr = 0
                archive.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
        os.replace(temporary, output)
        temporary = None
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def _start_here(version: str, archive_digest: str, screenshots: list[dict[str, str]]) -> str:
    screenshot_status = (
        "Current popup screenshot is embedded in the guide and included under screenshots/."
        if screenshots else
        "Capture a current popup screenshot with full local CI, then rebuild this kit."
    )
    return f"""BROWSER PREFERENCE SWITCHER — EXISTING-ITEM UPDATE KIT
Prepared update: {version}
Existing item ID: eakhhmacdkemcanhfnfjhfimimjecifa
Public listing:
https://chromewebstore.google.com/detail/browser-preference-switch/eakhhmacdkemcanhfnfjhfimimjecifa

Open index.html and follow its three steps:
1. Open the existing item and use Package > Upload new package.
   Upload extension/{ARCHIVE_NAME}-{version}.zip.
2. Refresh the changed description, popup screenshot, and reviewer instructions.
3. Save and submit the update for review.

The new package version must exceed the previously uploaded version.
The dashboard is authoritative for published and draft package versions.
{screenshot_status}

SHA-256: {archive_digest}
Do not upload this outer update-kit ZIP. Use the inner extension ZIP.
Copy-ready text is under copy/. Update notes are under reference/.
This kit does not access your account, upload files, or submit anything.
"""


def build(root: Path, toolkit_path: Path, dist_dir: Path) -> tuple[Path, Path, list[dict[str, str]]]:
    root = root.resolve()
    dist_dir = dist_dir.resolve()
    toolkit_path = toolkit_path.resolve()
    if not root.is_dir():
        raise BuildError(f"project root is not a directory: {root}")
    if toolkit_path.parent != root / "docs":
        raise BuildError(f"toolkit must be the project docs/publish-toolkit.html: {toolkit_path}")

    packager = _load_packager(root)
    # Read package metadata through the same validation used by package-extension.py,
    # then resolve the exact versioned archive path.
    try:
        _, version = packager._validate_manifest(root)
    except packager.PackageError as error:
        raise BuildError(str(error)) from error
    archive_path = dist_dir / f"{ARCHIVE_NAME}-{version}.zip"
    version, archive_data, digest = _validate_archive(packager, root, archive_path)
    html, data = _load_toolkit(toolkit_path)
    icon_data = _read(root / "icons" / "icon-128.png", "128 px store icon")
    try:
        packager._validate_png(icon_data, 128, "icons/icon-128.png")
    except packager.PackageError as error:
        raise BuildError(str(error)) from error
    screenshots = _collect_screenshots(packager, root)
    refreshed_html = _refresh_toolkit_html(
        html,
        data,
        root=root,
        version=version,
        archive_path=archive_path,
        archive_data=archive_data,
        digest=digest,
        icon_data=icon_data,
        screenshots=screenshots,
    )

    kit_name = f"publishing-kit-{version}"
    kit_dir = dist_dir / kit_name
    dist_dir.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{kit_name}-", dir=dist_dir))
    try:
        _write(staging / "index.html", refreshed_html.encode("utf-8"))
        _write(staging / "START-HERE.txt", _start_here(version, digest, screenshots).encode("utf-8"))
        _write(staging / "extension" / archive_path.name, archive_data)
        _write(staging / "extension" / "SHA256SUMS.txt", f"{digest}  {archive_path.name}\n".encode("ascii"))

        for screenshot in screenshots:
            screenshot_path = root / "store" / "screenshots" / screenshot["name"]
            _write(staging / "screenshots" / screenshot["name"], _read(screenshot_path, "screenshot"))

        for field in data["fields"]:
            field_id = field["id"]
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", field_id):
                raise BuildError(f"toolkit field id is unsafe for a filename: {field_id}")
            text = field.get("text")
            if not isinstance(text, str):
                raise BuildError(f"toolkit field text is not a string: {field_id}")
            _write(staging / "copy" / f"{field_id}.txt", (text.rstrip("\n") + "\n").encode("utf-8"))
        _copy_reference_docs(root, staging)

        if kit_dir.exists():
            shutil.rmtree(kit_dir)
        os.replace(staging, kit_dir)
        staging = None

        # Keep the source guide and the downloadable guide in sync. This happens
        # only after all package and asset validation has succeeded.
        temporary_html = toolkit_path.with_name(f".{toolkit_path.name}.tmp")
        temporary_html.write_text(refreshed_html, encoding="utf-8")
        os.replace(temporary_html, toolkit_path)

        outer_zip = dist_dir / f"{ARCHIVE_NAME}-publishing-kit-{version}.zip"
        _write_deterministic_zip(kit_dir, outer_zip, root_name=kit_name)
        return kit_dir, outer_zip, screenshots
    finally:
        if staging is not None and staging.exists():
            shutil.rmtree(staging)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist-dir", type=Path, help="release output directory (default: project root/dist)")
    parser.add_argument(
        "--toolkit", type=Path, help="source toolkit HTML (default: project root/docs/publish-toolkit.html)"
    )
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[1]
    dist_dir = args.dist_dir if args.dist_dir is not None else root / "dist"
    toolkit = args.toolkit if args.toolkit is not None else root / "docs" / "publish-toolkit.html"
    try:
        kit_dir, outer_zip, screenshots = build(root, toolkit, dist_dir)
    except (BuildError, OSError, ValueError) as error:
        print(f"Publishing-kit build failed: {error}", file=sys.stderr)
        return 1
    print(f"Created {kit_dir}")
    print(f"Created {outer_zip}")
    print(f"Embedded screenshots: {len(screenshots)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
