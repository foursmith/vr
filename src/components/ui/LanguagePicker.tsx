import { For } from "solid-js"
import { LANGUAGE_OPTIONS, locale, setLocale, t } from "../../i18n"

export function LanguagePicker(props: { class?: string }) {
  return (
    <div
      class={[
        "grid h-10 w-44 shrink-0 grid-cols-3 rounded-full bg-black/24 p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,.24),inset_0_0_0_1px_rgba(255,255,255,.025)]",
        props.class,
      ]}
      role="radiogroup"
      aria-label={t("language.title")}
    >
      <For each={LANGUAGE_OPTIONS}>
        {option => (
          <button
            type="button"
            role="radio"
            aria-checked={locale() === option.value ? "true" : "false"}
            class={[
              "min-w-0 rounded-full border-0 px-1.5 text-[10px] font-semibold outline-none transition-[background-color,color,box-shadow,transform] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/65",
              locale() === option.value
                ? "bg-accent text-[#062d36] shadow-[0_2px_8px_rgba(0,0,0,.28),inset_0_1px_0_rgba(255,255,255,.3)]"
                : "bg-transparent text-white/46 hover:text-white/78",
            ]}
            onClick={() => setLocale(option.value)}
          >
            <span class="block truncate">{option.label}</span>
          </button>
        )}
      </For>
    </div>
  )
}
