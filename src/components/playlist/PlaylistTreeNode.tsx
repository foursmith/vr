import { For, Show } from 'solid-js'
import type { PlaylistNode } from '../../features/playlist/model'
import { Icon } from '../ui/Icon'

export function PlaylistTreeNode(props: {
  node: PlaylistNode
  depth: number
  expanded: Set<string>
  selectedId?: string
  onToggle: (id: string) => void
  onSelect: (node: PlaylistNode) => void
}) {
  const isExpanded = () => props.expanded.has(props.node.id)

  return (
    <li
      role="treeitem"
      aria-expanded={props.node.kind === 'folder' ? (isExpanded() ? 'true' : 'false') : undefined}
      aria-selected={props.node.id === props.selectedId ? 'true' : 'false'}
    >
      <button
        type="button"
        class={`playlist-tree-row group relative flex h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 pr-2 text-left text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/70 ${
          props.node.id === props.selectedId
            ? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
            : 'bg-transparent text-white/68 hover:bg-white/8 hover:text-white/92'
        }`}
        style={{ 'padding-left': `${8 + props.depth * 16}px` }}
        title={props.node.name}
        onClick={() => (props.node.kind === 'folder' ? props.onToggle(props.node.id) : props.onSelect(props.node))}
      >
        <Show
          when={props.node.kind === 'folder'}
          fallback={<span aria-hidden="true" class="h-3.5 w-3.5 shrink-0"></span>}
        >
          <span
            aria-hidden="true"
            class={`i-ph-caret-right h-3.5 w-3.5 shrink-0 text-white/42 transition-transform ${isExpanded() ? 'rotate-90' : ''}`}
          ></span>
        </Show>
        <Icon
          name={props.node.kind === 'folder' ? (isExpanded() ? 'folder-open' : 'folder') : 'file-video'}
          class={`h-4 w-4 shrink-0 ${props.node.kind === 'folder' ? 'text-[#80c7ff]' : 'text-white/52 group-hover:text-white/74'}`}
        />
        <span class="min-w-0 flex-1 truncate">{props.node.name}</span>
        <Show when={props.node.id === props.selectedId}>
          <span aria-label="Playing" class="flex h-3 items-end gap-[2px] text-[#63b8ff]">
            <i class="playlist-eq h-2 w-[2px] rounded-full bg-current"></i>
            <i class="playlist-eq h-3 w-[2px] rounded-full bg-current [animation-delay:-.35s]"></i>
            <i class="playlist-eq h-1.5 w-[2px] rounded-full bg-current [animation-delay:-.7s]"></i>
          </span>
        </Show>
      </button>
      <Show when={props.node.kind === 'folder' && isExpanded()}>
        <ul role="group" class="m-0 list-none p-0">
          <For each={props.node.children ?? []}>
            {(child) => (
              <PlaylistTreeNode
                node={child}
                depth={props.depth + 1}
                expanded={props.expanded}
                selectedId={props.selectedId}
                onToggle={props.onToggle}
                onSelect={props.onSelect}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  )
}
