// main.js
if (require('electron-squirrel-startup')) {
    return; // This is an important line, it prevents the app from launching during install/uninstall
}

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const express = require('express');
const net = require('net');

// --- Server Setup ---
const expressApp = express();
const BASE_PORT = 38451;
let serverPort; // Will be determined at runtime

// --- Electron App Logic ---
let win;
let fontManagerWin; // Reference to our new window
let currentDownloadController = null; // To handle download cancellation
let fontManifest = []; // Cache for the font manifest for on-demand downloading
let fontUpdateQueue = [];
let isUpdatingFontsList = false;

// --- Paths Setup ---
// User-overridable content (from updater.py) goes here
const userDataPath = path.join(app.getPath('userData'), 'www.photopea.com');
// Bundled, default content is here
const bundlePath = path.join(__dirname, 'www.photopea.com');
// Path for user-downloaded fonts (a subset of userDataPath)
const fontsPath = path.join(userDataPath, 'rsrc', 'fonts');

// Helper to get the correct path for a resource, prioritizing the user's data directory.
// This allows users to override bundled files by placing updated ones in their app data folder.
function getResourcePath(relativePath) {
    const userFilePath = path.join(userDataPath, relativePath);
    // Use the user's version if it exists
    if (fs.existsSync(userFilePath)) {
        return userFilePath;
    }
    // Otherwise, fall back to the version bundled with the app
    return path.join(bundlePath, relativePath);
}

// Helper to find an available TCP port, starting from a base port.
function findFreePort(startPort) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref(); // Don't keep the event loop running
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                // Port is in use, recursively try the next one
                resolve(findFreePort(startPort + 1));
            } else {
                reject(err);
            }
        });
        server.listen({ port: startPort, host: '127.0.0.1' }, () => {
            const port = server.address().port;
            server.close(() => {
                resolve(port);
            });
        });
    });
}

// --- Reusable Font Download Logic ---
async function downloadAndSaveFont(font) {
    const finalPath = path.join(fontsPath, font.url);
    const remoteUrl = `https://www.photopea.com/rsrc/fonts/${font.url}`;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;

    // Ensure parent directory exists
    await fs.promises.mkdir(path.dirname(finalPath), { recursive: true }).catch(() => {});

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await new Promise((resolve, reject) => {
                const tempPath = finalPath + '.part';
                const file = fs.createWriteStream(tempPath);
                
                const request = https.get(remoteUrl, (response) => {
                    if (response.statusCode !== 200) {
                        file.close();
                        fs.unlink(tempPath, () => {});
                        return reject(new Error(`Status Code ${response.statusCode}`));
                    }

                    response.pipe(file);

                    file.on('finish', () => {
                        file.close(async (err) => {
                            if (err) {
                                fs.unlink(tempPath, () => {});
                                return reject(err);
                            }
                            try {
                                // EPERM fix: try to delete original file first if it exists.
                                try { await fs.promises.unlink(finalPath); }
                                catch (unlinkErr) { if (unlinkErr.code !== 'ENOENT') throw unlinkErr; }
                                
                                await fs.promises.rename(tempPath, finalPath);
                                resolve();
                            } catch (moveErr) {
                                reject(moveErr);
                            }
                        });
                    });
                }).on('error', (err) => {
                    file.close();
                    fs.unlink(tempPath, () => {});
                    reject(err);
                });

                request.setTimeout(15000, () => {
                    request.destroy(new Error('Request timed out'));
                });
            });
            // If the promise above resolves, the download was successful.
            return true;
        } catch (error) {
            console.error(`Download attempt ${attempt} failed for ${font.psn}: ${error.message}`);
            if (attempt === MAX_RETRIES) {
                // If this was the last attempt, break the loop and return false.
                break;
            }
            // Wait before retrying
            await new Promise(p => setTimeout(p, RETRY_DELAY));
        }
    }

    // If the loop finishes without returning true, it means all retries failed.
    return false;
}

// --- IPC for Font Management ---

ipcMain.handle('get-font-list', async () => {
    const manifestPath = getResourcePath('font-manifest.json');
    const downloadedFontsPath = path.join(fontsPath, 'downloaded.json');

    try {
        const manifestData = await fs.promises.readFile(manifestPath, 'utf-8');
        const allFonts = JSON.parse(manifestData);

        let downloadedFonts = [];
        if (fs.existsSync(downloadedFontsPath)) {
            const downloadedData = await fs.promises.readFile(downloadedFontsPath, 'utf-8');
            downloadedFonts = JSON.parse(downloadedData);
        }

        // Add 'isDownloaded' and 'isDefault' flags to each font
        const downloadedSet = new Set(downloadedFonts.map(f => f.psn));
        const fontListWithStatus = allFonts.map(font => {
            const isDefault = font.psn === 'DejaVuSans' || font.psn.startsWith('DejaVuSans-');
            return {
                ...font,
                isDownloaded: downloadedSet.has(font.psn) || isDefault,
                isDefault: isDefault,
            };
        });

        return fontListWithStatus;
    } catch (error) {
        console.error("Error reading font manifest:", error);
        return [];
    }
});

