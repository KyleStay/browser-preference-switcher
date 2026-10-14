const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
const markup = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");
const state = {
  consentAccepted: true,
  privacyNoticeVersion: 1,
  enabled: true,
  platformMode: "auto",
  platformLabel: "macOS",
  host: "google.com",
  browser: "chrome",
  reason: "Test rule",
  versionsCheckedAt: 0
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const requestOf = (requests, type) => requests.find(request => request.type === type);

function setup({ tab = { id: 1, url: "https://google.com/" }, query, handler } = {}) {
  const elements = {};
  for (const id of ["site", "identity", "reason", "enabled", "platform", "version-status", "refresh", "message", "consent-card", "consent-heading", "accept-consent", "consent-message"]) {
    const classes = new Set();
    elements[id] = {
      textContent: "",
      hidden: false,
      disabled: false,
      handlers: {},
      classList: {
        toggle(name, active) { active ? classes.add(name) : classes.delete(name); },
        contains(name) { return classes.has(name); }
      },
      addEventListener(type, callback) { this.handlers[type] = callback; }
    };
  }
  const requests = [];
  const calls = { tabs: 0 };
  const context = vm.createContext({
    document: { querySelector: selector => elements[selector.slice(1)] },
    chrome: {
      tabs: { query: async () => { calls.tabs += 1; return query ? query() : (tab ? [tab] : []); } },
      runtime: {
        sendMessage: async request => {
          requests.push(request);
          return handler ? handler(request) : { ...state };
        }
      }
    }
  });
  vm.runInContext(source, context);
  return { calls, context, elements, requests };
}

test("first use gates the popup without reading the active tab or refreshing versions", async () => {
  let refreshCalls = 0;
  const { calls, elements, requests } = setup({
    handler: request => {
      if (request.type === "get-popup-state") return { ...state, consentAccepted: false };
      refreshCalls += 1;
      return { ok: true, reloaded: false, errors: {} };
    }
  });
  await tick();
  assert.equal(calls.tabs, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].type, "get-popup-state");
  assert.equal(elements["consent-card"].hidden, false);
  assert(!elements["accept-consent"].disabled);
  assert(elements.enabled.disabled && elements.platform.disabled && elements.refresh.disabled);
  await elements.refresh.handlers.click();
  assert.equal(refreshCalls, 0);
});

test("an old consent notice version requires the current notice", async () => {
  const { calls, elements } = setup({
    handler: request => request.type === "get-popup-state" ? { ...state, privacyNoticeVersion: 0 } : { ok: true }
  });
  await tick();
  assert.equal(calls.tabs, 0);
  assert.equal(elements["consent-card"].hidden, false);
  assert(!elements["accept-consent"].disabled);
});

test("acceptance sends the notice version, then reads the active tab and enables controls", async () => {
  let accepted = false;
  const { calls, elements, requests } = setup({
    handler: request => {
      if (request.type === "get-popup-state") return { ...state, consentAccepted: accepted };
      if (request.type === "accept-privacy-notice") {
        accepted = true;
        return { ok: true };
      }
      return { ok: true, reloaded: false };
    }
  });
  await tick();
  await elements["accept-consent"].handlers.click();
  const acceptance = requestOf(requests, "accept-privacy-notice");
  assert.equal(acceptance.accepted, true);
  assert.equal(acceptance.noticeVersion, 1);
  assert.equal(calls.tabs, 1);
  assert.equal(elements["consent-card"].hidden, true);
  assert(!elements.enabled.disabled && !elements.platform.disabled && !elements.refresh.disabled);
});

test("acceptance failure keeps the notice and button available for retry", async () => {
  let attempt = 0;
  let accepted = false;
  const { calls, elements } = setup({
    handler: request => {
      if (request.type === "get-popup-state") return { ...state, consentAccepted: accepted };
      if (request.type === "accept-privacy-notice") {
        attempt += 1;
        if (attempt === 1) return { ok: false, error: "Could not save consent" };
        accepted = true;
        return { ok: true };
      }
      return { ok: true, reloaded: false };
    }
  });
  await tick();
  await elements["accept-consent"].handlers.click();
  assert.equal(elements["consent-card"].hidden, false);
  assert.equal(elements["consent-message"].textContent, "Could not save consent");
  assert(!elements["accept-consent"].disabled);
  assert.equal(calls.tabs, 0);
  await elements["accept-consent"].handlers.click();
  assert.equal(elements["consent-card"].hidden, true);
  assert.equal(calls.tabs, 1);
});

