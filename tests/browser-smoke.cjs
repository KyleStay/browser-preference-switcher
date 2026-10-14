// Optional offline browser integration check; the extension itself has no dependencies.
// Requires Chrome for Testing, Playwright, and the isolated extension test runner.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const runner = process.env.BPS_CHROME_RUNNER || path.join(os.homedir(), '.codex/skills/chrome-extension-test-runner/scripts/launch_test_chrome.py');
const playwrightPath = process.env.BPS_PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(playwrightPath);
const resources = [];
const vendorUrls = [
  'https://developer.apple.com/tutorials/data/documentation/safari-release-notes.json',
  'https://edgeupdates.microsoft.com/api/products?view=enterprise',
  'https://versionhistory.googleapis.com/v1/chrome/platforms/linux/channels/stable/versions/all/releases?filter=endtime%3Dnone',
  'https://versionhistory.googleapis.com/v1/chrome/platforms/mac/channels/stable/versions/all/releases?filter=endtime%3Dnone',
  'https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions/all/releases?filter=endtime%3Dnone'
];
let server;
let serverReady;
let serverListening = false;
let tempRoot;
let cleaning;
let interrupted = false;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function startRunner(args) {
  let resolveTask;
  let rejectTask;
  const task = new Promise((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });
  const child = execFile('python3', args, { timeout: 30000 }, (error, stdout, stderr) => {
    if (error) {
      error.stdout = stdout;
      error.stderr = stderr;
      rejectTask(error);
    } else resolveTask({ stdout, stderr });
  });
  return { child, task };
}

function processes() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,stat=,lstart=,command='], { encoding: 'utf8' })
    .trim().split('\n').map(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.*)$/.exec(line);
      return match && { pid: Number(match[1]), ppid: Number(match[2]), stat: match[3], started: match[4], command: match[5] };
    }).filter(Boolean);
}

function sameProcessIdentity(expected, current) {
  return expected?.started === current.started && expected?.command === current.command;
}

function inventory(resource) {
  const all = processes();
  // A unique profile marker identifies only this run, even if runner launch fails.
  const profileMarker = `--user-data-dir=${resource.profile_dir}`;
  const roots = all.filter(p => p.command.includes(profileMarker) && p.command.includes('Google Chrome for Testing'));
  const owned = new Set();
  for (const p of roots) {
    const known = resource.processes.get(p.pid);
    if (!known || sameProcessIdentity(known, p)) owned.add(p.pid);
  }
  // Keep known descendants owned after Chrome reparents them when the root exits.
  for (const p of all) {
    const known = resource.processes.get(p.pid);
    if (sameProcessIdentity(known, p)) owned.add(p.pid);
  }
  let changed;
  do {
    changed = false;
    for (const p of all) if (owned.has(p.ppid) && !owned.has(p.pid)) { owned.add(p.pid); changed = true; }
  } while (changed);
  for (const p of all) if (owned.has(p.pid)) {
    const known = resource.processes.get(p.pid);
    if (!known || sameProcessIdentity(known, p)) resource.processes.set(p.pid, p);
  }
  return all.filter(p => owned.has(p.pid) && sameProcessIdentity(resource.processes.get(p.pid), p) && !p.stat.startsWith('Z'));
}

