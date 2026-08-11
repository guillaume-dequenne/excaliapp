import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { CachedExcalidrawScene, ExcalidrawFile, FileTreeNode, OpenTab, Preferences } from '../types'
import { convertPreferencesFromRust, convertPreferencesToRust } from '../lib/preferences'
import { ask } from '@tauri-apps/plugin-dialog'

type UnsavedChangesDecision = 'save' | 'discard' | 'cancel'
type FileLoadSource = 'cache' | 'disk' | null
type LoadDirectoryOptions = {
  preserveSession?: boolean
}

interface FileContentResult {
  content: string
  content_hash: string
}

function parseSceneFromContent(content: string): CachedExcalidrawScene {
  const data = JSON.parse(content)

  return {
    elements: data.elements || [],
    appState: data.appState || {},
    files: data.files || {},
  }
}

function toOpenTab(
  file: ExcalidrawFile,
  content: string,
  contentHash: string,
  sceneVersion = 0
): OpenTab {
  return {
    ...file,
    cachedContent: content,
    contentHash,
    cachedScene: parseSceneFromContent(content),
    sceneVersion,
  }
}

function toExcalidrawFile(tab: OpenTab): ExcalidrawFile {
  return {
    name: tab.name,
    path: tab.path,
    modified: tab.modified,
  }
}

async function readOpenTabFromDisk(file: ExcalidrawFile, sceneVersion = 0): Promise<OpenTab> {
  const { content, content_hash: contentHash } = await invoke<FileContentResult>(
    'read_file_with_hash',
    { filePath: file.path }
  )

  return toOpenTab({ ...file, modified: false }, content, contentHash, sceneVersion)
}