// --- Helper function to run promises with a concurrency limit ---
async function runWithConcurrency(poolLimit, array, iteratorFn, controller) {
    const ret = [];
    const executing = [];
    for (const item of array) {
        if (controller.isCancelled) break; // Stop queuing new tasks if cancelled

        const p = Promise.resolve().then(() => iteratorFn(item, controller));
        ret.push(p);

        if (poolLimit <= array.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= poolLimit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(ret);
}

ipcMain.on('download-fonts', async (event, fontsToDownload) => {
    // Create a new controller for this download session.
    currentDownloadController = { isCancelled: false };
    const controller = currentDownloadController;

    const total = fontsToDownload.length;
    let completed = 0;
    const CONCURRENCY_LIMIT = 16;

    const sendProgress = (payload) => {
        if (fontManagerWin && !fontManagerWin.isDestroyed()) {
            fontManagerWin.webContents.send('download-progress', payload);
        }
    };

    // Run all downloads with concurrency using the new reusable function
    const results = await runWithConcurrency(CONCURRENCY_LIMIT, fontsToDownload, async (font, controller) => {
        // Stop early if the whole process was cancelled
        if (controller.isCancelled) {
            return { ...font, error: true, cancelled: true };
        }

        const success = await downloadAndSaveFont(font);
        
        // This task might have been running when cancellation was triggered.
        // We check again to not send progress for a cancelled batch.
        if (controller.isCancelled) {
            return { ...font, error: true, cancelled: true };
        }

        completed++;
        sendProgress({ completed, total, name: font.psn, error: !success });
        
        // Return the original font object with an error flag
        return { ...font, error: !success };
    }, controller);

    const successfulDownloads = results.filter(result => !result.error);

    if (successfulDownloads.length > 0) {
        await updateDownloadedFontsList(successfulDownloads);
    }
});

// This function adds fonts to a queue and triggers the processor.
function updateDownloadedFontsList(newlyDownloaded) {
    fontUpdateQueue.push(...newlyDownloaded);
    processFontUpdateQueue();
}

// This async function processes the queue, ensuring only one file write happens at a time.
async function processFontUpdateQueue() {
    if (isUpdatingFontsList) return; // If already running, exit. The existing run will catch the new items.
    isUpdatingFontsList = true;

    try {
        // Continue processing as long as items are in the queue.
        while (fontUpdateQueue.length > 0) {
            // Atomically get all items and clear the queue for this batch.
            const fontsToAdd = fontUpdateQueue.splice(0, fontUpdateQueue.length);
            
            const downloadedFontsPath = path.join(fontsPath, 'downloaded.json');
            let existingFonts = [];
            
            try {
                const data = await fs.promises.readFile(downloadedFontsPath, 'utf-8');
                // Check for non-empty string before parsing
                if (data) {
                    existingFonts = JSON.parse(data);
                }
            } catch (err) {
                // If file doesn't exist or is corrupt, we'll start a new one.
                if (err.code !== 'ENOENT') {
                    console.error('Could not read or parse downloaded.json, it will be overwritten.', err);
                }
            }

            const existingPsns = new Set(existingFonts.map(f => f.psn));
            fontsToAdd.forEach(font => {
                if (font && font.psn && !existingPsns.has(font.psn)) {
                    existingFonts.push(font);
                    existingPsns.add(font.psn); // Also update the set for this batch
                }
            });

            await fs.promises.writeFile(downloadedFontsPath, JSON.stringify(existingFonts, null, 2));
        }
    } catch (error) {
        console.error('CRITICAL: Failed to write to downloaded.json.', error);
    } finally {
        isUpdatingFontsList = false;
    }
}

function openFontManagerWindow() {
    if (fontManagerWin) {
        fontManagerWin.focus();
        return;
    }
    fontManagerWin = new BrowserWindow({
        width: 800,
        height: 600,
        title: 'Font Manager',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'font-manager-preload.js')
        }
    });
    fontManagerWin.loadFile('font-manager.html');
    fontManagerWin.on('closed', () => {
        if (currentDownloadController) {
            currentDownloadController.isCancelled = true;
            console.log('Font manager closed. Download process will be stopped.');
        }
        fontManagerWin = null;
    });
}

