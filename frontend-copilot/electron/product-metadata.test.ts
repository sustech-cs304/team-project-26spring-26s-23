import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(__dirname, '..')

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.join(workspaceRoot, relativePath), 'utf8')
}

describe('CanDue product metadata', () => {
  it('sets the Electron runtime application name to CanDue before resolving userData paths', () => {
    const mainSource = readWorkspaceFile('electron/main.ts')
    const setNameCall = 'app.setName(ELECTRON_APPLICATION_NAME)'
    const getUserDataCall = "app.getPath('userData')"

    expect(mainSource).toContain("const ELECTRON_APPLICATION_NAME = 'CanDue'")

    const setNameIndex = mainSource.indexOf(setNameCall)
    const getUserDataIndex = mainSource.indexOf(getUserDataCall)

    expect(setNameIndex).toBeGreaterThanOrEqual(0)
    expect(getUserDataIndex).toBeGreaterThanOrEqual(0)
    expect(setNameIndex).toBeLessThan(getUserDataIndex)
  })

  it('uses the packaged application id and localized display name for desktop notifications', () => {
    const mainSource = readWorkspaceFile('electron/main.ts')

    expect(mainSource).toContain("const ELECTRON_NOTIFICATION_DISPLAY_NAME = '赶渡 CanDue'")
    expect(mainSource).toContain("const ELECTRON_APPLICATION_ID = 'com.candue.app'")
    expect(mainSource).toContain("const ELECTRON_NOTIFICATION_SHORTCUT_NAME = `${ELECTRON_NOTIFICATION_DISPLAY_NAME}.lnk`")
    expect(mainSource).toContain("const ELECTRON_NOTIFICATION_TOAST_ACTIVATOR_CLSID = '{D6B8D450-4B0B-4F22-9A1C-ACB1A5A5B6F1}'")
    expect(mainSource).toContain('app.setAppUserModelId(ELECTRON_APPLICATION_ID)')
    expect(mainSource).toContain('app.setToastActivatorCLSID(ELECTRON_NOTIFICATION_TOAST_ACTIVATOR_CLSID)')
    expect(mainSource).toContain('notificationOptions.appID = ELECTRON_APPLICATION_ID')
    expect(mainSource).toContain('shell.writeShortcutLink(shortcutPath, {')
    expect(mainSource).toContain('appUserModelId: ELECTRON_APPLICATION_ID')
    expect(mainSource).toContain('toastActivatorClsid: ELECTRON_NOTIFICATION_TOAST_ACTIVATOR_CLSID')
    expect(mainSource).toContain('const escapedAppName = escapeDesktopNotificationXml(ELECTRON_NOTIFICATION_DISPLAY_NAME)')
  })

  it('keeps the package name npm-safe while exposing CanDue as the product name', () => {
    const packageJson = JSON.parse(readWorkspaceFile('package.json')) as {
      name: string
      productName: string
    }

    expect(packageJson.name).toBe('candue')
    expect(packageJson.productName).toBe('CanDue')
  })

  it('uses CanDue for the desktop window title and packaged artifact metadata', () => {
    const mainWindowSource = readWorkspaceFile('electron/main-window.ts')
    const builderConfig = readWorkspaceFile('electron-builder.json5')

    expect(mainWindowSource).toContain("title: 'CanDue'")
    expect(builderConfig).toContain('"productName": "CanDue"')
    expect(builderConfig).toContain('${productName}-Windows-${version}-Setup.${ext}')
    expect(builderConfig).toContain('${productName}-Mac-${version}-Installer.${ext}')
    expect(builderConfig).toContain('${productName}-Linux-${version}.${ext}')
  })
})
