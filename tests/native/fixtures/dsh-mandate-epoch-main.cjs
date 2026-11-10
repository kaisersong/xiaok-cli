"use strict";
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url"),
  assert = require("node:assert/strict");
const [bundle, root, resultFile] = process.argv.slice(2);
app.setPath("userData", path.join(root, "electron"));
app.disableHardwareAcceleration();
let failure, window, realm, user, store;
async function run() {
  await app.whenReady();
  const api = await import(pathToFileURL(bundle).href);
  const scope = { profileId: "a".repeat(64), workspaceId: "b".repeat(64) };
  const html = path.join(root, "index.html"),
    preload = path.join(root, "preload.cjs");
  fs.writeFileSync(
    html,
    "<!doctype html><body>Original user mandate revision</body>",
  );
  fs.writeFileSync(
    preload,
    "const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('verify',()=>ipcRenderer.invoke('fixture:mandate-epoch'));",
  );
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  realm = api.createMainDshBootstrapAuthority();
  user = api.createMainDshControlSource({
    window,
    scope,
    isTrustedUrl: (url) => url === pathToFileURL(html).href,
  });
  store = new api.DesktopMultiAgentStore(path.join(root, "groups.sqlite"), {
    dshAdmissionSource: realm,
    dshUserControlSource: user,
  });
  realm.bindStore(store);
  user.bindStore(store);
  store.claimBootOwnership();
  const port = api.readOriginalDshAdmissionPort(store, realm);
  ipcMain.handle("fixture:mandate-epoch", (event) => {
    const state = api.readOriginalDshDesktopState(realm, store, realm, scope),
      published = state.authorizations.publishedMandates[0];
    assert.ok(published);
    const projection = JSON.parse(JSON.stringify(published.projection)),
      oldEpoch = projection.document.authorizationEpoch;
    projection.document.revision++;
    projection.contentHash = null;
    function publish() {
      const frame = user.open(
        event,
        "mandate_control",
        { projection, expectedHeadRevision: published.headRevision },
        "user",
      );
      try {
        return port.putMandate(frame.proof, {
          requestSource: "user",
          bodyHash: frame.bodyHash,
          bootstrapAuthority: realm,
        });
      } finally {
        frame.release();
      }
    }
    const sourceConfiguration = state.sourceConfigurations[0].configuration;
    const budgetBody = {
      schemaVersion: 1,
      kind: "budget_config",
      account: {
        accountId: projection.document.budgetRef,
        tokenLimit: 2000000,
        costLimitMicros: 1000000,
        currency: "USD",
        scale: 6,
        validUntil: Date.parse("2027-01-01T00:00:00Z"),
      },
      mandate: {
        tenantId: sourceConfiguration.binding.authScope.tenantId,
        mandateId: projection.document.mandateId,
        mandateRevision: projection.document.revision,
      },
    };
    const budgetFrame = user.open(event, "policy_control", budgetBody, "user");
    const audience = api.readOriginalDshUserBudgetAudience(
      realm,
      store,
      realm,
      budgetFrame.proof,
      budgetFrame.bodyHash,
    );
    assert.equal(audience.authorizationEpoch, oldEpoch + 1);
    assert.equal(audience.issuerEpoch, state.authority.authorityEpoch);
    audience.assertCurrent();
    audience.assertLocal();
    assert.throws(publish, /DSH_A_MANDATE_EPOCH_CONFLICT/);
    projection.document.authorizationEpoch = oldEpoch + 1;
    const next = publish();
    assert.equal(next.ok, true);
    const after = api.readOriginalDshDesktopState(realm, store, realm, scope),
      document = after.authorizations.publishedMandates[0].projection.document;
    assert.equal(document.revision, projection.document.revision);
    assert.equal(document.authorizationEpoch, oldEpoch + 1);
    assert.equal(
      after.authority.authorityEpoch,
      state.authority.authorityEpoch,
    );
    assert.throws(
      () => audience.assertCurrent(),
      /DSH_A_BUDGET_AUDIENCE_STALE/,
    );
    budgetFrame.release();
    return {
      mandateRevision: document.revision,
      authorizationEpoch: document.authorizationEpoch,
      issuerEpoch: after.authority.authorityEpoch,
    };
  });
  await window.loadFile(html);
  const facts = await window.webContents.executeJavaScript("window.verify()");
  return {
    ok: true,
    pid: process.pid,
    actualMain: true,
    actualUserSource: true,
    noBudgetMutation: true,
    noNativeNGrant: true,
    ...facts,
  };
}
run()
  .then(
    (facts) => fs.writeFileSync(resultFile, JSON.stringify(facts)),
    (error) => {
      failure = error;
    },
  )
  .finally(async () => {
    try {
      user?.seal();
      await user?.drain();
      realm?.seal();
      if (store) {
        await apiWait();
        store.close();
      }
      window?.destroy();
    } catch (error) {
      failure ??= error;
    }
    if (failure) {
      process.stderr.write((failure?.stack || String(failure)) + "\n");
      fs.writeFileSync(
        resultFile,
        JSON.stringify({ ok: false, pid: process.pid, error: String(failure) }),
      );
    }
    app.exit(failure ? 1 : 0);
    async function apiWait() {
      const api = await import(pathToFileURL(bundle).href);
      await api.readOriginalDshAdmissionPort(store, realm).waitKnown();
    }
  });