async function settleRunner(resource) {
  if (!resource.launchTask || resource.launchSettled) return;
  await Promise.race([resource.launchTask.catch(() => {}), delay(5000)]);
  if (resource.launchSettled) return;
  try { resource.runnerProcess?.kill('SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await Promise.race([resource.launchTask.catch(() => {}), delay(1000)]);
  if (!resource.launchSettled) {
    const owned = inventory(resource).map(process => process.pid);
    throw new Error(`Chrome runner did not settle; refusing profile cleanup: ${resource.profile_dir}; owned PIDs: ${owned.join(', ') || 'unknown'}`);
  }
}

async function closeRun(resource) {
  if (resource.closed) return;
  await settleRunner(resource);
  inventory(resource);
  if (resource.browser) {
    try {
      const session = await resource.browser.newBrowserCDPSession();
      await session.send('Browser.close');
    } catch (error) {
      if (resource.browser.isConnected()) console.warn('CDP close failed:', error.message);
    }
  }
  const waitUntil = async deadline => {
    while (inventory(resource).length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  };
  await waitUntil(Date.now() + 5000);
  for (const p of inventory(resource)) {
    const original = resource.processes.get(p.pid);
    // Match the exact start identity recorded in this owned process tree.
    if (sameProcessIdentity(original, p)) {
      try { process.kill(p.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  await waitUntil(Date.now() + 5000);
  assert.deepEqual(inventory(resource).map(p => p.pid), [], `Owned Chrome processes survived: ${resource.profile_dir}`);
  await fs.rm(resource.profile_dir, { recursive: true, force: true });
  resource.closed = true;
}

async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    const errors = [];
    for (const resource of [...resources].reverse()) {
      try { await closeRun(resource); } catch (error) { errors.push(error); }
    }
    if (serverReady && !serverListening) await Promise.race([serverReady.catch(() => {}), delay(5000)]);
    if (server && serverListening) {
      await new Promise((resolve, reject) => {
        server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
        server.closeAllConnections();
      });
      serverListening = false;
    }
    if (!errors.length && tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
    if (errors.length) throw new AggregateError(errors, 'Browser cleanup incomplete');
    assert.equal(resources.flatMap(inventory).length, 0);
    for (const resource of resources) await assert.rejects(fs.access(resource.profile_dir));
    console.log('Cleanup verified: 0 owned Chrome processes; 0 disposable profiles; fixture server stopped.');
  })();
  return cleaning;
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = true;
  cleanup().then(() => process.exit(130), error => { console.error(error); process.exit(1); });
});

async function launch(extension, url, label) {
  if (interrupted) throw new Error('Browser test interrupted');
  const profileDir = await fs.mkdtemp(path.join(tempRoot, `${label}-profile-`));
  const resource = { profile_dir: profileDir, processes: new Map() };
  resources.push(resource);
  const started = startRunner([runner, '--extension', extension, '--url', url, '--profile', profileDir]);
  resource.runnerProcess = started.child;
  resource.launchTask = started.task.then(result => {
    resource.launchSettled = true;
    return result;
  }, error => {
    resource.launchSettled = true;
    throw error;
  });
  resource.launchTask.catch(() => {});
  let result;
  let runnerStdout = '';
  try {
    const { stdout } = await resource.launchTask;
    runnerStdout = stdout;
    result = JSON.parse(runnerStdout);
  } catch (error) {
    if (error.stdout?.trim()) {
      try { result = JSON.parse(error.stdout); } catch {}
    }
    if (result) resource.launchResult = result;
    const details = [error.message, error.stderr?.trim(), !error.stderr?.trim() && runnerStdout.trim()].filter(Boolean).join('\n');
    throw new Error(`${label}: Chrome runner failed${details ? `\n${details}` : ''}`, { cause: error });
  }
  resource.launchResult = result;
  assert.equal(path.resolve(result.profile_dir ?? ''), path.resolve(profileDir), `${label}: runner changed the owned profile path`);
  for (const [key, value] of Object.entries(result)) if (key !== 'profile_dir') resource[key] = value;
  assert(Number.isInteger(resource.pid), `${label}: runner did not report Chrome's pid`);
  if (interrupted) throw new Error('Browser test interrupted');
  assert.equal(resource.debugger_ready, true);
  assert.equal(resource.extension_loaded, true);
  assert(inventory(resource).some(process => process.pid === resource.pid), `${label}: runner-reported Chrome pid is not in the owned process tree`);
  resource.browser = await chromium.connectOverCDP(`http://127.0.0.1:${resource.debug_port}`);
  resource.context = resource.browser.contexts()[0];
  resource.unexpectedPageRequests = [];
  await resource.context.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.protocol === 'chrome-extension:' || target.origin === new URL(url).origin) return route.continue();
    if (target.origin === 'https://www.google.com') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Owned compatibility fixture</title><p>Owned test fixture</p>' });
    resource.unexpectedPageRequests.push(target.href);
    return route.abort('blockedbyclient');
  });
  resource.worker = await extensionWorker(resource);
  const deadline = Date.now() + 10000;
  while ((await rules(resource)).length !== 0 && Date.now() < deadline) await delay(100);
  assert.equal((await rules(resource)).length, 0, `${label}: extension must start with no rules before consent`);
  const stored = await evaluateWorker(resource, async () => {
    const values = await chrome.storage.local.get(null);
    return {
      versionsCheckedAt: values.versionsCheckedAt,
      requests: Object.entries(values).filter(([key]) => key.startsWith('__ciVendorRequest.')).map(([, url]) => url)
    };
  }, undefined, { retryOnWorkerRestart: true });
  assert.equal(stored.versionsCheckedAt, 0, `${label}: version refresh started before consent`);
  assert.deepEqual(stored.requests, [], `${label}: vendor fetch started before consent`);
  console.log(`${label}: copied manifest loaded; consent gate starts with 0 dynamic rules and 0 vendor requests.`);
  return resource;
}

async function extensionWorker(resource, excludedWorker) {
  const prefix = `chrome-extension://${resource.extension_id}/`;
  const existing = resource.context.serviceWorkers().find(worker => worker !== excludedWorker && worker.url().startsWith(prefix));
  if (existing) return existing;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const worker = await resource.context.waitForEvent('serviceworker', { timeout: Math.max(1, deadline - Date.now()) });
    if (worker !== excludedWorker && worker.url().startsWith(prefix)) return worker;
  }
  throw new Error('Replacement extension service worker did not start');
}

