import { app as r, BrowserWindow as f, Menu as P, ipcMain as s } from "electron";
import { readFile as O, mkdir as I, writeFile as N } from "node:fs/promises";
import { fileURLToPath as y } from "node:url";
import n from "node:path";
const p = "copilot-settings:load", g = "copilot-settings:save";
function l(t) {
  const e = typeof t == "object" && t !== null ? t : {};
  return {
    runtimeUrl: d(e.runtimeUrl),
    agentName: d(e.agentName)
  };
}
function R(t, e) {
  return l({
    ...t,
    ...e
  });
}
function m(t) {
  return t.runtimeUrl === null && t.agentName === null ? "empty" : "stored";
}
function d(t) {
  if (typeof t != "string")
    return null;
  const e = t.trim();
  return e.length > 0 ? e : null;
}
const S = n.dirname(y(import.meta.url));
process.env.APP_ROOT = n.join(S, "..");
const a = process.env.VITE_DEV_SERVER_URL, b = n.join(process.env.APP_ROOT, "dist-electron"), c = n.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = a ? n.join(process.env.APP_ROOT, "public") : c;
const h = process.env.VITE_PUBLIC ?? c;
let i;
const v = "copilot-settings.json";
function E() {
  i = new f({
    icon: n.join(h, "electron-vite.svg"),
    autoHideMenuBar: !0,
    webPreferences: {
      preload: n.join(S, "preload.mjs")
    }
  }), i.setMenuBarVisibility(!1), i.webContents.on("did-finish-load", () => {
    i?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), a ? i.loadURL(a) : i.loadFile(n.join(c, "index.html"));
}
function L() {
  s.removeHandler(p), s.removeHandler(g), s.handle(p, async () => _()), s.handle(g, async (t, e) => j(e));
}
async function _() {
  const t = T();
  try {
    const e = await O(t, "utf8"), o = l(JSON.parse(e));
    return {
      ok: !0,
      settings: o,
      storageState: m(o)
    };
  } catch (e) {
    return V(e) ? {
      ok: !0,
      settings: A(),
      storageState: "empty"
    } : {
      ok: !1,
      error: `Failed to load Copilot settings: ${C(e)}`
    };
  }
}
async function j(t) {
  const e = await _();
  if (!e.ok)
    return e;
  const o = R(e.settings, t), u = T();
  try {
    return await I(n.dirname(u), { recursive: !0 }), await N(u, `${JSON.stringify(o, null, 2)}
`, "utf8"), {
      ok: !0,
      settings: o,
      storageState: m(o)
    };
  } catch (w) {
    return {
      ok: !1,
      error: `Failed to save Copilot settings: ${C(w)}`
    };
  }
}
function T() {
  return n.join(r.getPath("userData"), v);
}
function A() {
  return l({});
}
function V(t) {
  return typeof t == "object" && t !== null && "code" in t && t.code === "ENOENT";
}
function C(t) {
  return t instanceof Error ? t.message : String(t);
}
r.on("window-all-closed", () => {
  process.platform !== "darwin" && (r.quit(), i = null);
});
r.on("activate", () => {
  f.getAllWindows().length === 0 && E();
});
r.whenReady().then(() => {
  P.setApplicationMenu(null), L(), E();
});
export {
  b as MAIN_DIST,
  c as RENDERER_DIST,
  a as VITE_DEV_SERVER_URL
};
