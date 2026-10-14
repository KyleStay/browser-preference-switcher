const site = document.querySelector("#site");
const identity = document.querySelector("#identity");
const reason = document.querySelector("#reason");
const enabled = document.querySelector("#enabled");
const platform = document.querySelector("#platform");
const versionStatus = document.querySelector("#version-status");
const refresh = document.querySelector("#refresh");
const message = document.querySelector("#message");
const consentCard = document.querySelector("#consent-card");
const consentHeading = document.querySelector("#consent-heading");
const consentButton = document.querySelector("#accept-consent");
const consentMessage = document.querySelector("#consent-message");

let currentTab;
let currentState;
let consentAccepted = false;
let busy = false;
let loadGeneration = 0;
let initialLoadPromise;
let consentAction = "accept";
const PRIVACY_NOTICE_VERSION = 1;

function hasCurrentConsent(state) {
  return state?.consentAccepted === true && state.privacyNoticeVersion === PRIVACY_NOTICE_VERSION;
}

function setBusy(value) {
  busy = value;
  enabled.disabled = busy || !currentState;
  platform.disabled = busy || !currentState;
  refresh.disabled = busy || !consentAccepted;
  consentButton.disabled = busy;
}

function showUnavailable() {
  site.textContent = "Unable to load this site";
  identity.textContent = "Unavailable";
  reason.textContent = "";
  enabled.checked = false;
  platform.value = "auto";
  versionStatus.textContent = "Version data unavailable";
}

function showConsent() {
  consentAction = "accept";
  consentCard.hidden = false;
  consentHeading.textContent = "Before you continue";
  consentButton.textContent = "Agree and enable";
  setConsentMessage("");
  site.textContent = "Consent required before reading the active tab";
  identity.textContent = "Consent required";
  reason.textContent = "Read the notice below to enable the extension.";
  versionStatus.textContent = "Version data unavailable until enabled";
}

function showInitialLoadError(error) {
  consentAction = "retry";
  consentCard.hidden = false;
  consentHeading.textContent = "Unable to load preferences";
  consentButton.textContent = "Retry";
  site.textContent = "Unable to load preferences";
  identity.textContent = "Unavailable";
  reason.textContent = "Retry to check your local preferences before reading the active tab.";
  versionStatus.textContent = "Version data unavailable";
  setConsentMessage(errorMessage(error), true);
}

function hideConsent() {
  consentCard.hidden = true;
  consentMessage.textContent = "";
  consentMessage.classList.toggle("error", false);
}

function errorMessage(error) {
  return String(error?.message ?? error);
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setConsentMessage(text, isError = false) {
  consentMessage.textContent = text;
  consentMessage.classList.toggle("error", isError);
}

function canReloadTab(tab = currentTab) {
  return tab?.id != null && /^https:\/\//i.test(tab.url ?? "");
}

function reloadMessage(result) {
  if (result.reloadError) return ` Page reload failed: ${result.reloadError}`;
  return result.reloaded ? " Reloading this page to apply it." : "";
}

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
}

async function loadCurrentState() {
  const generation = ++loadGeneration;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const state = await chrome.runtime.sendMessage({ type: "get-popup-state", tabId: tab?.id, url: tab?.url });
    if (!state || state.error) throw new Error(state?.error ?? "Could not load extension settings.");
    if (generation !== loadGeneration) return false;
    if (!hasCurrentConsent(state)) {
      consentAccepted = false;
      currentTab = undefined;
      currentState = undefined;
      showConsent();
      if (!busy) setBusy(false);
      return false;
    }
    currentTab = tab;
    currentState = state;
    render(state);
    if (!busy) setBusy(false);
    return true;
  } catch (error) {
    // An older request must not erase a newer tab/state response.
    if (generation !== loadGeneration) return false;
    currentTab = undefined;
    currentState = undefined;
    showUnavailable();
    if (!busy) setBusy(false);
    throw error;
  }
}

async function load() {
  if (!consentAccepted) {
    if (initialLoadPromise) await initialLoadPromise.catch(() => {});
    if (!consentAccepted) return false;
  }
  return loadCurrentState();
}

