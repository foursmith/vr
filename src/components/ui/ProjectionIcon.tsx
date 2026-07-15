import type { PROJECTION_OPTIONS } from "@foursmith/player-core/config"

type ProjectionMode = (typeof PROJECTION_OPTIONS)[number]["component"]

export function ProjectionIcon(props: { projection: ProjectionMode, class?: string }) {
  const isSbs = () => props.projection.startsWith("sbs_")
  const isTb = () => props.projection.startsWith("tb_")
  const isFisheye = () => props.projection.endsWith("_fe")
  const isFlat = () => props.projection === "flat_2d"
  const is360 = () => props.projection.includes("_360_")

  return (
    <svg
      aria-hidden="true"
      class={props.class ?? "h-4.5 w-4.5"}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {isFlat()
        ? (
            <>
              <rect x="3.25" y="5.75" width="17.5" height="12.5" rx="2.25" stroke="currentColor" stroke-width="1.7" />
              <path d="M7 18.25h10M9.25 21h5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
              <path d="M7.25 9.25h9.5v5.5h-9.5z" stroke="currentColor" stroke-width="1.25" opacity=".48" />
            </>
          )
        : isFisheye()
          ? (
              <>
                <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7" />
                <circle cx="12" cy="12" r="5.25" stroke="currentColor" stroke-width="1.25" opacity=".5" />
                <path d="M12 3.5c2.05 2.2 3.1 5.04 3.1 8.5S14.05 18.3 12 20.5C9.95 18.3 8.9 15.46 8.9 12S9.95 5.7 12 3.5Z" stroke="currentColor" stroke-width="1.15" opacity=".72" />
                {isSbs() && <path d="M12 3.5v17" stroke="currentColor" stroke-width="1.45" />}
              </>
            )
          : (
              <>
                <path
                  d={is360() ? "M3.25 7.25C5.7 4.95 8.6 3.8 12 3.8s6.3 1.15 8.75 3.45v9.5C18.3 19.05 15.4 20.2 12 20.2s-6.3-1.15-8.75-3.45v-9.5Z" : "M4 7.4C6.1 5.35 8.75 4.3 12 4.3s5.9 1.05 8 3.1v9.2c-2.1 2.05-4.75 3.1-8 3.1s-5.9-1.05-8-3.1V7.4Z"}
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linejoin="round"
                />
                <path d="M4 12h16M12 4.2c-1.7 2.05-2.55 4.65-2.55 7.8s.85 5.75 2.55 7.8M12 4.2c1.7 2.05 2.55 4.65 2.55 7.8s-.85 5.75-2.55 7.8" stroke="currentColor" stroke-width="1.1" opacity=".52" />
                {isSbs() && <path d="M12 4.2v15.6" stroke="currentColor" stroke-width="1.5" />}
                {isTb() && <path d="M3.4 12h17.2" stroke="currentColor" stroke-width="1.5" />}
                {!isSbs() && !isTb() && <circle cx="12" cy="12" r="1.2" fill="currentColor" />}
              </>
            )}
    </svg>
  )
}
