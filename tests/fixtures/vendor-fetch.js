// Loaded only into a temporary browser-test extension, before background.js.
// Unknown requests fail closed; this fixture never performs network I/O.
globalThis.__ciVendorRequests = [];
globalThis.fetch = async input => {
  const url = new URL(typeof input === "string" ? input : input.url);
  globalThis.__ciVendorRequests.push(url.href);
  // Keep request evidence in extension storage so a service-worker restart cannot
  // erase part of the startup/refresh batch. Each request gets its own key because
  // the five startup fetches run concurrently.
  await chrome.storage.local.set({ [`__ciVendorRequest.${Date.now()}.${Math.random()}`]: url.href });
  let data;
  const chromePlatformMatch = /^\/v1\/chrome\/platforms\/(mac|win64|linux)\/channels\/stable\/versions\/all\/releases$/.exec(url.pathname);
  if (url.origin === "https://versionhistory.googleapis.com" && chromePlatformMatch && url.searchParams.get("filter") === "endtime=none") {
    const version = { mac: "160.0.9000.11", win64: "160.0.9000.12", linux: "160.0.9000.13" }[chromePlatformMatch[1]];
    data = { releases: [{ version, fraction: 1 }] };
  } else if (url.href === "https://edgeupdates.microsoft.com/api/products?view=enterprise") {
    data = [{ Product: "Stable", Releases: [
      { Platform: "MacOS", ProductVersion: "159.0.8100.21" },
      { Platform: "Windows", ProductVersion: "159.0.8100.22" },
      { Platform: "Linux", ProductVersion: "159.0.8100.23" }
    ] }];
  } else if (url.href === "https://developer.apple.com/tutorials/data/documentation/safari-release-notes.json") {
    data = { references: { stable: {
      title: "Safari 27.0.2 Release Notes",
      abstract: [{ text: "Released January 1, 2020 — Local test fixture." }]
    } } };
  } else {
    throw new Error(`Offline CI blocked an unexpected vendor request: ${url.href}`);
  }
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
};
