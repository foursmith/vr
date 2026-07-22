export function Switch(props: {
  checked: boolean
  label: string
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={props.label}
      aria-checked={props.checked ? "true" : "false"}
      disabled={props.disabled}
      data-checked={props.checked ? "true" : "false"}
      class="ui-switch grid h-11 w-14 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:opacity-40"
      onClick={() => props.onCheckedChange(!props.checked)}
    >
      <span aria-hidden="true" class="ui-switch-track relative h-5 w-9 rounded-full border border-white/14">
        <span class="ui-switch-thumb absolute left-0.5 top-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_5px_rgba(0,0,0,.35)]"></span>
      </span>
    </button>
  )
}
