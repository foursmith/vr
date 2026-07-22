interface FileLaunchParams {
  files?: readonly FileSystemFileHandle[]
}

interface FileLaunchQueue {
  setConsumer: (consumer: (params: FileLaunchParams) => void) => void
}

declare global {
  interface Window {
    launchQueue?: FileLaunchQueue
  }
}

interface FileLaunchHandlerOptions {
  importFiles: (files: File[]) => Promise<void> | void
  isDisposed: () => boolean
}

export const setupFileLaunchHandler = (options: FileLaunchHandlerOptions) => {
  const launchQueue = window.launchQueue
  if (!launchQueue) return () => {}

  let active = true
  let launchGeneration = 0
  launchQueue.setConsumer((params) => {
    if (!params.files?.length) return
    const generation = ++launchGeneration
    void Promise.allSettled(params.files.map(handle => handle.getFile())).then(async (results) => {
      if (!active || options.isDisposed() || generation !== launchGeneration) return

      const files = results.flatMap(result => result.status === "fulfilled" ? [result.value] : [])
      const failures = results.filter(result => result.status === "rejected")
      if (failures.length) console.warn("some launched video files could not be opened", failures)
      if (!files.length) return

      try {
        await options.importFiles(files)
      } catch (error) {
        console.warn("launched video import failed", error)
      }
    })
  })

  return () => {
    active = false
  }
}
