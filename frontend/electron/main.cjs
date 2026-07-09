const { app, BrowserWindow, ipcMain, shell, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let servicesStarted = false;
let watchdogInterval = null;

// ==========================================
// THICK CLIENT ARCHITECTURE CONFIG
// ==========================================
const IS_PACKAGED = app.isPackaged;
const RESOURCES_PATH = IS_PACKAGED ? process.resourcesPath : path.join(app.getAppPath(), 'resources');
// For dev mode, if backend_published is built in root dir:
const DEV_ROOT = path.join(app.getAppPath(), '..');

const BIN_PATHS = {
  backend: IS_PACKAGED ? path.join(RESOURCES_PATH, 'backend_published', 'StationOS.Api.exe') : path.join(DEV_ROOT, 'backend_published', 'win-x64', 'StationOS.Api.exe'),
  postgres: IS_PACKAGED ? path.join(RESOURCES_PATH, 'pg_portable') : path.join(DEV_ROOT, 'pg_portable'),
  go2rtc: IS_PACKAGED ? path.join(RESOURCES_PATH, 'go2rtc', 'go2rtc.exe') : path.join(DEV_ROOT, 'go2rtc', 'go2rtc.exe'),
};

const DATA_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'MasterStation');
const PG_DATA_DIR = path.join(DATA_DIR, 'pg_data');
const BACKEND_PORT = 5000;
const PG_PORT = 5432;

// Active process handles
const processes = {
  postgres: null,
  backend: null,
  go2rtc: null,
};

async function killProcessByName(name) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec(`taskkill /F /IM ${name} /T`, (err) => {
        resolve(); // Ignore error if not found
      });
    } else {
      exec(`pkill -f ${name}`, (err) => {
        resolve();
      });
    }
  });
}

async function cleanupOldServices() {
  console.log('Cleaning up old services...');
  await killProcessByName('StationOS.Api.exe');
  await killProcessByName('go2rtc.exe');
  await killProcessByName('postgres.exe');
  await killProcessByName('pg_ctl.exe');
}

async function initializeDatabase() {
  const initdbExe = path.join(BIN_PATHS.postgres, 'bin', 'initdb.exe');
  if (!fs.existsSync(PG_DATA_DIR)) {
    console.log('Initializing PostgreSQL Database...');
    fs.mkdirSync(PG_DATA_DIR, { recursive: true });
    
    return new Promise((resolve, reject) => {
      const initdb = spawn(initdbExe, ['-D', PG_DATA_DIR, '-U', 'postgres', '--encoding=UTF8'], {
        windowsHide: true,
      });

      initdb.stdout.on('data', data => console.log(`[initdb]: ${data}`));
      initdb.stderr.on('data', data => console.error(`[initdb ERR]: ${data}`));
      
      initdb.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`initdb failed with code ${code}`));
        }
      });
    });
  } else {
    console.log('PostgreSQL Database already initialized.');
  }
}

async function startPostgres() {
  const pgCtlExe = path.join(BIN_PATHS.postgres, 'bin', 'pg_ctl.exe');
  console.log('Starting PostgreSQL...');

  return new Promise((resolve) => {
    const pg = spawn(pgCtlExe, ['start', '-D', PG_DATA_DIR, '-w', '-t', '10'], {
      windowsHide: true,
      env: { ...process.env, PGPORT: PG_PORT.toString() }
    });

    pg.stdout.on('data', data => console.log(`[pg_ctl]: ${data}`));
    pg.stderr.on('data', data => console.error(`[pg_ctl ERR]: ${data}`));

    pg.on('close', code => {
      console.log(`[pg_ctl] exited with code ${code}`);
      // pg_ctl exits after starting postgres process
      resolve();
    });
    
    // Fallback delay to ensure it's running
    setTimeout(resolve, 2000);
  });
}

