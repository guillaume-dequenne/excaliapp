import { beforeEach, describe, expect, it } from 'vitest'
import { mockInvoke } from '../test/setup'
import type { OpenTab, Preferences } from '../types'
import { useStore } from './useStore'

const basePreferences: Preferences = {
  lastDirectory: '/tmp/drawings',
  recentDirectories: ['/tmp/drawings'],
  lastOpenFiles: [],
  activeFilePath: null,
  theme: 'system',
  sidebarVisible: true,
  showDecorations: true,
}

function tab(name: string): OpenTab {
  const path = `/tmp/drawings/${name}.excalidraw`
  return {
    name: `${name}.excalidraw`,
    path,
    modified: false,
    cachedContent: '{}',
    contentHash: name,
    cachedScene: { elements: [], appState: {} },
    sceneVersion: 0,
  }
}

describe('tab ordering', () => {
  const tabs = [tab('one'), tab('two'), tab('three')]

  beforeEach(() => {
    useStore.setState({
      openTabs: tabs,
      activeFile: tabs[1],
      preferences: basePreferences,
    })
    mockInvoke.mockResolvedValue(undefined)
  })

  it('reorders tabs and persists the visible order', async () => {
    await useStore.getState().reorderTabs(tabs[0].path, tabs[2].path)

    expect(useStore.getState().openTabs.map(({ path }) => path)).toEqual([
      tabs[1].path,
      tabs[2].path,
      tabs[0].path,
    ])
    expect(useStore.getState().preferences.lastOpenFiles).toEqual([
      tabs[1].path,
      tabs[2].path,
      tabs[0].path,
    ])
    expect(useStore.getState().preferences.activeFilePath).toBe(tabs[1].path)
    expect(mockInvoke).toHaveBeenCalledWith('save_preferences', {
      preferences: expect.objectContaining({
        last_open_files: [tabs[1].path, tabs[2].path, tabs[0].path],
        active_file_path: tabs[1].path,
      }),
    })
  })

  it('does nothing when either tab is missing', async () => {
    await useStore.getState().reorderTabs(tabs[0].path, '/missing.excalidraw')

    expect(useStore.getState().openTabs).toEqual(tabs)
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