test("returning users skip onboarding and load the active tab once", async () => {
  const { calls, elements } = setup();
  await tick();
  assert.equal(elements["consent-card"].hidden, true);
  assert.equal(calls.tabs, 1);
  assert(!elements.enabled.disabled && !elements.platform.disabled);
});

test("consent disclosure keeps the required privacy policy link accessible", () => {
  assert.match(markup, /This extension reads the active tab’s address locally to show its site and configured request identity\. Addresses are not stored or sent to the developer\. Your settings stay on this device\. Release checks contact Google, Microsoft, and Apple; those servers receive normal connection details\. It changes request headers on selected HTTPS sites, not the browser engine or JavaScript identity\./);
  assert.match(markup, /href="https:\/\/github\.com\/KyleStay\/browser-preference-switcher\/blob\/main\/PRIVACY\.md" target="_blank" rel="noopener"/);
});

test("controls wait for the initial popup state", async () => {
  let unblock;
  const { elements } = setup({ handler: () => new Promise(resolve => { unblock = resolve; }) });
  assert(elements.enabled.disabled && elements.platform.disabled && elements.refresh.disabled);
  await tick();
  unblock({ ...state });
  await tick();
  unblock({ ...state });
  await tick();
  assert(!elements.enabled.disabled && !elements.platform.disabled && !elements.refresh.disabled);
});

test("global settings save without a selected tab and display the updated state", async () => {
  let saved = false;
  const { elements, requests } = setup({
    tab: null,
    handler: request => request.type === "get-popup-state"
      ? { ...state, enabled: !saved, host: "" }
      : (saved = true, { ok: true, reloaded: false })
  });
  await tick();
  elements.enabled.checked = false;
  elements.enabled.handlers.change();
  await tick();
  const update = requestOf(requests, "update-settings");
  assert.equal(update.reload, false);
  assert.equal(update.tabId, undefined);
  assert.equal(elements.enabled.checked, false);
  assert.equal(elements.message.textContent, "Saved.");
  assert(!elements.message.classList.contains("error"));
});

test("settings save samples the active browser tab immediately before updating it", async () => {
  const oldTab = { id: 1, url: "https://google.com/" };
  const activeTab = { id: 2, url: "https://youtube.com/" };
  let queryCount = 0;
  const { elements, requests } = setup({
    query: () => [queryCount++ === 0 ? oldTab : activeTab],
    handler: request => request.type === "get-popup-state" ? { ...state } : { ok: true, reloaded: false }
  });
  await tick();
  elements.platform.value = "windows";
  elements.platform.handlers.change();
  await tick();
  const update = requestOf(requests, "update-settings");
  assert.equal(update.tabId, activeTab.id);
  assert.equal(update.reload, true);
});

for (const url of ["chrome://extensions", "file:///tmp/test.html", "http://google.com/"]) {
  test(`settings do not request a reload for ${url}`, async () => {
    const { elements, requests } = setup({
      tab: { id: 1, url },
      handler: request => request.type === "get-popup-state" ? { ...state } : { ok: true, reloaded: false }
    });
    await tick();
    elements.platform.value = "windows";
    elements.platform.handlers.change();
    await tick();
    assert.equal(requestOf(requests, "update-settings").reload, false);
  });
}

test("version refresh does not request an HTTP page reload", async () => {
  const { elements, requests } = setup({
    tab: { id: 1, url: "http://google.com/" },
    handler: request => request.type === "get-popup-state" ? { ...state } : { ok: true, reloaded: false, errors: {} }
  });
  await tick();
  await elements.refresh.handlers.click();
  assert.equal(requestOf(requests, "refresh-versions").reload, false);
});

