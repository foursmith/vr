import type { MediaEntry, MediaSource } from "./source"
import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { createSocket } from "node:dgram"
import { XMLParser } from "fast-xml-parser"

const SSDP_ADDRESS = "239.255.255.250"
const SSDP_PORT = 1900
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true })
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value]
const encodeId = (value: string) => Buffer.from(value).toString("base64url")

interface DeviceDescription {
  root?: {
    device?: {
      friendlyName?: string
      UDN?: string
      serviceList?: { service?: DeviceService | DeviceService[] }
    }
  }
}
interface DeviceService { serviceType?: string, controlURL?: string }
interface DidlObject {
  "@_id"?: string
  "title"?: string
  "class"?: string
  "res"?: DidlResource | DidlResource[]
}
interface DidlResource { "#text"?: string, "@_protocolInfo"?: string }

const fetchText = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`DLNA request failed (${response.status})`)
  return response.text()
}

const discoverLocations = (timeoutMs = 2200) => new Promise<string[]>((resolve, reject) => {
  const socket = createSocket({ type: "udp4", reuseAddr: true })
  const locations = new Set<string>()
  const finish = () => {
    socket.close()
    resolve([...locations])
  }
  socket.on("error", (error) => {
    socket.close()
    reject(error)
  })
  socket.on("message", (message) => {
    const lines = message.toString().split("\r\n")
    const locationLine = lines.find(line => line.toLowerCase().startsWith("location:"))
    const location = locationLine?.slice("location:".length).trim()
    if (location) locations.add(location)
  })
  socket.bind(0, () => {
    const request = Buffer.from([
      "M-SEARCH * HTTP/1.1",
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      "MAN: \"ssdp:discover\"",
      "MX: 2",
      "ST: urn:schemas-upnp-org:device:MediaServer:1",
      "",
      "",
    ].join("\r\n"))
    socket.send(request, SSDP_PORT, SSDP_ADDRESS)
    setTimeout(() => socket.send(request, SSDP_PORT, SSDP_ADDRESS), 350)
    setTimeout(finish, timeoutMs)
  })
})

const createDlnaSource = async (location: string): Promise<MediaSource | undefined> => {
  const description = parser.parse(await fetchText(location)) as DeviceDescription
  const device = description.root?.device
  const service = array(device?.serviceList?.service).find(candidate => candidate.serviceType?.includes(":service:ContentDirectory:"))
  if (!device || !service?.serviceType || !service.controlURL) return undefined
  const controlUrl = new URL(service.controlURL, location).href
  const resources = new Map<string, { url: string, mimeType?: string }>()
  const id = `dlna-${createHash("sha256").update(device.UDN ?? location).digest("hex").slice(0, 12)}`

  const browse = async (objectId: string) => {
    const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:Browse xmlns:u="${service.serviceType}"><ObjectID>${objectId.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter><StartingIndex>0</StartingIndex><RequestedCount>0</RequestedCount><SortCriteria></SortCriteria></u:Browse></s:Body></s:Envelope>`
    const soap = parser.parse(await fetchText(controlUrl, {
      method: "POST",
      headers: {
        "content-type": "text/xml; charset=\"utf-8\"",
        "soapaction": `"${service.serviceType}#Browse"`,
      },
      body,
    })) as { Envelope?: { Body?: { BrowseResponse?: { Result?: string } } } }
    const result = soap.Envelope?.Body?.BrowseResponse?.Result
    if (!result) return []
    const didl = parser.parse(result) as { "DIDL-Lite"?: { container?: DidlObject | DidlObject[], item?: DidlObject | DidlObject[] } }
    const root = didl["DIDL-Lite"]
    const containers: MediaEntry[] = array(root?.container).flatMap((item) => {
      if (!item["@_id"]) return []
      return [{ id: encodeId(item["@_id"]), name: item.title ?? "Folder", kind: "folder" as const }]
    })
    const items: MediaEntry[] = array(root?.item).flatMap((item) => {
      if (!item["@_id"]) return []
      const candidates = array(item.res)
      const resource = candidates.find(value => value["@_protocolInfo"]?.includes("video/")) ?? candidates[0]
      const url = resource?.["#text"]
      if (!url) return []
      const mimeType = resource["@_protocolInfo"]?.split(":")[2]
      const subtitle = /\.(?:srt|vtt|ass|ssa)(?:\?|$)/i.test(url)
      if (!subtitle && !item.class?.includes("videoItem") && !mimeType?.startsWith("video/")) return []
      const entryId = encodeId(item["@_id"])
      resources.set(entryId, { url, mimeType })
      return [{ id: entryId, name: item.title ?? "Media", kind: subtitle ? "subtitle" as const : "video" as const }]
    })
    return [...containers, ...items]
  }

  return {
    id,
    name: device.friendlyName ?? "DLNA Media Server",
    kind: "dlna",
    list(path) {
      return browse(path ? Buffer.from(path, "base64url").toString("utf8") : "0")
    },
    async resolve(entryId) {
      const resource = resources.get(entryId)
      if (!resource) throw new Error("DLNA media resource is no longer available")
      return { kind: "url", ...resource }
    },
  }
}

export async function discoverDlnaSources() {
  const locations = await discoverLocations()
  const results = await Promise.allSettled(locations.map(createDlnaSource))
  return results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : [])
}
