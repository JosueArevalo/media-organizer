const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1000,
    height: 760,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  await window.loadURL(process.env.MEDIA_ORGANIZER_INTERACTION_URL);
});

app.on('window-all-closed', () => app.quit());
