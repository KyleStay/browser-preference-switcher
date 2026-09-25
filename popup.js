const site = document.querySelector("#site");
const identity = document.querySelector("#identity");
const reason = document.querySelector("#reason");
const enabled = document.querySelector("#enabled");
const platform = document.querySelector("#platform");
const versionStatus = document.querySelector("#version-status");
const refresh = document.querySelector("#refresh");
const message = document.querySelector("#message");

let currentTab;

function browserName(id) {
  return ({ chrome: "Chrome", edge: "Microsoft Edge", safari: "Safari", firefox: "Firefox" })[id] ?? "Native browser";
}

function render(state) {
  site.textContent = state.host || "No web page selected";
  enabled.checked = state.enabled;
  platform.value = state.platformMode;
  identity.textContent = state.browser ? `${browserName(state.browser)} · ${state.platformLabel}` : "Native browser";
  reason.textContent = state.reason ?? "";
  const date = state.versionsCheckedAt ? new Date(state.versionsCheckedAt).toLocaleString() : "not checked yet";
  const errorCount = Object.keys(state.versionErrors ?? {}).length;
  versionStatus.textContent = errorCount ? `Last check ${date} · ${errorCount} source issue(s)` : `Versions checked ${date}`;
  message.textContent = "";
}

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  currentTab = tab;
  const state = await chrome.runtime.sendMessage({ type: "get-popup-state", tabId: tab?.id, url: tab?.url });
  render(state);
}

async function save(patch) {
  if (!currentTab?.id) return;
  const result = await chrome.runtime.sendMessage({
    type: "update-settings",
    patch,
    tabId: currentTab.id,
    reload: true
  });
  if (!result?.ok) message.textContent = result?.error ?? "Could not save the setting.";
  else message.textContent = "Saved. Reloading this page to apply it.";
}

enabled.addEventListener("change", () => { void save({ enabled: enabled.checked }); });
platform.addEventListener("change", () => { void save({ platformMode: platform.value }); });
refresh.addEventListener("click", async () => {
  refresh.disabled = true;
  message.textContent = "Checking official release sources…";
  const result = await chrome.runtime.sendMessage({
    type: "refresh-versions",
    tabId: currentTab?.id,
    reload: true
  });
  refresh.disabled = false;
  if (!result?.ok) message.textContent = result?.error ?? "Version refresh failed; cached versions remain in use.";
  else message.textContent = Object.keys(result.errors ?? {}).length
    ? "Some sources failed; cached versions remain in use for those browsers."
    : "Browser versions updated. Reloading this page.";
  await load();
});

void load();
