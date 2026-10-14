#!/usr/bin/env python3
"""Build a deterministic, Chrome Web Store ready extension archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import struct
import sys
import tempfile
import zlib
from pathlib import Path, PurePosixPath, PureWindowsPath
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ARCHIVE_NAME = "browser-preference-switcher"
ICON_SIZES = (16, 32, 48, 128)
ARCHIVE_FILES = (
    "manifest.json",
    "background.js",
    "popup.html",
    "popup.js",
    "popup.css",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
)
RESOURCE_KEYS = {
    "service_worker",
    "default_popup",
    "default_path",
    "default_icon",
    "icons",
    "js",
    "css",
    "resources",
    "options_page",
    "page",
    "pages",
    "devtools_page",
    "chrome_url_overrides",
}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class PackageError(Exception):
    """A user-actionable packaging validation error."""


def _inside(root: Path, candidate: Path) -> bool:
    try:
        return os.path.commonpath((str(root), str(candidate))) == str(root)
    except ValueError:
        return False


def _read_file(root: Path, relative: str, label: str) -> tuple[Path, bytes]:
    if not isinstance(relative, str) or not relative or "\x00" in relative:
        raise PackageError(f"{label} must be a non-empty relative file path")
    if relative.startswith("/") or PureWindowsPath(relative).drive or "\\" in relative:
        raise PackageError(f"{label} must be a relative project path: {relative}")
    if ".." in PurePosixPath(relative).parts:
        raise PackageError(f"{label} must stay inside the project: {relative}")

    source = root.joinpath(*relative.split("/"))
    try:
        resolved = source.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise PackageError(f"{label} is missing: {relative}") from error
    if not _inside(root, resolved):
        raise PackageError(f"{label} resolves outside the project: {relative}")
    if not resolved.is_file():
        raise PackageError(f"{label} is not a file: {relative}")
    try:
        return resolved, resolved.read_bytes()
    except OSError as error:
        raise PackageError(f"{label} could not be read: {relative}") from error


def _json_file(root: Path, relative: str, label: str) -> tuple[dict, bytes]:
    _, raw = _read_file(root, relative, label)
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PackageError(f"{label} is not valid UTF-8 JSON: {error}") from error
    if not isinstance(value, dict):
        raise PackageError(f"{label} must contain a JSON object")
    return value, raw


def _resource_values(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _resource_values(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _resource_values(item)


def _manifest_resources(manifest: dict):
    references = []

    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in RESOURCE_KEYS:
                    references.extend(_resource_values(child))
                else:
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(manifest)
    return references


def _validate_png(data: bytes, expected_size: int, label: str) -> None:
    if not data.startswith(PNG_SIGNATURE):
        raise PackageError(f"{label} is not a PNG file")

    offset = len(PNG_SIGNATURE)
    saw_ihdr = False
    saw_idat = False
    saw_iend = False
    idat_payload = bytearray()
    width = height = bit_depth = color_type = interlace = None
    palette_seen = False
    chunks_seen = set()

    while offset < len(data):
        if len(data) - offset < 12:
            raise PackageError(f"{label} has a truncated PNG chunk")
        length = struct.unpack_from(">I", data, offset)[0]
        chunk_type = data[offset + 4 : offset + 8]
        if not all(65 <= byte <= 90 or 97 <= byte <= 122 for byte in chunk_type):
            raise PackageError(f"{label} has an invalid PNG chunk type")
        end = offset + 12 + length
        if end > len(data):
            raise PackageError(f"{label} has a truncated PNG chunk")
        chunk_data = data[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack_from(">I", data, offset + 8 + length)[0]
        actual_crc = zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF
        if actual_crc != expected_crc:
            raise PackageError(f"{label} has an invalid PNG chunk CRC")

        if chunk_type == b"IHDR":
            if saw_ihdr or length != 13:
                raise PackageError(f"{label} has an invalid PNG IHDR")
            if offset != len(PNG_SIGNATURE):
                raise PackageError(f"{label} must start with an IHDR chunk")
            width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(
                ">IIBBBBB", chunk_data
            )
            if width != expected_size or height != expected_size:
                raise PackageError(
                    f"{label} must be {expected_size}x{expected_size} (got {width}x{height})"
                )
            allowed_depths = {
                0: {1, 2, 4, 8, 16},
                2: {8, 16},
                3: {1, 2, 4, 8},
                4: {8, 16},
                6: {8, 16},
            }
            if color_type not in allowed_depths or bit_depth not in allowed_depths[color_type]:
                raise PackageError(f"{label} has an invalid PNG color type or bit depth")
            if compression != 0 or filter_method != 0 or interlace not in (0, 1):
                raise PackageError(f"{label} has unsupported PNG encoding parameters")
            saw_ihdr = True
        elif not saw_ihdr:
            raise PackageError(f"{label} must start with an IHDR chunk")
        elif chunk_type == b"PLTE":
            if saw_idat or not (3 <= length <= 768) or length % 3:
                raise PackageError(f"{label} has an invalid PNG palette")
            palette_seen = True
        elif chunk_type == b"IDAT":
            if length == 0:
                raise PackageError(f"{label} has an empty PNG IDAT chunk")
            saw_idat = True
            idat_payload.extend(chunk_data)
        elif chunk_type == b"IEND":
            if length != 0:
                raise PackageError(f"{label} has an invalid PNG IEND chunk")
            saw_iend = True
            offset = end
            break

        if chunk_type == b"IHDR" and b"IHDR" in chunks_seen:
            raise PackageError(f"{label} has multiple PNG IHDR chunks")
        chunks_seen.add(chunk_type)
        offset = end

    if not saw_ihdr or not saw_idat or not saw_iend or offset != len(data):
        raise PackageError(f"{label} is incomplete or has trailing PNG data")
    if color_type == 3 and not palette_seen:
        raise PackageError(f"{label} indexed PNG is missing a palette")
    try:
        decompressor = zlib.decompressobj()
        decoded = decompressor.decompress(bytes(idat_payload))
        decoded += decompressor.flush()
    except zlib.error as error:
        raise PackageError(f"{label} contains invalid PNG image data") from error
    if not decompressor.eof or decompressor.unused_data:
        raise PackageError(f"{label} contains invalid PNG image data")
    if interlace == 0:
        bits_per_pixel = {
            0: bit_depth,
            2: bit_depth * 3,
            3: bit_depth,
            4: bit_depth * 2,
            6: bit_depth * 4,
        }[color_type]
        row_bytes = (width * bits_per_pixel + 7) // 8
        expected_decoded_size = (row_bytes + 1) * height
        if len(decoded) != expected_decoded_size:
            raise PackageError(f"{label} has invalid PNG scanline data")


def _validate_manifest(root: Path) -> tuple[bytes, str]:
    package, _ = _json_file(root, "package.json", "package.json")
    manifest, manifest_raw = _json_file(root, "manifest.json", "manifest.json")
    package_version = package.get("version")
    manifest_version = manifest.get("version")
    if not isinstance(package_version, str) or not package_version:
        raise PackageError("package.json version is required")
    if not isinstance(manifest_version, str) or not manifest_version:
        raise PackageError("manifest.json version is required")
    if package_version != manifest_version:
        raise PackageError(
            f"package.json and manifest.json versions differ ({package_version} != {manifest_version})"
        )
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]*", package_version):
        raise PackageError(f"version is unsafe for an archive filename: {package_version}")
    if manifest.get("manifest_version") != 3:
        raise PackageError("manifest.json must use manifest_version 3")

    background = manifest.get("background")
    if not isinstance(background, dict) or background.get("service_worker") != "background.js":
        raise PackageError("manifest background.service_worker must be background.js")
    action = manifest.get("action")
    if not isinstance(action, dict) or action.get("default_popup") != "popup.html":
        raise PackageError("manifest action.default_popup must be popup.html")

    for reference in _manifest_resources(manifest):
        if reference not in ARCHIVE_FILES:
            raise PackageError(f"manifest resource is outside the package allowlist: {reference}")
        _read_file(root, reference, "manifest resource")
    return manifest_raw, package_version


def _validate_sources(root: Path, manifest_raw: bytes):
    files = [("manifest.json", root / "manifest.json", manifest_raw)]
    for relative in ARCHIVE_FILES[1:]:
        resolved, data = _read_file(root, relative, "package resource")
        files.append((relative, resolved, data))

    for size in ICON_SIZES:
        relative = f"icons/icon-{size}.png"
        data = next(item[2] for item in files if item[0] == relative)
        _validate_png(data, size, relative)
    return files


def _write_archive(output: Path, files) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", prefix=f".{output.name}.", suffix=".tmp", dir=output.parent, delete=False
        ) as handle:
            temporary = Path(handle.name)
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for relative, _, data in files:
                info = ZipInfo(relative)
                info.date_time = (1980, 1, 1, 0, 0, 0)
                info.compress_type = ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.internal_attr = 0
                archive.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)
        os.replace(temporary, output)
        temporary = None
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def build(root: Path, output_dir: Path) -> tuple[Path, str]:
    root = root.resolve()
    if not root.is_dir():
        raise PackageError(f"project root is not a directory: {root}")
    manifest_raw, version = _validate_manifest(root)
    files = _validate_sources(root, manifest_raw)
    output = output_dir.resolve() / f"{ARCHIVE_NAME}-{version}.zip"
    _write_archive(output, files)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    return output, digest


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="directory for the archive (default: project root/dist)",
    )
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[1]
    output_dir = args.output_dir if args.output_dir is not None else root / "dist"
    try:
        output, digest = build(root, output_dir)
    except (PackageError, OSError) as error:
        print(f"Packaging failed: {error}", file=sys.stderr)
        return 1
    print(f"Created {output}")
    print(f"SHA256: {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