function workerRestartError(error) {
  return /execution context was destroyed|target page, context or browser has been closed|target .* has been closed|worker .* closed/i.test(String(error?.message ?? error));
}

async function evaluateWorker(resource, expression, argument, { retryOnWorkerRestart = false } = {}) {
  const worker = await extensionWorker(resource);
  resource.worker = worker;
  try { return await worker.evaluate(expression, argument); }
  catch (error) {
    if (!retryOnWorkerRestart || !workerRestartError(error)) throw error;
    resource.worker = undefined;
    const replacement = await extensionWorker(resource, worker);
    resource.worker = replacement;
    return replacement.evaluate(expression, argument);
  }
}

async function rules(resource) {
  return evaluateWorker(resource, () => chrome.declarativeNetRequest.getDynamicRules(), undefined, { retryOnWorkerRestart: true });
}

async function storedVendorState(resource) {
  return evaluateWorker(resource, async () => {
    const values = await chrome.storage.local.get(null);
    return {
      versionsCheckedAt: values.versionsCheckedAt,
      requests: Object.entries(values).filter(([key]) => key.startsWith('__ciVendorRequest.')).map(([, url]) => url)
    };
  }, undefined, { retryOnWorkerRestart: true });
}

async function waitForConsentRefresh(resource) {
  const deadline = Date.now() + 15000;
  let activeRules = [];
  let stored = { versionsCheckedAt: 0, requests: [] };
  while (Date.now() < deadline) {
    activeRules = await rules(resource);
    stored = await storedVendorState(resource);
    if (activeRules.length === 20 && stored.versionsCheckedAt > 0 && stored.requests.length === vendorUrls.length) break;
    await delay(100);
  }
  assert.equal(activeRules.length, 20, 'Accepting the privacy notice must install all 20 dynamic rules');
  assert(stored.versionsCheckedAt > 0, 'Accepting the privacy notice must complete the initial version refresh');
  assert.deepEqual(stored.requests.slice().sort(), vendorUrls.slice().sort(), 'Consent must trigger exactly one request to each local vendor fixture');
  return stored;
}

async function assertConsentNotice(resource, popup) {
  await popup.waitForFunction(() => document.querySelector('#consent-card')?.hidden === false);
  assert.equal(await popup.locator('#accept-consent').textContent(), 'Agree and enable');
  assert.equal(await popup.locator('#accept-consent').isEnabled(), true);
  const before = await popup.evaluate(() => new Promise(resolve => chrome.runtime.sendMessage({ type: 'get-popup-state', url: 'https://www.google.com/' }, resolve)));
  assert.equal(before.consentAccepted, false);
  assert.equal(before.privacyNoticeVersion, 1);
  assert.equal(before.host, '');
  assert.equal(before.browser, null);
  assert.equal((await rules(resource)).length, 0);
  assert.deepEqual((await storedVendorState(resource)).requests, []);
  await popup.locator('#accept-consent').click();
  await popup.waitForFunction(() => document.querySelector('#consent-card')?.hidden === true);
  await waitForConsentRefresh(resource);
}

