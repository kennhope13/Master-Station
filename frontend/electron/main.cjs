const { app, BrowserWindow, ipcMain, shell, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');
const http = require('http');
const https = require('https');

let mainWindow = null;
let servicesStarted = false;
let watchdogInterval = null;
let localUiServer = null;
let localUiPort = null;

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
const LOG_DIR = path.join(DATA_DIR, 'logs');
const BACKEND_PORT = 6000;
const PG_PORT = 6432;
const LOCAL_UI_PORT = 6173;
const PIDS_FILE = path.join(DATA_DIR, 'pids.json');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writeLog(file, data) {
  try {
    const cleanData = data.toString().replace(/\r?\n$/, '');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(path.join(LOG_DIR, file), `[${timestamp}] ${cleanData}\n`);
  } catch (err) {
    // Ignore logging errors
  }
}

function logOrchestrator(msg, type = 'INFO') {
  console.log(`[Orchestrator][${type}]: ${msg}`);
  writeLog('orchestrator.log', `[${type}] ${msg}`);
}

function readSavedPids() {
  try {
    if (fs.existsSync(PIDS_FILE)) {
      return JSON.parse(fs.readFileSync(PIDS_FILE, 'utf8'));
    }
  } catch (err) {
    logOrchestrator(`Failed to read PIDs file: ${err.message}`, 'WARNING');
  }
  return {};
}

function savePid(key, pid) {
  try {
    const pids = readSavedPids();
    if (pid) {
      pids[key] = pid;
    } else {
      delete pids[key];
    }
    fs.writeFileSync(PIDS_FILE, JSON.stringify(pids, null, 2), 'utf8');
  } catch (err) {
    logOrchestrator(`Failed to save PID for ${key}: ${err.message}`, 'WARNING');
  }
}

async function killPid(pid) {
  if (!pid) return;
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec(`taskkill /F /PID ${pid} /T`, () => resolve());
    } else {
      exec(`kill -9 ${pid}`, () => resolve());
    }
  });
}

async function killOldPostgres() {
  const pidFile = path.join(PG_DATA_DIR, 'postmaster.pid');
  if (fs.existsSync(pidFile)) {
    try {
      const content = fs.readFileSync(pidFile, 'utf8');
      const pid = parseInt(content.split('\n')[0].trim(), 10);
      if (pid && !isNaN(pid)) {
        logOrchestrator(`Found old postmaster PID ${pid}, killing...`);
        await killPid(pid);
      }
    } catch (err) {
      logOrchestrator(`Failed to read postmaster.pid: ${err.message}`, 'WARNING');
    }
  }
}

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
  logOrchestrator('Cleaning up old services...');
  const pids = readSavedPids();
  
  if (pids.backend) {
    logOrchestrator(`Killing old backend process with PID ${pids.backend}...`);
    await killPid(pids.backend);
    savePid('backend', null);
  }
  if (pids.go2rtc) {
    logOrchestrator(`Killing old go2rtc process with PID ${pids.go2rtc}...`);
    await killPid(pids.go2rtc);
    savePid('go2rtc', null);
  }

  await killOldPostgres();
  
  const pidFile = path.join(PG_DATA_DIR, 'postmaster.pid');
  if (fs.existsSync(pidFile)) {
    try { fs.unlinkSync(pidFile); } catch (e) {}
  }
}

async function initializeDatabase() {
  const initdbExe = path.join(BIN_PATHS.postgres, 'bin', 'initdb.exe');
  if (!fs.existsSync(PG_DATA_DIR)) {
    logOrchestrator('Initializing PostgreSQL Database...');
    fs.mkdirSync(PG_DATA_DIR, { recursive: true });
    
    return new Promise((resolve, reject) => {
      const initdb = spawn(initdbExe, ['-D', PG_DATA_DIR, '-U', 'postgres', '--encoding=UTF8'], {
        windowsHide: true,
      });

      initdb.stdout.on('data', data => {
        writeLog('postgres.log', `[initdb stdout] ${data}`);
      });
      initdb.stderr.on('data', data => {
        writeLog('postgres.log', `[initdb stderr] ${data}`);
      });
      
      initdb.on('close', code => {
        if (code === 0) {
          logOrchestrator('Database initialized successfully.');
          resolve();
        } else {
          logOrchestrator(`Database initialization failed with code ${code}`, 'ERROR');
          reject(new Error(`initdb failed with code ${code}`));
        }
      });
    });
  } else {
    logOrchestrator('PostgreSQL Database already initialized.');
  }
}

