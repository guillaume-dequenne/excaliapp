import { useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { cn } from '../lib/utils'
import type { OpenTab } from '../types'

interface TabContentProps {
  tab: OpenTab
  presentationMode: boolean
  onClose?: () => void
}

function TabContent({ tab, presentationMode, onClose }: TabContentProps) {
  return (
    <>
      <span className="truncate">
        {tab.name.replace('.excalidraw', '')}
      </span>
      {tab.modified && (
        <span className="modified-dot w-2 h-2 rounded-full shrink-0" />
      )}
      {!presentationMode && onClose && (
        <button
          className="tab-close opacity-0 group-hover:opacity-100 p-0.5 rounded shrink-0 transition-opacity"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          title="Close tab"
          aria-label={`Close ${tab.name}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </>
  )
}

interface SortableTabProps {
  tab: OpenTab
  isActive: boolean
  presentationMode: boolean
  onActivate: () => void
  onClose: () => void
}

function SortableTab({
  tab,
  isActive,
  presentationMode,
  onActivate,
  onClose,
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tab.path,
    disabled: presentationMode,
    attributes: {
      role: 'tab',
      roleDescription: 'sortable tab',
    },
  })
  const dragAttributes = presentationMode
    ? { role: 'tab', tabIndex: 0 }
    : attributes
  const dragListeners = presentationMode ? undefined : listeners

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    dragListeners?.onKeyDown?.(event)

    if (!event.defaultPrevented && event.key === 'Enter') {
      onActivate()
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'tab-item group flex items-center gap-1.5 px-3 py-1.5 text-sm border-r border-t-2 border-t-transparent select-none min-w-0 max-w-[180px]',
        presentationMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        isActive && 'active',
        isDragging && 'dragging'
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={onActivate}
      aria-selected={isActive}
      {...dragAttributes}
      {...dragListeners}
      onKeyDown={handleKeyDown}
    >
      <TabContent
        tab={tab}
        presentationMode={presentationMode}
        onClose={onClose}
      />
    </div>
  )
}

export function TabBar() {
  const openTabs = useStore(state => state.openTabs)
  const activeFile = useStore(state => state.activeFile)
  const loadFile = useStore(state => state.loadFile)
  const closeTab = useStore(state => state.closeTab)
  const reorderTabs = useStore(state => state.reorderTabs)
  const presentationMode = useStore(state => state.presentationMode)
  const [draggedTab, setDraggedTab] = useState<OpenTab | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  if (openTabs.length === 0) return null

  const handleDragStart = ({ active }: DragStartEvent) => {
    setDraggedTab(openTabs.find((tab) => tab.path === active.id) ?? null)
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggedTab(null)

    if (over && active.id !== over.id) {
      void reorderTabs(String(active.id), String(over.id))
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragCancel={() => setDraggedTab(null)}
      onDragEnd={handleDragEnd}
    >
      <div
        className={cn(
          'tab-bar flex items-center border-b overflow-x-auto shrink-0',
          presentationMode && 'presentation'
        )}
        role="tablist"
        aria-label="Open drawings"
      >
        <SortableContext
          items={openTabs.map((tab) => tab.path)}
          strategy={horizontalListSortingStrategy}
        >
          {openTabs.map((tab) => (
            <SortableTab
              key={tab.path}
              tab={tab}
              isActive={activeFile?.path === tab.path}
              presentationMode={presentationMode}
              onActivate={() => loadFile(tab)}
              onClose={() => void closeTab(tab.path)}
            />
          ))}
        </SortableContext>
      </div>
      {createPortal(
        <DragOverlay>
          {draggedTab ? (
            <div className="tab-item tab-drag-overlay flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded select-none max-w-[180px]">
              <TabContent tab={draggedTab} presentationMode={presentationMode} />
            </div>
          ) : null}
        </DragOverlay>,
        document.body
      )}
    </DndContext>
  )
}
