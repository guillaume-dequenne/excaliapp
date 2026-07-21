import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { ask } from '@tauri-apps/plugin-dialog'
import { Sidebar } from './components/Sidebar'
import { ExcalidrawEditor } from './components/ExcalidrawEditor'
import { TabBar } from './components/TabBar'
import { LaserPointer } from './components/LaserPointer'
import { useStore } from './store/useStore'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useMenuHandler } from './hooks/useMenuHandler'
import './index.css'

function containsFilePath(nodes: ReturnType<typeof useStore.getState>['fileTree'], filePath: string): boolean {
  return nodes.some((node) =>
    node.path === filePath || (node.children ? containsFilePath(node.children, filePath) : false)
  )
}

function App() {
  const { loadPreferences, loadDirectory, currentDirectory, sidebarVisible, isDirty, saveCurrentFile, presentationMode } = useStore()


  // Load preferences (which may load the last directory) and setup on mount
  useEffect(() => {
    const openPath = async (path: string) => {
      const name = path.split('/').pop() ?? path
      await useStore.getState().loadFile({ name, path, modified: false })
    }

    const init = async () => {
      await loadPreferences()

      // Open files requested via "Open With ExcaliApp" / double-clicking a .excalidraw file.
      // Must run after loadPreferences (which may load the last directory and reset open tabs).
      try {
        const paths = await invoke<string[]>('take_pending_open_files')
        for (const path of paths) {
          await openPath(path)
        }
      } catch (error) {
        console.error('Failed to check pending open files:', error)
      }
    }
    init()

    const unlisten = listen<string>('open-file-request', (event) => openPath(event.payload))

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  // Listen for file system changes
  useEffect(() => {
    if (!currentDirectory) return

    const unlisten = listen('file-system-change', async () => {
      // Reload the directory to refresh file list
      const state = useStore.getState()
      await state.loadFileTree(currentDirectory)
      
      // If the active file was deleted, clear it
      if (state.activeFile) {
        const fileStillExists = containsFilePath(state.fileTree, state.activeFile.path)
        
        if (!fileStillExists) {
          state.setActiveFile(null)
          state.setFileContent(null)
          state.setIsDirty(false)
        }
      }
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [currentDirectory, loadDirectory])

  // Listen for window close event
  useEffect(() => {
    const unlisten = listen('check-unsaved-before-close', async () => {
      if (isDirty) {
        const shouldSave = await ask('Do you want to save your changes before closing?', {
          title: 'Unsaved Changes',
          kind: 'warning',
          okLabel: 'Save & Close',
          cancelLabel: "Don't Save",
        })
        
        if (shouldSave) {
          await saveCurrentFile()
          await invoke('force_close_app')
        } else {
          const reallyClose = await ask('Close without saving your changes?', {
            title: 'Confirm Close',
            kind: 'warning',
            okLabel: 'Close Without Saving',
            cancelLabel: 'Cancel',
          })
          
          if (reallyClose) {
            await invoke('force_close_app')
          }
        }
      } else {
        // No unsaved changes, close directly
        await invoke('force_close_app')
      }
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [isDirty, saveCurrentFile])

  // Setup keyboard shortcuts
  useKeyboardShortcuts()
  
  // Setup menu handler (NOTE: ExcalidrawEditor will set the Excalidraw API)
  useMenuHandler()

  return (
    <div className={`app-shell h-screen flex overflow-hidden ${presentationMode ? 'cursor-none' : ''}`}>
      {sidebarVisible && !presentationMode && <Sidebar />}
      <div className="flex-1 flex flex-col min-w-0">
        <TabBar />
        <ExcalidrawEditor />
      </div>
      {presentationMode && <LaserPointer />}
    </div>
  )
}

export default App
