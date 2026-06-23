const { app } = require('electron');
const path = require('path');

// This script runs inside Electron's main process to test the auth backend.
app.whenReady().then(async () => {
  const db = require(path.join(__dirname, '../dist/electron/database.js'));

  const init = db.initDb();
  console.log('[Test] DB init result:', init);

  const good = db.authenticateUser('admin', 'admin123');
  console.log('[Test] admin / admin123:', good);

  const bad = db.authenticateUser('admin', 'wrong');
  console.log('[Test] admin / wrong:', bad);

  app.quit();
});
