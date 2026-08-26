import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
const dir = mkdtempSync(join(tmpdir(), 'sspoffer-test-'))
export const app = {
  getPath: () => dir,
  setAppUserModelId: () => {},
}
export const ipcMain = { handle: () => {}, on: () => {} }
export const BrowserWindow = function () {}
export default app
