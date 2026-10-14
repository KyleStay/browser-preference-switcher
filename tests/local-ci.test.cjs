const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const runnerSource = path.join(projectRoot, "scripts", "local-ci.cjs");

function fixture({ browser = "pass", manifest = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-preference-switcher-ci-"));
  const files = {
    "package.json": JSON.stringify({ name: "fixture", version: "1.2.3" }),
    "manifest.json": JSON.stringify({
      manifest_version: 3,
      name: "Fixture",
      version: "1.2.3",
      background: { service_worker: "src/background.js" },
      action: { default_popup: "ui/popup.html" },
      ...manifest
    }),
    "src/background.js": "globalThis.fixtureBackground = true;\n",
    "src/nested/extra.mjs": "export const fixture = true;\n",
    "ui/popup.html": "<!doctype html><title>Fixture</title>\n",
    "popup.js": "globalThis.fixturePopup = true;\n",
    "popup.css": "body {}\n",
    "tests/nested/fixture.test.cjs": "const test = require('node:test'); test('fixture regression', () => {});\n",
    "tests/browser-smoke.cjs": browser === "signal"
      ? "process.kill(process.pid, 'SIGTERM');\n"
      : `process.exit(${browser === "fail" ? 7 : 0});\n`,
    "runner.py": "# fixture runner path\n",
    "fake-playwright/package.json": JSON.stringify({ main: "index.js" }),
    "fake-playwright/index.js": "module.exports = {};\n",
    "fake-bin/python3": "#!/bin/sh\nprintf '%s\\n' 'Python 3 fixture'\n"
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  fs.chmodSync(path.join(root, "fake-bin/python3"), 0o755);
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(runnerSource, path.join(root, "scripts", "local-ci.cjs"));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" }).status, 0);
  const env = {
    ...process.env,
    PATH: `${path.join(root, "fake-bin")}${path.delimiter}${process.env.PATH || ""}`,
    BPS_CHROME_RUNNER: path.join(root, "runner.py"),
    BPS_PLAYWRIGHT_MODULE: path.join(root, "fake-playwright")
  };
  return { root, env, manifest: path.join(root, "manifest.json"), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function runFixture(fixtureRepo, args = ["--checks-only"]) {
  return spawnSync(process.execPath, [path.join(fixtureRepo.root, "scripts", "local-ci.cjs"), ...args], {
    cwd: fixtureRepo.root,
    env: fixtureRepo.env,
    encoding: "utf8"
  });
}

test("checks-only discovers nested source/tests and explicitly reports browser verification as skipped", t => {
  const repo = fixture();
  t.after(repo.cleanup);
  const result = runFixture(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Local code checks passed/);
  assert.match(result.stdout, /Browser verification was not run \(checks-only mode\)/);
});

test("full and browser-only modes report browser pass, failure, and signal outcomes accurately", t => {
  const passing = fixture();
  t.after(passing.cleanup);
  const full = runFixture(passing, []);
  assert.equal(full.status, 0, full.stderr);
  assert.match(full.stdout, /Full local CI passed/);

  const browserOnly = runFixture(passing, ["--browser-only"]);
  assert.equal(browserOnly.status, 0, browserOnly.stderr);
  assert.match(browserOnly.stdout, /Code checks were not run \(browser-only mode\)/);

  const failing = fixture({ browser: "fail" });
  t.after(failing.cleanup);
  const failed = runFixture(failing, []);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Local Chrome for Testing verification failed with exit code 7/);
  assert.match(failed.stderr, /Browser verification did not pass/);
  assert.doesNotMatch(failed.stdout, /Full local CI passed/);

  const signaled = fixture({ browser: "signal" });
  t.after(signaled.cleanup);
  const signal = runFixture(signaled, []);
  assert.equal(signal.status, 1);
  assert.match(signal.stderr, /Local Chrome for Testing verification was terminated by SIGTERM/);
  assert.match(signal.stderr, /Browser verification did not pass/);
});

test("manifest and resource validation rejects missing, escaped, and symlinked worker resources", t => {
  const escaped = fixture({ manifest: { background: { service_worker: "../outside.js" } } });
  t.after(escaped.cleanup);
  const escapedResult = runFixture(escaped);
  assert.equal(escapedResult.status, 1);
  assert.match(escapedResult.stderr, /manifest\.background\.service_worker must stay inside the project/);

  const missing = fixture({ manifest: { background: { service_worker: "src/missing.js" } } });
  t.after(missing.cleanup);
  const missingResult = runFixture(missing);
  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /manifest\.background\.service_worker is missing/);

  const linked = fixture();
  t.after(linked.cleanup);
  const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "browser-preference-switcher-ci-outside-"));
  t.after(() => fs.rmSync(outsideDirectory, { recursive: true, force: true }));
  const outside = path.join(outsideDirectory, "outside-worker.js");
  fs.writeFileSync(outside, "outside\n");
  fs.rmSync(path.join(linked.root, "src", "background.js"));
  fs.symlinkSync(outside, path.join(linked.root, "src", "background.js"));
  const linkedResult = runFixture(linked);
  assert.equal(linkedResult.status, 1);
  assert.match(linkedResult.stderr, /manifest\.background\.service_worker resolves outside the project/);
});

test("diff validation covers clean, untracked, and staged files", t => {
  const repo = fixture();
  t.after(repo.cleanup);
  assert.equal(runFixture(repo).status, 0);

  fs.writeFileSync(path.join(repo.root, "untracked.txt"), "trailing whitespace \n");
  const untracked = runFixture(repo);
  assert.equal(untracked.status, 1);
  assert.match(untracked.stderr, /Untracked diff validation/);
  fs.rmSync(path.join(repo.root, "untracked.txt"));

  fs.writeFileSync(path.join(repo.root, "staged.txt"), "staged whitespace \n");
  assert.equal(spawnSync("git", ["add", "staged.txt"], { cwd: repo.root, stdio: "ignore" }).status, 0);
  const staged = runFixture(repo);
  assert.equal(staged.status, 1);
  assert.match(staged.stderr, /Staged diff validation/);
});

test("Node prerequisite comparison handles one-digit versions without lexical ordering bugs", () => {
  const ci = require(runnerSource);
  assert.equal(ci.isSupportedNode("9.10.0"), false);
  assert.equal(ci.isSupportedNode("17.9.9"), false);
  assert.equal(ci.isSupportedNode("18.0.0-beta"), true);
  assert.equal(ci.isSupportedNode("26.3.1"), true);
});
