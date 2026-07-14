import type { PlaylistSourceKind, PlaylistStateNode } from "../../features/playlist/model"
import { For, Show } from "solid-js"
import { Icon } from "../ui/Icon"

function SourceFolderIcon(props: { expanded: boolean, source?: PlaylistSourceKind }) {
  const folderColor = () => {
    if (props.source === "dlna") return "#a78bfa"
    return "#e9ad58"
  }
  const badgeIcon = () => {
    if (props.source === "dlna") return "source-dlna" as const
    return "source-local" as const
  }

  return (
    <span aria-hidden="true" class="relative h-4.5 w-5 shrink-0" style={{ color: folderColor() }}>
      <Icon name={props.expanded ? "folder-open-fill" : "folder-fill"} class="absolute left-0 top-0 h-4.5 w-4.5 text-current" />
      <Icon name={badgeIcon()} class="absolute bottom-0 right-0 size-3 text-[#f4fbff]/70" />
    </span>
  )
}

export function PlaylistTreeNode(props: {
  node: PlaylistStateNode
  depth: number
  expanded: Set<string>
  selectedId?: string
  onToggle: (id: string) => void
  onSelect: (node: PlaylistStateNode) => void
}) {
  const isExpanded = () => props.expanded.has(props.node.id)
  const iconName = () => {
    if (props.node.kind === "folder") return isExpanded() ? "folder-open" as const : "folder" as const
    return "file-video" as const
  }
  return (
    <li
      role="treeitem"
      aria-expanded={props.node.kind === "folder" ? (isExpanded() ? "true" : "false") : undefined}
      aria-selected={props.node.id === props.selectedId ? "true" : "false"}
    >
      <button
        type="button"
        class={`playlist-tree-row group relative flex h-8 w-full min-w-0 items-center gap-1.5 rounded-xl border-0 pr-2 text-left text-xs max-sm:h-11 ${
          props.node.id === props.selectedId
            ? "bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
            : "bg-transparent text-white/68 hover:bg-white/8 hover:text-white/92"
        }`}
        style={{ "padding-left": `${8 + props.depth * 16}px` }}
        title={props.node.name}
        onClick={() => (props.node.kind === "folder" ? props.onToggle(props.node.id) : props.onSelect(props.node))}
      >
        <Show
          when={props.node.kind === "folder"}
          fallback={<span aria-hidden="true" class="h-3.5 w-3.5 shrink-0"></span>}
        >
          <span
            aria-hidden="true"
            class={`i-ph-caret-right h-3.5 w-3.5 shrink-0 text-white/42 transition-transform ${isExpanded() ? "rotate-90" : ""}`}
          >
          </span>
        </Show>
        <Show
          when={props.node.kind === "folder" && props.node.sourceKind && props.node.sourceKind !== "browser"}
          fallback={(
            <Icon
              name={iconName()}
              class={`h-4 w-4 shrink-0 ${props.node.kind === "folder" ? "text-accent" : "text-white/52 group-hover:text-white/74"}`}
            />
          )}
        >
          <SourceFolderIcon expanded={isExpanded()} source={props.node.sourceKind} />
        </Show>
        <span class="min-w-0 flex-1 truncate">{props.node.name}</span>
        <Show when={props.node.kind === "video" && props.node.hasSubtitle}>
          <span
            aria-label="Subtitle available"
            title="Subtitle: matched automatically"
            class="shrink-0 rounded border border-white/14 bg-white/8 px-1 py-0.5 font-mono text-[8px] font-bold leading-none tracking-wide text-white/52"
          >
            CC
          </span>
        </Show>
        <Show when={props.node.id === props.selectedId}>
          <span aria-label="Playing" class="flex h-3 items-end gap-[2px] text-accent">
            <i class="playlist-eq h-2 w-[2px] rounded-full bg-current"></i>
            <i class="playlist-eq h-3 w-[2px] rounded-full bg-current [animation-delay:-.35s]"></i>
            <i class="playlist-eq h-1.5 w-[2px] rounded-full bg-current [animation-delay:-.7s]"></i>
          </span>
        </Show>
      </button>
      <Show when={props.node.kind === "folder" && isExpanded()}>
        <ul role="group" class="m-0 list-none p-0">
          <For each={props.node.children ?? []}>
            {child => (
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
