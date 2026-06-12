/**
 * Collect File objects from picker lists or drag-and-drop (including nested folders).
 */

/** @param {FileList|File[]} fileList */
export function collectFromFileList(fileList) {
  return Array.from(fileList)
}

/**
 * Recursively read a directory entry from a drag-and-drop operation.
 * @param {FileSystemEntry} entry
 * @param {string} [pathPrefix]
 * @returns {Promise<File[]>}
 */
function readEntry(entry, pathPrefix = '') {
  if (entry.isFile) {
    return new Promise((resolve) => {
      /** @type {FileSystemFileEntry} */ (entry).file(
        (file) => {
          try {
            Object.defineProperty(file, '_relativePath', {
              value: pathPrefix + file.name,
              writable: false,
              enumerable: false,
            })
          } catch (_) { /* read-only in some browsers */ }
          resolve([file])
        },
        () => resolve([]),
      )
    })
  }

  if (entry.isDirectory) {
    return new Promise((resolve) => {
      const reader = /** @type {FileSystemDirectoryEntry} */ (entry).createReader()
      const all = []

      const readBatch = () => {
        reader.readEntries(async (entries) => {
          if (!entries.length) {
            resolve(all)
            return
          }
          for (const child of entries) {
            const childPath = pathPrefix + entry.name + '/'
            const files = await readEntry(child, childPath)
            all.push(...files)
          }
          readBatch()
        }, () => resolve(all))
      }

      readBatch()
    })
  }

  return Promise.resolve([])
}

/**
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<File[]>}
 */
export async function collectFromDataTransfer(dataTransfer) {
  const items = dataTransfer?.items
  if (items?.length && typeof items[0].webkitGetAsEntry === 'function') {
    /** @type {File[]} */
    const out = []
    const tasks = []
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry()
      if (entry) tasks.push(readEntry(entry))
    }
    const batches = await Promise.all(tasks)
    batches.forEach((batch) => out.push(...batch))
    if (out.length) return out
  }

  return collectFromFileList(dataTransfer.files)
}

/** @returns {boolean} */
export function supportsFolderDrop() {
  try {
    return typeof DataTransferItem.prototype.webkitGetAsEntry === 'function'
  } catch {
    return false
  }
}
