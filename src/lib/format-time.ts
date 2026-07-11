export const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "00:00"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const body = [minutes, secs].map(part => String(part).padStart(2, "0")).join(":")
  return hours > 0 ? `${hours}:${body}` : body
}