async function startPostgres() {
  const pgCtlExe = path.join(BIN_PATHS.postgres, 'bin', 'pg_ctl.exe');
  logOrchestrator('Starting PostgreSQL...');

  return new Promise((resolve) => {
    const pg = spawn(pgCtlExe, ['start', '-D', PG_DATA_DIR, '-w', '-t', '10'], {
      windowsHide: true,
      env: { ...process.env, PGPORT: PG_PORT.toString() }
    });

    pg.stdout.on('data', data => {
      writeLog('postgres.log', `[pg_ctl stdout] ${data}`);
    });
    pg.stderr.on('data', data => {
      writeLog('postgres.log', `[pg_ctl stderr] ${data}`);
    });

    pg.on('close', code => {
      logOrchestrator(`pg_ctl exited with code ${code}`);
      resolve();
    });
    
    setTimeout(resolve, 2000);
  });
}

async function stopPostgres() {
  const pgCtlExe = path.join(BIN_PATHS.postgres, 'bin', 'pg_ctl.exe');
  logOrchestrator('Stopping PostgreSQL...');
  return new Promise((resolve) => {
    const pg = spawn(pgCtlExe, ['stop', '-D', PG_DATA_DIR, '-m', 'fast'], {
      windowsHide: true
    });
    pg.stdout.on('data', data => writeLog('postgres.log', `[pg_ctl stop stdout] ${data}`));
    pg.stderr.on('data', data => writeLog('postgres.log', `[pg_ctl stop stderr] ${data}`));
    pg.on('close', () => {
      logOrchestrator('PostgreSQL stopped.');
      resolve();
    });
    setTimeout(resolve, 3000);
  });
}

function startBackend() {
  if (processes.backend) return;
  logOrchestrator('Starting Backend...');
  if (!fs.existsSync(BIN_PATHS.backend)) {
    logOrchestrator(`Backend executable not found at ${BIN_PATHS.backend}`, 'ERROR');
    return;
  }
  
  processes.backend = spawn(BIN_PATHS.backend, [], {
    windowsHide: true,
    cwd: path.dirname(BIN_PATHS.backend),
    env: { ...process.env, ASPNETCORE_URLS: `http://localhost:${BACKEND_PORT}` }
  });

  savePid('backend', processes.backend.pid);

  processes.backend.stdout.on('data', data => {
    writeLog('backend.log', data);
  });
  processes.backend.stderr.on('data', data => {
    writeLog('backend.log', `[ERR] ${data}`);
  });
  
  processes.backend.on('close', code => {
    logOrchestrator(`Backend exited with code ${code}`);
    processes.backend = null;
    savePid('backend', null);
  });
}

function startGo2RTC() {
  if (processes.go2rtc) return;
  logOrchestrator('Starting go2rtc...');
  if (!fs.existsSync(BIN_PATHS.go2rtc)) {
    logOrchestrator(`go2rtc executable not found at ${BIN_PATHS.go2rtc}`, 'ERROR');
    return;
  }

  processes.go2rtc = spawn(BIN_PATHS.go2rtc, [], {
    windowsHide: true,
    cwd: path.dirname(BIN_PATHS.go2rtc),
  });

  savePid('go2rtc', processes.go2rtc.pid);

  processes.go2rtc.stdout.on('data', data => {
    writeLog('go2rtc.log', data);
  });
  processes.go2rtc.stderr.on('data', data => {
    writeLog('go2rtc.log', `[ERR] ${data}`);
  });
  
  processes.go2rtc.on('close', code => {
    logOrchestrator(`go2rtc exited with code ${code}`);
    processes.go2rtc = null;
    savePid('go2rtc', null);
  });
}

