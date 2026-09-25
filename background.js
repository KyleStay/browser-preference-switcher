const RELEASE_SOURCES = {
  chrome: "https://versionhistory.googleapis.com/v1/chrome/platforms",
  edge: "https://edgeupdates.microsoft.com/api/products?view=enterprise",
  safari: "https://developer.apple.com/documentation/safari-release-notes",
  firefox: "https://product-details.mozilla.org/1.0/firefox_versions.json"
};

const SEEDED_VERSIONS = {
  chrome: { mac: "154.0.8037.58", windows: "154.0.8037.58", linux: "154.0.8037.58" },
  edge: { mac: "153.0.4234.48", windows: "153.0.4234.48", linux: "153.0.4234.48" },
  safari: "26.5",
  firefox: "156.0.1"
};

const DEFAULT_SETTINGS = {
  enabled: true,
  platformMode: "auto",
  versions: SEEDED_VERSIONS,
  versionsCheckedAt: 0,
  versionErrors: {}
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
  return values.filter(Boolean).sort(compareVersions).at(-1) ?? null;
}

async function getSettings() {
  const saved = await chrome.storage.local.get(null);
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    versions: {
      ...SEEDED_VERSIONS,
      ...(saved.versions ?? {}),
      chrome: { ...SEEDED_VERSIONS.chrome, ...(saved.versions?.chrome ?? {}) },
      edge: { ...SEEDED_VERSIONS.edge, ...(saved.versions?.edge ?? {}) }
    }
  };
}

async function reportedOS(mode) {
  if (mode !== "auto" && OS_PROFILES[mode]) return mode;
  const info = await chrome.runtime.getPlatformInfo();
  if (info.os === "mac") return "mac";
  if (info.os === "win") return "windows";
  return "linux";
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function profileFor(host, os, enabled) {
  if (!enabled) return null;
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
    userAgent = `Mozilla/5.0 (${platform.ua}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${targetVersion} Safari/605.1.15`;
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
  } else {
    for (const header of CLIENT_HINT_HEADERS) requestHeaders.push({ header, operation: "remove" });
  }
  return {
    id,
    priority: 1,
    action: { type: "modifyHeaders", requestHeaders },
    condition: { requestDomains: [domain], resourceTypes: RESOURCE_TYPES }
  };
}

async function rebuildHeaderRules() {
  const settings = await getSettings();
  const os = await reportedOS(settings.platformMode);
  const rules = [];
  if (settings.enabled) {
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
  const response = await fetch(url, { cache: "no-store", credentials: "omit" });
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
  if (text.includes("mac")) return "mac";
  if (text.includes("win")) return "windows";
  if (text.includes("linux")) return "linux";
  return null;
}

async function fetchEdgeVersions() {
  const products = await fetchJson(RELEASE_SOURCES.edge);
  const stable = products.find(item => String(item.Product ?? item.product).toLowerCase() === "stable");
  const releases = stable?.Releases ?? stable?.releases ?? [];
  const result = {};
  for (const os of Object.keys(OS_PROFILES)) {
    const candidates = releases
      .filter(item => !platformKey(item.Platform ?? item.platform) || platformKey(item.Platform ?? item.platform) === os)
      .map(item => item.ProductVersion ?? item.productVersion)
      .filter(Boolean);
    result[os] = latestVersion(candidates);
  }
  if (!Object.values(result).some(Boolean)) throw new Error("No Stable Edge versions found");
  return result;
}

async function fetchSafariVersion() {
  const response = await fetch(RELEASE_SOURCES.safari, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const versions = [...html.matchAll(/Safari\s+(\d+(?:\.\d+)*)\s+Release Notes/g)].map(match => match[1]);
  const version = latestVersion(versions);
  if (!version) throw new Error("No stable Safari release found");
  return version;
}

async function fetchFirefoxVersion() {
  const data = await fetchJson(RELEASE_SOURCES.firefox);
  if (!data.LATEST_FIREFOX_VERSION) throw new Error("No current Firefox release found");
  return data.LATEST_FIREFOX_VERSION;
}

async function refreshVersions() {
  const settings = await getSettings();
  const versions = structuredClone(settings.versions);
  const errors = {};
  const jobs = [
    ...Object.entries({ mac: "mac", windows: "win64", linux: "linux" }).map(async ([key, platform]) => {
      versions.chrome[key] = await fetchChromeVersion(platform);
    }),
    (async () => {
      const edge = await fetchEdgeVersions();
      for (const [os, version] of Object.entries(edge)) if (version) versions.edge[os] = version;
    })(),
    (async () => { versions.safari = await fetchSafariVersion(); })(),
    (async () => { versions.firefox = await fetchFirefoxVersion(); })()
  ];
  const settled = await Promise.allSettled(jobs);
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      const key = index < 3 ? `chrome.${["mac", "windows", "linux"][index]}` : ["edge", "safari", "firefox"][index - 3];
      errors[key] = String(result.reason?.message ?? result.reason);
    }
  });
  await chrome.storage.local.set({ versions, versionsCheckedAt: Date.now(), versionErrors: errors });
  await rebuildHeaderRules();
  return { versions, errors, checkedAt: Date.now() };
}

async function initialize() {
  const existing = await chrome.storage.local.get(null);
  const initial = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) initial[key] = value;
  }
  if (Object.keys(initial).length) await chrome.storage.local.set(initial);
  await chrome.alarms.create("refresh-browser-versions", { periodInMinutes: 1440 });
  await rebuildHeaderRules();
  void refreshVersions();
}

chrome.runtime.onInstalled.addListener(() => { void initialize(); });
chrome.runtime.onStartup.addListener(() => { void initialize(); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "refresh-browser-versions") void refreshVersions();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "get-popup-state") {
    (async () => {
      const settings = await getSettings();
      const os = await reportedOS(settings.platformMode);
      const url = message.url ?? "";
      let host = "";
      try { host = new URL(url).hostname; } catch {}
      const match = profileFor(host, os, settings.enabled);
      sendResponse({
        enabled: settings.enabled,
        platformMode: settings.platformMode,
        platformLabel: OS_PROFILES[os].label,
        host,
        browser: match?.browser ?? null,
        reason: match?.reason ?? "No automatic rule matches this site; the native browser identity is used.",
        versions: settings.versions,
        versionsCheckedAt: settings.versionsCheckedAt,
        versionErrors: settings.versionErrors
      });
    })().catch(error => sendResponse({ error: String(error?.message ?? error) }));
    return true;
  }

  if (message.type === "update-settings") {
    (async () => {
      const patch = {};
      if (typeof message.patch?.enabled === "boolean") patch.enabled = message.patch.enabled;
      if (["auto", "mac", "windows", "linux"].includes(message.patch?.platformMode)) patch.platformMode = message.patch.platformMode;
      await chrome.storage.local.set(patch);
      await rebuildHeaderRules();
      if (message.tabId != null && message.reload) await chrome.tabs.reload(message.tabId);
      sendResponse({ ok: true });
    })().catch(error => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  }

  if (message.type === "refresh-versions") {
    refreshVersions().then(async result => {
      if (message.tabId != null && message.reload) await chrome.tabs.reload(message.tabId);
      sendResponse({ ok: true, ...result });
    }).catch(error => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  }
  return false;
});
