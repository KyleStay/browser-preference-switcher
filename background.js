const RELEASE_SOURCES = {
  chrome: "https://versionhistory.googleapis.com/v1/chrome/platforms",
  edge: "https://edgeupdates.microsoft.com/api/products?view=enterprise",
  safari: "https://developer.apple.com/tutorials/data/documentation/safari-release-notes.json"
};

const SEEDED_VERSIONS = {
  chrome: { mac: "154.0.8037.58", windows: "154.0.8037.58", linux: "154.0.8037.58" },
  edge: { mac: "153.0.4234.48", windows: "153.0.4234.48", linux: "153.0.4234.48" },
  safari: "26.5",
  firefox: "156.0.1"
};

const PRIVACY_NOTICE_VERSION = 1;

const DEFAULT_SETTINGS = {
  enabled: false,
  platformMode: "auto",
  versions: SEEDED_VERSIONS,
  versionsCheckedAt: 0,
  versionErrors: {},
  privacyConsentVersion: 0
};

const SITE_RULES = [
  ...["google.com", "youtube.com", "youtu.be"].map(domain => ({
    domain, browser: "chrome", platform: "any", reason: "User preference: report Chrome on Google sites."
  })),
  ...[
    "microsoft.com", "cloud.microsoft", "microsoft365.com", "office.com", "office365.com",
    "outlook.com", "live.com", "onedrive.com", "sharepoint.com", "bing.com", "msn.com", "azure.com",
    "xbox.com", "windows.com", "microsoftonline.com"
  ].map(domain => ({
    domain, browser: "edge", platform: "any", reason: "User preference: report Edge on Microsoft sites."
  })),
  ...["apple.com", "icloud.com"].map(domain => ({
    domain, browser: "safari", platform: "any", reason: "User preference: report Safari on Apple sites."
  }))
];

const RESOURCE_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object",
  "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport",
  "webbundle", "other"
];

const CLIENT_HINT_HEADERS = [
  "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "sec-ch-ua-arch",
  "sec-ch-ua-bitness", "sec-ch-ua-full-version", "sec-ch-ua-full-version-list",
  "sec-ch-ua-model", "sec-ch-ua-platform-version", "sec-ch-ua-wow64",
  "sec-ch-ua-form-factors"
];

const OS_PROFILES = {
  mac: {
    label: "macOS",
    ua: "Macintosh; Intel Mac OS X 10_15_7",
    hintPlatform: "macOS",
  },
  windows: {
    label: "Windows",
    ua: "Windows NT 10.0; Win64; x64",
    hintPlatform: "Windows",
  },
  linux: {
    label: "Linux",
    ua: "X11; Linux x86_64",
    hintPlatform: "Linux",
  }
};

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
let mutationQueue = Promise.resolve();
let refreshInFlight;

// Keep settings and their corresponding rules in order, even across popup/alarm events.
function mutate(operation) {
  const pending = mutationQueue.then(operation);
  mutationQueue = pending.catch(() => {});
  return pending;
}

function privacyConsentRequiredError() {
  const error = new Error("Accept the privacy notice before using automatic switching.");
  error.code = "PRIVACY_CONSENT_REQUIRED";
  return error;
}

function consentResponseFields() {
  return { consentAccepted: false, privacyNoticeVersion: PRIVACY_NOTICE_VERSION };
}

function validVersion(value) {
  return typeof value === "string" && /^[1-9]\d{0,4}(?:\.\d{1,5}){0,3}$/.test(value);
}

