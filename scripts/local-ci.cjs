const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const sourcePattern = /\.(?:js|cjs|mjs)$/;
const testPattern = /\.test\.(?:js|cjs|mjs)$/;

function isSupportedNode(version = process.versions.node) {
  const match = /^(?:v)?(\d+)/.exec(String(version));
  return Boolean(match && Number(match[1]) >= 18);
}

function run(command, args, label, options = {}) {
  const result = (options.spawnSync || spawnSync)(command, args, {
    cwd: options.cwd,
    stdio: options.stdio || "inherit",
    encoding: options.encoding,
    env: options.env
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.signal) throw new Error(`${label} was terminated by ${result.signal}.`);
  if (result.status !== 0) {
    const outcome = result.status === null || result.status === undefined ? "without an exit status" : `with exit code ${result.status}`;
    throw new Error(`${label} failed ${outcome}.`);
  }
  return result;
}

function captured(command, args, label, options = {}) {
  const result = (options.spawnSync || spawnSync)(command, args, {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: options.encoding === undefined ? "utf8" : options.encoding,
    env: options.env
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.signal) throw new Error(`${label} was terminated by ${result.signal}.`);
  return result;
}

function output(result) {
  return [result.stdout, result.stderr].filter(value => value !== undefined && value !== null)
    .map(value => Buffer.isBuffer(value) ? value.toString("utf8") : String(value)).join("");
}

function inside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resource(rootDirectory, value, label) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error(`${label} must be a non-empty relative path inside the project`);
  }
  if (value.replaceAll("\\", "/").split("/").includes("..")) throw new Error(`${label} must stay inside the project: ${value}`);
  const resolved = path.resolve(rootDirectory, value);
  if (!inside(rootDirectory, resolved)) throw new Error(`${label} must stay inside the project: ${value}`);
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(rootDirectory);
    realFile = fs.realpathSync(resolved);
  } catch (error) {
    throw new Error(`${label} is missing: ${value}`);
  }
  if (!inside(realRoot, realFile)) throw new Error(`${label} resolves outside the project: ${value}`);
  if (!fs.statSync(realFile).isFile()) throw new Error(`${label} is not a file: ${value}`);
}

function validateManifest(rootDirectory) {
  let manifest;
  let metadata;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(rootDirectory, "manifest.json"), "utf8"));
    metadata = JSON.parse(fs.readFileSync(path.join(rootDirectory, "package.json"), "utf8"));
  } catch (error) {
    throw new Error(`Manifest or package metadata is not valid JSON: ${error.message}`);
  }
  assert.equal(manifest.manifest_version, 3, "Manifest must use version 3");
  assert.equal(typeof manifest.version, "string", "Manifest version is required");
  assert.equal(typeof metadata.version, "string", "Package version is required");
  assert.equal(manifest.version, metadata.version, "Extension and package versions must match");
  assert.equal(typeof manifest.background?.service_worker, "string", "Manifest background service worker is required");
  assert.equal(typeof manifest.action?.default_popup, "string", "Manifest popup resource is required");
  for (const [value, label] of [
    [manifest.background.service_worker, "manifest.background.service_worker"],
    [manifest.action.default_popup, "manifest.action.default_popup"],
    ["popup.js", "required project resource popup.js"],
    ["popup.css", "required project resource popup.css"]
  ]) resource(rootDirectory, value, label);
}

function filesUnder(directory, pattern, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) filesUnder(file, pattern, files);
    else if (entry.isFile() && pattern.test(entry.name)) files.push(file);
  }
  return files;
}

function sourceFiles(rootDirectory) {
  return filesUnder(rootDirectory, sourcePattern);
}

function testFiles(rootDirectory) {
  const directory = path.join(rootDirectory, "tests");
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error(`Tests directory is missing: ${directory}`);
  return filesUnder(directory, testPattern);
}

function checkDiff(rootDirectory, options = {}) {
  const check = (args, label, noIndex = false) => {
    const result = captured("git", args, label, { ...options, cwd: rootDirectory, encoding: "utf8" });
    const text = output(result);
    const cleanNoIndex = noIndex && result.status === 1 && !text;
    if (result.status !== 0 && !cleanNoIndex) throw new Error(`${label} failed${result.status == null ? " without an exit status" : ` with exit code ${result.status}`}.${text.trim() ? `\n${text.trim()}` : ""}`);
    if (text.trim()) throw new Error(`${label} found whitespace or conflict errors:\n${text.trim()}`);
  };
  check(["diff", "--check"], "Unstaged diff validation");
  check(["diff", "--cached", "--check"], "Staged diff validation");
  const untracked = captured("git", ["ls-files", "--others", "--exclude-standard", "--full-name", "-z"], "Untracked file discovery", { ...options, cwd: rootDirectory, encoding: null });
  if (untracked.status !== 0) throw new Error(`Untracked file discovery failed with exit code ${untracked.status}.`);
  const files = (Buffer.isBuffer(untracked.stdout) ? untracked.stdout.toString("utf8") : String(untracked.stdout || "")).split("\0").filter(Boolean);
  for (const file of files) {
    const absolute = path.resolve(rootDirectory, file);
    if (!inside(rootDirectory, absolute)) throw new Error(`Untracked file escaped the project: ${file}`);
    check(["diff", "--no-index", "--check", "--", "/dev/null", absolute], `Untracked diff validation: ${file}`, true);
  }
}