async function loadAndReport(text) {
  let stateError = false;
  try {
    await load();
  } catch (error) {
    text += ` Could not update the popup: ${errorMessage(error)}`;
    stateError = true;
  }
  setMessage(text, stateError);
}

async function latestTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    currentTab = tab;
    return tab;
  } catch {
    currentTab = undefined;
    return undefined;
  }
}

async function loadInitial() {
  const state = await chrome.runtime.sendMessage({ type: "get-popup-state" });
  if (!state || state.error) throw new Error(state?.error ?? "Could not load extension settings.");
  consentAccepted = hasCurrentConsent(state);
  if (!consentAccepted) {
    currentTab = undefined;
    currentState = undefined;
    showConsent();
    return false;
  }
  hideConsent();
  return loadCurrentState();
}

async function acceptPrivacyNotice() {
  if (busy || consentAccepted) return;
  setBusy(true);
  setConsentMessage("Saving…");
  let acceptedByThisAttempt = false;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "accept-privacy-notice",
      accepted: true,
      noticeVersion: PRIVACY_NOTICE_VERSION
    });
    if (result?.ok !== true) throw new Error(result?.error ?? "Could not enable the extension.");
    consentAccepted = true;
    acceptedByThisAttempt = true;
    hideConsent();
    if (!await load()) throw new Error("Could not load extension settings after enabling.");
  } catch (error) {
    currentTab = undefined;
    currentState = undefined;
    if (acceptedByThisAttempt) {
      // The acknowledgement was saved; keep it while making the failed tab read recoverable.
      consentAccepted = true;
      showUnavailable();
      setMessage(errorMessage(error), true);
    } else {
      consentAccepted = false;
      showConsent();
      setConsentMessage(errorMessage(error), true);
    }
  } finally {
    setBusy(false);
  }
}

async function retryInitialLoad() {
  if (busy) return;
  setBusy(true);
  setConsentMessage("Loading preferences…");
  try {
    await startInitialLoad();
  } catch {}
}

async function save(patch) {
  if (busy || !currentState) return;
  setBusy(true);
  setMessage("Saving…");
  const tab = await latestTab();
  let confirmedFailure = false;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "update-settings",
      patch,
      tabId: tab?.id,
      reload: canReloadTab(tab)
    });
    if (result?.ok !== true) {
      confirmedFailure = result?.ok === false;
      throw new Error(result?.error ?? "Could not save the setting.");
    }
    await loadAndReport(`Saved.${reloadMessage(result)}`);
  } catch (error) {
    if (confirmedFailure && currentState) render(currentState);
    else {
      currentTab = undefined;
      currentState = undefined;
      showUnavailable();
    }
    setMessage(errorMessage(error), true);
  } finally {
    setBusy(false);
  }
}

enabled.addEventListener("change", () => { void save({ enabled: enabled.checked }); });
platform.addEventListener("change", () => { void save({ platformMode: platform.value }); });
refresh.addEventListener("click", async () => {
  if (busy || !consentAccepted) return;
  setBusy(true);
  setMessage("Checking official release sources…");
  const tab = await latestTab();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "refresh-versions",
      tabId: tab?.id,
      reload: canReloadTab(tab)
    });
    if (!result?.ok) throw new Error(result?.error ?? "Version refresh failed; cached versions remain in use.");
    const text = Object.keys(result.errors ?? {}).length
      ? "Some sources failed; cached versions remain in use for those browsers."
      : "Browser versions updated.";
    await loadAndReport(text + reloadMessage(result));
  } catch (error) {
    setMessage(errorMessage(error), true);
  } finally {
    setBusy(false);
  }
});

consentButton.addEventListener("click", () => consentAction === "retry" ? retryInitialLoad() : acceptPrivacyNotice());

setBusy(true);
function startInitialLoad() {
  initialLoadPromise = loadInitial();
  initialLoadPromise.catch(error => {
    consentAccepted = false;
    currentTab = undefined;
    currentState = undefined;
    showInitialLoadError(error);
  }).finally(() => setBusy(false));
  return initialLoadPromise;
}
void startInitialLoad();