async function createTestCopy(label, localhost = false) {
  const extension = path.join(tempRoot, label);
  await fs.mkdir(extension);
  const sourceManifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  for (const file of ['manifest.json', 'background.js', 'popup.html', 'popup.js', 'popup.css']) await fs.copyFile(path.join(root, file), path.join(extension, file));
  const iconPaths = new Set([
    ...Object.values(sourceManifest.icons ?? {}),
    ...Object.values(sourceManifest.action?.default_icon ?? {})
  ]);
  for (const file of iconPaths) {
    assert.equal(typeof file, 'string', 'Manifest icon paths must be strings');
    const sourcePath = path.resolve(root, file);
    assert(sourcePath.startsWith(`${root}${path.sep}`), `Manifest icon path escapes the project: ${file}`);
    const targetPath = path.join(extension, file);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const source = await fs.readFile(sourcePath);
    assert(source.length > 0, `Production icon is empty: ${file}`);
    await fs.writeFile(targetPath, source);
    assert((await fs.readFile(targetPath)).equals(source), `Temporary copy changed production icon: ${file}`);
  }
  await fs.copyFile(path.join(__dirname, 'fixtures/vendor-fetch.js'), path.join(extension, 'ci-fixtures.js'));
  const backgroundPath = path.join(extension, 'background.js');
  await fs.writeFile(backgroundPath, `importScripts('ci-fixtures.js');\n${await fs.readFile(backgroundPath, 'utf8')}`);
  const manifestPath = path.join(extension, 'manifest.json');
  if (localhost) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.host_permissions.push('http://127.0.0.1/*');
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
  } else {
    assert((await fs.readFile(manifestPath)).equals(await fs.readFile(path.join(root, 'manifest.json'))), 'Manifest parity copy must be byte-identical');
  }
  return extension;
}

