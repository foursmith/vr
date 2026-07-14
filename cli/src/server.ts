import type { MediaSource } from "./source"
import { Buffer } from "node:buffer"
import { timingSafeEqual } from "node:crypto"

export const AUTH_COOKIE_NAME = "fsvr_password"
const AUTH_COOKIE_MAX_AGE = 365 * 24 * 60 * 60
const AUTH_COOKIE_ATTRIBUTES = "HttpOnly; Secure; SameSite=Strict; Path=/"

export interface MediaServerOptions {
  hostname: string
  port: number
  password?: string
  sources: Map<string, MediaSource>
  discoverDlna?: () => Promise<MediaSource[]>
  webAssets?: Record<string, string>
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

type RouteHandler<Path extends string> = (request: Bun.BunRequest<Path>) => Response | Promise<Response>

const json = (value: unknown, init?: ResponseInit) => Response.json(value, init)
const errorResponse = (message: string, status: number, headers?: HeadersInit) =>
  json({ error: message }, { status, headers })

const passwordMatches = (supplied: string | null | undefined, expected: string) => {
  if (supplied == null) return false
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
}

const authCookie = (value: string, maxAge: number) =>
  `${AUTH_COOKIE_NAME}=${encodeURIComponent(value)}; ${AUTH_COOKIE_ATTRIBUTES}; Max-Age=${maxAge}`

const authenticated = <Path extends string>(
  password: string | undefined,
  handle: RouteHandler<Path>,
): RouteHandler<Path> => request => password === undefined || passwordMatches(request.cookies.get(AUTH_COOKIE_NAME), password)
  ? handle(request)
  : errorResponse("unauthorized", 401)

const parseRange = (header: string | null, size: number) => {
  if (!header) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) return null

  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[2] && match[1] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

const sourceSummary = (source: MediaSource) => ({
  id: source.id,
  name: source.name,
  kind: source.kind,
})

const proxyMedia = async (request: Request, url: string, mimeType?: string) => {
  const upstreamHeaders = new Headers()
  const requestedRange = request.headers.get("range")
  if (requestedRange) upstreamHeaders.set("range", requestedRange)

  const upstream = await fetch(url, { method: request.method, headers: upstreamHeaders })
  const headers = new Headers()
  for (const name of ["accept-ranges", "content-length", "content-range", "content-type"]) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (!headers.has("content-type") && mimeType) headers.set("content-type", mimeType)
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers })
}

const serveMediaFile = async (request: Request, path: string) => {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new HttpError(404, "not found")

  const range = parseRange(request.headers.get("range"), file.size)
  if (range === null) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.size}` } })
  }

  const headers = new Headers({
    "accept-ranges": "bytes",
    "content-type": file.type || "application/octet-stream",
  })
  if (!range) {
    headers.set("content-length", String(file.size))
    return new Response(request.method === "HEAD" ? null : file, { headers })
  }

  headers.set("content-length", String(range.end - range.start + 1))
  headers.set("content-range", `bytes ${range.start}-${range.end}/${file.size}`)
  return new Response(request.method === "HEAD" ? null : file.slice(range.start, range.end + 1), {
    status: 206,
    headers,
  })
}

const createRoutes = (options: MediaServerOptions) => {
  const serveMedia: RouteHandler<"/api/v1/media/:sourceId/:entryId"> = async (request) => {
    const source = options.sources.get(request.params.sourceId)
    if (!source) throw new HttpError(404, "source not found")
    const resource = await source.resolve(request.params.entryId)
    return resource.kind === "url"
      ? proxyMedia(request, resource.url, resource.mimeType)
      : serveMediaFile(request, resource.path)
  }

  return {
    "/api/v1/status": {
      GET: () => json({ name: "fsvr", version: "0.1.0" }),
    },
    "/api/v1/auth": {
      GET: (request: Bun.BunRequest<"/api/v1/auth">) => {
        const queryPassword = new URL(request.url).searchParams.get(AUTH_COOKIE_NAME)
        if (queryPassword !== null && options.password !== undefined) {
          if (!passwordMatches(queryPassword, options.password)) {
            return errorResponse("unauthorized", 401, { "set-cookie": authCookie("", 0) })
          }
          return new Response(null, {
            status: 302,
            headers: { "location": "/", "set-cookie": authCookie(queryPassword, AUTH_COOKIE_MAX_AGE) },
          })
        }
        return json({
          authenticated: options.password === undefined
            || passwordMatches(request.cookies.get(AUTH_COOKIE_NAME), options.password),
        })
      },
      POST: async (request: Bun.BunRequest<"/api/v1/auth">) => {
        if (options.password === undefined) return json({ authenticated: true })
        const body = await request.json().catch(() => undefined) as { password?: unknown } | undefined
        if (typeof body?.password !== "string" || !passwordMatches(body.password, options.password)) {
          return errorResponse("unauthorized", 401, { "set-cookie": authCookie("", 0) })
        }
        return json({ authenticated: true }, {
          headers: { "set-cookie": authCookie(body.password, AUTH_COOKIE_MAX_AGE) },
        })
      },
      DELETE: () => json({ authenticated: false }, {
        headers: { "set-cookie": authCookie("", 0) },
      }),
    },
    "/api/v1/sources": {
      GET: authenticated(options.password, () => json([...options.sources.values()].map(sourceSummary))),
    },
    "/api/v1/dlna/discover": {
      POST: authenticated(options.password, async () => {
        const discovered = await options.discoverDlna?.() ?? []
        discovered.forEach((source) => {
          if (!options.sources.has(source.id)) options.sources.set(source.id, source)
        })
        return json(discovered.map(source => sourceSummary(options.sources.get(source.id) ?? source)))
      }),
    },
    "/api/v1/sources/:sourceId/entries": {
      GET: authenticated(options.password, async (request) => {
        const source = options.sources.get(request.params.sourceId)
        if (!source) throw new HttpError(404, "source not found")
        const path = new URL(request.url).searchParams.get("path") ?? ""
        return json(await source.list(path))
      }),
    },
    "/api/v1/media/:sourceId/:entryId": {
      GET: authenticated(options.password, serveMedia),
      HEAD: authenticated(options.password, serveMedia),
    },
  } as const
}

export function createMediaServer(options: MediaServerOptions) {
  const routes = createRoutes(options)

  return Bun.serve({
    hostname: options.hostname,
    port: options.port,
    idleTimeout: 10,
    routes,
    async fetch(request) {
      const url = new URL(request.url)
      if (!url.pathname.startsWith("/api/") && (request.method === "GET" || request.method === "HEAD")) {
        const assetPath = options.webAssets?.[url.pathname] ?? options.webAssets?.["/index.html"]
        if (assetPath) {
          const file = Bun.file(assetPath)
          if (await file.exists()) {
            const headers = new Headers({ "content-type": file.type || "application/octet-stream" })
            if (url.pathname === "/" || url.pathname === "/index.html") headers.set("cache-control", "no-cache")
            return new Response(request.method === "HEAD" ? null : file, { headers })
          }
        }
      }
      return errorResponse("not found", 404)
    },
    error(error) {
      if (error instanceof HttpError) return errorResponse(error.message, error.status)
      console.error("request failed", error)
      return errorResponse("internal error", 500)
    },
  })
}
