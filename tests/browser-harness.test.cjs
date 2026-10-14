const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const fixtureSource = fs.readFileSync(path.join(__dirname, "fixtures/vendor-fetch.js"), "utf8");

function fixture() {
  const storage = {};
  const context = vm.createContext({
    URL,
    Response,
    Date,
    Math,
    console,
    chrome: {
      storage: {
        local: {
          set: async values => Object.assign(storage, values),
          get: async () => ({ ...storage })
        }
      }
    }
  });
  vm.runInContext(fixtureSource, context, { filename: "vendor-fetch.js" });
  return { context, storage };
}

const expected = {
  "https://versionhistory.googleapis.com/v1/chrome/platforms/mac/channels/stable/versions/all/releases?filter=endtime%3Dnone": {
    releases: [{ version: "160.0.9000.11", fraction: 1 }]
  },
  "https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions/all/releases?filter=endtime%3Dnone": {
    releases: [{ version: "160.0.9000.12", fraction: 1 }]
  },
  "https://versionhistory.googleapis.com/v1/chrome/platforms/linux/channels/stable/versions/all/releases?filter=endtime%3Dnone": {
    releases: [{ version: "160.0.9000.13", fraction: 1 }]
  },
  "https://edgeupdates.microsoft.com/api/products?view=enterprise": [{
    Product: "Stable",
    Releases: [
      { Platform: "MacOS", ProductVersion: "159.0.8100.21" },
      { Platform: "Windows", ProductVersion: "159.0.8100.22" },
      { Platform: "Linux", ProductVersion: "159.0.8100.23" }
    ]
  }],
  "https://developer.apple.com/tutorials/data/documentation/safari-release-notes.json": {
    references: { stable: {
      title: "Safari 27.0.2 Release Notes",
      abstract: [{ text: "Released January 1, 2020 — Local test fixture." }]
    } }
  },
};

test("offline vendor fixture returns each exact release payload and records every request", async () => {
  const { context, storage } = fixture();
  const urls = Object.keys(expected);
  const responses = await Promise.all(urls.map(url => context.fetch(url)));
  const payloads = await Promise.all(responses.map(response => response.json()));

  assert.deepEqual(JSON.parse(JSON.stringify(payloads)), urls.map(url => expected[url]));
  assert.deepEqual(Array.from(context.__ciVendorRequests).sort(), urls.slice().sort());
  const persisted = Object.entries(storage)
    .filter(([key]) => key.startsWith("__ciVendorRequest."))
    .map(([, url]) => url);
  assert.deepEqual(persisted.slice().sort(), urls.slice().sort());
});

test("offline vendor fixture rejects unknown release sources without network fallback", async () => {
  const { context, storage } = fixture();
  const url = "https://unexpected.example.test/releases.json";
  await assert.rejects(context.fetch(url), /Offline CI blocked an unexpected vendor request/);
  assert.deepEqual(Array.from(context.__ciVendorRequests), [url]);
  assert.equal(Object.keys(storage).filter(key => key.startsWith("__ciVendorRequest.")).length, 1);
});