async function stopPostgres() {
  const pgCtlExe = path.join(BIN_PATHS.postgres, 'bin', 'pg_ctl.exe');
  return new Promise((resolve) => {
    const pg = spawn(pgCtlExe, ['stop', '-D', PG_DATA_DIR, '-m', 'fast'], {
      windowsHide: true
    });
    pg.on('close', () => resolve());
    setTimeout(resolve, 3000);
  });
}

function startBackend() {
  if (processes.backend) return;
  console.log('Starting Backend...');
  if (!fs.existsSync(BIN_PATHS.backend)) {
    console.error('Backend executable not found at', BIN_PATHS.backend);
    return;
  }
  
  // Set ASPNETCORE_URLS to ensure it runs on port 5000
  processes.backend = spawn(BIN_PATHS.backend, [], {
    windowsHide: true,
    cwd: path.dirname(BIN_PATHS.backend),
    env: { ...process.env, ASPNETCORE_URLS: `http://localhost:${BACKEND_PORT}` }
  });

  processes.backend.stdout.on('data', data => console.log(`[Backend]: ${data}`));
  processes.backend.stderr.on('data', data => console.error(`[Backend ERR]: ${data}`));
  
  processes.backend.on('close', code => {
    console.log(`Backend exited with code ${code}`);
    processes.backend = null;
  });
}

function startGo2RTC() {
  if (processes.go2rtc) return;
  console.log('Starting go2rtc...');
  if (!fs.existsSync(BIN_PATHS.go2rtc)) {
    console.error('go2rtc executable not found at', BIN_PATHS.go2rtc);
    return;
  }

  processes.go2rtc = spawn(BIN_PATHS.go2rtc, [], {
    windowsHide: true,
    cwd: path.dirname(BIN_PATHS.go2rtc),
  });

  processes.go2rtc.stdout.on('data', data => console.log(`[go2rtc]: ${data}`));
  processes.go2rtc.stderr.on('data', data => console.error(`[go2rtc ERR]: ${data}`));
  
  processes.go2rtc.on('close', code => {
    console.log(`go2rtc exited with code ${code}`);
    processes.go2rtc = null;
  });
}