function checkBackendReady() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${BACKEND_PORT}/health`, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 404);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function checkDbAlive() {
  return new Promise((resolve) => {
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
  
  const dbAlive = await checkDbAlive();
  if (!dbAlive) {
    logOrchestrator('Watchdog: DB is down, restarting PostgreSQL...', 'WARNING');
    await killOldPostgres();
    await startPostgres();
  }
  
  if (!processes.backend) {
    logOrchestrator('Watchdog: Backend is down, restarting...', 'WARNING');
    startBackend();
  }

  if (!processes.go2rtc) {
    logOrchestrator('Watchdog: go2rtc is down, restarting...', 'WARNING');
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
        logOrchestrator("PostgreSQL not bundled or not found in dev env.", "WARNING");
    }
    
    webContents.executeJavaScript(`if(typeof updateStatus === 'function') updateStatus('Đang khởi động Máy chủ API & Camera...')`).catch(() => {});
    startBackend();
    startGo2RTC();
    
    servicesStarted = true;
    
    watchdogInterval = setInterval(watchdogLoop, 10000);

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
      logOrchestrator("Backend startup timed out!", "WARNING");
    } else {
      logOrchestrator("Backend is ready!");
    }
    
    return true;

  } catch (err) {
    logOrchestrator(`Failed to start services: ${err.message}`, "ERROR");
    webContents.executeJavaScript(`if(typeof updateStatus === 'function') updateStatus('Lỗi khởi động: ${err.message}')`).catch(() => {});
    return false;
  }
}

async function stopAllServices() {
  logOrchestrator('Shutting down all services...');
  servicesStarted = false;
  if (watchdogInterval) clearInterval(watchdogInterval);
  
  if (processes.backend) processes.backend.kill();
  if (processes.go2rtc) processes.go2rtc.kill();
  await stopPostgres();
  await cleanupOldServices();
}


// ==========================================
// LOCAL HTTP UI SERVER (Serves React UI & Proxies API/WS to Backend on port 6000)
// ==========================================
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.ico': return 'image/x-icon';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

function pipeProxy(req, res, targetBase) {
  const url = new URL(req.url, targetBase);
  const client = url.protocol === 'https:' ? https : http;
  const proxyReq = client.request(url, {
    method: req.method,
    headers: req.headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Proxy error: ${err.message}`);
  });
  req.pipe(proxyReq);
}