function compareVersions(left, right) {
  const a = String(left).match(/\d+/g)?.map(Number) ?? [];
  const b = String(right).match(/\d+/g)?.map(Number) ?? [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function latestVersion(values) {
  return values.filter(validVersion).sort(compareVersions).at(-1) ?? null;
}

async function getSettings() {
  const saved = await chrome.storage.local.get(null);
  const consentAccepted = saved.privacyConsentVersion === PRIVACY_NOTICE_VERSION;
  const versions = structuredClone(SEEDED_VERSIONS);
  for (const browser of ["chrome", "edge"]) {
    for (const os of Object.keys(OS_PROFILES)) {
      if (validVersion(saved.versions?.[browser]?.[os])) versions[browser][os] = saved.versions[browser][os];
    }
  }
  for (const browser of ["safari", "firefox"]) {
    if (validVersion(saved.versions?.[browser])) versions[browser] = saved.versions[browser];
  }
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    enabled: consentAccepted && typeof saved.enabled === "boolean" ? saved.enabled : false,
    platformMode: ["auto", "mac", "windows", "linux"].includes(saved.platformMode) ? saved.platformMode : "auto",
    versionsCheckedAt: Number.isFinite(saved.versionsCheckedAt) && saved.versionsCheckedAt >= 0 ? saved.versionsCheckedAt : 0,
    versionErrors: saved.versionErrors && typeof saved.versionErrors === "object" && !Array.isArray(saved.versionErrors) ? saved.versionErrors : {},
    privacyConsentVersion: consentAccepted ? PRIVACY_NOTICE_VERSION : 0,
    consentAccepted,
    versions
  };
}

async function reportedOS(mode) {
  if (mode !== "auto" && OS_PROFILES[mode]) return mode;
  const info = await chrome.runtime.getPlatformInfo();
  if (info.os === "mac") return "mac";
  if (info.os === "win") return "windows";
  if (info.os === "linux") return "linux";
  return null;
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function profileFor(host, os, enabled) {
  if (!enabled || !OS_PROFILES[os]) return null;
  return SITE_RULES.find(rule => (rule.platform === "any" || rule.platform === OS_PROFILES[os].label) && hostMatches(host, rule.domain)) ?? null;
}

function browserVersion(versions, browser, os) {
  if (browser === "chrome" || browser === "edge") return versions[browser]?.[os] ?? SEEDED_VERSIONS[browser][os];
  return versions[browser] ?? SEEDED_VERSIONS[browser];
}

function hintBrandList(browser, chromeVersion, targetVersion) {
  const chromeMajor = String(chromeVersion).split(".")[0];
  return browser === "edge"
    ? [
        { brand: "Microsoft Edge", version: String(targetVersion).split(".")[0] },
        { brand: "Chromium", version: chromeMajor },
        { brand: "Not_A Brand", version: "99" }
      ]
    : [
        { brand: "Google Chrome", version: chromeMajor },
        { brand: "Chromium", version: chromeMajor },
        { brand: "Not_A Brand", version: "99" }
      ];
}

function makeIdentity(browser, versions, os) {
  const platform = OS_PROFILES[os];
  const targetVersion = browserVersion(versions, browser, os);
  const chromeVersion = browser === "edge" ? targetVersion : browserVersion(versions, "chrome", os);
  const chromeMajor = String(chromeVersion).split(".")[0];
  let userAgent;
  let metadata;

  if (browser === "safari") {
    const safariVersion = /^\d+$/.test(String(targetVersion)) ? `${targetVersion}.0` : targetVersion;
    userAgent = `Mozilla/5.0 (${platform.ua}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safariVersion} Safari/605.1.15`;
  } else if (browser === "firefox") {
    const version = String(targetVersion).split(".").slice(0, 2).join(".");
    userAgent = `Mozilla/5.0 (${platform.ua}; rv:${version}) Gecko/20100101 Firefox/${version}`;
  } else {
    userAgent = `Mozilla/5.0 (${platform.ua}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36${browser === "edge" ? ` Edg/${targetVersion}` : ""}`;
    metadata = {
      brands: hintBrandList(browser, chromeVersion, targetVersion),
      platform: platform.hintPlatform
    };
  }

  return { browser, userAgent, metadata };
}

function quotedBrandList(brands) {
  return brands.map(item => `"${item.brand}";v="${item.version}"`).join(", ");
}

function dynamicRule(id, domain, identity) {
  const requestHeaders = [{ header: "user-agent", operation: "set", value: identity.userAgent }];
  if (identity.metadata) {
    requestHeaders.push(
      { header: "sec-ch-ua", operation: "set", value: quotedBrandList(identity.metadata.brands) },
      { header: "sec-ch-ua-mobile", operation: "set", value: "?0" },
      { header: "sec-ch-ua-platform", operation: "set", value: `"${identity.metadata.platform}"` }
    );
    // Opted-in hints otherwise expose the native browser version and actual OS.
    for (const header of CLIENT_HINT_HEADERS.slice(3)) requestHeaders.push({ header, operation: "remove" });
  } else {
    for (const header of CLIENT_HINT_HEADERS) requestHeaders.push({ header, operation: "remove" });
  }
  return {
    id,
    priority: 1,
    action: { type: "modifyHeaders", requestHeaders },
    condition: { requestDomains: [domain], urlFilter: "|https://", resourceTypes: RESOURCE_TYPES }
  };
}

async function rebuildHeaderRules() {
  return mutate(applyHeaderRules);
}

async function applyHeaderRules() {
  const settings = await getSettings();
  const os = settings.consentAccepted ? await reportedOS(settings.platformMode) : null;
  const rules = [];
  if (settings.enabled && OS_PROFILES[os]) {
    for (const site of SITE_RULES) {
      if (site.platform === "any" || site.platform === OS_PROFILES[os].label) {
        const identity = makeIdentity(site.browser, settings.versions, os);
        rules.push(dynamicRule(rules.length + 1, site.domain, identity));
      }
    }
  }
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRules.map(rule => rule.id),
    addRules: rules
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchChromeVersion(platform) {
  const url = `${RELEASE_SOURCES.chrome}/${platform}/channels/stable/versions/all/releases?filter=endtime%3Dnone`;
  const data = await fetchJson(url);
  const releases = (data.releases ?? []).map(item => item.version).filter(Boolean);
  const fullRollout = (data.releases ?? []).filter(item => item.fraction === 1).map(item => item.version);
  const version = latestVersion(fullRollout.length ? fullRollout : releases);
  if (!version) throw new Error("No current Stable release found");
  return version;
}

function platformKey(value) {
  const text = String(value ?? "").toLowerCase();
  if (["mac", "macos"].includes(text)) return "mac";
  if (["win", "win64", "windows"].includes(text)) return "windows";
  if (text === "linux") return "linux";
  return null;
}

async function fetchEdgeVersions() {
  const products = await fetchJson(RELEASE_SOURCES.edge);
  const stable = products.find(item => String(item.Product ?? item.product).toLowerCase() === "stable");
  const releases = stable?.Releases ?? stable?.releases ?? [];
  const result = {};
  for (const os of Object.keys(OS_PROFILES)) {
    const candidates = releases
      .filter(item => platformKey(item.Platform ?? item.platform) === os)
      .map(item => item.ProductVersion ?? item.productVersion)
      .filter(Boolean);
    result[os] = latestVersion(candidates);
  }
  if (!Object.values(result).some(Boolean)) throw new Error("No Stable Edge versions found");
  return result;
}

async function fetchSafariVersion() {
  const data = await fetchJson(RELEASE_SOURCES.safari);
  const versions = Object.values(data.references ?? {}).flatMap(reference => {
    const match = /^Safari (\d+(?:\.\d+)*) Release Notes$/.exec(reference.title ?? "");
    const summary = (reference.abstract ?? []).map(item => item.text ?? "").join(" ");
    const released = /^Released (.+?)\s+[—–]/.exec(summary);
    const date = released ? Date.parse(released[1]) : NaN;
    return match && Number.isFinite(date) && date <= Date.now() ? [match[1]] : [];
  });
  const version = latestVersion(versions);
  if (!version) throw new Error("No stable Safari release found");
  return version;
}

function refreshVersions() {
  if (!refreshInFlight) {
    refreshInFlight = runVersionRefresh().finally(() => { refreshInFlight = undefined; });
  }
  return refreshInFlight;
}

async function runVersionRefresh() {
  const settings = await getSettings();
  if (!settings.consentAccepted) throw privacyConsentRequiredError();
  const versions = structuredClone(settings.versions);
  const errors = {};
  const jobs = [
    ...Object.entries({ mac: "mac", windows: "win64", linux: "linux" }).map(async ([key, platform]) => {
      versions.chrome[key] = await fetchChromeVersion(platform);
    }),
    (async () => {
      const edge = await fetchEdgeVersions();
      for (const [os, version] of Object.entries(edge)) {
        if (version) versions.edge[os] = version;
        else errors[`edge.${os}`] = "No Stable Edge version found for this platform";
      }
    })(),
    (async () => { versions.safari = await fetchSafariVersion(); })()
  ];
  const settled = await Promise.allSettled(jobs);
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      const key = index < 3 ? `chrome.${["mac", "windows", "linux"][index]}` : ["edge", "safari"][index - 3];
      errors[key] = String(result.reason?.message ?? result.reason);
    }
  });
  const checkedAt = Date.now();
  await mutate(async () => {
    const previous = await getSettings();
    await chrome.storage.local.set({ versions, versionsCheckedAt: checkedAt, versionErrors: errors });
    try { await applyHeaderRules(); }
    catch (error) {
      await chrome.storage.local.set({
        versions: previous.versions,
        versionsCheckedAt: previous.versionsCheckedAt,
        versionErrors: previous.versionErrors
      });
      throw error;
    }
    await scheduleVersionRefreshAlarm(checkedAt, true);
  });
  return { versions, errors, checkedAt };
}

