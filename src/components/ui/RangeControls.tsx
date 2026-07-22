import type { JSX } from "@solidjs/web"
import { For } from "solid-js"

export interface RangeOption {
  label: string
}

export function DiscreteRange(props: {
  options: readonly RangeOption[]
  value: number
  labelledBy?: string
  label?: string
  class?: JSX.ClassValue
  onChange: (value: number) => void
}) {
  const lastIndex = () => Math.max(1, props.options.length - 1)
  const progress = () => props.value / lastIndex()

  return (
    <div
      class={["px-4 pb-3 pt-2.5", props.class]}
      style={`--discrete-progress:${progress() * 100}%;--discrete-fill-offset:${(1 - progress()) * 1.25}rem`}
    >
      <div class="relative h-8">
        <span aria-hidden="true" class="absolute inset-x-0 top-1/2 h-5 -translate-y-1/2 overflow-hidden rounded-full bg-white/7 shadow-[inset_0_1px_2px_rgba(0,0,0,.22)]">
          <span class="discrete-range-fill absolute inset-y-0 left-0 rounded-full"></span>
        </span>
        <span aria-hidden="true" class="absolute inset-x-2.5 top-1/2 -translate-y-1/2">
          <For each={props.options}>
            {(_, index) => (
              <span
                class="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/56"
                style={{ left: `${(index() / lastIndex()) * 100}%` }}
              >
              </span>
            )}
          </For>
        </span>
        <input
          type="range"
          min="0"
          max={props.options.length - 1}
          step="1"
          value={props.value}
          aria-label={props.label}
          aria-labelledby={props.labelledBy}
          aria-valuetext={props.options[props.value]?.label}
          class="discrete-range-input absolute inset-0 z-10 h-8 w-full appearance-none bg-transparent"
          onInput={event => props.onChange(Number(event.currentTarget.value))}
        />
        <span aria-hidden="true" class="pointer-events-none absolute inset-x-2.5 top-1/2">
          <span class="discrete-range-thumb absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/46 bg-white shadow-[0_2px_9px_rgba(0,0,0,.4)]"></span>
        </span>
      </div>
      <div class="relative mx-2.5 h-3 text-[9px] font-medium text-white/38">
        <For each={props.options}>
          {(option, index) => (
            <span
              class={[
                "absolute top-0 whitespace-nowrap",
                index() === 0 ? "translate-x-0" : index() === props.options.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
              ]}
              style={{ left: `${(index() / lastIndex()) * 100}%` }}
            >
              {option.label}
            </span>
          )}
        </For>
      </div>
    </div>
  )
}

export interface MatrixRangeColumn extends RangeOption {
  color: string
}

/**
 * Inspired by https://x.com/maria_rcks/status/2076176709221552447
 */
export function MatrixRange(props: {
  columns: readonly MatrixRangeColumn[]
  rows: readonly RangeOption[]
  column: number
  row: number
  label: string
  cornerLabel?: string
  class?: JSX.ClassValue
  cellLabel?: (column: RangeOption, row: RangeOption) => string
  onChange: (column: number, row: number) => void
}) {
  const labelWidthRem = 3.875
  const rowHeightRem = 2.75
  const columnPosition = () => ((props.column + 0.5) / props.columns.length) * 100
  const activeRow = () => Math.min(props.rows.length - 1, Math.max(0, props.row))
  const thumbLeft = () => {
    const ratio = columnPosition() / 100
    return `calc(${columnPosition()}% + ${labelWidthRem * (1 - ratio)}rem)`
  }
  const columnsStyle = () => ({ "grid-template-columns": `repeat(${props.columns.length}, minmax(0, 1fr))` })

  return (
    <div role="radiogroup" aria-label={props.label} class={["select-none", props.class]}>
      <div class="matrix-range-layout items-end pb-1.5">
        <span aria-hidden="true" class="pr-3 text-right text-[11px] font-semibold tracking-tight text-white/78">
          {props.cornerLabel}
        </span>
        <div class="grid" style={columnsStyle()}>
          <For each={props.columns}>
            {option => <span class="truncate px-0.5 text-center text-[9px] font-medium text-white/42">{option.label}</span>}
          </For>
        </div>
      </div>
      <div class="relative">
        <span aria-hidden="true" class="matrix-range-well absolute bottom-0 right-0 top-0 rounded-[20px] bg-[#202326] shadow-[inset_0_2px_6px_rgba(0,0,0,.54),inset_0_-1px_1px_rgba(255,255,255,.035)]"></span>
        <span aria-hidden="true" class="matrix-range-track pointer-events-none absolute bottom-0 right-0 top-0">
          <span
            class="matrix-range-fill absolute left-1.5 h-7 rounded-full shadow-[0_3px_10px_rgba(0,0,0,.3)]"
            style={{
              top: `${activeRow() * rowHeightRem + 0.5}rem`,
              width: `calc(${columnPosition()}%)`,
              background: `linear-gradient(180deg, color-mix(in srgb, ${props.columns[props.column]?.color} 86%, white), ${props.columns[props.column]?.color})`,
            }}
          >
          </span>
        </span>
        <For each={props.rows}>
          {(row, rowIndex) => {
            const active = () => rowIndex() === activeRow()
            return (
              <div class="matrix-range-layout relative items-center">
                <span
                  class="pr-3 text-right text-[10px] font-semibold transition-colors"
                  style={{ color: active() ? props.columns[props.column]?.color : "rgba(255,255,255,.42)" }}
                >
                  {row.label}
                </span>
                <div class="relative h-11">
                  <div class="absolute inset-0 grid" style={columnsStyle()}>
                    <For each={props.columns}>
                      {(column, columnIndex) => {
                        const selected = () => active() && columnIndex() === props.column
                        const covered = () => active() && columnIndex() <= props.column
                        return (
                          <button
                            type="button"
                            role="radio"
                            aria-label={props.cellLabel?.(column, row) ?? `${column.label}, ${row.label}`}
                            aria-checked={selected() ? "true" : "false"}
                            data-covered={covered() ? "true" : "false"}
                            class="matrix-range-cell group/cell relative grid h-11 place-items-center rounded-xl border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/55"
                            style={{ "--matrix-cell-color": column.color }}
                            onClick={() => props.onChange(columnIndex(), rowIndex())}
                          >
                            <span class={["matrix-range-dot relative z-10 h-1.5 w-1.5 rounded-full", covered() ? "bg-white" : "bg-[#595c5e] group-hover/cell:scale-150"]}></span>
                          </button>
                        )
                      }}
                    </For>
                  </div>
                </div>
              </div>
            )
          }}
        </For>
        <span
          aria-hidden="true"
          class="matrix-range-thumb pointer-events-none absolute z-20 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/72 bg-[radial-gradient(circle_at_36%_30%,#fff,#f2f2f2_62%,#dedede)] shadow-[0_1px_2px_rgba(0,0,0,.4),0_4px_9px_rgba(0,0,0,.44)]"
          style={{
            left: thumbLeft(),
            top: `${(activeRow() + 0.5) * rowHeightRem}rem`,
          }}
        >
        </span>
      </div>
    </div>
  )
}
