import { app, BrowserWindow, ipcMain } from "electron";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const COPILOT_SETTINGS_LOAD_CHANNEL = "copilot-settings:load";
const COPILOT_SETTINGS_SAVE_CHANNEL = "copilot-settings:save";
function normalizeCopilotSettings(input) {
  const record = typeof input === "object" && input !== null ? input : {};
  return {
    runtimeUrl: normalizeOptionalString(record.runtimeUrl),
    agentName: normalizeOptionalString(record.agentName)
  };
}
function mergeCopilotSettings(current, patch) {
  return normalizeCopilotSettings({
    ...current,
    ...patch
  });
}
function getCopilotSettingsStorageState(settings) {
  return settings.runtimeUrl === null && settings.agentName === null ? "empty" : "stored";
}
function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
const VITE_PUBLIC = process.env.VITE_PUBLIC ?? RENDERER_DIST;
let win;
const COPILOT_SETTINGS_FILE_NAME = "copilot-settings.json";
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
function registerCopilotSettingsHandlers() {
  ipcMain.removeHandler(COPILOT_SETTINGS_LOAD_CHANNEL);
  ipcMain.removeHandler(COPILOT_SETTINGS_SAVE_CHANNEL);
  ipcMain.handle(COPILOT_SETTINGS_LOAD_CHANNEL, async () => {
    return loadCopilotSettings();
  });
  ipcMain.handle(COPILOT_SETTINGS_SAVE_CHANNEL, async (_event, patch) => {
    return saveCopilotSettings(patch);
  });
}
async function loadCopilotSettings() {
  const settingsFilePath = getCopilotSettingsFilePath();
  try {
    const fileContent = await readFile(settingsFilePath, "utf8");
    const settings = normalizeCopilotSettings(JSON.parse(fileContent));
    return {
      ok: true,
      settings,
      storageState: getCopilotSettingsStorageState(settings)
    };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      const emptySettings = createEmptyCopilotSettings();
      return {
        ok: true,
        settings: emptySettings,
        storageState: "empty"
      };
    }
    return {
      ok: false,
      error: `Failed to load Copilot settings: ${formatUnknownError(error)}`
    };
  }
}
async function saveCopilotSettings(patch) {
  const currentSettingsResult = await loadCopilotSettings();
  if (!currentSettingsResult.ok) {
    return currentSettingsResult;
  }
  const settings = mergeCopilotSettings(currentSettingsResult.settings, patch);
  const settingsFilePath = getCopilotSettingsFilePath();
  try {
    await mkdir(path.dirname(settingsFilePath), { recursive: true });
    await writeFile(settingsFilePath, `${JSON.stringify(settings, null, 2)}
`, "utf8");
    return {
      ok: true,
      settings,
      storageState: getCopilotSettingsStorageState(settings)
    };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to save Copilot settings: ${formatUnknownError(error)}`
    };
  }
}
function getCopilotSettingsFilePath() {
  return path.join(app.getPath("userData"), COPILOT_SETTINGS_FILE_NAME);
}
function createEmptyCopilotSettings() {
  return normalizeCopilotSettings({});
}
function isFileNotFoundError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function formatUnknownError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(() => {
  registerCopilotSettingsHandlers();
  createWindow();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