function startLocalUiServer() {
  if (localUiServer) return Promise.resolve(localUiPort);

  const distDir = path.join(app.getAppPath(), 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error(`Không tìm thấy frontend dist tại ${distDir}`);
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = req.url || '/';

      if (reqUrl.startsWith('/api/') || reqUrl.startsWith('/media/') || reqUrl.startsWith('/ws/')) {
        pipeProxy(req, res, `http://127.0.0.1:${BACKEND_PORT}`);
        return;
      }
      if (reqUrl === '/ai-api' || reqUrl.startsWith('/ai-api/')) {
        req.url = reqUrl.replace(/^\/ai-api/, '');
        pipeProxy(req, res, 'http://127.0.0.1:9100');
        return;
      }
      if (reqUrl.startsWith('/pd-monitor/')) {
        pipeProxy(req, res, 'http://127.0.0.1:9100');
        return;
      }

      const safePath = decodeURIComponent(reqUrl.split('?')[0] || '/');
      const requested = safePath === '/' ? 'index.html' : safePath.replace(/^\/+/, '');
      let filePath = path.join(distDir, requested);

      if (!filePath.startsWith(distDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html');
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': getMimeType(filePath), 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    });

    server.on('upgrade', (req, socket, head) => {
      const reqUrl = req.url || '/';
      if (reqUrl.startsWith('/ws/')) {
        const targetUrl = new URL(reqUrl, `http://127.0.0.1:${BACKEND_PORT}`);
        const options = {
          port: BACKEND_PORT,
          host: '127.0.0.1',
          path: targetUrl.pathname + targetUrl.search,
          headers: req.headers,
          method: req.method || 'GET'
        };

        const proxyReq = http.request(options);
        proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
          socket.write(
            `HTTP/1.1 101 Switching Protocols\r\n` +
            Object.keys(proxyRes.headers)
              .map(key => `${key}: ${proxyRes.headers[key]}`)
              .join('\r\n') +
            '\r\n\r\n'
          );

          if (proxyHead && proxyHead.length > 0) {
            socket.write(proxyHead);
          }

          proxySocket.on('error', (err) => {
            console.error(`[ProxySocket Error] ${err.message}`);
            socket.destroy();
          });
          socket.on('error', (err) => {
            console.error(`[Socket Error] ${err.message}`);
            proxySocket.destroy();
          });

          proxySocket.pipe(socket);
          socket.pipe(proxySocket);
        });

        proxyReq.on('error', (err) => {
          console.error(`[WS Proxy Error] ${err.message}`);
          socket.end();
        });

        if (head && head.length > 0) {
          proxyReq.write(head);
        }
        proxyReq.end();
      } else {
        socket.end();
      }
    });

    server.on('error', reject);
    server.listen(LOCAL_UI_PORT, '0.0.0.0', () => {
      localUiServer = server;
      localUiPort = LOCAL_UI_PORT;
      resolve(localUiPort);
    });
  });
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
    autoHideMenuBar: true,
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
        body {
          background: #1a1c1e;
          color: #e1e2e1;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          overflow: hidden;
          position: relative;
        }
        .grid {
          position: absolute; inset: -40px;
          background-image:
            linear-gradient(rgba(245,158,11,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(245,158,11,0.06) 1px, transparent 1px);
          background-size: 40px 40px;
          animation: gridScroll 30s linear infinite;
          pointer-events: none;
          z-index: 1;
        }
        @keyframes gridScroll {
          from { transform: translateY(0); }
          to   { transform: translateY(40px); }
        }
        .card {
          position: relative;
          width: 380px;
          padding: 40px;
          background: #24272a;
          border: 1px solid #33373b;
          box-shadow: 0 0 0 1px rgba(245,158,11,0.06), 0 24px 60px rgba(0,0,0,0.6);
          text-align: center;
          z-index: 2;
        }
        .card::before {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; height: 2px;
          background: #f59e0b;
        }
        .corner {
          position: absolute;
          width: 12px; height: 12px;
          border-color: #f59e0b;
          border-style: solid;
          opacity: 0.5;
        }
        .corner--tl { top: -1px; left: -1px;   border-width: 2px 0 0 2px; }
        .corner--tr { top: -1px; right: -1px;   border-width: 2px 2px 0 0; }
        .corner--bl { bottom: -1px; left: -1px; border-width: 0 0 2px 2px; }
        .corner--br { bottom: -1px; right: -1px;border-width: 0 2px 2px 0; }
        .spinner {
          width: 48px;
          height: 48px;
          border: 3px solid rgba(245,158,11,0.1);
          border-left-color: #f59e0b;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 24px;
        }
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
        h2 {
          margin: 0 0 10px;
          font-size: 16px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 2px;
          color: #e1e2e1;
        }
        h2 span {
          color: #f59e0b;
        }
        #status {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          color: #8c9196;
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid #33373b;
        }
      </style>
    </head>
    <body>
      <div class="grid"></div>
      <div class="card">
        <span class="corner corner--tl"></span>
        <span class="corner corner--tr"></span>
        <span class="corner corner--bl"></span>
        <span class="corner corner--br"></span>
        <div class="spinner"></div>
        <h2>Master<span>Station</span></h2>
        <div id="status">Vui lòng chờ...</div>
      </div>
      <script>
        function updateStatus(msg) {
          document.getElementById('status').innerText = msg;
        }
      </script>
    </body>
    </html>
  `;
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`);

  // Start background services
  await startAllServices(mainWindow.webContents);

  // Load the Local UI (Vite dev server or built frontend)
  let targetUrl = process.env.VITE_DEV_SERVER_URL;
  if (!targetUrl) {
    if (fs.existsSync(path.join(__dirname, '..', 'dist', 'index.html'))) {
      try {
        await startLocalUiServer();
        targetUrl = `http://127.0.0.1:${LOCAL_UI_PORT}`;
      } catch (err) {
        console.error("Failed to start local UI server, falling back to direct loadFile:", err);
        targetUrl = null;
      }
    } else {
      // Fallback if built file is missing in dev
      targetUrl = `http://localhost:6173`;
    }
  }
  
  try {
    if (targetUrl) {
        await mainWindow.loadURL(targetUrl);
    } else {
        await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }
  } catch (err) {
    console.error("Failed to load UI:", err);
  }
  
  // Live wall popup logic
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // Station and live-monitor windows already provide their own navigation/title
    // controls. Open them as desktop windows without Chromium's surrounding UI.
    if (url.includes('/live-wall') || url.includes('/live-camera') || frameName?.startsWith('station_') || frameName?.startsWith('wall_')) {
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
  if (localUiServer) {
    try { localUiServer.close(); } catch {}
    localUiServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (e) => {
  if (localUiServer) {
    try { localUiServer.close(); } catch {}
    localUiServer = null;
  }
  if (servicesStarted) {
    e.preventDefault();
    await stopAllServices();
    app.exit(0);
  }
});
