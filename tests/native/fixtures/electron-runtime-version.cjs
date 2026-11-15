const {app} = require('electron');
const fs = require('node:fs');
const [resultPath, userData] = process.argv.slice(2);
app.setPath('userData', userData);
app.whenReady().then(() => {
  const {DatabaseSync, StatementSync} = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const sqlite = db.prepare('select sqlite_version() version').get().version;
  db.close();
  fs.writeFileSync(resultPath, JSON.stringify({
    electron: process.versions.electron,
    node: process.versions.node,
    sqlite,
    databaseCapabilities: Object.getOwnPropertyNames(DatabaseSync.prototype).sort(),
    statementCapabilities: Object.getOwnPropertyNames(StatementSync.prototype).sort(),
    databaseSymbols: Object.getOwnPropertySymbols(DatabaseSync.prototype).map(String).sort(),
    statementSymbols: Object.getOwnPropertySymbols(StatementSync.prototype).map(String).sort(),
    type: process.type,
    dockVisible: app.dock?.isVisible(),
  }));
  app.quit();
});
