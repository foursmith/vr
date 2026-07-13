import type { MediaSource } from "./source"
import { Buffer } from "node:buffer"
import { timingSafeEqual } from "node:crypto"

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" }

const json = (value: unknown, init?: ResponseInit) => Response.json(value, init)
const AUTH_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

const passwordMatches = (supplied: string | undefined, expected: string) => {
  if (supplied === undefined) return false
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
}

const isAllowedOrigin = (origin: string, allowedOrigins: string[]) => {
  if (allowedOrigins.includes(origin)) return true
  try {
    const url = new URL(origin)
    return url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
  } catch {
    return false
  }
}

const parseRange = (header: string | null, size: number) => {
  if (!header) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

export function createMediaServer(options: {
  hostname: string
  port: number
  password: string
  sources: Map<string, MediaSource>
  discoverDlna?: () => Promise<MediaSource[]>
  webAssets?: Record<string, string>
  allowedOrigins: string[]
}) {
  const readCookiePassword = (request: Request) => {
    const value = /(?:^|;\s*)fsvr_password=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1]
    if (!value) return undefined
    try {
      return decodeURIComponent(value)
    } catch {
      return undefined
    }
  }

  return Bun.serve({
    hostname: options.hostname,
    port: options.port,
    idleTimeout: 10,
    async fetch(request) {
      const url = new URL(request.url)
      const origin = request.headers.get("origin")
      const corsOrigin = origin && isAllowedOrigin(origin, options.allowedOrigins)
        ? origin
        : undefined
      const corsHeaders: Record<string, string> = corsOrigin
        ? {
            "access-control-allow-origin": corsOrigin,
            "access-control-allow-private-network": "true",
            "access-control-allow-headers": "Content-Type, Range",
            "access-control-allow-methods": "GET, HEAD, OPTIONS, POST, DELETE",
            "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range",
            "vary": "Origin",
          }
        : {}

      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders })

      if (url.pathname === "/api/v1/status") {
        return json({ name: "fsvr", version: "0.1.0" }, { headers: corsHeaders })
      }

      if (url.pathname === "/api/v1/auth" && request.method === "GET") {
        return json({ authenticated: passwordMatches(readCookiePassword(request), options.password) }, { headers: corsHeaders })
      }

      if (url.pathname === "/api/v1/auth" && request.method === "POST") {
        const body = await request.json().catch(() => ({})) as { password?: unknown }
        if (typeof body.password !== "string" || !passwordMatches(body.password, options.password)) {
          return json({ error: "unauthorized" }, {
            status: 401,
            headers: { ...corsHeaders, "set-cookie": "fsvr_password=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" },
          })
        }
        return json({ authenticated: true }, {
          headers: {
            ...corsHeaders,
            "set-cookie": `fsvr_password=${encodeURIComponent(body.password)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE}`,
          },
        })
      }

      if (url.pathname === "/api/v1/auth" && request.method === "DELETE") {
        return json({ authenticated: false }, {
          headers: { ...corsHeaders, "set-cookie": "fsvr_password=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" },
        })
      }

      if (!url.pathname.startsWith("/api/") && (request.method === "GET" || request.method === "HEAD")) {
        const assetPath = options.webAssets?.[url.pathname] ?? options.webAssets?.["/index.html"]
        if (assetPath) {
          const file = Bun.file(assetPath)
          const headers: Record<string, string> = { "content-type": file.type || "application/octet-stream" }
          if (url.pathname === "/" || url.pathname === "/index.html") {
            headers["cache-control"] = "no-cache"
          }
          return new Response(request.method === "HEAD" ? null : file, { headers })
        }
      }

      if (!passwordMatches(readCookiePassword(request), options.password)) {
        return json({ error: "unauthorized" }, { status: 401, headers: corsHeaders })
      }

      try {
        if (url.pathname === "/api/v1/sources") {
          return json([...options.sources.values()].map(source => ({ id: source.id, name: source.name, kind: source.kind })), { headers: corsHeaders })
        }
        if (url.pathname === "/api/v1/dlna/discover" && request.method === "POST") {
          const discovered = await options.discoverDlna?.() ?? []
          discovered.forEach(source => options.sources.set(source.id, source))
          return json(discovered.map(source => ({ id: source.id, name: source.name, kind: source.kind })), { headers: corsHeaders })
        }
        const entriesMatch = /^\/api\/v1\/sources\/([^/]+)\/entries$/.exec(url.pathname)
        if (entriesMatch) {
          const source = options.sources.get(decodeURIComponent(entriesMatch[1]))
          if (!source) return json({ error: "source not found" }, { status: 404, headers: corsHeaders })
          const path = url.searchParams.get("path") ?? ""
          return json(await source.list(path), { headers: corsHeaders })
        }
        const mediaMatch = /^\/api\/v1\/media\/([^/]+)\/([^/]+)$/.exec(url.pathname)
        if (mediaMatch) {
          const source = options.sources.get(decodeURIComponent(mediaMatch[1]))
          if (!source) return json({ error: "source not found" }, { status: 404, headers: corsHeaders })
          const resource = await source.resolve(mediaMatch[2])
          if (resource.kind === "url") {
            const upstreamHeaders = new Headers()
            const requestedRange = request.headers.get("range")
            if (requestedRange) upstreamHeaders.set("range", requestedRange)
            const upstream = await fetch(resource.url, { method: request.method, headers: upstreamHeaders })
            const headers: Record<string, string> = { ...corsHeaders }
            for (const name of ["accept-ranges", "content-length", "content-range", "content-type"]) {
              const value = upstream.headers.get(name)
              if (value) headers[name] = value
            }
            if (!headers["content-type"] && resource.mimeType) headers["content-type"] = resource.mimeType
            return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers })
          }
          const file = Bun.file(resource.path)
          if (!(await file.exists())) return json({ error: "not found" }, { status: 404, headers: corsHeaders })
          const range = parseRange(request.headers.get("range"), file.size)
          if (range === null) {
            return new Response(null, { status: 416, headers: { ...corsHeaders, "content-range": `bytes */${file.size}` } })
          }
          const headers: Record<string, string> = {
            ...corsHeaders,
            "accept-ranges": "bytes",
            "content-type": file.type || "application/octet-stream",
          }
          if (range) {
            headers["content-length"] = String(range.end - range.start + 1)
            headers["content-range"] = `bytes ${range.start}-${range.end}/${file.size}`
            return new Response(request.method === "HEAD" ? null : file.slice(range.start, range.end + 1), { status: 206, headers })
          }
          headers["content-length"] = String(file.size)
          return new Response(request.method === "HEAD" ? null : file, { headers })
        }
        if (url.pathname.startsWith("/api/")) {
          return json({ error: "not found" }, { status: 404, headers: { ...JSON_HEADERS, ...corsHeaders } })
        }
        return json({ error: "not found" }, { status: 404, headers: { ...JSON_HEADERS, ...corsHeaders } })
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal error"
        return json({ error: message }, { status: 400, headers: corsHeaders })
      }
    },
  })
}
