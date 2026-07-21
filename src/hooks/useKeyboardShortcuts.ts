import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../store/useStore'
import { promptForName } from '../lib/namePrompt'

export function useKeyboardShortcuts() {
  const {
    toggleSidebar,
    saveCurrentFile,
    openTabs,
    activeFile,
    loadFile,
    createNewFile,
    createNewFolder,
    togglePresentationMode,
    closeTab,
    toggleDecorations,
  } = useStore()

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const modKey = isMac ? e.metaKey : e.ctrlKey

      // Don't handle any events if clipboard operations are being used
      // Let Excalidraw handle all clipboard operations natively
      if (modKey && (e.key === 'c' || e.key === 'v' || e.key === 'x' || e.key === 'a')) {
        return
      }

      // F5: Toggle presentation mode
      if (e.key === 'F5') {
        e.preventDefault()
        togglePresentationMode()
      }

      // Escape: Exit presentation mode
      if (e.key === 'Escape') {
        const state = useStore.getState()
        if (state.presentationMode) {
          e.preventDefault()
          togglePresentationMode()
        }
      }

      // Ctrl/Cmd + Shift + D: Toggle decorations
      if (modKey && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        toggleDecorations()
      }

      // Cmd/Ctrl + B: Toggle sidebar
      if (modKey && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }

      // Cmd/Ctrl + S: Save current file
      if (modKey && e.key === 's') {
        e.preventDefault()
        await saveCurrentFile()
      }

      // Cmd/Ctrl + O: Open directory
      if (modKey && e.key === 'o') {
        e.preventDefault()
        const dir = await invoke<string | null>('select_directory')
        if (dir) {
          await useStore.getState().loadDirectory(dir)
        }
      }

      // Cmd/Ctrl + Shift + N: New folder
      if (modKey && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()

        const state = useStore.getState()

        // If no directory is selected, select one first
        if (!state.currentDirectory) {
          const dir = await invoke<string | null>('select_directory')
          if (dir) {
            await state.loadDirectory(dir)
          } else {
            return
          }
        }

        const folderName = await promptForName({
          title: 'Folder name',
          defaultValue: 'New Folder',
          confirmLabel: 'Create',
        })
        if (!folderName) {
          return
        }

        await createNewFolder(folderName)
      }

      // Cmd/Ctrl + N: New file
      if (modKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()

        const state = useStore.getState()

        // If no directory is selected, select one first
        if (!state.currentDirectory) {
          const dir = await invoke<string | null>('select_directory')
          if (dir) {
            await state.loadDirectory(dir)
          } else {
            return
          }
        }

        const fileName = await promptForName({
          title: 'File name',
          defaultValue: 'Untitled.excalidraw',
          confirmLabel: 'Create',
        })
        if (!fileName) {
          return
        }

        await createNewFile(fileName)
      }

      // Cmd/Ctrl + W: Close current tab
      if (modKey && e.key === 'w') {
        e.preventDefault()
        if (activeFile) {
          await closeTab(activeFile.path)
        }
      }

      const switchTab = async (direction: 1 | -1) => {
        if (openTabs.length > 1 && activeFile) {
          const currentIndex = openTabs.findIndex((f) => f.path === activeFile.path)
          const nextIndex = (currentIndex + direction + openTabs.length) % openTabs.length
          await loadFile(openTabs[nextIndex])
        }
      }

      // Cmd/Ctrl + Tab / Cmd/Ctrl + Shift + Tab: Switch tabs
      if (modKey && e.key === 'Tab') {
        e.preventDefault()
        await switchTab(e.shiftKey ? -1 : 1)
      }

      // Cmd/Ctrl + Shift + [ / ]: Switch tabs (Safari/Chrome/Xcode convention)
      if (modKey && e.shiftKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault()
        await switchTab(e.key === ']' ? 1 : -1)
      }

      // Cmd/Ctrl + 1-9: Jump to tab N
      if (modKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const index = Number(e.key) - 1
        if (openTabs[index]) {
          e.preventDefault()
          await loadFile(openTabs[index])
        }
      }

      // Option/Alt + F1: Reveal the active file in the sidebar
      if (e.altKey && e.key === 'F1') {
        e.preventDefault()
        useStore.getState().revealActiveFileInSidebar()
      }
    }

    // Use non-capturing phase to let Excalidraw handle events first
    window.addEventListener('keydown', handleKeyDown, false)
    return () => window.removeEventListener('keydown', handleKeyDown, false)
  }, [toggleSidebar, saveCurrentFile, openTabs, activeFile, loadFile, createNewFile, createNewFolder, togglePresentationMode, closeTab, toggleDecorations])
}
