const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const NOW = Date.parse("2026-10-14T12:00:00Z");
const clone = value => JSON.parse(JSON.stringify(value));
const cachedVersions = () => ({
  chrome: { mac: "140.0.1.2", windows: "140.0.2.3", linux: "140.0.3.4" },
  edge: { mac: "139.0.1.2", windows: "139.0.2.3", linux: "139.0.3.4" },
  safari: "26.0", firefox: "143.0.1"
});
const settings = patch => ({ enabled: true, platformMode: "auto", versions: cachedVersions(), versionsCheckedAt: NOW, versionErrors: {}, privacyConsentVersion: 1, ...patch });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function safariReference(title, released) {
  // Apple references put the release date before an em dash in the abstract.
  const abstract = released.startsWith("Released ") ? `${released.replace(/\.$/, "")} — Learn about the new features.` : released;
  return { title, type: "topic", url: `/documentation/safari-release-notes/${title.toLowerCase().replaceAll(" ", "-")}`, abstract: [{ type: "text", text: abstract }] };
}

function validFetch(url) {
  const value = String(url);
  let data;
  if (value.includes("versionhistory.googleapis.com")) data = { releases: [{ version: "141.0.7390.1", fraction: 1 }] };
  else if (value.includes("edgeupdates.microsoft.com")) data = [{ Product: "Stable", Releases: ["MacOS", "Windows", "Linux"].map(Platform => ({ Platform, ProductVersion: "140.0.3485.10" })) }];
  else if (value.includes("developer.apple.com")) data = { references: {
    stable: safariReference("Safari 26.1 Release Notes", "Released October 13, 2026."),
    beta: safariReference("Safari 27.0 Beta Release Notes", "Released October 12, 2026."),
    future: safariReference("Safari 28.0 Release Notes", "Released December 1, 2026.")
  } };
  else throw new Error(`Unexpected release source ${value}`);
  return Promise.resolve({ ok: true, status: 200, json: async () => clone(data), text: async () => JSON.stringify(data) });
}

function harness({ saved = settings(), os = "mac", fetchImpl = validFetch, beforeRuleUpdate = async () => {}, beforeAlarmCreate = async () => {}, tabUrl = "https://google.com/" } = {}) {
  const store = structuredClone(saved);
  const events = {};
  const calls = { fetch: [], updates: [], alarms: [], reloads: [], errors: [], platformInfo: 0, urlParses: 0, activeUpdates: 0, maxActiveUpdates: 0 };
  let rules = [];
  const event = name => ({ addListener(listener) { events[name] = listener; } });
  class TestDate extends Date { static now() { return NOW; } }
  class TestURL extends URL { constructor(...args) { calls.urlParses += 1; super(...args); } }
  const testConsole = { error: (...args) => calls.errors.push(args) };
  const context = vm.createContext({
    URL: TestURL, Date: TestDate, structuredClone, setTimeout, clearTimeout, AbortController, AbortSignal, console: testConsole,
    fetch: async (url, options) => { calls.fetch.push({ url: String(url), options }); return fetchImpl(url, options); },
    chrome: {
      storage: { local: {
        get: async () => structuredClone(store),
        set: async patch => { Object.assign(store, structuredClone(patch)); }
      } },
      runtime: { getPlatformInfo: async () => { calls.platformInfo += 1; return { os }; }, onInstalled: event("installed"), onStartup: event("startup"), onMessage: event("message") },
      alarms: { create: async (name, info) => { calls.alarms.push({ name, info: clone(info) }); await beforeAlarmCreate(name, info); }, onAlarm: event("alarm") },
      tabs: { get: async id => ({ id, url: tabUrl }), reload: async id => { calls.reloads.push(id); } },
      declarativeNetRequest: {
        getDynamicRules: async () => clone(rules),
        updateDynamicRules: async update => {
          calls.activeUpdates += 1;
          calls.maxActiveUpdates = Math.max(calls.maxActiveUpdates, calls.activeUpdates);
          try {
            await beforeRuleUpdate(update);
            const removed = new Set(update.removeRuleIds);
            const retained = rules.filter(rule => !removed.has(rule.id));
            const ids = new Set(retained.map(rule => rule.id));
            for (const rule of update.addRules) {
              if (ids.has(rule.id)) throw new Error(`Duplicate rule ID ${rule.id}`);
              ids.add(rule.id);
            }
            rules = [...retained, ...clone(update.addRules)];
            calls.updates.push(clone(update));
          } finally { calls.activeUpdates -= 1; }
        }
      }
    }
  });
  vm.runInContext(source, context, { filename: "background.js" });
  return {
    calls, store, events,
    rules: () => clone(rules),
    run: expression => vm.runInContext(expression, context),
    message: message => new Promise((resolve, reject) => {
      const keepOpen = events.message(clone(message), {}, resolve);
      if (!keepOpen) reject(new Error("Message handler did not keep response channel open"));
    })
  };
}

