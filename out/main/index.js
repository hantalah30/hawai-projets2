"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const si = require("systeminformation");
const crypto = require("crypto");
const electronUpdater = require("electron-updater");
const fs = require("fs");
const https = require("https");
const AdmZip = require("adm-zip");
const vdf = require("vdf");
const icon = path.join(__dirname, "../../resources/icon.png");
async function getDeviceId() {
  try {
    const osInfo = await si.osInfo();
    const cpu = await si.cpu();
    const system = await si.system();
    const disks = await si.diskLayout();
    const diskSerial = disks.length > 0 ? disks[0].serialNum : "no-disk-id";
    const rawString = [
      osInfo.serial,
      system.uuid,
      cpu.brand,
      diskSerial
    ].join("|");
    return crypto.createHash("sha256").update(rawString).digest("hex");
  } catch (error) {
    console.error("Device fingerprint error:", error);
    return "fallback-" + process.env.COMPUTERNAME;
  }
}
const { dialog } = require("electron");
const { spawn, exec } = require("child_process");
const os = require("os");
const GITHUB_OWNER = "hantalah30";
const GITHUB_REPO = "hawai-projets2";
const GITHUB_BRANCH = "main";
const GITHUB_TOKEN = process.env.GH_TOKEN || "";
const APP_ID = "com.project.hawai";
if (process.platform === "win32") {
  electron.app.setAppUserModelId(APP_ID);
}
electron.app.setName("HAWAI Projects");
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1280,
    minHeight: 820,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "HAWAI Projects",
    backgroundColor: "#121212",
    show: false,
    autoHideMenuBar: true,
    icon,
    ...process.platform === "linux" ? { icon } : {},
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId(APP_ID);
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  electron.ipcMain.on("ping", () => console.log("pong"));
  electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com https://img.youtube.com https://res.cloudinary.com https://cdn.cloudflare.steamstatic.com https://cdn2.steamgriddb.com https://cdn3.steamgriddb.com; connect-src 'self' ws: http:;"
        ]
      }
    });
  });
  createWindow();
  electron.app.on("activate", function () {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electronUpdater.autoUpdater.autoDownload = false;
electronUpdater.autoUpdater.autoInstallOnAppQuit = true;
electronUpdater.autoUpdater.on("update-available", (info) => {
  electron.BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("updater-progress", { status: "available", info });
  });
});
electronUpdater.autoUpdater.on("download-progress", (progressObj) => {
  electron.BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("updater-progress", { status: "downloading", progress: progressObj });
  });
});
electronUpdater.autoUpdater.on("update-downloaded", (info) => {
  electron.BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("updater-progress", { status: "ready", info });
  });
});
electronUpdater.autoUpdater.on("error", (err) => {
  electron.BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("updater-progress", { status: "error", error: err.message });
  });
});
electron.ipcMain.handle("check-app-update", () => {
  return electronUpdater.autoUpdater.checkForUpdates();
});
electron.ipcMain.handle("start-app-update", () => {
  return electronUpdater.autoUpdater.downloadUpdate();
});
electron.ipcMain.handle("install-app-update", () => {
  electronUpdater.autoUpdater.quitAndInstall();
});
electron.ipcMain.handle("detect-steam-path", async () => {
  return new Promise((resolve) => {
    exec(
      'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
      (err, stdout) => {
        if (err) return resolve(null);
        const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
        resolve(match ? match[1].trim() : null);
      }
    );
  });
});
electron.ipcMain.handle("select-steam-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select Steam Folder"
  });
  return result.canceled ? null : result.filePaths[0];
});
electron.ipcMain.on("steam-flush", async () => {
  electron.shell.openExternal("steam://flushconfig");
});
electron.ipcMain.on("steam-downgrade", async () => {
  const confirm = await dialog.showMessageBox({
    type: "question",
    buttons: ["Cancel", "Continue"],
    defaultId: 1,
    message: "Let’s get your Steam version ready for the game."
  });
  if (confirm.response !== 1) return;
  exec(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -useb 'https://luatools.vercel.app/SteamDowngrader.ps1' | iex"`
  );
});
let activeDownloadReq = null;
const downloadFile = (url, destPath, token = null, onProgress = null) => {
  return new Promise((resolve, reject) => {
    const makeRequest = (targetUrl) => {
      const headers = { "User-Agent": "HAWAI Projects" };
      if (token) {
        if (targetUrl.includes("api.github.com")) {
          headers.Authorization = `token ${token}`;
          if (targetUrl.includes("/releases/assets/")) {
            headers.Accept = "application/octet-stream";
          } else {
            headers.Accept = "application/vnd.github.v3.raw";
          }
        } else if (targetUrl.includes("raw.githubusercontent.com")) {
          headers.Authorization = `token ${token}`;
        }
      }
      const req = https.get(targetUrl, { headers }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          if (res.headers.location) {
            return makeRequest(res.headers.location);
          }
          return reject(new Error("Redirect without location"));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: ${res.statusCode} ${res.statusMessage}`));
        }
        const totalBytes = parseInt(res.headers["content-length"], 10) || 0;
        let receivedBytes = 0;
        let lastUpdate = Date.now();
        let lastBytes = 0;
        const fileStream = fs.createWriteStream(destPath);
        res.on("data", (chunk) => {
          receivedBytes += chunk.length;
          const now = Date.now();
          if (now - lastUpdate > 200 && onProgress) {
            const timeDiff = (now - lastUpdate) / 1e3;
            const bytesDiff = receivedBytes - lastBytes;
            const speed = bytesDiff / timeDiff;
            onProgress({
              received: receivedBytes,
              total: totalBytes,
              speed,
              percentage: totalBytes ? receivedBytes / totalBytes * 100 : 0
            });
            lastBytes = receivedBytes;
            lastUpdate = now;
          }
        });
        res.pipe(fileStream);
        fileStream.on("finish", () => {
          activeDownloadReq = null;
          if (onProgress) {
            onProgress({ received: totalBytes, total: totalBytes, speed: 0, percentage: 100 });
          }
          fileStream.close(() => resolve());
        });
        fileStream.on("error", (err) => {
          fs.unlink(destPath, () => {
          });
          activeDownloadReq = null;
          reject(err);
        });
      });
      req.on("error", (err) => {
        fs.unlink(destPath, () => {
        });
        activeDownloadReq = null;
        reject(err);
      });
      activeDownloadReq = req;
    };
    makeRequest(url);
  });
};
electron.ipcMain.on("cancel-download", () => {
  if (activeDownloadReq) {
    console.log("Cancelling active download...");
    activeDownloadReq.destroy();
    activeDownloadReq = null;
  }
});
async function getGitHubApiAssetUrl(webUrl, token) {
  if (!webUrl.includes("github.com") || !webUrl.includes("/releases/download/")) {
    return webUrl;
  }
  const match = webUrl.match(/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/);
  if (!match) return webUrl;
  const [_, owner, repo, tag, filename] = match;
  const releaseApiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;
  const res = await fetch(releaseApiUrl, {
    headers: {
      "Authorization": `token ${token}`,
      "User-Agent": "DECODER"
    }
  });
  if (!res.ok) {
    throw new Error(`Could not fetch release metadata. GitHub API responded with ${res.status}`);
  }
  const releaseData = await res.json();
  const asset = releaseData.assets.find((a) => a.name === filename);
  if (!asset) {
    throw new Error(`File ${filename} not found in GitHub Release tag ${tag}`);
  }
  return asset.url;
}
async function installGameInternal(game) {
  let tempDir = null;
  try {
    const zipName = (game.zipPath || "").trim();
    if (!zipName) {
      throw new Error("Invalid zip path");
    }
    console.log(`Starting install for: "${zipName}"`);
    const steamBase = await new Promise((resolve) => {
      exec(
        'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
        (err, stdout) => {
          if (err) return resolve(null);
          const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
          resolve(match ? match[1].trim() : null);
        }
      );
    });
    if (!steamBase) throw new Error("Steam path not found.");
    const steamPath = steamBase.replace(/\//g, "\\");
    const pluginDir = path.join(steamPath, "config", "stplug-in");
    const depotDir = path.join(steamPath, "config", "depotcache");
    if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
    if (!fs.existsSync(depotDir)) fs.mkdirSync(depotDir, { recursive: true });
    tempDir = path.join(electron.app.getPath("temp"), "hawai-install");
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
    const zipPath = path.join(tempDir, zipName);
    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${zipName}?ref=${GITHUB_BRANCH}`;
    console.log("Fetching metadata:", apiUrl);
    const metaRes = await fetch(apiUrl, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "User-Agent": "HAWAI Projects"
      }
    });
    if (!metaRes.ok) {
      throw new Error(`GitHub API Error: ${metaRes.status}`);
    }
    const meta = await metaRes.json();
    console.log("Meta:", meta);
    const fileUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${zipName}?ref=${GITHUB_BRANCH}`;
    await downloadFile(fileUrl, zipPath, GITHUB_TOKEN);
    if (!fs.existsSync(zipPath)) {
      throw new Error("Download failed.");
    }
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tempDir, true);
    const files = fs.readdirSync(tempDir);
    let installedCount = 0;
    for (const file of files) {
      const fullPath = path.join(tempDir, file);
      if (!fs.statSync(fullPath).isFile()) continue;
      const ext = path.extname(file).toLowerCase();
      if (ext === ".lua") {
        fs.copyFileSync(fullPath, path.join(pluginDir, file));
        installedCount++;
      } else if (ext === ".manifest") {
        fs.copyFileSync(fullPath, path.join(depotDir, file));
        installedCount++;
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    return { success: true, filesInstalled: installedCount };
  } catch (err) {
    console.error("INSTALL FAILED:", err);
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
      }
    }
    return { success: false, error: err.message };
  }
}
electron.ipcMain.handle("install-game", async (_, game) => {
  return await installGameInternal(game);
});
electron.ipcMain.handle("restart-steam", async () => {
  return new Promise((resolve) => {
    exec('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', (err, stdout) => {
      if (err) return resolve(false);
      const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
      if (!match) return resolve(false);
      const steamBase = match[1].trim().replace(/\//g, "\\");
      exec("taskkill /IM steam.exe /F", () => {
        setTimeout(() => {
          exec(`"${steamBase}\\steam.exe"`);
          resolve(true);
        }, 1200);
      });
    });
  });
});
electron.ipcMain.handle("get-app-version", () => {
  return electron.app.getVersion();
});
electron.ipcMain.handle("get-device-id", async () => {
  return await getDeviceId();
});
electron.ipcMain.handle("get-pc-name", () => {
  return os.hostname();
});
electron.ipcMain.handle("get-steam-appids", async () => {
  try {
    let steamPath = await new Promise((resolve) => {
      exec(
        'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
        (err, stdout) => {
          if (err) return resolve(null);
          const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
          resolve(match ? match[1].trim() : null);
        }
      );
    });
    if (!steamPath) {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Select Steam Folder"
      });
      if (result.canceled) {
        return { success: false, allAppIds: [], playableAppIds: [], error: "User canceled folder selection" };
      }
      steamPath = result.filePaths[0];
    }
    steamPath = steamPath.replace(/\//g, "\\");
    console.log("STEAM PATH:", steamPath);
    const accountId = getActiveAccountId(steamPath);
    console.log("ACTIVE ACCOUNT ID:", accountId);
    const installedAppIds = getInstalledAppIds(steamPath);
    const ownedAppIds = accountId ? getOwnedAppIds(steamPath, accountId) : [];
    const unlockedAppIds = getUnlockedAppIds(steamPath);
    const allAppIds = Array.from(/* @__PURE__ */ new Set([
      ...installedAppIds,
      ...ownedAppIds,
      ...unlockedAppIds
    ]));
    const installedGames = filterPlayableGames(steamPath, installedAppIds);
    const allGames = filterPlayableGames(steamPath, allAppIds);
    console.log(`INSTALLED GAMES: ${installedGames.length}`);
    console.log(`ALL GAMES: ${allGames.length}`);
    return {
      success: true,
      installedAppIds: installedGames,
      allAppIds: allGames,
      error: null
    };
  } catch (err) {
    console.error("Steam Library Parsing Error:", err);
    return {
      success: false,
      installedAppIds: [],
      allAppIds: [],
      error: err.message || "Failed to parse Steam library"
    };
  }
});
function getActiveAccountId(steamPath) {
  try {
    const loginUsersPath = path.join(steamPath, "config", "loginusers.vdf");
    if (!fs.existsSync(loginUsersPath)) return null;
    const raw = fs.readFileSync(loginUsersPath, "utf-8");
    const data = vdf.parse(raw);
    const users = data.users || data.Users || data;
    for (const steamId64 in users) {
      if (users[steamId64].MostRecent === "1") {
        return (BigInt(steamId64) - 76561197960265728n).toString();
      }
    }
  } catch (err) {
    console.error("getActiveAccountId error:", err);
  }
  return null;
}
function getInstalledAppIds(steamPath) {
  try {
    const libraries = [];
    libraries.push(path.join(steamPath, "steamapps"));
    const libFile = path.join(steamPath, "steamapps", "libraryfolders.vdf");
    if (fs.existsSync(libFile)) {
      const raw = fs.readFileSync(libFile, "utf-8");
      const data = vdf.parse(raw);
      const folders = data.libraryfolders || data.LibraryFolders;
      for (const key in folders) {
        const folder = folders[key];
        if (folder.path) {
          const libPath = path.join(folder.path.replace(/\\\\/g, "\\"), "steamapps");
          if (!libraries.includes(libPath)) {
            libraries.push(libPath);
          }
        }
      }
    }
    const appSet = /* @__PURE__ */ new Set();
    for (const lib of libraries) {
      if (!fs.existsSync(lib)) continue;
      const files = fs.readdirSync(lib);
      files.forEach((file) => {
        if (file.startsWith("appmanifest_") && file.endsWith(".acf")) {
          const appid = file.replace("appmanifest_", "").replace(".acf", "");
          appSet.add(appid);
        }
      });
    }
    return Array.from(appSet);
  } catch (err) {
    console.error("getInstalledAppIds error:", err);
    return [];
  }
}
function getOwnedAppIds(steamPath, accountId) {
  try {
    const localConfigPath = path.join(steamPath, "userdata", accountId, "config", "localconfig.vdf");
    if (!fs.existsSync(localConfigPath)) return [];
    const raw = fs.readFileSync(localConfigPath, "utf-8");
    const data = vdf.parse(raw);
    const store = data.UserLocalConfigStore || data.userlocalconfigstore;
    const apps = store?.Software?.Valve?.Steam?.apps || store?.software?.valve?.steam?.apps;
    if (apps) {
      return Object.keys(apps);
    }
  } catch (err) {
    console.error("getOwnedAppIds error:", err);
  }
  return [];
}
function getUnlockedAppIds(steamPath) {
  const unlockedIds = /* @__PURE__ */ new Set();
  try {
    const pluginDir = path.join(steamPath, "config", "stplug-in");
    if (fs.existsSync(pluginDir)) {
      const files = fs.readdirSync(pluginDir);
      files.forEach((file) => {
        if (file.endsWith(".lua")) {
          const match = file.match(/\d+/);
          if (match) unlockedIds.add(match[0]);
        }
      });
    }
    const appListFolder = path.join(steamPath, "AppList");
    if (fs.existsSync(appListFolder)) {
      const files = fs.readdirSync(appListFolder);
      files.forEach((file) => {
        if (file.endsWith(".txt")) {
          const filePath = path.join(appListFolder, file);
          const content = fs.readFileSync(filePath, "utf-8");
          const match = content.match(/\d+/);
          if (match) unlockedIds.add(match[0]);
        }
      });
    }
    const masterFiles = [
      "GreenLuma_Reborn_AppList.txt",
      "GreenLuma_AppList.txt",
      "DefaultAppList.txt"
    ];
    masterFiles.forEach((file) => {
      const filePath = path.join(steamPath, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split(/\r?\n/);
        lines.forEach((line) => {
          const match = line.trim().match(/^\d+/);
          if (match) unlockedIds.add(match[0]);
        });
      }
    });
  } catch (err) {
    console.error("getUnlockedAppIds error:", err);
  }
  return Array.from(unlockedIds);
}
function filterPlayableGames(steamPath, appIds) {
  const IGNORE_LIST = /* @__PURE__ */ new Set([
    "228980",
    "250820",
    "1070560",
    "1391110",
    "1628350",
    "1161040",
    "1826330",
    "1493710",
    "760",
    "1182480",
    "2829100",
    "7",
    "241100",
    "2371090"
  ]);
  const validGames = [];
  for (const appid of appIds) {
    const idStr = String(appid).trim();
    if (idStr.length > 20 && /^[a-f0-9]+$/i.test(idStr)) {
      continue;
    }
    if (IGNORE_LIST.has(idStr)) continue;
    try {
      const appinfoPath = path.join(steamPath, "appcache", "appinfo.vdf");
      if (!fs.existsSync(appinfoPath)) {
        validGames.push(idStr);
        continue;
      }
      const buffer = fs.readFileSync(appinfoPath);
      const idSearchStr = `\0${idStr}\0`;
      const index = buffer.indexOf(idSearchStr, 0, "ascii");
      if (index !== -1) {
        const chunk = buffer.slice(index, index + 2e3).toString("ascii");
        if (chunk.includes(".png") && !chunk.includes(".jpg")) {
          console.log(`HAWAI Projects: Skipping ${idStr} because it uses PNG assets.`);
          continue;
        }
        const typeMatch = chunk.match(/type\x00([A-Za-z]+)\x00/i);
        if (typeMatch) {
          const appType = typeMatch[1].toLowerCase();
          if (appType === "game") {
            validGames.push(idStr);
          }
        } else {
          validGames.push(idStr);
        }
      } else {
        validGames.push(idStr);
      }
    } catch (err) {
      validGames.push(idStr);
    }
  }
  return validGames;
}
electron.ipcMain.handle("get-local-game-art", async (_, appid) => {
  try {
    const steamPath = await new Promise((resolve) => {
      exec('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', (err, stdout) => {
        if (err) return resolve(null);
        const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
        resolve(match ? match[1].trim().replace(/\//g, "\\") : null);
      });
    });
    if (!steamPath) return null;
    const cacheDir = path.join(steamPath, "appcache", "librarycache");
    const possiblePaths = [
      path.join(cacheDir, appid.toString(), "library_600x900.jpg"),
      path.join(cacheDir, appid.toString(), "header.jpg"),
      path.join(cacheDir, `${appid}_library_600x900.jpg`),
      path.join(cacheDir, `${appid}_header.jpg`)
    ];
    for (const imgPath of possiblePaths) {
      if (fs.existsSync(imgPath)) {
        const bitmap = fs.readFileSync(imgPath);
        return `data:image/jpeg;base64,${bitmap.toString("base64")}`;
      }
    }
    return null;
  } catch (err) {
    console.log("Local image fetch error:", err);
    return null;
  }
});
electron.ipcMain.handle("get-steamgriddb-art", async (_, appid) => {
  const SGDB_API_KEY = "b6723c83c50f2bd745d47b6ac136e64f";
  try {
    const response = await fetch(`https://www.steamgriddb.com/api/v2/grids/steam/${appid}?dimensions=600x900`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${SGDB_API_KEY}`
      }
    });
    const data = await response.json();
    if (data.success && data.data.length > 0) {
      const solidCover = data.data.find(
        (img) => (img.mime === "image/jpeg" || img.mime === "image/jpg") && img.humor === false
      );
      if (solidCover) {
        return solidCover.url;
      }
      return data.data[0].url;
    }
    return null;
  } catch (err) {
    console.log("SteamGridDB fetch error:", err);
    return null;
  }
});
electron.ipcMain.handle("get-game-path", async (_, appid) => {
  try {
    const steamBase = await new Promise((resolve) => {
      exec(
        'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
        (err, stdout) => {
          if (err) return resolve(null);
          const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
          resolve(match ? match[1].trim() : null);
        }
      );
    });
    if (!steamBase) throw new Error("Steam not found");
    const steamPath = steamBase.replace(/\//g, "\\");
    const libraries = [];
    libraries.push(path.join(steamPath, "steamapps"));
    const libFile = path.join(steamPath, "steamapps", "libraryfolders.vdf");
    if (fs.existsSync(libFile)) {
      const raw = fs.readFileSync(libFile, "utf-8");
      const data = vdf.parse(raw);
      const folders = data.libraryfolders || data.LibraryFolders;
      for (const key in folders) {
        const folder = folders[key];
        if (folder.path) {
          const libPath = path.join(
            folder.path.replace(/\\\\/g, "\\"),
            "steamapps"
          );
          libraries.push(libPath);
        }
      }
    }
    for (const lib of libraries) {
      const manifestPath = path.join(
        lib,
        `appmanifest_${appid}.acf`
      );
      if (fs.existsSync(manifestPath)) {
        const raw = fs.readFileSync(manifestPath, "utf-8");
        const data = vdf.parse(raw);
        const installdir = data.AppState?.installdir || data.appstate?.installdir;
        if (!installdir) continue;
        const gamePath = path.join(lib, "common", installdir);
        return {
          success: true,
          gamePath,
          installdir
        };
      }
    }
    return { success: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
async function getGamePath(appid) {
  try {
    let steamPath = await new Promise((resolve) => {
      exec(
        'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
        (err, stdout) => {
          if (err) return resolve(null);
          const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
          resolve(match ? match[1].trim() : null);
        }
      );
    });
    if (!steamPath) return { success: false };
    steamPath = steamPath.replace(/\//g, "\\");
    const libraries = [];
    libraries.push(path.join(steamPath, "steamapps"));
    const libFile = path.join(steamPath, "steamapps", "libraryfolders.vdf");
    if (fs.existsSync(libFile)) {
      const raw = fs.readFileSync(libFile, "utf-8");
      const data = vdf.parse(raw);
      const folders = data.libraryfolders || data.LibraryFolders;
      for (const key in folders) {
        const folder = folders[key];
        if (folder.path) {
          const libPath = path.join(
            folder.path.replace(/\\\\/g, "\\"),
            "steamapps"
          );
          libraries.push(libPath);
        }
      }
    }
    for (const lib of libraries) {
      const manifest = path.join(lib, `appmanifest_${appid}.acf`);
      if (fs.existsSync(manifest)) {
        const raw = fs.readFileSync(manifest, "utf-8");
        const data = vdf.parse(raw);
        const installdir = data.AppState?.installdir || data.appstate?.installdir;
        if (!installdir) continue;
        const gamePath = path.join(lib, "common", installdir);
        return { success: true, gamePath };
      }
    }
    return { success: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
electron.ipcMain.handle("apply-fix", async (event, game) => {
  let tempDir;
  try {
    const luaRes = await installGameInternal({ zipPath: game.lua_file });
    if (!luaRes.success) throw new Error(`Lua install failed: ${luaRes.error}`);
    const res = await getGamePath(game.appid);
    if (!res.success) throw new Error("Game not installed");
    const gamePath = res.gamePath;
    if (game.repair_url) {
      tempDir = path.join(electron.app.getPath("temp"), "hawai-crack");
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      fs.mkdirSync(tempDir, { recursive: true });
      const zipPath = path.join(tempDir, "crack.zip");
      const secureApiUrl = await getGitHubApiAssetUrl(game.repair_url, GITHUB_TOKEN);
      await downloadFile(secureApiUrl, zipPath, GITHUB_TOKEN, (stats) => {
        event.sender.send("download-progress", stats);
      });
      event.sender.send("download-progress", { extracting: true });
      new AdmZip(zipPath).extractAllTo(gamePath, true);
    }
    if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    console.error("APPLY FIX ERROR:", err);
    if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    return { success: false, error: err.message };
  }
});
electron.ipcMain.handle("play-game", async (_, game) => {
  try {
    const res = await getGamePath(game.appid);
    if (!res.success) {
      return {
        success: false,
        error: "Game is not installed"
      };
    }
    const gameRootPath = res.gamePath;
    const exeRelative = game.exe_path.replace(/\//g, path.sep);
    const exeFullPath = path.join(gameRootPath, exeRelative);
    if (!fs.existsSync(exeFullPath)) {
      return {
        success: false,
        error: "Required EXE not found. Apply Fix first."
      };
    }
    const workingDir = path.dirname(exeFullPath);
    console.log("--- LAUNCHING GAME ---");
    console.log("ROOT PATH  :", gameRootPath);
    console.log("EXE PATH   :", exeFullPath);
    console.log("WORKING DIR:", workingDir);
    console.log("----------------------");
    exec(
      `powershell -Command "Start-Process \\"${exeFullPath}\\" -WorkingDirectory \\"${workingDir}\\" -Verb runAs"`
    );
    return { success: true };
  } catch (err) {
    console.error("PLAY ERROR:", err);
    return {
      success: false,
      error: "Failed to launch game"
    };
  }
});
electron.ipcMain.handle("install-vc-redist", async (event) => {
  let tempDir;
  try {
    tempDir = path.join(electron.app.getPath("temp"), "hawai-vcredist");
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    const zipPath = path.join(tempDir, "vc_redist.zip");
    const rawWebUrl = "https://github.com/hantalah30/hawai-projets2/releases/download/VCRedistAIOv1/VisualCppRedist_AIO_x86_x64_103.zip";
    const secureApiUrl = await getGitHubApiAssetUrl(rawWebUrl, GITHUB_TOKEN);
    await downloadFile(secureApiUrl, zipPath, GITHUB_TOKEN, (stats) => {
      event.sender.send("download-progress", stats);
    });
    event.sender.send("download-progress", { extracting: true });
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tempDir, true);
    const exePath = path.join(tempDir, "VisualCppRedist_AIO_x86_x64.exe");
    return new Promise((resolve) => {
      event.sender.send("download-progress", { installing: true });
      exec(`"${exePath}" /y /gm2`, (error) => {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        if (error) {
          console.error("VC++ Install Error:", error);
          resolve({ success: false, error: "Installation failed. Please close all running apps and try again." });
        } else {
          resolve({ success: true });
        }
      });
    });
  } catch (err) {
    console.error("VC++ REDIST ERROR:", err);
    if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    return { success: false, error: err.message };
  }
});
electron.ipcMain.handle("add-av-exclusion", async () => {
  try {
    const steamBase = await new Promise((resolve) => {
      exec('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', (err, stdout) => {
        if (err) return resolve(null);
        const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
        resolve(match ? match[1].trim() : null);
      });
    });
    if (!steamBase) throw new Error("Steam installation not found.");
    const steamPath = steamBase.replace(/\//g, "\\");
    console.log(`Adding AV Exclusion for: ${steamPath}`);
    const psCommand = `Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command Add-MpPreference -ExclusionPath ''${steamPath}''' -Verb RunAs`;
    await new Promise((resolve, reject) => {
      exec(`powershell -Command "${psCommand}"`, (error) => {
        if (error) {
          console.error("Failed to trigger AV exclusion:", error);
          reject(error);
        } else {
          resolve();
        }
      });
    });
    const markerPath = path.join(steamPath, ".hawai_av_ok");
    fs.writeFileSync(markerPath, "true");
    return { success: true };
  } catch (err) {
    console.error("AV EXCLUSION ERROR:", err);
    return { success: false, error: err.message };
  }
});
electron.ipcMain.handle("check-av-exclusion", async () => {
  try {
    const steamBase = await new Promise((resolve) => {
      exec('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', (err, stdout) => {
        if (err) return resolve(null);
        const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
        resolve(match ? match[1].trim() : null);
      });
    });
    if (!steamBase) return false;
    const steamPath = steamBase.replace(/\//g, "\\");
    const markerPath = path.join(steamPath, ".hawai_av_ok");
    if (fs.existsSync(markerPath)) {
      return true;
    }
    return false;
  } catch (err) {
    console.error("CHECK AV EXCLUSION ERROR:", err);
    return false;
  }
});
electron.ipcMain.handle("steam-version-downgrade", async (event) => {
  let tempDir = null;
  try {
    const steamBase = await new Promise((resolve) => {
      exec('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', (err, stdout) => {
        if (err) return resolve(null);
        const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
        resolve(match ? match[1].trim() : null);
      });
    });
    if (!steamBase) throw new Error("Steam not found");
    const steamPath = steamBase.replace(/\//g, "\\");
    console.log("Killing Steam...");
    exec("taskkill /IM steam.exe /F");
    await new Promise((r) => setTimeout(r, 1e3));
    tempDir = path.join(electron.app.getPath("temp"), "hawai-downgrade");
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    const zipPath = path.join(tempDir, "steam_fix.zip");
    const rawUrl = "https://github.com/hantalah30/hawai-projets2/releases/download/steam/SteamFix_By_DECODER_crack.zip";
    const secureUrl = await getGitHubApiAssetUrl(rawUrl, GITHUB_TOKEN);
    console.log("Downloading fix...");
    await downloadFile(secureUrl, zipPath, GITHUB_TOKEN, (stats) => {
      event.sender.send("download-progress", stats);
    });
    console.log("Extracting to:", steamPath);
    event.sender.send("download-progress", { extracting: true });
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(steamPath, true);
    fs.rmSync(tempDir, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    console.error("Downgrade Failed:", err);
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
      }
    }
    if (err.message === "socket hang up" || err.code === "ECONNRESET") {
      return { success: false, error: "Cancelled by user" };
    }
    return { success: false, error: err.message };
  }
});
electron.ipcMain.handle("open-game-folder", async (_, game) => {
  try {
    const res = await getGamePath(game.appid);
    if (!res.success) {
      return { success: false, error: "Game is not installed" };
    }
    const gameRootPath = res.gamePath;
    const exeRelative = game.exe_path.replace(/\//g, path.sep);
    const exeFullPath = path.join(gameRootPath, exeRelative);
    if (!fs.existsSync(exeFullPath)) {
      return { success: false, error: "Required EXE not found. Apply Fix first." };
    }
    electron.shell.showItemInFolder(exeFullPath);
    return { success: true, exeName: path.basename(exeFullPath) };
  } catch (err) {
    console.error("OPEN FOLDER ERROR:", err);
    return { success: false, error: "Failed to open folder" };
  }
});
