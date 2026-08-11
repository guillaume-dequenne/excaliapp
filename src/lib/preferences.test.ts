import { describe, expect, it } from 'vitest'
import { convertPreferencesFromRust, convertPreferencesToRust } from './preferences'
import type { Preferences } from '../types'

describe('preferences conversion', () => {
  it('defaults missing session fields from older preference files', () => {
    expect(convertPreferencesFromRust({
      last_directory: '/tmp/drawings',
      recent_directories: ['/tmp/drawings'],
      theme: 'dark',
      sidebar_visible: false,
      show_decorations: false,
    })).toEqual({
      lastDirectory: '/tmp/drawings',
      recentDirectories: ['/tmp/drawings'],
      lastOpenFiles: [],
      activeFilePath: null,
      theme: 'dark',
      sidebarVisible: false,
      showDecorations: false,
    })
  })

  it('round-trips session fields to Rust preference names', () => {
    const preferences: Preferences = {
      lastDirectory: '/tmp/drawings',
      recentDirectories: ['/tmp/drawings'],
      lastOpenFiles: ['/tmp/drawings/a.excalidraw', '/tmp/drawings/b.excalidraw'],
      activeFilePath: '/tmp/drawings/b.excalidraw',
      theme: 'light',
      sidebarVisible: true,
      showDecorations: true,
    }

    expect(convertPreferencesToRust(preferences)).toEqual({
      last_directory: '/tmp/drawings',
      recent_directories: ['/tmp/drawings'],
      last_open_files: ['/tmp/drawings/a.excalidraw', '/tmp/drawings/b.excalidraw'],
      active_file_path: '/tmp/drawings/b.excalidraw',
      theme: 'light',
      sidebar_visible: true,
      show_decorations: true,
    })
  })
})