test("curated rules match exact hosts and subdomains, without matching suffix spoofs", () => {
  const h = harness();
  for (const host of ["google.com", "mail.google.com", "deep.mail.google.com"]) {
    assert.equal(h.run(`profileFor(${JSON.stringify(host)}, 'mac', true)?.browser`), "chrome");
  }
  for (const host of ["evilgoogle.com", "google.com.evil.example", "example.org", ""]) {
    assert.equal(h.run(`profileFor(${JSON.stringify(host)}, 'mac', true)`), null);
  }
  assert.equal(h.run("profileFor('apple.com', 'windows', false)"), null);
});

test("manifest grants every curated HTTPS domain and subdomain, plus vendor source origins, without debugger access", () => {
  const h = harness();
  // Chrome match patterns treat *.example.com as both the root and its subdomains.
  const permitted = address => {
    const url = new URL(address);
    return manifest.host_permissions.some(pattern => {
      if (pattern === "<all_urls>") return ["http:", "https:", "file:", "ftp:"].includes(url.protocol);
      const match = /^(https|http|\*):\/\/([^/]+)\/.*$/.exec(pattern);
      if (!match) return false;
      const [, scheme, host] = match;
      if (scheme === "*" ? !["http:", "https:"].includes(url.protocol) : `${scheme}:` !== url.protocol) return false;
      if (host === "*") return true;
      return host.startsWith("*.")
        ? url.hostname === host.slice(2) || url.hostname.endsWith(`.${host.slice(2)}`)
        : url.hostname === host;
    });
  };
  for (const domain of h.run("SITE_RULES.map(rule => rule.domain)")) {
    assert.ok(permitted(`https://${domain}/`), `root domain ${domain}`);
    assert.ok(permitted(`https://test.${domain}/page`), `subdomain of ${domain}`);
  }
  for (const releaseSource of h.run("Object.values(RELEASE_SOURCES)")) {
    assert.equal(new URL(releaseSource).protocol, "https:");
    assert.ok(permitted(releaseSource), `release source ${releaseSource}`);
  }
  assert.equal(manifest.permissions.includes("debugger"), false);
});

test("actual OS remains the default and explicit OS choices affect every identity", async () => {
  for (const [hostOS, expected] of [["mac", "mac"], ["win", "windows"], ["linux", "linux"]]) {
    const h = harness({ os: hostOS });
    assert.equal(await h.run("reportedOS('auto')"), expected);
    assert.equal(await h.run("reportedOS('windows')"), "windows");
    for (const browser of ["chrome", "edge", "safari", "firefox"]) {
      const identity = h.run(`makeIdentity('${browser}', SEEDED_VERSIONS, '${expected}')`);
      assert.match(identity.userAgent, expected === "mac" ? /Macintosh/ : expected === "windows" ? /Windows NT/ : /Linux/);
    }
  }
});

