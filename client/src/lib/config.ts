export const SERVER_HTTP_BASE =
  (import.meta.env.VITE_SERVER_HTTP_BASE as string | undefined) ??
  window.location.origin

export const SERVER_SOCKET_BASE =
  (import.meta.env.VITE_SERVER_SOCKET_BASE as string | undefined) ??
  window.location.origin

export const GITHUB_REPO_URL = 'https://github.com/amoorzheyu/roomFilePreview'

const DEFAULT_STUN: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

/** WebRTC ICE；可设置 `VITE_ICE_SERVERS` 为 JSON 数组，例如 `[{"urls":"stun:stun.l.google.com:19302"}]` */
export function getRtcIceServers(): RTCIceServer[] {
  const raw = import.meta.env.VITE_ICE_SERVERS as string | undefined
  if (!raw?.trim()) return DEFAULT_STUN
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_STUN
    return parsed as RTCIceServer[]
  } catch {
    return DEFAULT_STUN
  }
}