async function confirmUnsavedChanges(
  fileName: string,
  actionDescription: string
): Promise<UnsavedChangesDecision> {
  const shouldSave = await ask(
    `Do you want to save changes to "${fileName}" before ${actionDescription}?`,
    {
      title: 'Unsaved Changes',
      kind: 'warning',
      okLabel: 'Save',
      cancelLabel: "Don't Save",
    }
  )

  if (shouldSave) {
    return 'save'
  }

  const shouldDiscard = await ask(
    `Discard unsaved changes to "${fileName}"?`,
    {
      title: 'Discard Unsaved Changes',
      kind: 'warning',
      okLabel: "Don't Save",
      cancelLabel: 'Cancel',
    }
  )

  return shouldDiscard ? 'discard' : 'cancel'
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`) || path.startsWith(`${directory}\\`)
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) {
    return newPrefix
  }

  if (path.startsWith(`${oldPrefix}/`) || path.startsWith(`${oldPrefix}\\`)) {
    return `${newPrefix}${path.slice(oldPrefix.length)}`
  }

  return path
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths))
}

function withOpenSession(
  preferences: Preferences,
  openTabs: Pick<OpenTab, 'path'>[],
  activeFile: ExcalidrawFile | null
): Preferences {
  const lastOpenFiles = uniquePaths(openTabs.map((tab) => tab.path))
  const activeFilePath =
    activeFile && lastOpenFiles.includes(activeFile.path)
      ? activeFile.path
      : lastOpenFiles[0] ?? null

  return {
    ...preferences,
    lastOpenFiles,
    activeFilePath,
  }
}

function clearOpenSession(preferences: Preferences): Preferences {
  return {
    ...preferences,
    lastOpenFiles: [],
    activeFilePath: null,
  }
}

function sameOpenSession(a: Preferences, b: Preferences): boolean {
  return (
    a.activeFilePath === b.activeFilePath &&
    a.lastOpenFiles.length === b.lastOpenFiles.length &&
    a.lastOpenFiles.every((path, index) => path === b.lastOpenFiles[index])
  )
}

interface AppStore {
  // State
  currentDirectory: string | null
  files: ExcalidrawFile[]
  fileTree: FileTreeNode[]
  activeFile: ExcalidrawFile | null
  fileContent: string | null
  activeFileLoadSource: FileLoadSource
  preferences: Preferences
  sidebarVisible: boolean
  isDirty: boolean
  presentationMode: boolean
  openTabs: OpenTab[]
  revealRequest: { targetPath: string; nonce: number } | null

  // Actions
  setCurrentDirectory: (dir: string | null) => void
  setFiles: (files: ExcalidrawFile[]) => void
  setFileTree: (tree: FileTreeNode[]) => void
  setActiveFile: (file: ExcalidrawFile | null) => void
  setFileContent: (content: string | null) => void
  updateTabScene: (filePath: string, scene: CachedExcalidrawScene) => void
  setPreferences: (prefs: Preferences) => void
  setSidebarVisible: (visible: boolean) => void
  setIsDirty: (dirty: boolean) => void
  markFileAsModified: (filePath: string, modified: boolean) => void
  markTreeNodeAsModified: (filePath: string, modified: boolean) => void
  togglePresentationMode: () => void
  closeTab: (filePath: string) => Promise<void>
  toggleDecorations: () => void
  toggleTheme: () => void
  revealActiveFileInSidebar: () => void

  // Async actions
  loadDirectory: (dir: string, options?: LoadDirectoryOptions) => Promise<void>
  loadFileTree: (dir: string) => Promise<void>
  loadFile: (file: ExcalidrawFile) => Promise<void>
  loadFileFromTree: (node: FileTreeNode) => Promise<void>
  saveCurrentFile: (content?: string) => Promise<void>
  createNewFile: (fileName?: string, directory?: string) => Promise<void>
  createNewFolder: (folderName?: string, directory?: string) => Promise<void>
  renameFile: (oldPath: string, newName: string) => Promise<void>
  renameFolder: (oldPath: string, newName: string) => Promise<void>
  deleteFile: (filePath: string) => Promise<boolean>
  deleteFolder: (folderPath: string) => Promise<boolean>
  loadPreferences: () => Promise<void>
  savePreferences: () => Promise<void>
  toggleSidebar: () => void
}

export const useStore = create<AppStore>((set, get) => ({
  // Initial state
  currentDirectory: null,
  files: [],
  fileTree: [],
  activeFile: null,
  fileContent: null,
  activeFileLoadSource: null,
  preferences: {
    lastDirectory: null,
    recentDirectories: [],
    lastOpenFiles: [],
    activeFilePath: null,
    theme: 'system',
    sidebarVisible: true,
    showDecorations: true,
  },
  sidebarVisible: true,
  isDirty: false,
  presentationMode: false,
  openTabs: [],
  revealRequest: null,

  // Basic setters
  setCurrentDirectory: (dir) => set({ currentDirectory: dir }),
  setFiles: (files) => set({ files }),
  setFileTree: (tree) => set({ fileTree: tree }),
  setActiveFile: (file) => set({ activeFile: file }),
  setFileContent: (content) => set((state) => ({
    fileContent: content,
    openTabs:
      content && state.activeFile
        ? state.openTabs.map((tab) =>
            tab.path === state.activeFile?.path
              ? { ...tab, cachedContent: content }
              : tab
          )
        : state.openTabs,
  })),
  updateTabScene: (filePath, scene) => set((state) => ({
    openTabs: state.openTabs.map((tab) =>
      tab.path === filePath ? { ...tab, cachedScene: scene } : tab
    ),
  })),
  setPreferences: (prefs) => set({ preferences: prefs }),
  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
  setIsDirty: (dirty) => set({ isDirty: dirty }),
  
  markFileAsModified: (filePath, modified) => {
    set((state) => ({
      files: state.files.map((f) =>
        f.path === filePath ? { ...f, modified } : f
      ),
      openTabs: state.openTabs.map((f) =>
        f.path === filePath ? { ...f, modified } : f
      ),
    }))
  },

  markTreeNodeAsModified: (filePath, modified) => {
    const updateNode = (nodes: FileTreeNode[]): FileTreeNode[] => {
      return nodes.map(node => {
        if (node.path === filePath) {
          return { ...node, modified }
        }
        if (node.children) {
          return { ...node, children: updateNode(node.children) }
        }
        return node
      })
    }
    
    set((state) => ({
      fileTree: updateNode(state.fileTree)
    }))
  },

  // Load directory and list files
  loadDirectory: async (dir, options = {}) => {
    try {
      const state = get()
      const [files, fileTree] = await Promise.all([
        invoke<ExcalidrawFile[]>('list_excalidraw_files', { directory: dir }),
        invoke<FileTreeNode[]>('get_file_tree', { directory: dir })
      ])

      if (state.presentationMode && state.preferences.showDecorations) {
        await invoke('set_menu_visible', { visible: true }).catch((error) => {
          console.error('Failed to restore menu before loading directory:', error)
        })
      }
      
      set({
        currentDirectory: dir,
        files,
        fileTree,
        activeFile: null,
        fileContent: null,
        activeFileLoadSource: null,
        isDirty: false,
        presentationMode: false,
        openTabs: [],
      })
      
      // Update preferences with recent directory
      const prefs = get().preferences
      // Ensure recentDirectories is always an array
      const currentRecentDirs = prefs.recentDirectories || []
      const recentDirs = currentRecentDirs.filter((d) => d !== dir)
      recentDirs.unshift(dir)
      if (recentDirs.length > 10) {
        recentDirs.pop()
      }
      
      const sessionPrefs = options.preserveSession ? prefs : clearOpenSession(prefs)
      const newPrefs: Preferences = {
        ...sessionPrefs,
        lastDirectory: dir,
        recentDirectories: recentDirs,
      }
      
      set({ preferences: newPrefs })
      await get().savePreferences()
      
      // Start watching directory
      await invoke('watch_directory', { directory: dir })
    } catch (error) {
      console.error('Failed to load directory:', error)
      // Show user-friendly error message
      alert(`Failed to load directory: ${error}`)
    }
  },

  // Load file tree only
  loadFileTree: async (dir) => {
    try {
      const fileTree = await invoke<FileTreeNode[]>('get_file_tree', {
        directory: dir,
      })
      
      set({ fileTree })
    } catch (error) {
      console.error('Failed to load file tree:', error)
    }
  },

  // Load file content
  loadFile: async (file) => {
    const state = get()
    
    // If clicking the same file that's already active, do nothing
    if (state.activeFile?.path === file.path) {
      return
    }
    
    // Check if current file has unsaved changes
    if (state.isDirty && state.activeFile) {
      const decision = await confirmUnsavedChanges(state.activeFile.name, 'switching files')
      
      if (decision === 'save') {
        await state.saveCurrentFile()
      } else if (decision === 'cancel') {
        return
      } else {
        try {
          const existingTab = get().openTabs.find((tab) => tab.path === state.activeFile?.path)
          const cleanTab = await readOpenTabFromDisk(
            state.activeFile,
            (existingTab?.sceneVersion || 0) + 1
          )

          set((currentState) => ({
            activeFile: toExcalidrawFile(cleanTab),
            fileContent: cleanTab.cachedContent,
            activeFileLoadSource: 'disk',
            isDirty: false,
            openTabs: currentState.openTabs.map((tab) =>
              tab.path === cleanTab.path ? cleanTab : tab
            ),
          }))
          state.markFileAsModified(cleanTab.path, false)
          state.markTreeNodeAsModified(cleanTab.path, false)
        } catch (error) {
          console.error('Failed to discard unsaved changes:', error)
          alert(`Failed to discard unsaved changes: ${error}`)
          return
        }
      }
    }
    
    try {
      const latestState = get()
      const existingTab = latestState.openTabs.find(t => t.path === file.path)

      if (existingTab) {
        const diskHash = await invoke<string>('hash_file_content', {
          filePath: file.path,
        })

        if (diskHash === existingTab.contentHash) {
          const activeFile = toExcalidrawFile(existingTab)
          const newPrefs = withOpenSession(
            latestState.preferences,
            latestState.openTabs,
            activeFile
          )
          set({
            activeFile,
            fileContent: existingTab.cachedContent,
            activeFileLoadSource: 'cache',
            isDirty: existingTab.modified,
            preferences: newPrefs,
          })
          await get().savePreferences()
          return
        }
      }

      const updatedTab = await readOpenTabFromDisk(
        file,
        existingTab ? existingTab.sceneVersion + 1 : 0
      )
      const updatedFile = toExcalidrawFile(updatedTab)
      const openTabs = existingTab
        ? get().openTabs.map((tab) => (tab.path === file.path ? updatedTab : tab))
        : [...get().openTabs, updatedTab]

      const newPrefs = withOpenSession(get().preferences, openTabs, updatedFile)

      set({
        activeFile: updatedFile,
        fileContent: updatedTab.cachedContent,
        activeFileLoadSource: 'disk',
        isDirty: false,
        openTabs,
        preferences: newPrefs,
      })
      await get().savePreferences()

      state.markFileAsModified(file.path, false)
      state.markTreeNodeAsModified(file.path, false)
    } catch (error) {
      console.error('Failed to load file:', error)
      
      // If file doesn't exist, refresh the tree and show error
      if (String(error).includes('No such file') || String(error).includes('not found')) {
        alert(`File not found: ${file.name}\n\nThe file may have been deleted or moved. Refreshing file list...`)
        
        // Clear active file if it's the one that failed
        if (state.activeFile?.path === file.path) {
          set({
            activeFile: null,
            fileContent: null,
            activeFileLoadSource: null,
            isDirty: false,
          })
        }
        
        // Refresh the file tree
        if (state.currentDirectory) {
          await state.loadFileTree(state.currentDirectory)
        }
      } else {
        // Other errors
        alert(`Failed to load file: ${error}`)
      }
    }
  },

  // Load file from tree node
  loadFileFromTree: async (node) => {
    if (node.is_directory) return

    await get().loadFile({
      name: node.name,
      path: node.path,
      modified: node.modified,
    })
  },

  // Save current file
  saveCurrentFile: async (content) => {
    const state = get()
    const { activeFile, fileContent, isDirty } = state
    
    if (!activeFile) {
      return
    }
    
    // Only save if file is dirty
    if (!isDirty && !content) {
      return
    }
    
    const contentToSave = content || fileContent
    if (!contentToSave) {
      return
    }
    
    // Validate JSON before saving
    try {
      const parsed = JSON.parse(contentToSave)
      if (!parsed || typeof parsed !== 'object') {
        console.error('[saveCurrentFile] Invalid JSON structure')
        return
      }
      
      // Don't save if it's an empty Excalidraw file (no elements)
      if (Array.isArray(parsed.elements) && parsed.elements.length === 0 && !content) {
        // Only skip if this is an auto-save (no explicit content provided)
        return
      }
    } catch (jsonError) {
      console.error('[saveCurrentFile] Invalid JSON, not saving:', jsonError)
      return
    }
    
    try {
      const contentHash = await invoke<string>('save_file', {
        filePath: activeFile.path,
        content: contentToSave,
      })
      
      state.markFileAsModified(activeFile.path, false)
      state.markTreeNodeAsModified(activeFile.path, false)
      set((currentState) => ({
        isDirty: false,
        activeFile: { ...activeFile, modified: false },
        openTabs: currentState.openTabs.map((tab) =>
          tab.path === activeFile.path
            ? {
                ...tab,
                cachedContent: contentToSave,
                contentHash,
                modified: false,
              }
            : tab
        ),
      }))
    } catch (error) {
      console.error('[saveCurrentFile] Failed to save file:', error)
      alert(`Failed to save file: ${error}`)
    }
  },

  // Create new file
  createNewFile: async (fileName, directory) => {
    const state = get()
    let { currentDirectory } = state
    
    // Check if current file has unsaved changes
    if (state.isDirty && state.activeFile) {
      const decision = await confirmUnsavedChanges(state.activeFile.name, 'creating a new file')
      
      if (decision === 'save') {
        await state.saveCurrentFile()
      } else if (decision === 'cancel') {
        return
      } else {
        try {
          const existingTab = get().openTabs.find((tab) => tab.path === state.activeFile?.path)
          const cleanTab = await readOpenTabFromDisk(
            state.activeFile,
            (existingTab?.sceneVersion || 0) + 1
          )

          set((currentState) => ({
            activeFile: toExcalidrawFile(cleanTab),
            fileContent: cleanTab.cachedContent,
            activeFileLoadSource: 'disk',
            isDirty: false,
            openTabs: currentState.openTabs.map((tab) =>
              tab.path === cleanTab.path ? cleanTab : tab
            ),
          }))
          state.markFileAsModified(cleanTab.path, false)
          state.markTreeNodeAsModified(cleanTab.path, false)
        } catch (error) {
          console.error('Failed to discard unsaved changes:', error)
          alert(`Failed to discard unsaved changes: ${error}`)
          return
        }
      }
    }
    
    // Check if a directory is selected
    if (!currentDirectory) {
      // Prompt to select a directory if none is selected
      try {
        const dir = await invoke<string | null>('select_directory')
        if (!dir) {
          return
        }
        // Load the selected directory
        await state.loadDirectory(dir)
        currentDirectory = dir
      } catch (error) {
        console.error('Failed to select directory:', error)
        alert(`Failed to select directory: ${error}`)
        return
      }
    }
    
    // Generate default filename if not provided
    const finalFileName = fileName || `Untitled-${Date.now()}.excalidraw`
    const requestedFileName = finalFileName.endsWith('.excalidraw')
      ? finalFileName
      : `${finalFileName}.excalidraw`
    const targetDirectory = directory || currentDirectory
    
    try {
      // Create the new file
      const filePath = await invoke<string>('create_new_file', {
        directory: targetDirectory,
        fileName: requestedFileName,
      })
      
      // Reload the file tree to show the new file
      await state.loadFileTree(currentDirectory)
      
      // Create an ExcalidrawFile object for the new file
      const file: ExcalidrawFile = {
        name: fileNameFromPath(filePath),
        path: filePath,
        modified: false,
      }
      
      // Load the new file immediately
      await state.loadFile(file)
    } catch (error) {
      console.error('Failed to create new file:', error)
      alert(`Failed to create file: ${error}`)
    }
  },

  // Create new folder
  createNewFolder: async (folderName, directory) => {
    const state = get()
    let { currentDirectory } = state

    // Check if a directory is selected
    if (!currentDirectory) {
      // Prompt to select a directory if none is selected
      try {
        const dir = await invoke<string | null>('select_directory')
        if (!dir) {
          return
        }
        // Load the selected directory
        await state.loadDirectory(dir)
        currentDirectory = dir
      } catch (error) {
        console.error('[createNewFolder] Failed to select directory:', error)
        alert(`Failed to select directory: ${error}`)
        return
      }
    }

    // Generate default folder name if not provided
    const finalFolderName = folderName || `New Folder-${Date.now()}`
    const targetDirectory = directory || currentDirectory

    try {
      await invoke<string>('create_new_folder', {
        directory: targetDirectory,
        folderName: finalFolderName,
      })

      // Reload the file tree to show the new folder
      await state.loadFileTree(currentDirectory)
    } catch (error) {
      console.error('[createNewFolder] Failed to create folder:', error)
      alert(`Failed to create folder: ${error}`)
    }
  },

  // Rename file
  renameFile: async (oldPath, newName) => {
    try {
      // Ensure the new name has .excalidraw extension
      const finalName = newName.endsWith('.excalidraw') 
        ? newName 
        : `${newName}.excalidraw`
      
      const newPath = await invoke<string>('rename_file', {
        oldPath,
        newName: finalName,
      })
      
      const state = get()
      const renamedFile = {
        name: finalName,
        path: newPath,
        modified: state.activeFile?.path === oldPath ? state.isDirty : false,
      }
      const openTabs = state.openTabs.map((tab) =>
        tab.path === oldPath ? { ...tab, name: finalName, path: newPath } : tab
      )
      const activeFile = state.activeFile?.path === oldPath ? renamedFile : state.activeFile
      const newPrefs = withOpenSession(state.preferences, openTabs, activeFile)

      set({
        activeFile,
        openTabs,
        preferences: newPrefs,
      })
      await get().savePreferences()

      // Reload the file tree
      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }
    } catch (error) {
      console.error('Failed to rename file:', error)
      alert(`Failed to rename file: ${error}`)
    }
  },

  // Rename folder
  renameFolder: async (oldPath, newName) => {
    try {
      const newPath = await invoke<string>('rename_folder', {
        oldPath,
        newName,
      })

      const state = get()
      const updatedTabs = state.openTabs.map((tab) => {
        if (!isPathInsideDirectory(tab.path, oldPath)) {
          return tab
        }

        const nextPath = replacePathPrefix(tab.path, oldPath, newPath)
        return {
          ...tab,
          path: nextPath,
          name: fileNameFromPath(nextPath),
        }
      })

      const activeFile = state.activeFile && isPathInsideDirectory(state.activeFile.path, oldPath)
        ? {
            ...state.activeFile,
            path: replacePathPrefix(state.activeFile.path, oldPath, newPath),
            name: fileNameFromPath(replacePathPrefix(state.activeFile.path, oldPath, newPath)),
          }
        : state.activeFile
      const newPrefs = withOpenSession(state.preferences, updatedTabs, activeFile)

      set({
        activeFile,
        openTabs: updatedTabs,
        preferences: newPrefs,
      })
      await get().savePreferences()

      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }
    } catch (error) {
      console.error('Failed to rename folder:', error)
      alert(`Failed to rename folder: ${error}`)
    }
  },
  
  // Delete file
  // NOTE: Confirmation should be handled by the caller
  deleteFile: async (filePath) => {
    try {
      await invoke('delete_file', { filePath })
      const state = get()
      const openTabs = state.openTabs.filter((tab) => tab.path !== filePath)
      const activeFile = state.activeFile?.path === filePath ? null : state.activeFile
      const newPrefs = withOpenSession(state.preferences, openTabs, activeFile)
      
      if (state.activeFile?.path === filePath) {
        set({
          openTabs,
          activeFile: null,
          fileContent: null,
          activeFileLoadSource: null,
          isDirty: false,
          preferences: newPrefs,
        })
      } else {
        set({ openTabs, preferences: newPrefs })
      }
      await get().savePreferences()
      
      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }
      
      return true
    } catch (error) {
      console.error('[deleteFile] Failed to delete file:', error)
      throw error
    }
  },

  // Delete folder
  // NOTE: Confirmation should be handled by the caller
  deleteFolder: async (folderPath) => {
    try {
      await invoke('delete_folder', { folderPath })
      const state = get()
      const openTabs = state.openTabs.filter((tab) => !isPathInsideDirectory(tab.path, folderPath))
      const activeFile = state.activeFile && isPathInsideDirectory(state.activeFile.path, folderPath)
        ? null
        : state.activeFile
      const newPrefs = withOpenSession(state.preferences, openTabs, activeFile)

      if (state.activeFile && isPathInsideDirectory(state.activeFile.path, folderPath)) {
        set({
          openTabs,
          activeFile: null,
          fileContent: null,
          activeFileLoadSource: null,
          isDirty: false,
          preferences: newPrefs,
        })
      } else {
        set({ openTabs, preferences: newPrefs })
      }
      await get().savePreferences()

      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }

      return true
    } catch (error) {
      console.error('[deleteFolder] Failed to delete folder:', error)
      throw error
    }
  },

  // Load preferences
  loadPreferences: async () => {
    try {
      // The Rust backend returns snake_case fields
      const prefs = await invoke<any>('get_preferences')
      
      // Convert snake_case from Rust to camelCase for TypeScript
      const safePrefs = convertPreferencesFromRust(prefs)
      
      set({
        preferences: safePrefs,
        sidebarVisible: safePrefs.sidebarVisible,
      })

      // Apply decorations preference
      if (safePrefs.showDecorations === false) {
        invoke('set_decorations', { visible: false })
      }

      // Apply theme
      const root = document.documentElement
      if (safePrefs.theme === 'dark') {
        root.classList.add('dark')
      } else if (safePrefs.theme === 'light') {
        root.classList.remove('dark')
      } else {
        // System theme
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        if (prefersDark) {
          root.classList.add('dark')
        } else {
          root.classList.remove('dark')
        }
      }
      
      // Auto-load last directory if it exists
      if (safePrefs.lastDirectory) {
        try {
          await get().loadDirectory(safePrefs.lastDirectory, { preserveSession: true })
        } catch (dirError) {
          console.error('Failed to auto-load last directory:', dirError)
          // Clear the invalid lastDirectory from preferences
          const newPrefs = { ...safePrefs, lastDirectory: null }
          set({ preferences: newPrefs })
          await get().savePreferences()
        }
      }

      const pathsToRestore = uniquePaths(safePrefs.lastOpenFiles || [])
      if (pathsToRestore.length > 0) {
        const restoredTabs: OpenTab[] = []

        for (const path of pathsToRestore) {
          try {
            restoredTabs.push(
              await readOpenTabFromDisk({
                name: fileNameFromPath(path),
                path,
                modified: false,
              })
            )
          } catch (restoreError) {
            console.warn(`Failed to restore previously open file "${path}":`, restoreError)
          }
        }

        const preferredActivePath =
          safePrefs.activeFilePath &&
          restoredTabs.some((tab) => tab.path === safePrefs.activeFilePath)
            ? safePrefs.activeFilePath
            : restoredTabs[0]?.path ?? null
        const activeTab = restoredTabs.find((tab) => tab.path === preferredActivePath) ?? null
        const activeFile = activeTab ? toExcalidrawFile(activeTab) : null
        const currentPrefs = get().preferences
        const newPrefs = withOpenSession(currentPrefs, restoredTabs, activeFile)

        set({
          openTabs: restoredTabs,
          activeFile,
          fileContent: activeTab?.cachedContent ?? null,
          activeFileLoadSource: activeTab ? 'disk' : null,
          isDirty: false,
          preferences: newPrefs,
        })

        if (!sameOpenSession(currentPrefs, newPrefs)) {
          await get().savePreferences()
        }
      } else if (safePrefs.activeFilePath) {
        const currentPrefs = get().preferences
        const newPrefs = clearOpenSession(currentPrefs)
        set({ preferences: newPrefs })
        await get().savePreferences()
      }
    } catch (error) {
      console.error('Failed to load preferences:', error)
      // Set default preferences if loading fails
      const defaultPrefs: Preferences = {
        lastDirectory: null,
        recentDirectories: [],
        lastOpenFiles: [],
        activeFilePath: null,
        theme: 'system',
        sidebarVisible: true,
        showDecorations: true,
      }
      set({
        preferences: defaultPrefs,
        sidebarVisible: true,
      })
    }
  },

  // Save preferences
  savePreferences: async () => {
    const { preferences } = get()
    try {
      // Convert camelCase to snake_case for Rust backend
      const prefsToSave = convertPreferencesToRust(preferences)
      await invoke('save_preferences', { preferences: prefsToSave })
    } catch (error) {
      console.error('Failed to save preferences:', error)
    }
  },

  // Toggle theme between light and dark (becomes an explicit override, even if 'system' before)
  toggleTheme: () => {
    const state = get()
    const isDark = document.documentElement.classList.contains('dark')
    const newTheme: 'light' | 'dark' = isDark ? 'light' : 'dark'

    document.documentElement.classList.toggle('dark', newTheme === 'dark')

    const newPrefs = { ...state.preferences, theme: newTheme }
    set({ preferences: newPrefs })
    state.savePreferences()
  },

  // Toggle sidebar
  toggleSidebar: () => {
    const state = get()
    const newVisible = !state.sidebarVisible
    set({ sidebarVisible: newVisible })

    // Update preferences
    const newPrefs = { ...state.preferences, sidebarVisible: newVisible }
    set({ preferences: newPrefs })
    state.savePreferences()
  },

  // Reveal the active file in the sidebar tree: show the sidebar if hidden,
  // expand its ancestor folders, and scroll it into view
  revealActiveFileInSidebar: () => {
    const state = get()
    if (!state.activeFile) return

    if (!state.sidebarVisible) {
      set({ sidebarVisible: true })
      const newPrefs = { ...state.preferences, sidebarVisible: true }
      set({ preferences: newPrefs })
      state.savePreferences()
    }

    set({ revealRequest: { targetPath: state.activeFile.path, nonce: Date.now() } })
  },

  // Toggle presentation mode
  togglePresentationMode: () => {
    const state = get()
    const entering = !state.presentationMode
    set({ presentationMode: entering })

    if (entering) {
      invoke('set_menu_visible', { visible: false }).catch((error) => {
        console.error('Failed to hide menu for presentation mode:', error)
        set({ presentationMode: false })
      })
    } else {
      if (state.preferences.showDecorations) {
        invoke('set_menu_visible', { visible: true }).catch((error) => {
          console.error('Failed to restore menu after presentation mode:', error)
        })
      }
    }
  },

  // Toggle decorations
  toggleDecorations: () => {
    const state = get()
    const newVisible = !state.preferences.showDecorations
    invoke('set_decorations', { visible: newVisible })
      .then(() => {
        const newPrefs = { ...state.preferences, showDecorations: newVisible }
        set({ preferences: newPrefs })
        get().savePreferences()
      })
      .catch((error) => {
        console.error('Failed to toggle window decorations:', error)
        alert(`Failed to toggle window decorations: ${error}`)
      })
  },

  // Close tab
  closeTab: async (filePath) => {
    const state = get()
    const tabIndex = state.openTabs.findIndex(t => t.path === filePath)
    if (tabIndex === -1) return

    const tab = state.openTabs[tabIndex]

    // Check for unsaved changes if this is the active file
    if (state.activeFile?.path === filePath && state.isDirty) {
      const decision = await confirmUnsavedChanges(tab.name, 'closing')

      if (decision === 'save') {
        await state.saveCurrentFile()
      } else if (decision === 'cancel') {
        return
      } else {
        try {
          const existingTab = get().openTabs.find((tab) => tab.path === state.activeFile?.path)
          const cleanTab = await readOpenTabFromDisk(
            state.activeFile,
            (existingTab?.sceneVersion || 0) + 1
          )

          set((currentState) => ({
            activeFile: toExcalidrawFile(cleanTab),
            fileContent: cleanTab.cachedContent,
            activeFileLoadSource: 'disk',
            isDirty: false,
            openTabs: currentState.openTabs.map((tab) =>
              tab.path === cleanTab.path ? cleanTab : tab
            ),
          }))
          state.markFileAsModified(cleanTab.path, false)
          state.markTreeNodeAsModified(cleanTab.path, false)
        } catch (error) {
          console.error('Failed to discard unsaved changes:', error)
          alert(`Failed to discard unsaved changes: ${error}`)
          return
        }
      }
    }

    const newTabs = state.openTabs.filter(t => t.path !== filePath)

    if (state.activeFile?.path === filePath) {
      // Switch to adjacent tab
      if (newTabs.length > 0) {
        const newIndex = Math.min(tabIndex, newTabs.length - 1)
        const newActiveTab = newTabs[newIndex]
        set({ openTabs: newTabs })
        await get().loadFile(newActiveTab)
      } else {
        const newPrefs = withOpenSession(state.preferences, newTabs, null)
        set({
          openTabs: newTabs,
          activeFile: null,
          fileContent: null,
          activeFileLoadSource: null,
          isDirty: false,
          preferences: newPrefs,
        })
        await get().savePreferences()
      }
    } else {
      const newPrefs = withOpenSession(state.preferences, newTabs, state.activeFile)
      set({ openTabs: newTabs, preferences: newPrefs })
      await get().savePreferences()
    }
  },

}))