async function manifestParityChecks(url) {
  const extension = await createTestCopy('manifest-parity-copy');
  const resource = await launch(extension, url, 'manifest-parity');
  const context = resource.context;
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 1280, height: 800 });
  const pageErrors = [];
  popup.on('pageerror', error => pageErrors.push(error.message));
  await popup.goto(`chrome-extension://${resource.extension_id}/popup.html`);
  await popup.waitForFunction(() => document.querySelector('#consent-card')?.hidden === false);
  assert.equal(await popup.locator('#accept-consent').textContent(), 'Agree and enable');
  await fs.mkdir(path.join(root, 'store/screenshots'), { recursive: true });
  await popup.screenshot({ path: path.join(root, 'store/screenshots/consent-1280x800.png') });
  await assertConsentNotice(resource, popup);

  const installed = await rules(resource);
  assert.equal(new Set(installed.map(rule => rule.id)).size, 20);
  assert(installed.every(rule => rule.condition.urlFilter === '|https://'));
  // testMatchOutcome is available to unpacked extensions without feedback permission.
  const outcomes = await evaluateWorker(resource, async () => {
    const urls = ['https://www.google.com/search?q=fixture', 'https://www.office.com/', 'https://www.icloud.com/', 'https://example.com/', 'http://www.google.com/', 'https://google.com.evil.example/'];
    return Promise.all(urls.map(async url => ({ url, matches: (await chrome.declarativeNetRequest.testMatchOutcome({ url, type: 'main_frame' })).matchedRules.map(rule => rule.ruleId) })));
  }, undefined, { retryOnWorkerRestart: true });
  assert.deepEqual(outcomes.map(outcome => outcome.matches), [[1], [7], [20], [], [], []]);
  const state = await popup.evaluate(async () => {
    const urls = ['https://www.google.com/', 'https://www.office.com/', 'https://www.icloud.com/', 'https://example.com/', 'http://www.google.com/'];
    return Promise.all(urls.map(url => new Promise(resolve => chrome.runtime.sendMessage({ type: 'get-popup-state', url }, resolve))));
  });
  assert.deepEqual(state.map(item => item.browser), ['chrome', 'edge', 'safari', null, null]);
  assert(state.every(item => item.platformMode === 'auto' && item.platformLabel === 'macOS' && item.consentAccepted === true && item.privacyNoticeVersion === 1));

  const fixture = context.pages()[0];
  // Context routing supplies owned HTML before any external navigation.
  await fixture.goto('https://www.google.com/');
  await popup.goto(`chrome-extension://${resource.extension_id}/popup.html`);
  // popup.js starts load() as soon as the extension page runs. Let that request
  // finish before changing the active tab and issuing the test's second load().
  await popup.waitForFunction(() => document.querySelector('#site').textContent !== 'Checking this site…');
  await popup.evaluate(async () => {
    const [fixtureTab] = await chrome.tabs.query({ url: 'https://www.google.com/*' });
    if (!fixtureTab) throw new Error('Owned Google fixture tab was not found');
    await chrome.tabs.update(fixtureTab.id, { active: true });
    await load();
  });
  await assert.equal(await popup.locator('#site').textContent(), 'www.google.com');
  await assert.equal(await popup.locator('#platform').inputValue(), 'auto');
  await assert.equal(await popup.locator('#identity').textContent(), 'Chrome · macOS');
  await popup.waitForFunction(() => !document.querySelector('#refresh').disabled);
  await popup.screenshot({ path: path.join(root, 'store/screenshots/accepted-1280x800.png') });
  await popup.locator('#refresh').click();
  await popup.waitForFunction(() => !document.querySelector('#refresh').disabled && document.querySelector('#message').textContent.startsWith('Browser versions updated.'));
  const refreshed = await evaluateWorker(resource, async () => {
    const stored = await chrome.storage.local.get(null);
    return {
      versions: stored.versions,
      versionErrors: stored.versionErrors,
      requests: Object.entries(stored).filter(([key]) => key.startsWith('__ciVendorRequest.')).map(([, url]) => url)
    };
  }, undefined, { retryOnWorkerRestart: true });
  assert.deepEqual(refreshed.versions, {
    chrome: { mac: '160.0.9000.11', windows: '160.0.9000.12', linux: '160.0.9000.13' },
    edge: { mac: '159.0.8100.21', windows: '159.0.8100.22', linux: '159.0.8100.23' },
    safari: '27.0.2', firefox: '156.0.1'
  });
  assert.deepEqual(refreshed.versionErrors, {});
  assert.equal(refreshed.requests.length, 10, 'Startup and popup refresh must each issue five vendor requests');
  const requestCounts = refreshed.requests.reduce((counts, request) => counts.set(request, (counts.get(request) ?? 0) + 1), new Map());
  assert.deepEqual([...requestCounts.entries()].sort(), [
    ['https://developer.apple.com/tutorials/data/documentation/safari-release-notes.json', 2],
    ['https://edgeupdates.microsoft.com/api/products?view=enterprise', 2],
    ['https://versionhistory.googleapis.com/v1/chrome/platforms/linux/channels/stable/versions/all/releases?filter=endtime%3Dnone', 2],
    ['https://versionhistory.googleapis.com/v1/chrome/platforms/mac/channels/stable/versions/all/releases?filter=endtime%3Dnone', 2],
    ['https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions/all/releases?filter=endtime%3Dnone', 2]
  ]);
  await popup.locator('#platform').selectOption('windows');
  await popup.waitForFunction(() => !document.querySelector('#platform').disabled && document.querySelector('#message').textContent.startsWith('Saved.'));
  assert.equal(await popup.locator('#identity').textContent(), 'Chrome · Windows');
  assert((await rules(resource)).every(rule => rule.action.requestHeaders[0].value.includes('Windows NT')));
  assert.match(await popup.locator('#message').textContent(), /Reloading/);
  await popup.locator('#enabled').uncheck();
  await popup.waitForFunction(() => !document.querySelector('#enabled').disabled && document.querySelector('#identity').textContent === 'Native browser');
  assert.equal((await rules(resource)).length, 0);
  await popup.locator('#enabled').check();
  await popup.waitForFunction(() => !document.querySelector('#enabled').disabled && document.querySelector('#identity').textContent === 'Chrome · Windows');
  assert.equal((await rules(resource)).length, 20);
  await popup.locator('#platform').selectOption('auto');
  await popup.waitForFunction(() => !document.querySelector('#platform').disabled && document.querySelector('#identity').textContent === 'Chrome · macOS');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(resource.unexpectedPageRequests, []);
  console.log('Manifest parity checks passed: HTTPS/domain scope, macOS default, popup OS/toggle/reload behavior, local vendor parser refresh with 0 source errors. Only the temporary worker fetch transport is stubbed.');
  await closeRun(resource);
}