ipcMain.on('open-font-manager', () => {
    openFontManagerWindow();
});

ipcMain.on('close-font-manager-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        win.close();
    }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // --- UPDATED DIALOG LOGIC ---
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', // 'warning' is more appropriate for potential data loss
      buttons: ['OK', 'Cancel'],
      title: 'Unsaved Changes',
      message: 'You have unsaved changes. Do you want to quit anyway?',
      detail: 'Any changes you made will be lost.',
      defaultId: 1, // Index of 'Cancel'. Makes 'Cancel' the default button.
      cancelId: 1   // Index of 'Cancel'. Maps the Esc key to 'Cancel'.
    });

    // The 'showMessageBoxSync' function returns the index of the clicked button.
    // In our `buttons` array: 0 is 'OK', 1 is 'Cancel'.
    // If the user chose 'OK' (index 0), we proceed with closing the window.
    if (choice === 0) {
      // By calling preventDefault(), we override Photopea's attempt to
      // *prevent* the unload, thereby allowing the window to close.
      event.preventDefault();
    }
  });


  win.loadURL(`http://localhost:${serverPort}`);
//   win.webContents.openDevTools();

  // --- F12 to open DevTools ---
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.once('ready-to-show', () => {
    win.maximize();
  });
}

// --- IPC Listeners for Window Controls --- (no changes)
ipcMain.on('window-control', (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    switch (action) {
      case 'minimize':
        win.minimize();
        break;
      case 'maximize':
        win.isMaximized() ? win.unmaximize() : win.maximize();
        break;
      case 'close':
        win.close();
        break;
    }
  }
});

// --- App Lifecycle ---
app.whenReady().then(async () => {
  // Load the font manifest into memory for fast lookups
  try {
    const manifestPath = getResourcePath('font-manifest.json');
    const manifestData = await fs.promises.readFile(manifestPath, 'utf-8');
    fontManifest = JSON.parse(manifestData);
    console.log(`Loaded font manifest with ${fontManifest.length} fonts from ${path.dirname(manifestPath)}`);
  } catch (error) {
    console.error('CRITICAL: Failed to load font-manifest.json. On-demand font loading will not work.', error);
  }

  // --- On-Demand Font Middleware ---
  // This must be placed BEFORE the static file handlers.
  expressApp.use(async (req, res, next) => {
    if (!req.url.startsWith('/rsrc/fonts/')) {
        return next(); // Not a font request, pass along.
    }

    const userFontPath = path.join(userDataPath, req.url);
    const bundledFontPath = path.join(bundlePath, req.url);

    // Check if the font already exists in the user's data folder.
    try {
        await fs.promises.access(userFontPath, fs.constants.F_OK);
        return next(); // File exists, let the static handler serve it from user data.
    } catch (e) {
        // Not in user data.
    }

    // If not in user data, check if the font exists in the application bundle.
    try {
        await fs.promises.access(bundledFontPath, fs.constants.F_OK);
        return next(); // File exists, let the static handler serve it from the bundle.
    } catch (e) {
        // File does not exist in either location, proceed to download on-demand.
    }

    const fontUrl = req.url.substring('/rsrc/fonts/'.length);
    const fontToDownload = fontManifest.find(f => f.url === fontUrl);

    if (!fontToDownload) {
        console.warn(`A font was requested ("${fontUrl}") but not found in the manifest.`);
        return next(); // Let it 404
    }

    console.log(`On-demand download triggered for: ${fontToDownload.psn}`);
    const success = await downloadAndSaveFont(fontToDownload);

    if (success) {
        console.log(`Successfully downloaded ${fontToDownload.psn}. Serving file.`);
        // The update function is now fire-and-forget; it handles its own errors.
        updateDownloadedFontsList([fontToDownload]);
        res.sendFile(path.join(fontsPath, fontToDownload.url));
    } else {
        console.error(`Failed to download ${fontToDownload.psn} on-demand. The app will receive a 404.`);
        return next();
    }
  });
  
  // --- SERVER SETUP ---
  fs.mkdirSync(fontsPath, { recursive: true });

  console.log(`Serving user-overridable content from: ${userDataPath}`);
  console.log(`Serving bundled content from: ${bundlePath}`);
  
  // 1. Serve user-provided files first (from app data). This allows user updates.
  expressApp.use(express.static(userDataPath));
  
  // 2. Fallback to serving packaged application files if not found in user-data.
  expressApp.use(express.static(bundlePath));
  
  // Find a free port before starting the server.
  serverPort = await findFreePort(BASE_PORT);
  
  expressApp.listen(serverPort, '127.0.0.1', () => {
    console.log(`Server started on http://localhost:${serverPort}`);
    createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});