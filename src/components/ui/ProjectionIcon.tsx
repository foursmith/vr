import type { PROJECTION_OPTIONS } from "@foursmith/player-core/config"

type ProjectionMode = (typeof PROJECTION_OPTIONS)[number]["component"]

export function ProjectionIcon(props: { projection: ProjectionMode, class?: string }) {
  const artwork = () => {
    switch (props.projection) {
      case "sbs_180_eqr":
        return (
          <>
            <rect x="2" y="7" width="20" height="10" rx="1.8" />
            <path d="M12 7v10" />
            <g opacity=".46" stroke-width="1.05">
              <path d="M2.25 12h19.5M7 7.25v9.5M17 7.25v9.5" />
            </g>
          </>
        )
      case "sbs_180_fe":
        return (
          <>
            <rect x="2" y="7" width="20" height="10" rx="1.8" />
            <path d="M12 7v10" opacity=".55" stroke-width="1.05" />
            <circle cx="7" cy="12" r="3.65" />
            <circle cx="17" cy="12" r="3.65" />
          </>
        )
      case "mono_360_eqr":
        return (
          <>
            <rect x="2" y="7" width="20" height="10" rx="1.8" />
            <g opacity=".46" stroke-width="1.05">
              <path d="M2.25 12h19.5M7 7.25v9.5M12 7.25v9.5M17 7.25v9.5" />
            </g>
          </>
        )
      case "m_180_eqr":
        return (
          <>
            <rect x="4.5" y="4.5" width="15" height="15" rx="2" />
            <g opacity=".46" stroke-width="1.05">
              <path d="M4.75 9.5h14.5M4.75 14.5h14.5M9.5 4.75v14.5M14.5 4.75v14.5" />
            </g>
          </>
        )
      case "m_180_fe":
        return (
          <>
            <rect x="4.5" y="4.5" width="15" height="15" rx="2" />
            <circle cx="12" cy="12" r="5.65" />
            <circle cx="12" cy="12" r="1.15" opacity=".5" stroke-width="1.05" />
          </>
        )
      case "tb_360_eqr":
        return (
          <>
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M4 12h16" />
            <g opacity=".46" stroke-width="1.05">
              <path d="M4.25 8h15.5M4.25 16h15.5M8 4.25v15.5M12 4.25v15.5M16 4.25v15.5" />
            </g>
          </>
        )
      case "flat_2d":
        return (
          <>
            <rect x="2" y="6.5" width="20" height="11.25" rx="1.8" />
            <path d="M8.5 20.5h7M12 17.75v2.75" />
          </>
        )
    }
  }

  return (
    <svg
      aria-hidden="true"
      class={props.class ?? "h-4.5 w-4.5"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.65"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {artwork()}
    </svg>
  )
}