async function fixtureHeaders(url) {
  const extension = await createTestCopy('localhost-test-copy', true);
  const resource = await launch(extension, url, 'localhost-copy');
  const popup = await resource.context.newPage();
  await popup.goto(`chrome-extension://${resource.extension_id}/popup.html`);
  await assertConsentNotice(resource, popup);
  await popup.close();
  const page = resource.context.pages()[0];
  // The first response opts this loopback origin into high-entropy hints. Warm
  // the origin once more before asserting the native baseline actually carries
  // them; otherwise a broken remove rule could pass by removing nothing.
  await page.goto(url);
  const native = await (await page.goto(url)).json();
  assert.match(native['user-agent'], /Chrome\//);
  const highEntropy = ['sec-ch-ua-full-version-list', 'sec-ch-ua-arch', 'sec-ch-ua-platform-version'];
  for (const header of highEntropy) assert.ok(native[header], `Native baseline did not emit ${header} after Accept-CH`);
  for (const [domain, brand] of [['google.com', 'Google Chrome'], ['microsoft.com', 'Microsoft Edge'], ['icloud.com', null]]) {
    const target = (await rules(resource)).find(rule => rule.condition.requestDomains[0] === domain);
    await evaluateWorker(resource, async action => {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [10001], addRules: [{ id: 10001, priority: 1, action, condition: { requestDomains: ['127.0.0.1'], urlFilter: '|http://', resourceTypes: ['main_frame', 'xmlhttprequest'] } }] });
    }, target.action);
    const headers = await (await page.goto(url)).json();
    for (const header of target.action.requestHeaders) {
      if (header.operation === 'set') assert.equal(headers[header.header], header.value, `${domain}: ${header.header}`);
      if (header.operation === 'remove') assert.equal(headers[header.header], undefined, `${domain}: ${header.header}`);
    }
    if (brand) assert(headers['sec-ch-ua'].includes(brand));
    else { assert.match(headers['user-agent'], /Version\/.* Safari\//); assert(!headers['sec-ch-ua']); }
  }
  await evaluateWorker(resource, () => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [10001] }));
  const restored = await (await page.goto(url)).json();
  assert.equal(restored['user-agent'], native['user-agent']);
  for (const header of highEntropy) assert.equal(restored[header], native[header], `Native ${header} was not restored after removing the session rule`);
  assert.deepEqual(resource.unexpectedPageRequests, []);
  console.log('Owned localhost fixture received exact Chrome/Edge/Safari User-Agent and client-hint modifications; removing the test session rule restored native headers. Fixture copy alone grants localhost; production permissions are unchanged.');
  await closeRun(resource);
}

(async () => {
  let failure;
  try {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bps-browser-smoke-'));
    server = http.createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'accept-ch': 'Sec-CH-UA-Full-Version-List, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Platform-Version, Sec-CH-UA-Model, Sec-CH-UA-WoW64, Sec-CH-UA-Form-Factors' });
      response.end(JSON.stringify(request.headers));
    });
    serverReady = new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { serverListening = true; resolve(); });
    });
    await serverReady;
    const url = `http://127.0.0.1:${server.address().port}/headers`;
    await manifestParityChecks(url);
    await fixtureHeaders(url);
  } catch (error) {
    failure = error;
  }
  try {
    await cleanup();
  } catch (error) {
    failure = failure ? new AggregateError([failure, error], 'Browser test and cleanup failed') : error;
  }
  if (failure) throw failure;
})().catch(error => {
  const source = error.cause ?? error;
  if ((['EPERM', 'EACCES'].includes(source.code) && source.syscall === 'listen') || /PermissionError: \[Errno (1|13)\] Operation not permitted/.test(source.stderr ?? '')) {
    console.error('Local browser CI could not bind its localhost fixture or Chrome debugging port. Run `npm run ci` from your local terminal where localhost sockets are allowed. No Chrome profile permission or sandbox escalation is requested.');
  } else console.error(error);
  process.exitCode = 1;
});