function checkBackendReady() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${BACKEND_PORT}/health`, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 404); // Health endpoint or just response
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function checkDbAlive() {
  return new Promise((resolve) => {
    // Attempting a simple socket connection to PG port
    const net = require('net');
    const socket = new net.Socket();
    let isConnected = false;
    socket.setTimeout(2000);
    socket.on('connect', () => { isConnected = true; socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { resolve(false); });
    socket.connect(PG_PORT, '127.0.0.1');
  });
}

async function watchdogLoop() {
  if (!servicesStarted) return;
  
  // Check Database
  const dbAlive = await checkDbAlive();
  if (!dbAlive) {
    console.log('Watchdog: DB is down, restarting PostgreSQL...');
    await killProcessByName('postgres.exe');
    await startPostgres();
  }
  
  // Check Backend
  if (!processes.backend) {
    console.log('Watchdog: Backend is down, restarting...');
    startBackend();
  }

  // Check Go2RTC
  if (!processes.go2rtc) {
    console.log('Watchdog: go2rtc is down, restarting...');
    startGo2RTC();
  }
}

async function startAllServices(webContents) {
  try {
    webContents.executeJavaScript(`if(typeof updateStatus === 'function') updateStatus('Dọn dẹp hệ thống cũ...')`).catch(() => {});
    await cleanupOldServices();
    
    webContents.executeJavaScript(`if(typeof updateStatus === 'function') updateStatus('Khởi tạo Database...')`).catch(() => {});
    if (fs.existsSync(BIN_PATHS.postgres)) {
        await initializeDatabase();
        webContents.executeJavaScript(`if(typeof updateStatus === 'function') updateStatus('Đang khởi động Database...')`).catch(() => {});
        await startPostgres();
    } else {
        console.warn("PostgreSQL not bundled or not found in dev env.");
    }
    
    webContents.executeJavaScript(`if(typeof updateStatus === 'function') updateStatus('Đang khởi động Máy chủ API & Camera...')`).catch(() => {});
    startBackend();
    startGo2RTC();
    
    servicesStarted = true;
    
    // Start Watchdog
    watchdogInterval = setInterval(watchdogLoop, 10000);

    // Wait for backend to be ready
    webContents.executeJavaScript(`if(typeof updateStatus === 'function') updateStatus('Đang chờ hệ thống sẵn sàng...')`).catch(() => {});
    
    let attempts = 0;
    while (attempts < 30) {
      const isReady = await checkBackendReady();
      if (isReady) {
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }

    if (attempts >= 30) {
      console.warn("Backend startup timed out!");
    } else {
      console.log("Backend is ready!");
    }
    
    return true;

  } catch (err) {
    console.error("Failed to start services:", err);
    webContents.executeJavaScript(`if(typeof updateStatus === 'function') updateStatus('Lỗi khởi động: ${err.message}')`).catch(() => {});
    return false;
  }
}

async function stopAllServices() {
  console.log('Shutting down all services...');
  servicesStarted = false;
  if (watchdogInterval) clearInterval(watchdogInterval);
  
  if (processes.backend) processes.backend.kill();
  if (processes.go2rtc) processes.go2rtc.kill();
  await stopPostgres();
  await cleanupOldServices();
}


// ==========================================
// ELECTRON WINDOW MANAGEMENT
// ==========================================

async function clearRendererRuntimeCache() {
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
  } catch (err) {
    console.error('Failed to clear renderer cache:', err);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    resizable: true,
    center: true,
    backgroundColor: '#0f172a',
    title: 'Hệ Thống Giám Sát Trung Tâm — Master Station (Thick Client)',
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
  await clearRendererRuntimeCache();

  // Create loading HTML internally
  const loadingHtml = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <title>Đang khởi động...</title>
      <style>
        body { background: #0f172a; color: white; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .spinner { width: 50px; height: 50px; border: 4px solid rgba(255,255,255,0.1); border-left-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        #status { font-size: 1.1rem; color: #94a3b8; }
      </style>
    </head>
    <body>
      <div class="spinner"></div>
      <h2>Master Station đang khởi động</h2>
      <div id="status">Vui lòng chờ...</div>
      <script>
        function updateStatus(msg) { document.getElementById('status').innerText = msg; }
      </script>
    </body>
    </html>
  `;
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`);

  // Start background services
  await startAllServices(mainWindow.webContents);

  // Load the Local UI (Vite dev server or built frontend)
  const LOCAL_UI_URL = process.env.VITE_DEV_SERVER_URL || `file://${path.join(__dirname, '..', 'dist', 'index.html')}`;
  
  try {
    if (!process.env.VITE_DEV_SERVER_URL && fs.existsSync(path.join(__dirname, '..', 'dist', 'index.html'))) {
        await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    } else if (process.env.VITE_DEV_SERVER_URL) {
        await mainWindow.loadURL(LOCAL_UI_URL);
    } else {
        // Fallback if built file is missing in dev
        await mainWindow.loadURL(`http://localhost:5173`);
    }
  } catch (err) {
    console.error("Failed to load UI:", err);
  }
  
  // Live wall popup logic
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('/live-wall')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { frame: false, titleBarStyle: 'hidden', autoHideMenuBar: true, backgroundColor: '#070c14' },
      };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('close_app', () => {
  app.quit();
});
ipcMain.handle('minimize_app', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.handle('maximize_app', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

// For backward compatibility with the frontend that might call these
ipcMain.handle('get_server_url', () => {
  return `http://localhost:${BACKEND_PORT}`;
});
ipcMain.handle('connect_to_server', async () => {
  return { success: true };
});
ipcMain.handle('install_tailscale', async () => {
  return { success: false, error: 'Not needed in Thick Client.' };
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

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (e) => {
  if (servicesStarted) {
    e.preventDefault();
    await stopAllServices();
    app.exit(0);
  }
});
