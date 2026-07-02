const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

let mainWindow = null;

// Resolve the configuration path to be 100% compatible with Tauri's config location
function getConfigPath() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'StationOS', 'config.json');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'StationOS', 'config.json');
  } else {
    // Linux/Unix fallback
    return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'StationOS', 'config.json');
  }
}

// Read saved server URL
function getSavedServerUrl() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return data.serverUrl || null;
    } catch (e) {
      console.error('Failed to read config:', e);
      return null;
    }
  }
  return null;
}

// Save server URL to config
function saveServerUrl(url) {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify({ serverUrl: url }), 'utf8');
}

// Clear config
function clearConfig() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      fs.unlinkSync(configPath);
    } catch (e) {
      console.error('Failed to clear config:', e);
    }
  }
}

// Get the absolute path to the launcher UI
function getLauncherPath() {
  return path.join(app.getAppPath(), 'thin-client-ui', 'index.html');
}

// Load the launcher UI
async function loadLauncher() {
  if (mainWindow) {
    const launcherPath = getLauncherPath();
    if (fs.existsSync(launcherPath)) {
      await mainWindow.loadFile(launcherPath);
    } else {
      console.error('Launcher UI not found at:', launcherPath);
      // Fallback for dev mode if path structure differs
      const devLauncherPath = path.join(__dirname, '..', 'thin-client-ui', 'index.html');
      if (fs.existsSync(devLauncherPath)) {
        await mainWindow.loadFile(devLauncherPath);
      } else {
        await mainWindow.loadURL('data:text/html,<h1>Station Monitor Launcher UI not found.</h1>');
      }
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    resizable: true,
    center: true,
    backgroundColor: '#0f172a',
    title: 'Hệ Thống Giám Sát — Station Monitor',
    darkTheme: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.maximize();
  mainWindow.focus();

  // Live wall popup — frameless, no OS chrome, pure camera grid
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('/live-wall')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          frame: false,
          titleBarStyle: 'hidden',
          autoHideMenuBar: true,
          backgroundColor: '#070c14',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
          },
        },
      };
    }
    return { action: 'allow' };
  });

  // Handle network/load failure for remote URLs
  mainWindow.webContents.on('did-fail-load', async (event, errorCode, errorDescription, validatedURL) => {
    console.log(`Failed to load URL: ${validatedURL}, error: ${errorDescription} (${errorCode})`);
    
    // Check if the failed URL was a remote server URL (not the local launcher file)
    if (!validatedURL.startsWith('file://')) {
      console.log('Reverting to local launcher due to load failure.');
      await loadLauncher();
      
      // Inject connection error warning to UI
      mainWindow.webContents.executeJavaScript(`
        if (typeof showStatus === 'function') {
          showStatus('error', 'Không thể kết nối tới máy chủ đã lưu. Vui lòng kiểm tra lại mạng hoặc địa chỉ.');
          if (typeof setIdle === 'function') setIdle();
        }
      `).catch(err => console.error('Failed to execute UI error script:', err));
    }
  });

  // Determine starting view based on config
  const savedUrl = getSavedServerUrl();
  if (savedUrl) {
    console.log('Loading saved server URL:', savedUrl);
    mainWindow.loadURL(savedUrl).catch(async (err) => {
      console.error('Failed to load saved URL on startup:', err.message);
      await loadLauncher();
    });
  } else {
    console.log('No saved server URL, loading launcher UI.');
    loadLauncher();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Register IPC Handlers to emulate Tauri commands called from thin-client-ui/index.html
ipcMain.handle('get_server_url', () => {
  return getSavedServerUrl();
});

ipcMain.handle('connect_to_server', async (event, { url }) => {
  console.log('Connecting to server:', url);
  saveServerUrl(url);
  
  if (mainWindow) {
    try {
      await mainWindow.loadURL(url);
      return { success: true };
    } catch (err) {
      console.error('Failed to connect to server URL:', err.message);
      // Let the caller handle the error
      throw new Error(err.message);
    }
  }
  return { success: false };
});

ipcMain.handle('disconnect', async () => {
  console.log('Disconnecting and clearing config.');
  clearConfig();
  await loadLauncher();
  return { success: true };
});

ipcMain.handle('open_url', async (event, { url }) => {
  console.log('Opening external URL:', url);
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    console.error('Failed to open external URL:', err.message);
    throw err;
  }
});

ipcMain.handle('install_tailscale', async () => {
  console.log('Triggering Tailscale installation.');
  if (process.platform !== 'win32') {
    throw new Error('Tính năng cài đặt nhanh Tailscale chỉ hỗ trợ trên hệ điều hành Windows.');
  }

  // Find tailscale installer. Packages resources are at process.resourcesPath.
  const installerPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'tailscale-setup.exe')
    : path.join(app.getAppPath(), 'resources', 'tailscale-setup.exe');

  if (!fs.existsSync(installerPath)) {
    throw new Error('File cài đặt Tailscale không tồn tại trong tài nguyên của app.');
  }

  exec(`"${installerPath}"`, (err) => {
    if (err) {
      console.error('Failed to execute Tailscale installer:', err);
    }
  });

  return { success: true };
});

ipcMain.handle('close_app', () => {
  console.log('Closing application.');
  app.quit();
});

ipcMain.handle('minimize_app', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('maximize_app', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
