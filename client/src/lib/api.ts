import { SERVER_HTTP_BASE } from './config'

export type CreateRoomResponse = { roomId: string; ownerToken: string }

export type RoomPublicState = {
  roomId: string
  hasOwner: boolean
  shareEnabled: boolean
  contentMeta?: { type: 'pdf' | 'md'; name: string; version: number }
  scroll: { kind: 'pdf' | 'md'; ratio: number; updatedAt: number }
}

export async function createRoom(): Promise<CreateRoomResponse> {
  const res = await fetch(`${SERVER_HTTP_BASE}/api/rooms`, { method: 'POST' })
  if (!res.ok) throw new Error('create_room_failed')
  return (await res.json()) as CreateRoomResponse
}

export async function getRoomState(roomId: string): Promise<RoomPublicState> {
  const res = await fetch(`${SERVER_HTTP_BASE}/api/rooms/${encodeURIComponent(roomId)}/state`)
  if (!res.ok) throw new Error('room_not_found')
  const data = (await res.json()) as { state: RoomPublicState }
  return data.state
}

export async function getMdContent(opts: { roomId: string }): Promise<string> {
  const res = await fetch(
    `${SERVER_HTTP_BASE}/api/rooms/${encodeURIComponent(opts.roomId)}/content/md`,
  )
  if (!res.ok) throw new Error('no_md')
  return await res.text()
}

export async function uploadRoomContent(opts: {
  roomId: string
  ownerToken: string
  file: File
}): Promise<{ version: number }> {
  const fd = new FormData()
  fd.append('file', opts.file)
  const res = await fetch(`${SERVER_HTTP_BASE}/api/rooms/${encodeURIComponent(opts.roomId)}/content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.ownerToken}` },
    body: fd,
  })
  if (!res.ok) throw new Error('upload_failed')
  return (await res.json()) as { version: number }
}

export async function setShare(opts: { roomId: string; ownerToken: string; enabled: boolean }) {
  const res = await fetch(`${SERVER_HTTP_BASE}/api/rooms/${encodeURIComponent(opts.roomId)}/share`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.ownerToken}`,
    },
    body: JSON.stringify({ enabled: opts.enabled }),
  })
  if (!res.ok) throw new Error('set_share_failed')
}

export async function clearContent(opts: { roomId: string; ownerToken: string }) {
  const res = await fetch(
    `${SERVER_HTTP_BASE}/api/rooms/${encodeURIComponent(opts.roomId)}/content`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${opts.ownerToken}` },
    },
  )
  if (!res.ok) throw new Error('clear_failed')
}

export async function closeRoom(opts: { roomId: string; ownerToken: string }) {
  const res = await fetch(`${SERVER_HTTP_BASE}/api/rooms/${encodeURIComponent(opts.roomId)}/close`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.ownerToken}` },
  })
  if (!res.ok) throw new Error('close_failed')
}

export function pdfUrl(roomId: string) {
  return `${SERVER_HTTP_BASE}/api/rooms/${encodeURIComponent(roomId)}/content/pdf`
}

export function mdUrl(roomId: string) {
  return `${SERVER_HTTP_BASE}/api/rooms/${encodeURIComponent(roomId)}/content/md`
}