function checkGit(rootDirectory, options = {}) {
  const spawn = options.spawnSync || spawnSync;
  const version = spawn("git", ["--version"], { cwd: rootDirectory, stdio: "ignore", env: options.env });
  if (version.error || version.signal || version.status !== 0) throw new Error("Git is required for local CI.");
  const result = captured("git", ["rev-parse", "--show-toplevel"], "Git repository check", { ...options, cwd: rootDirectory });
  if (result.status !== 0) throw new Error("Local CI must run inside a Git repository.");
  if (fs.realpathSync(String(result.stdout).trim()) !== fs.realpathSync(rootDirectory)) throw new Error("Git repository root does not match project root.");
}

function checkCode(rootDirectory, options = {}) {
  if (!isSupportedNode(options.nodeVersion)) throw new Error(`Node.js 18 or newer is required (found ${options.nodeVersion || process.versions.node}).`);
  checkGit(rootDirectory, options);
  validateManifest(rootDirectory);
  console.log("Manifest and extension resources validated.");
  const node = options.nodeExecutable || process.execPath;
  const sources = sourceFiles(rootDirectory);
  if (!sources.length) throw new Error("No JavaScript source files found.");
  for (const file of sources) run(node, ["--check", file], `Syntax: ${path.relative(rootDirectory, file)}`, { ...options, cwd: rootDirectory });
  const tests = testFiles(rootDirectory);
  if (!tests.length) throw new Error("No regression tests found.");
  const testEnvironment = { ...(options.env || process.env) };
  delete testEnvironment.NODE_TEST_CONTEXT;
  run(node, ["--test", ...tests], "Local regression tests", { ...options, cwd: rootDirectory, env: testEnvironment });
  checkDiff(rootDirectory, options);
}

function browserPaths(rootDirectory, environment = process.env) {
  return {
    runner: path.resolve(rootDirectory, environment.BPS_CHROME_RUNNER || path.join(os.homedir(), ".codex/skills/chrome-extension-test-runner/scripts/launch_test_chrome.py")),
    playwright: path.resolve(rootDirectory, environment.BPS_PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"))
  };
}

function checkBrowser(rootDirectory, options = {}) {
  const paths = browserPaths(rootDirectory, options.env || process.env);
  const smoke = path.join(rootDirectory, "tests", "browser-smoke.cjs");
  const isFile = file => { try { return fs.statSync(file).isFile(); } catch (error) { return false; } };
  if (!isFile(smoke) || !isFile(paths.runner)) throw new Error("Browser verification prerequisites are missing.");
  if (!fs.existsSync(paths.playwright)) throw new Error(`Playwright module is missing: ${paths.playwright}`);
  const python = (options.spawnSync || spawnSync)("python3", ["--version"], { cwd: rootDirectory, stdio: "ignore", env: options.env });
  if (python.error || python.signal || python.status !== 0) throw new Error("python3 is required for browser verification.");
  try { require.resolve(paths.playwright); } catch (error) { throw new Error(`Playwright module cannot be loaded: ${error.message}`); }
}

function parseMode(args) {
  if (args.length > 1 || (args.length && !["--checks-only", "--browser-only"].includes(args[0]))) throw new Error("Usage: node scripts/local-ci.cjs [--checks-only | --browser-only]");
  return args[0] === "--checks-only" ? "checks-only" : args[0] === "--browser-only" ? "browser-only" : "full";
}

function main(args = process.argv.slice(2)) {
  let mode;
  let phase = "setup";
  try {
    mode = parseMode(args);
    if (!isSupportedNode()) throw new Error(`Node.js 18 or newer is required (found ${process.versions.node}).`);
    if (mode !== "browser-only") {
      phase = "code checks";
      checkCode(root);
    }
    if (mode === "checks-only") {
      console.log("\nLocal code checks passed. Browser verification was not run (checks-only mode).");
      return 0;
    }
    phase = "browser prerequisites";
    checkBrowser(root);
    phase = "browser verification";
    run(process.execPath, [path.join(root, "tests", "browser-smoke.cjs")], "Local Chrome for Testing verification", { cwd: root });
    console.log(mode === "browser-only" ? "\nBrowser verification passed. Code checks were not run (browser-only mode)." : "\nFull local CI passed.");
    return 0;
  } catch (error) {
    console.error(`\nLocal CI did not pass: ${error.message}`);
    if (mode === "checks-only") console.error("Browser verification was skipped (checks-only mode).");
    else if (mode === "full" && phase !== "browser prerequisites" && phase !== "browser verification") console.error("Browser verification was skipped because an earlier local check failed.");
    else if (phase === "browser prerequisites") console.error("Browser verification did not run because its prerequisites failed.");
    else if (mode === "full" || mode === "browser-only") console.error("Browser verification did not pass.");
    return 1;
  }
}

module.exports = { isSupportedNode };
if (require.main === module) process.exitCode = main();