function refreshAlarmInfo(checkedAt, reset) {
  const age = Date.now() - checkedAt;
  return {
    delayInMinutes: !reset && checkedAt && age >= 0 && age < REFRESH_INTERVAL_MS
      ? Math.max(1, (REFRESH_INTERVAL_MS - age) / 60000) : 1440,
    periodInMinutes: 1440
  };
}

async function scheduleVersionRefreshAlarm(checkedAt, reset = false) {
  try {
    await chrome.alarms.create("refresh-browser-versions", refreshAlarmInfo(checkedAt, reset));
  } catch (error) {
    reportBackgroundError(error);
  }
}

async function initialize() {
  let initializationError;
  try {
    await mutate(async () => {
      const existing = await chrome.storage.local.get(null);
      const initial = {};
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (existing[key] === undefined) initial[key] = value;
      }
      if (Object.keys(initial).length) await chrome.storage.local.set(initial);
      await applyHeaderRules();
    });
  } catch (error) {
    initializationError = error;
  }

  let settings;
  try {
    settings = await getSettings();
    if (settings.consentAccepted) await scheduleVersionRefreshAlarm(settings.versionsCheckedAt);
  } catch (error) {
    if (initializationError) reportBackgroundError(error);
    else initializationError = error;
  }
  if (initializationError) throw initializationError;
  if (!settings.consentAccepted) return;

  const age = Date.now() - settings.versionsCheckedAt;
  if (!settings.versionsCheckedAt || age >= REFRESH_INTERVAL_MS || age < 0) await refreshVersions();
}