test("refresh preserves partial-source feedback and renders the new identity", async () => {
  let refreshed = false;
  const { elements, requests } = setup({
    handler: request => request.type === "get-popup-state"
      ? { ...state, platformMode: refreshed ? "windows" : "auto", platformLabel: refreshed ? "Windows" : "macOS" }
      : (refreshed = true, { ok: true, reloaded: true, errors: { safari: "offline" } })
  });
  await tick();
  await elements.refresh.handlers.click();
  assert.equal(requestOf(requests, "refresh-versions").reload, true);
  assert.match(elements.message.textContent, /Some sources failed/);
  assert.match(elements.message.textContent, /Reloading/);
  assert.equal(elements.identity.textContent, "Chrome · Windows");
});

test("version refresh samples the active browser tab before requesting a reload", async () => {
  const oldTab = { id: 1, url: "https://google.com/" };
  const activeTab = { id: 2, url: "https://youtube.com/" };
  let queryCount = 0;
  const { elements, requests } = setup({
    query: () => [queryCount++ === 0 ? oldTab : activeTab],
    handler: request => request.type === "get-popup-state" ? { ...state } : { ok: true, reloaded: false, errors: {} }
  });
  await tick();
  await elements.refresh.handlers.click();
  const refreshRequest = requestOf(requests, "refresh-versions");
  assert.equal(refreshRequest.tabId, activeTab.id);
  assert.equal(refreshRequest.reload, true);
});

test("rejected refresh messaging reports the error and restores controls", async () => {
  const { elements } = setup({
    handler: request => {
      if (request.type === "get-popup-state") return { ...state };
      throw new Error("Connection closed");
    }
  });
  await tick();
  await elements.refresh.handlers.click();
  assert.equal(elements.message.textContent, "Connection closed");
  assert(elements.message.classList.contains("error"));
  assert(!elements.refresh.disabled && !elements.enabled.disabled);
});

test("save blocks concurrent refresh and preserves success when page reload fails", async () => {
  let unblock;
  const { elements, requests } = setup({
    handler: request => request.type === "get-popup-state"
      ? { ...state }
      : new Promise(resolve => { unblock = resolve; })
  });
  await tick();
  elements.enabled.checked = false;
  elements.enabled.handlers.change();
  await tick();
  await elements.refresh.handlers.click();
  assert.equal(requests.filter(request => request.type === "get-popup-state").length, 2);
  assert.equal(requests.filter(request => request.type === "update-settings").length, 1);
  assert(elements.enabled.disabled && elements.platform.disabled && elements.refresh.disabled);
  unblock({ ok: true, reloaded: false, reloadError: "Tab closed" });
  await tick();
  assert.match(elements.message.textContent, /Saved.*Page reload failed: Tab closed/);
});

test("initial global state failure offers a safe retry before reading tabs", async () => {
  let attempts = 0;
  const { calls, elements } = setup({
    handler: request => {
      if (request.type !== "get-popup-state") return { ok: true, reloaded: false, errors: {} };
      attempts += 1;
      return attempts === 1 ? { error: "State unavailable" } : { ...state };
    }
  });
  await tick();
  assert.equal(calls.tabs, 0);
  assert.equal(elements["consent-card"].hidden, false);
  assert.equal(elements["consent-heading"].textContent, "Unable to load preferences");
  assert.equal(elements["accept-consent"].textContent, "Retry");
  assert.equal(elements["consent-message"].textContent, "State unavailable");
  assert(elements.enabled.disabled && elements.platform.disabled && elements.refresh.disabled);
  await elements["accept-consent"].handlers.click();
  assert.equal(calls.tabs, 1);
  assert.equal(elements["consent-card"].hidden, true);
  assert(!elements.enabled.disabled && !elements.platform.disabled && !elements.refresh.disabled);
});

test("accepted consent stays acknowledged when the first active-tab load fails", async () => {
  let accepted = false;
  const { calls, elements } = setup({
    handler: request => {
      if (request.type === "get-popup-state") {
        return accepted ? { error: "Tab state unavailable" } : { ...state, consentAccepted: false };
      }
      if (request.type === "accept-privacy-notice") {
        accepted = true;
        return { ok: true };
      }
      return { ok: true, reloaded: false };
    }
  });
  await tick();
  await elements["accept-consent"].handlers.click();
  assert.equal(calls.tabs, 1);
  assert.equal(elements["consent-card"].hidden, true);
  assert.equal(elements.identity.textContent, "Unavailable");
  assert.equal(elements.message.textContent, "Tab state unavailable");
  assert(elements.message.classList.contains("error"));
  assert(elements.enabled.disabled && elements.platform.disabled);
  assert(!elements.refresh.disabled);
});

