const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const zlib = require("node:zlib");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const packageScript = path.join(projectRoot, "scripts", "package-extension.py");
const archiveNames = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png"
];

test("committed publishing guide embeds the current validated upload archive", () => {
  const script = [
    "import base64, hashlib, io, json, re, sys, zipfile",
    "from pathlib import Path",
    "root = Path(sys.argv[1])",
    "html = (root / 'docs/publish-toolkit.html').read_text()",
    "data = json.loads(re.search(r'<script id=\"toolkit-data\" type=\"application/json\">(.*?)</script>', html, re.S).group(1))",
    "raw = base64.b64decode(data['assets']['zip'].split(',', 1)[1], validate=True)",
    "fields = {f['id']: f['text'] for f in data['fields']}",
    "assert hashlib.sha256(raw).hexdigest() == fields['zip-checksum']",
    "with zipfile.ZipFile(io.BytesIO(raw)) as archive:",
    " assert archive.testzip() is None",
    " assert json.loads(archive.read('manifest.json')) == json.loads((root / 'manifest.json').read_text())",
    " for name in archive.namelist(): assert archive.read(name) == (root / name).read_bytes(), name",
    "assert fields['zip-path'] == 'dist/browser-preference-switcher-' + json.loads((root / 'manifest.json').read_text())['version'] + '.zip'",
    "import importlib.util",
    "spec = importlib.util.spec_from_file_location('kit', root / 'scripts/package-publishing-kit.py')",
    "module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)",
    "for folder in [root / 'release', root.parent / 'external-output']:",
    " archive_path = folder / 'browser-preference-switcher-0.1.3.zip'",
    " refreshed = module._refresh_toolkit_html(html, json.loads(json.dumps(data)), root=root, version='0.1.3', archive_path=archive_path, archive_data=raw, digest=hashlib.sha256(raw).hexdigest(), icon_data=b'icon', screenshots=[])",
    " refreshed_data = json.loads(re.search(r'<script id=\"toolkit-data\" type=\"application/json\">(.*?)</script>', refreshed, re.S).group(1))",
    " refreshed_fields = {f['id']: f['text'] for f in refreshed_data['fields']}",
    " assert (root / refreshed_fields['zip-path']).resolve() == archive_path.resolve()",
    " assert refreshed_fields['verify-command'].endswith(' && open dist/publishing-kit-0.1.3/index.html')",
    " assert 'npm run ci && npm run package && python3 scripts/package-publishing-kit.py' in refreshed_fields['verify-command']"
  ].join("\n");
  const result = spawnSync("python3", ["-c", script, projectRoot], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

let crcTable;
function crc32(value) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let item = index;
      for (let bit = 0; bit < 8; bit++) item = (item & 1) ? (0xedb88320 ^ (item >>> 1)) : (item >>> 1);
      return item >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of value) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, body, { corruptCrc = false } = {}) {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + body.length);
  output.writeUInt32BE(body.length, 0);
  typeBytes.copy(output, 4);
  body.copy(output, 8);
  output.writeUInt32BE((crc32(Buffer.concat([typeBytes, body])) ^ (corruptCrc ? 1 : 0)) >>> 0, 8 + body.length);
  return output;
}

function fakePng(width, height, options = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  const end = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr, options),
    pngChunk("IDAT", zlib.deflateSync(scanlines)),
    end
  ]);
}

function createFixture({ version = "0.1.1", manifestChanges = {}, extraFiles = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-preference-switcher-package-"));
  const icons = path.join(root, "icons");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(icons);
  fs.copyFileSync(packageScript, path.join(root, "scripts", "package-extension.py"));

  const iconPaths = Object.fromEntries([16, 32, 48, 128].map(size => [`${size}`, `icons/icon-${size}.png`]));
  const manifest = {
    manifest_version: 3,
    name: "Browser Preference Switcher",
    version,
    background: { service_worker: "background.js" },
    action: { default_popup: "popup.html", default_icon: iconPaths },
    icons: iconPaths,
    ...manifestChanges
  };
  const files = {
    "package.json": JSON.stringify({ name: "browser-preference-switcher", version }),
    "manifest.json": JSON.stringify(manifest),
    "background.js": "globalThis.background = true;\n",
    "popup.html": "<!doctype html><title>Browser Preference Switcher</title>\n",
    "popup.js": "globalThis.popup = true;\n",
    "popup.css": "body { margin: 0; }\n",
    "tests/fixture-secret.txt": "must never ship\n",
    "scripts/development-note.txt": "must never ship\n",
    ...extraFiles
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  for (const size of [16, 32, 48, 128]) fs.writeFileSync(path.join(icons, `icon-${size}.png`), fakePng(size, size));

  const outputDir = path.join(root, "dist");
  return {
    root,
    outputDir,
    archive: path.join(outputDir, `browser-preference-switcher-${version}.zip`),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  };
}

function runPackage(fixture) {
  return spawnSync("python3", [path.join(fixture.root, "scripts", "package-extension.py"), "--output-dir", fixture.outputDir], {
    cwd: fixture.root,
    encoding: "utf8"
  });
}

function readZip(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 6) & 0x08, 0, "archive must not use data descriptors");
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const modTime = buffer.readUInt16LE(offset + 10);
    const modDate = buffer.readUInt16LE(offset + 12);
    const crc = buffer.readUInt32LE(offset + 14);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed);
    assert.equal(method, 8, `${name} should use deflate`);
    assert.equal(flags & 0x08, 0, `${name} must not use data descriptors`);
    assert.equal(data.length, uncompressedSize, `${name} has the wrong uncompressed size`);
    assert.equal(crc32(data), crc, `${name} has the wrong CRC`);
    entries.push({ name, data, modTime, modDate });
    offset = dataStart + compressedSize;
  }
  const centralNames = [];
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x02014b50) {
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    centralNames.push(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x06054b50, "archive must end with an end-of-directory record");
  assert.equal(buffer.readUInt16LE(offset + 8), entries.length, "central directory entry count must match local entries");
  assert.deepEqual(centralNames, entries.map(entry => entry.name));
  assert.equal(offset + 22 + buffer.readUInt16LE(offset + 20), buffer.length, "archive must not contain trailing data");
  return entries;
}

