type PermissionOptions_ = {
  readonly mode: 'readwrite'
}

type FileSystemHandle_ = FileSystemDirectoryHandle | FileSystemFileHandle

// https://wicg.github.io/file-system-access/#enumdef-wellknowndirectory
export type WellKnownDirectory = 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'

// https://wicg.github.io/file-system-access/#api-filepickeroptions-starting-directory
// https://wicg.github.io/file-system-access/#api-showdirectorypicker
export type StartingDirectory = {
  readonly id?: string // If id’s length is more than 32, throw a TypeError.
  readonly startIn?: FileSystemHandle | WellKnownDirectory
}

export type FilePickerOptionsType = {
  readonly description?: string
  readonly accept: Record<string, ReadonlyArray<string>>
}

// https://developer.mozilla.org/en-US/docs/Web/API/window/showSaveFilePicker
export type SaveFilePickerOptions = {
  readonly excludeAcceptAllOption?: boolean

  // https://github.com/WICG/file-system-access/blob/main/SuggestedNameAndDir.md
  readonly startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'

  // https://github.com/WICG/file-system-access/blob/main/SuggestedNameAndDir.md#interaction-of-suggestedname-and-accepted-file-types
  readonly suggestedName?: string

  readonly types?: FilePickerOptionsType[]
}

// https://developer.mozilla.org/en-US/docs/Web/API/window/showOpenFilePicker
// https://wicg.github.io/file-system-access/#api-filepickeroptions
export type OpenFilePickerOptions = StartingDirectory & {
  readonly multiple?: boolean
  readonly excludeAcceptAllOption?: boolean
  readonly types?: FilePickerOptionsType[]
}

export interface DataTransferItem {
  getAsFileSystemHandle(): Promise<FileSystemHandle_>
}

declare global {
  interface Window {
    showOpenFilePicker: (
      options?: OpenFilePickerOptions
    ) => Promise<(FileSystemFileHandle | FileSystemDirectoryHandle)[]>
    showDirectoryPicker: (options?: StartingDirectory) => Promise<FileSystemDirectoryHandle>
    showSaveFilePicker: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
  }
}