test("a successful refresh disables stale controls when the follow-up state request fails", async () => {
  let stateCalls = 0;
  const { elements } = setup({
    handler: request => request.type === "get-popup-state"
      ? (++stateCalls <= 2 ? { ...state } : { error: "State connection closed" })
      : { ok: true, reloaded: false, errors: {} }
  });
  await tick();
  await elements.refresh.handlers.click();
  assert.match(elements.message.textContent, /Browser versions updated\. Could not update the popup: State connection closed/);
  assert(elements.enabled.disabled && elements.platform.disabled);
  assert.equal(elements.identity.textContent, "Unavailable");
  assert(!elements.refresh.disabled);
});

test("save failure restores the last confirmed settings", async () => {
  const { elements } = setup({
    handler: request => request.type === "get-popup-state"
      ? { ...state }
      : { ok: false, error: "Could not persist settings" }
  });
  await tick();
  elements.enabled.checked = false;
  elements.enabled.handlers.change();
  await tick();
  assert.equal(elements.enabled.checked, true);
  assert.equal(elements.message.textContent, "Could not persist settings");
  assert(!elements.enabled.disabled);
});

test("a save transport failure invalidates the state before allowing recovery", async () => {
  const { elements } = setup({
    handler: request => request.type === "get-popup-state"
      ? { ...state }
      : Promise.reject(new Error("Connection closed while saving"))
  });
  await tick();
  elements.platform.value = "windows";
  elements.platform.handlers.change();
  await tick();
  assert.equal(elements.message.textContent, "Connection closed while saving");
  assert(elements.enabled.disabled && elements.platform.disabled);
  assert.equal(elements.identity.textContent, "Unavailable");
  assert(!elements.refresh.disabled);
});

test("an empty save response invalidates state because the outcome is unknown", async () => {
  const { elements } = setup({
    handler: request => request.type === "get-popup-state" ? { ...state } : undefined
  });
  await tick();
  elements.platform.value = "windows";
  elements.platform.handlers.change();
  await tick();
  assert.equal(elements.message.textContent, "Could not save the setting.");
  assert(elements.enabled.disabled && elements.platform.disabled);
  assert.equal(elements.identity.textContent, "Unavailable");
  assert(!elements.refresh.disabled);
});

test("a successful save disables stale controls when the follow-up popup state request fails", async () => {
  let saved = false;
  const { elements } = setup({
    handler: request => request.type === "get-popup-state"
      ? (saved ? { error: "State connection closed" } : { ...state })
      : (saved = true, { ok: true, reloaded: false })
  });
  await tick();
  elements.enabled.checked = false;
  elements.enabled.handlers.change();
  await tick();
  assert.match(elements.message.textContent, /Saved.*Could not update the popup: State connection closed/);
  assert(elements.enabled.disabled && elements.platform.disabled);
  assert.equal(elements.identity.textContent, "Unavailable");
  assert(!elements.refresh.disabled);
});

test("an older asynchronous state response cannot overwrite a newer popup state", async () => {
  const pending = [];
  const { context, elements } = setup({
    handler: request => request.type === "get-popup-state"
      ? new Promise(resolve => pending.push(resolve))
      : { ok: true, reloaded: false }
  });
  while (pending.length < 1) await tick();
  pending[0]({ ...state });
  while (pending.length < 2) await tick();
  const newerLoad = context.load();
  while (pending.length < 3) await tick();
  pending[1]({ ...state, platformMode: "auto", platformLabel: "macOS" });
  await tick();
  pending[2]({ ...state, platformMode: "windows", platformLabel: "Windows" });
  await newerLoad;
  await tick();
  assert.equal(elements.identity.textContent, "Chrome · Windows");
  assert(!elements.enabled.disabled && !elements.platform.disabled);
  assert(!elements.message.classList.contains("error"));
});
