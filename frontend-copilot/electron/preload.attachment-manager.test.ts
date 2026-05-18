import { describe, expect, it } from 'vitest'

import type { AttachmentManagerApi } from './attachment-service/ipc'
import {
  ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL,
  ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL,
  ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL,
  ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL,
} from './attachment-service/ipc'
import { getExposedApi, getInvokeMock, getPathForFileMock, loadPreloadModule } from './preload.test-support'

describe('preload attachment-manager bridge', () => {
  it('routes attachment manager APIs through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    const pathForFileMock = getPathForFileMock()
    invokeMock.mockResolvedValue(undefined)
    pathForFileMock.mockReturnValue('C:/tmp/pasted-image.png')

    await loadPreloadModule()

    const attachmentManager = getExposedApi<AttachmentManagerApi>('attachmentManager')
    const file = new File(['image-data'], 'pasted-image.png', { type: 'image/png' })

    expect(attachmentManager.resolveFilePath(file)).toBe('C:/tmp/pasted-image.png')
    await attachmentManager.readClipboardData()
    await attachmentManager.writeTempFile({
      data: {
        mimeType: 'image/png',
        base64Data: 'cG5nLWRhdGE=',
        byteLength: 8,
        width: 320,
        height: 180,
        suggestedName: 'pasted-image.png',
      },
    })
    await attachmentManager.readPreview({ path: '/tmp/readme.txt', maxTextBytes: 1024 })
    await attachmentManager.cleanupTempFiles({ paths: ['/tmp/candue-attachments/pasted-image.png'] })

    expect(pathForFileMock).toHaveBeenCalledWith(file)
    expect(invokeMock.mock.calls).toEqual([
      [ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL],
      [
        ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL,
        {
          data: {
            mimeType: 'image/png',
            base64Data: 'cG5nLWRhdGE=',
            byteLength: 8,
            width: 320,
            height: 180,
            suggestedName: 'pasted-image.png',
          },
        },
      ],
      [ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL, { path: '/tmp/readme.txt', maxTextBytes: 1024 }],
      [ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL, { paths: ['/tmp/candue-attachments/pasted-image.png'] }],
    ])
  })
})