test("Safari major release UAs use a dotted major version and preserve dotted releases", () => {
  const h = harness();
  const major = h.run("makeIdentity('safari', { ...SEEDED_VERSIONS, safari: '27' }, 'mac').userAgent");
  assert.match(major, /Version\/27\.0 Safari\//);
  const dotted = h.run("makeIdentity('safari', { ...SEEDED_VERSIONS, safari: '27.0.2' }, 'mac').userAgent");
  assert.match(dotted, /Version\/27\.0\.2 Safari\//);
});

test("new installs wait for privacy consent before reading platform or checking release sources", async () => {
  const h = harness({ saved: {} });
  await h.run("initialize()");
  assert.equal(h.calls.platformInfo, 0);
  assert.equal(h.calls.fetch.length, 0);
  assert.equal(h.calls.alarms.length, 0);
  assert.deepEqual(h.rules(), []);
  assert.equal(h.store.enabled, false);
  assert.equal(h.store.privacyConsentVersion, 0);
});

test("legacy enabled settings remain gated until the privacy notice is accepted", async () => {
  const h = harness({ saved: { enabled: true, platformMode: "windows", versions: cachedVersions(), versionsCheckedAt: NOW } });
  await h.run("initialize()");
  const state = await h.message({ type: "get-popup-state", url: "https://mail.google.com/inbox" });
  assert.equal(state.consentAccepted, false);
  assert.equal(state.privacyNoticeVersion, 1);
  assert.equal(state.enabled, false);
  assert.equal(state.platformMode, "windows");
  assert.deepEqual(state.versions, cachedVersions());
  assert.equal(state.platformLabel, "This device's OS");
  assert.equal(state.host, "");
  assert.equal(state.browser, null);
  assert.equal(h.calls.platformInfo, 0);
  assert.equal(h.calls.urlParses, 0);
  assert.deepEqual(h.rules(), []);
});

test("settings and release refreshes require privacy consent", async () => {
  const h = harness({ saved: {} });
  const settingsResult = await h.message({ type: "update-settings", patch: { platformMode: "windows" } });
  assert.equal(settingsResult.ok, false);
  assert.equal(settingsResult.consentAccepted, false);
  assert.equal(settingsResult.privacyNoticeVersion, 1);
  const refreshResult = await h.message({ type: "refresh-versions" });
  assert.equal(refreshResult.ok, false);
  assert.equal(refreshResult.consentAccepted, false);
  assert.equal(refreshResult.privacyNoticeVersion, 1);
  assert.equal(h.calls.fetch.length, 0);
  assert.deepEqual(h.rules(), []);
});

test("privacy acceptance requires the current notice version and an affirmative flag", async () => {
  for (const message of [
    { type: "accept-privacy-notice", noticeVersion: 0, accepted: true },
    { type: "accept-privacy-notice", noticeVersion: 1, accepted: false },
    { type: "accept-privacy-notice", noticeVersion: "1", accepted: true }
  ]) {
    const h = harness({ saved: {} });
    const result = await h.message(message);
    assert.equal(result.ok, false);
    assert.equal(result.consentAccepted, false);
    assert.equal(result.privacyNoticeVersion, 1);
    assert.equal(h.calls.fetch.length, 0);
    assert.equal(h.calls.alarms.length, 0);
    assert.deepEqual(h.rules(), []);
  }
});

test("privacy acceptance enables rules, schedules the daily alarm, and refreshes afterward", async () => {
  const h = harness({ saved: {} });
  const result = await h.message({ type: "accept-privacy-notice", noticeVersion: 1, accepted: true });
  assert.equal(result.ok, true);
  assert.equal(result.enabled, true);
  assert.equal(result.consentAccepted, true);
  assert.equal(result.privacyNoticeVersion, 1);
  assert.equal(h.store.privacyConsentVersion, 1);
  assert.equal(h.store.enabled, true);
  assert.ok(h.rules().length > 0);
  assert.equal(h.calls.alarms.length, 1);
  assert.equal(h.calls.alarms[0].info.delayInMinutes, 1440);
  for (let index = 0; index < 5; index += 1) await tick();
  assert.equal(h.calls.fetch.length, 5);
  assert.equal(h.store.versionsCheckedAt, NOW);
});

test("privacy acceptance rolls back consent and enabled state when rule replacement fails", async () => {
  const h = harness({ saved: {}, beforeRuleUpdate: async () => { throw new Error("Rule update rejected"); } });
  const result = await h.message({ type: "accept-privacy-notice", noticeVersion: 1, accepted: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /Rule update rejected/);
  assert.equal(h.store.privacyConsentVersion, 0);
  assert.equal(h.store.enabled, false);
  assert.equal(h.calls.fetch.length, 0);
  assert.equal(h.calls.alarms.length, 0);
  assert.deepEqual(h.rules(), []);
});

test("an existing refresh alarm remains inert before privacy consent", async () => {
  const h = harness({ saved: {} });
  h.events.alarm({ name: "refresh-browser-versions" });
  for (let index = 0; index < 2; index += 1) await tick();
  assert.equal(h.calls.fetch.length, 0);
  assert.equal(h.calls.platformInfo, 0);
  assert.deepEqual(h.calls.errors, []);
});

test("switched requests remove every high entropy client hint and set only compatible low entropy hints", () => {
  const h = harness();
  const highEntropy = ["sec-ch-ua-arch", "sec-ch-ua-bitness", "sec-ch-ua-full-version", "sec-ch-ua-full-version-list", "sec-ch-ua-model", "sec-ch-ua-platform-version", "sec-ch-ua-wow64", "sec-ch-ua-form-factors"];
  for (const browser of ["chrome", "edge", "safari", "firefox"]) {
    const rule = h.run(`dynamicRule(1, 'example.com', makeIdentity('${browser}', SEEDED_VERSIONS, 'mac'))`);
    const headers = new Map(rule.action.requestHeaders.map(item => [item.header, item]));
    assert.equal(headers.get("user-agent").operation, "set");
    for (const header of highEntropy) assert.equal(headers.get(header)?.operation, "remove", `${browser}: ${header}`);
    for (const header of ["sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform"]) {
      assert.equal(headers.get(header)?.operation, ["chrome", "edge"].includes(browser) ? "set" : "remove", `${browser}: ${header}`);
    }
  }
});

test("failed release checks retain the last valid cached versions", async () => {
  const original = cachedVersions();
  const h = harness({ fetchImpl: async () => { throw new Error("Source offline"); } });
  const result = await h.run("refreshVersions()");
  assert.deepEqual(clone(result.versions), original);
  assert.deepEqual(h.store.versions, original);
  assert.equal(Object.keys(result.errors).length, 5);
  assert.equal(h.store.versionsCheckedAt, NOW);
  assert.ok(h.rules().length > 0, "cached identities still become active rules");
});

test("malformed versions from vendors cannot overwrite the cache", async () => {
  const h = harness({ fetchImpl: async url => {
    const value = String(url);
    const data = value.includes("versionhistory") ? { releases: [{ version: "999.0.injected", fraction: 1 }] }
      : value.includes("edgeupdates") ? [{ Product: "Stable", Releases: [{ Platform: "MacOS", ProductVersion: "999.0\r\nX-Test: bad" }] }]
      : { references: { bad: safariReference("Safari 999oops Release Notes", "Released October 13, 2026.") } };
    return { ok: true, json: async () => data, text: async () => JSON.stringify(data) };
  } });
  const result = await h.run("refreshVersions()");
  assert.deepEqual(h.store.versions, cachedVersions());
  assert.equal(Object.keys(result.errors).length, 5);
});

test("partial Edge results preserve missing platforms and never borrow unknown-platform releases", async () => {
  const h = harness({ fetchImpl: async url => {
    if (!String(url).includes("edgeupdates")) return validFetch(url);
    return { ok: true, json: async () => [{ Product: "Stable", Releases: [
      { Platform: "Windows", ProductVersion: "140.0.3485.10" },
      { Platform: "Android", ProductVersion: "999.0.1.2" },
      { Platform: "Darwin", ProductVersion: "999.0.2.3" },
      { ProductVersion: "998.0.1.2" }
    ] }] };
  } });
  const result = await h.run("refreshVersions()");
  assert.equal(h.store.versions.edge.windows, "140.0.3485.10");
  assert.equal(h.store.versions.edge.mac, cachedVersions().edge.mac);
  assert.equal(h.store.versions.edge.linux, cachedVersions().edge.linux);
  assert.ok(result.errors["edge.mac"]);
  assert.ok(result.errors["edge.linux"]);
  assert.equal(result.errors["edge.windows"], undefined);
});

test("Safari uses official JSON release references and excludes beta, future, and unreleased notes", async () => {
  const h = harness({ fetchImpl: async url => {
    assert.match(String(url), /^https:\/\/developer\.apple\.com\/.*\.json$/);
    return { ok: true, json: async () => ({ references: {
      older: safariReference("Safari 26.0 Release Notes", "Released September 15, 2026."),
      latest: safariReference("Safari 26.1 Release Notes", "Released October 13, 2026."),
      beta: safariReference("Safari 27.0 Beta Release Notes", "Released October 12, 2026."),
      future: safariReference("Safari 28.0 Release Notes", "Released December 1, 2026."),
      undated: safariReference("Safari 29.0 Release Notes", "Learn about the new features."),
      prefix: safariReference("Preview Safari 30.0 Release Notes", "Released October 13, 2026.")
    } }) };
  } });
  assert.equal(await h.run("fetchSafariVersion()"), "26.1");
});

test("concurrent refreshes share one vendor request batch", async () => {
  const gate = deferred();
  const h = harness({ fetchImpl: async url => { await gate.promise; return validFetch(url); } });
  const first = h.run("refreshVersions()");
  const second = h.run("refreshVersions()");
  await tick();
  assert.equal(h.calls.fetch.length, 5);
  gate.resolve();
  const results = await Promise.all([first, second]);
  assert.deepEqual(clone(results[0]), clone(results[1]));
  assert.equal(h.calls.updates.length, 1);
});

test("concurrent rebuilds serialize the dynamic-rule replacement", async () => {
  const gate = deferred();
  let started = 0;
  const h = harness({ beforeRuleUpdate: async () => { started += 1; if (started === 1) await gate.promise; } });
  const first = h.run("rebuildHeaderRules()");
  const second = h.run("rebuildHeaderRules()");
  await tick();
  assert.equal(h.calls.maxActiveUpdates, 1);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(h.calls.maxActiveUpdates, 1);
  assert.ok(h.rules().length > 0);
});

test("concurrent settings changes finish with the latest saved configuration and rules", async () => {
  const gate = deferred();
  let started = 0;
  const h = harness({ beforeRuleUpdate: async () => { started += 1; if (started === 1) await gate.promise; } });
  const first = h.message({ type: "update-settings", patch: { platformMode: "windows" } });
  await tick();
  const second = h.message({ type: "update-settings", patch: { enabled: false } });
  await tick();
  gate.resolve();
  for (const result of await Promise.all([first, second])) assert.equal(result.ok, true);
  assert.equal(h.store.platformMode, "windows");
  assert.equal(h.store.enabled, false);
  assert.deepEqual(h.rules(), []);
  assert.equal(h.calls.maxActiveUpdates, 1);
});

test("failed rule application rolls back settings and leaves the mutation queue usable", async () => {
  let failUpdate = false;
  const h = harness({ beforeRuleUpdate: async () => {
    if (failUpdate) { failUpdate = false; throw new Error("Rule update rejected"); }
  } });
  await h.run("rebuildHeaderRules()");
  const previousRules = h.rules();
  failUpdate = true;
  const failed = await h.message({ type: "update-settings", patch: { enabled: false } });
  assert.equal(failed.ok, false);
  assert.equal(h.store.enabled, true);
  assert.deepEqual(h.rules(), previousRules);
  const retry = await h.message({ type: "update-settings", patch: { enabled: false } });
  assert.equal(retry.ok, true);
  assert.equal(h.store.enabled, false);
  assert.deepEqual(h.rules(), []);
});

test("failed refresh rule application restores cached versions, freshness, and errors before retry", async () => {
  let failUpdate = false;
  const previous = settings({ versionsCheckedAt: NOW - 3600000, versionErrors: { safari: "Previous source issue" } });
  const h = harness({ saved: previous, beforeRuleUpdate: async () => {
    if (failUpdate) { failUpdate = false; throw new Error("Rule update rejected"); }
  } });
  await h.run("rebuildHeaderRules()");
  const previousRules = h.rules();
  failUpdate = true;
  const failed = await h.message({ type: "refresh-versions" });
  assert.equal(failed.ok, false);
  assert.deepEqual(h.store.versions, previous.versions);
  assert.equal(h.store.versionsCheckedAt, previous.versionsCheckedAt);
  assert.deepEqual(h.store.versionErrors, previous.versionErrors);
  assert.deepEqual(h.rules(), previousRules);
  const retry = await h.message({ type: "refresh-versions" });
  assert.equal(retry.ok, true);
  assert.equal(h.store.versions.chrome.mac, "141.0.7390.1");
  assert.equal(h.store.versionsCheckedAt, NOW);
  assert.deepEqual(h.store.versionErrors, {});
  assert.notDeepEqual(h.rules(), previousRules);
});

test("completed refresh re-arms the daily alarm from the new check", async () => {
  const h = harness({ saved: settings({ versionsCheckedAt: NOW - 6 * 60 * 60 * 1000 }) });
  await h.run("refreshVersions()");
  const alarm = h.calls.alarms.at(-1);
  assert.equal(alarm.info.delayInMinutes, 1440);
  assert.equal(alarm.info.periodInMinutes, 1440);
});

test("startup schedules the refresh alarm even when initial rule application fails", async () => {
  const h = harness({ beforeRuleUpdate: async () => { throw new Error("Rule update rejected"); } });
  await assert.rejects(h.run("initialize()"), /Rule update rejected/);
  assert.equal(h.calls.alarms.length, 1);
  assert.equal(h.calls.alarms[0].info.delayInMinutes, 1440);
  assert.deepEqual(h.store.versions, cachedVersions());
});

test("a failed alarm re-arm reports the error while retaining refreshed cache", async () => {
  const h = harness({ beforeAlarmCreate: async () => { throw new Error("Alarm creation rejected"); } });
  const result = await h.run("refreshVersions()");
  assert.equal(result.checkedAt, NOW);
  assert.equal(h.store.versions.chrome.mac, "141.0.7390.1");
  assert.equal(h.store.versionsCheckedAt, NOW);
  assert.ok(h.calls.errors.some(args => String(args[1]).includes("Alarm creation rejected")));
});

test("startup respects daily version freshness and refreshes stale caches", async () => {
  const fresh = harness({ saved: settings({ versionsCheckedAt: NOW - 6 * 60 * 60 * 1000 }) });
  await fresh.run("initialize()");
  await tick();
  assert.equal(fresh.calls.fetch.length, 0);
  assert.equal(fresh.calls.alarms.length, 1);
  assert.equal(fresh.calls.alarms[0].info.delayInMinutes, 1080);
  assert.equal(fresh.calls.alarms[0].info.periodInMinutes, 1440);
  const stale = harness({ saved: settings({ versionsCheckedAt: NOW - 86400001 }) });
  await stale.run("initialize()");
  for (let index = 0; index < 5; index += 1) await tick();
  assert.equal(stale.calls.fetch.length, 5);
  assert.equal(stale.store.versionsCheckedAt, NOW);
  assert.equal(stale.calls.alarms.at(-1).info.delayInMinutes, 1440);
});

test("invalid cache timestamps cannot suppress startup refresh or create invalid alarm delays", async () => {
  for (const timestamp of [NaN, Infinity, "NaN", "not-a-date", -1, null, NOW + 3600000]) {
    const h = harness({ saved: settings({ versionsCheckedAt: timestamp }) });
    await h.run("initialize()");
    assert.equal(h.calls.fetch.length, 5, String(timestamp));
    assert.equal(h.store.versionsCheckedAt, NOW);
    assert.ok(Number.isFinite(h.calls.alarms[0].info.delayInMinutes));
    assert.ok(h.calls.alarms[0].info.delayInMinutes >= 1);
  }
});

test("popup reports switching only for HTTPS URLs and explains disabled switching", async () => {
  const h = harness();
  const secure = await h.message({ type: "get-popup-state", url: "https://mail.google.com/inbox" });
  assert.equal(secure.browser, "chrome");
  for (const url of ["http://google.com", "ftp://google.com", "chrome://extensions", "https://example.org", "invalid"]) {
    const state = await h.message({ type: "get-popup-state", url });
    assert.equal(state.browser, null, url);
  }
  const disabled = harness({ saved: settings({ enabled: false }) });
  const state = await disabled.message({ type: "get-popup-state", url: "https://google.com" });
  assert.equal(state.browser, null);
  assert.match(state.reason, /disabled|turned off|switching is off/i);
});

test("requested tab reloads are limited to HTTPS pages", async () => {
  const http = harness({ tabUrl: "http://google.com/" });
  const httpResult = await http.message({ type: "update-settings", patch: { enabled: false }, tabId: 4, reload: true });
  assert.equal(httpResult.ok, true);
  assert.equal(httpResult.reloaded, false);
  assert.deepEqual(http.calls.reloads, []);

  const https = harness({ tabUrl: "https://google.com/" });
  const httpsResult = await https.message({ type: "update-settings", patch: { enabled: false }, tabId: 4, reload: true });
  assert.equal(httpsResult.ok, true);
  assert.equal(httpsResult.reloaded, true);
  assert.deepEqual(https.calls.reloads, [4]);
});

test("unrecognized host platforms retain native identity unless the user selects a supported OS", async () => {
  const h = harness({ os: "android" });
  await h.run("rebuildHeaderRules()");
  assert.deepEqual(h.rules(), []);
  const native = await h.message({ type: "get-popup-state", url: "https://google.com" });
  assert.equal(native.browser, null);
  const saved = await h.message({ type: "update-settings", patch: { platformMode: "windows" } });
  assert.equal(saved.ok, true);
  const explicit = await h.message({ type: "get-popup-state", url: "https://google.com" });
  assert.equal(explicit.browser, "chrome");
  assert.equal(explicit.platformLabel, "Windows");
});
