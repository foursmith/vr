import { Icon } from "./Icon"
import { LiquidGlass } from "./LiquidGlass"

export function MediaPickerButtons(props: {
  onChooseFiles: () => void
  onChooseFolder: () => void
  fullWidth?: boolean
}) {
  return (
    <LiquidGlass
      class={["h-10 max-w-full rounded-full text-white", props.fullWidth ? "w-full" : "w-64"]}
      cornerRadius={999}
      elasticity={0.12}
      castShadow={false}
    >
      <div class="flex h-full w-full items-center">
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 rounded-l-full border-0 bg-transparent px-3 text-xs font-semibold text-white/82"
          onClick={props.onChooseFiles}
        >
          <Icon name="file-video" class="h-3.5 w-3.5" />
          Choose files
        </button>
        <span aria-hidden="true" class="h-4 w-px shrink-0 bg-white/12"></span>
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 rounded-r-full border-0 bg-transparent px-3 text-xs font-semibold text-white/82"
          onClick={props.onChooseFolder}
        >
          <Icon name="folder" class="h-3.5 w-3.5" />
          Choose folder
        </button>
      </div>
    </LiquidGlass>
  )
}