test("packages the exact allowlist with fixed metadata and deterministic bytes", t => {
  const fixture = createFixture({ extraFiles: { "README.md": "development only\n" } });
  t.after(fixture.cleanup);

  const first = runPackage(fixture);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /SHA256: [0-9a-f]{64}/);
  const firstArchive = fs.readFileSync(fixture.archive);
  const entries = readZip(firstArchive);
  assert.deepEqual(entries.map(entry => entry.name), archiveNames);
  assert(entries.every(entry => entry.modTime === 0 && entry.modDate === 33), "entries must use the DOS epoch");
  assert.equal(entries.find(entry => entry.name === "manifest.json").data.toString(), fs.readFileSync(path.join(fixture.root, "manifest.json"), "utf8"));
  assert.equal(entries.find(entry => entry.name === "background.js").data.toString(), fs.readFileSync(path.join(fixture.root, "background.js"), "utf8"));
  assert.equal(entries.some(entry => entry.name.includes("tests/") || entry.name.includes("scripts/")), false);

  const second = runPackage(fixture);
  assert.equal(second.status, 0, second.stderr);
  const secondArchive = fs.readFileSync(fixture.archive);
  assert.deepEqual(secondArchive, firstArchive, "repeated packaging must produce identical bytes");
  const digest = crypto.createHash("sha256").update(firstArchive).digest("hex");
  assert.match(first.stdout, new RegExp(`SHA256: ${digest}`));
});

test("rejects version mismatches and preserves an existing archive", t => {
  const fixture = createFixture({ version: "0.1.2", manifestChanges: { version: "0.1.1" } });
  t.after(fixture.cleanup);
  fs.mkdirSync(fixture.outputDir, { recursive: true });
  fs.writeFileSync(fixture.archive, "previous archive\n");

  const result = runPackage(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /versions differ/);
  assert.equal(fs.readFileSync(fixture.archive, "utf8"), "previous archive\n");
  assert.deepEqual(fs.readdirSync(fixture.outputDir), [path.basename(fixture.archive)]);
});

test("rejects incomplete PNGs and missing assets without creating a partial archive", t => {
  const fixture = createFixture();
  t.after(fixture.cleanup);
  fs.mkdirSync(fixture.outputDir, { recursive: true });
  fs.writeFileSync(fixture.archive, "previous archive\n");
  const icon = path.join(fixture.root, "icons/icon-16.png");
  const invalid = fakePng(16, 16, { corruptCrc: true });
  fs.writeFileSync(icon, invalid);

  const invalidResult = runPackage(fixture);
  assert.equal(invalidResult.status, 1);
  assert.match(invalidResult.stderr, /invalid PNG chunk CRC/);
  assert.equal(fs.readFileSync(fixture.archive, "utf8"), "previous archive\n");

  fs.writeFileSync(icon, fakePng(16, 16));
  fs.unlinkSync(path.join(fixture.root, "icons/icon-128.png"));
  const missingResult = runPackage(fixture);
  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /is missing/);
  assert.equal(fs.readFileSync(fixture.archive, "utf8"), "previous archive\n");
});

test("rejects a resource symlink that escapes the project", t => {
  const fixture = createFixture();
  t.after(fixture.cleanup);
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "browser-preference-switcher-outside-")), "icon.png");
  t.after(() => fs.rmSync(path.dirname(outside), { recursive: true, force: true }));
  fs.writeFileSync(outside, fakePng(16, 16));
  fs.unlinkSync(path.join(fixture.root, "icons/icon-16.png"));
  try {
    fs.symlinkSync(outside, path.join(fixture.root, "icons/icon-16.png"));
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.message}`);
    return;
  }

  const result = runPackage(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /resolves outside the project/);
  assert.equal(fs.existsSync(fixture.archive), false);
});

test("rectangular screenshot validation accepts store dimensions and rejects corrupt or incomplete PNGs", t => {
  const fixture = createFixture();
  t.after(fixture.cleanup);
  const screenshot = path.join(fixture.root, "screenshot-test-fixture.png");
  const validation = [
    "import importlib.util, sys",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('packager', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "module._validate_png(Path(sys.argv[2]).read_bytes(), (1280, 800), 'test screenshot')"
  ].join("\n");
  const check = bytes => {
    fs.writeFileSync(screenshot, bytes);
    return spawnSync("python3", ["-c", validation, packageScript, screenshot], { encoding: "utf8" });
  };
  assert.equal(check(fakePng(1280, 800)).status, 0);
  assert.notEqual(check(fakePng(1280, 1280)).status, 0);
  assert.notEqual(check(fakePng(1280, 800, { corruptCrc: true })).status, 0);
  assert.notEqual(check(fakePng(1280, 800).subarray(0, 33)).status, 0);
});