function reportBackgroundError(error) { console.error("Browser Preference Switcher:", error); }

async function refreshFromAlarm() {
  const settings = await getSettings();
  if (!settings.consentAccepted) return;
  await refreshVersions();
}

chrome.runtime.onInstalled.addListener(() => { void initialize().catch(reportBackgroundError); });
chrome.runtime.onStartup.addListener(() => { void initialize().catch(reportBackgroundError); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "refresh-browser-versions") void refreshFromAlarm().catch(reportBackgroundError);
});

async function reloadRequestedTab(message) {
  if (!message.reload || !Number.isInteger(message.tabId)) return { reloaded: false };
  try {
    const tab = await chrome.tabs.get(message.tabId);
    if (!/^https:\/\//i.test(tab.url ?? "")) return { reloaded: false };
    await chrome.tabs.reload(message.tabId);
    return { reloaded: true };
  } catch (error) {
    return { reloaded: false, reloadError: String(error?.message ?? error) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "get-popup-state") {
    (async () => {
      await mutationQueue;
      const settings = await getSettings();
      if (!settings.consentAccepted) {
        sendResponse({
          enabled: false,
          platformMode: settings.platformMode,
          platformLabel: "This device's OS",
          host: "",
          browser: null,
          reason: "Accept the privacy notice to enable automatic switching.",
          versions: settings.versions,
          versionsCheckedAt: settings.versionsCheckedAt,
          versionErrors: settings.versionErrors,
          ...consentResponseFields()
        });
        return;
      }
      const os = await reportedOS(settings.platformMode);
      const url = message.url ?? "";
      let host = "";
      let protocol = "";
      try { const parsed = new URL(url); host = parsed.hostname; protocol = parsed.protocol; } catch {}
      const match = protocol === "https:" ? profileFor(host, os, settings.enabled) : null;
      sendResponse({
        enabled: settings.enabled,
        platformMode: settings.platformMode,
        platformLabel: OS_PROFILES[os]?.label ?? "This device's OS",
        host,
        browser: match?.browser ?? null,
        reason: !settings.enabled ? "Automatic switching is off; the native browser identity is used."
          : !OS_PROFILES[os] ? "This device's OS is unsupported; the native browser identity is used."
          : protocol !== "https:" ? "Automatic switching applies to HTTPS sites only."
          : match?.reason ?? "No automatic rule matches this site; the native browser identity is used.",
        versions: settings.versions,
        versionsCheckedAt: settings.versionsCheckedAt,
        versionErrors: settings.versionErrors,
        consentAccepted: true,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION
      });
    })().catch(error => sendResponse({ error: String(error?.message ?? error) }));
    return true;
  }

  if (message?.type === "accept-privacy-notice") {
    (async () => {
      if (message.noticeVersion !== PRIVACY_NOTICE_VERSION || message.accepted !== true) {
        sendResponse({ ok: false, error: "Unsupported privacy notice version.", ...consentResponseFields() });
        return;
      }
      await mutate(async () => {
        const previous = await getSettings();
        await chrome.storage.local.set({ privacyConsentVersion: PRIVACY_NOTICE_VERSION, enabled: true });
        try {
          await applyHeaderRules();
          await scheduleVersionRefreshAlarm(previous.versionsCheckedAt);
        } catch (error) {
          await chrome.storage.local.set({
            privacyConsentVersion: previous.privacyConsentVersion,
            enabled: previous.enabled
          });
          throw error;
        }
      });
      sendResponse({ ok: true, enabled: true, ...consentResponseFields(), consentAccepted: true });
      void refreshVersions().catch(reportBackgroundError);
    })().catch(error => sendResponse({ ok: false, error: String(error?.message ?? error), ...consentResponseFields() }));
    return true;
  }

  if (message?.type === "update-settings") {
    (async () => {
      const patch = {};
      if (typeof message.patch?.enabled === "boolean") patch.enabled = message.patch.enabled;
      if (["auto", "mac", "windows", "linux"].includes(message.patch?.platformMode)) patch.platformMode = message.patch.platformMode;
      await mutate(async () => {
        const previous = await getSettings();
        if (!previous.consentAccepted) throw privacyConsentRequiredError();
        await chrome.storage.local.set(patch);
        try { await applyHeaderRules(); }
        catch (error) {
          await chrome.storage.local.set({ enabled: previous.enabled, platformMode: previous.platformMode });
          throw error;
        }
      });
      sendResponse({ ok: true, ...await reloadRequestedTab(message) });
    })().catch(error => sendResponse({
      ok: false,
      error: String(error?.message ?? error),
      ...(error?.code === "PRIVACY_CONSENT_REQUIRED" ? consentResponseFields() : {})
    }));
    return true;
  }

  if (message?.type === "refresh-versions") {
    refreshVersions().then(async result => {
      sendResponse({ ok: true, ...result, ...await reloadRequestedTab(message) });
    }).catch(error => sendResponse({
      ok: false,
      error: String(error?.message ?? error),
      ...(error?.code === "PRIVACY_CONSENT_REQUIRED" ? consentResponseFields() : {})
    }));
    return true;
  }
  return false;
});
