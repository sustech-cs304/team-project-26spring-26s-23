import { spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import { collectForwardedElectronMainProcessArguments } from './electron/runtime/runtime-config'

type ElectronStartup = ((argv?: string[], options?: SpawnOptions, customElectronPkg?: string) => Promise<void>) & {
  exit?: () => Promise<void>
  __canduePatched?: true
}

type ProcessWithElectronApp = NodeJS.Process & {
  electronApp?: ChildProcess
}

const require = createRequire(import.meta.url)
const mathJaxPackageVersion = (require('mathjax-full/package.json') as { version: string }).version
const mathJaxPackageVersionDefine = JSON.stringify(mathJaxPackageVersion)

function createElectronChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function patchElectronDevStartupExit(startup: ElectronStartup): void {
  if (startup.__canduePatched === true) {
    return
  }

  const originalExit = startup.exit?.bind(startup)

  startup.exit = async () => {
    const processWithElectronApp = process as ProcessWithElectronApp
    const electronApp = processWithElectronApp.electronApp

    if (electronApp === undefined) {
      if (process.platform !== 'win32') {
        await originalExit?.()
      }
      return
    }

    electronApp.removeAllListeners()

    if (process.platform === 'win32') {
      processWithElectronApp.electronApp = undefined

      if (electronApp.exitCode !== null || electronApp.signalCode !== null) {
        return
      }

      if (electronApp.pid !== undefined) {
        spawnSync('taskkill', ['/pid', String(electronApp.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
      }

      return
    }

    await originalExit?.()
  }

  startup.__canduePatched = true
}

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.mts', '.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  define: {
    PACKAGE_VERSION: mathJaxPackageVersionDefine,
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        PACKAGE_VERSION: mathJaxPackageVersionDefine,
      },
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['better-sqlite3'],
            },
          },
        },
        onstart({ startup }) {
          patchElectronDevStartupExit(startup as ElectronStartup)
          return startup([
            '.',
            '--no-sandbox',
            ...collectForwardedElectronMainProcessArguments(process.argv),
          ], { env: createElectronChildEnv() })
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Polyfill the Electron and Node.js APIs for the renderer process.
      // If you want to use Node.js in the renderer process, `nodeIntegration` needs to be enabled in the main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})
