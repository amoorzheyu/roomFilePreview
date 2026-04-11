import crypto from 'node:crypto'

export type ContentType = 'pdf' | 'md'

export type RoomContent =
  | {
      type: 'pdf'
      name: string
      bytes: Buffer
      version: number
    }
  | {
      type: 'md'
      name: string
      text: string
      version: number
    }

export type RoomScroll = {
  kind: ContentType
  ratio: number
  updatedAt: number
}

export type SharedStroke = {
  id: string
  points: [number, number][]
  color: string
  width: number
}

export type SharedTextAnn = {
  id: string
  x: number
  y: number
  text: string
  color: string
  fontSize?: number
}

/** 与当前 content.version 对齐的标注快照 */
export type RoomAnnotations = {
  contentVersion: number
  strokes: SharedStroke[]
  texts: SharedTextAnn[]
}

export type RoomState = {
  roomId: string
  ownerToken: string
  ownerSocketId?: string
  shareEnabled: boolean
  content?: RoomContent
  scroll: RoomScroll
  annotations?: RoomAnnotations
  createdAt: number
  updatedAt: number
}

export type RoomStatePublic = {
  roomId: string
  hasOwner: boolean
  shareEnabled: boolean
  contentMeta?: {
    type: ContentType
    name: string
    version: number
  }
  scroll: RoomScroll
  annotations?: RoomAnnotations
}

const ROOM_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function randomRoomId(): string {
  const bytes = crypto.randomBytes(6)
  let out = ''
  for (let i = 0; i < 6; i++) {
    out += ROOM_ID_ALPHABET[bytes[i] % ROOM_ID_ALPHABET.length]
  }
  return out
}

function randomToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

export const rooms = new Map<string, RoomState>()

export function createRoom(): { roomId: string; ownerToken: string; state: RoomState } {
  let roomId = randomRoomId()
  for (let i = 0; i < 8 && rooms.has(roomId); i++) roomId = randomRoomId()
  if (rooms.has(roomId)) {
    throw new Error('room_id_collision')
  }

  const ownerToken = randomToken()
  const now = Date.now()
  const state: RoomState = {
    roomId,
    ownerToken,
    shareEnabled: true,
    scroll: { kind: 'md', ratio: 0, updatedAt: now },
    createdAt: now,
    updatedAt: now,
  }
  rooms.set(roomId, state)
  return { roomId, ownerToken, state }
}

export function getRoom(roomId: string): RoomState | undefined {
  return rooms.get(roomId)
}

export function requireRoom(roomId: string): RoomState {
  const room = rooms.get(roomId)
  if (!room) throw new Error('room_not_found')
  return room
}

export function isOwner(room: RoomState, ownerToken?: string | null): boolean {
  return Boolean(ownerToken && ownerToken === room.ownerToken)
}

export function toPublicState(room: RoomState): RoomStatePublic {
  const v = room.content?.version
  const ann =
    room.annotations && v !== undefined && room.annotations.contentVersion === v
      ? room.annotations
      : undefined
  return {
    roomId: room.roomId,
    hasOwner: Boolean(room.ownerSocketId),
    shareEnabled: room.shareEnabled,
    contentMeta: room.content
      ? { type: room.content.type, name: room.content.name, version: room.content.version }
      : undefined,
    scroll: room.scroll,
    annotations: ann,
  }
}

export function setShareEnabled(room: RoomState, enabled: boolean) {
  room.shareEnabled = enabled
  room.updatedAt = Date.now()
}

export function clearContent(room: RoomState) {
  room.content = undefined
  room.annotations = undefined
  const now = Date.now()
  room.scroll = { kind: 'md', ratio: 0, updatedAt: now }
  room.updatedAt = now
}

export function setScroll(room: RoomState, next: RoomScroll) {
  room.scroll = next
  room.updatedAt = Date.now()
}

export function setPdf(room: RoomState, name: string, bytes: Buffer) {
  const now = Date.now()
  const version = (room.content?.version ?? 0) + 1
  room.content = { type: 'pdf', name, bytes, version }
  room.scroll = { kind: 'pdf', ratio: 0, updatedAt: now }
  room.annotations = { contentVersion: version, strokes: [], texts: [] }
  room.updatedAt = now
}

export function setMd(room: RoomState, name: string, text: string) {
  const now = Date.now()
  const version = (room.content?.version ?? 0) + 1
  room.content = { type: 'md', name, text, version }
  room.scroll = { kind: 'md', ratio: 0, updatedAt: now }
  room.annotations = { contentVersion: version, strokes: [], texts: [] }
  room.updatedAt = now
}

export function setAnnotations(room: RoomState, next: RoomAnnotations) {
  const v = room.content?.version
  if (v === undefined || next.contentVersion !== v) return false
  room.annotations = next
  room.updatedAt = Date.now()
  return true
}

export function closeRoom(roomId: string) {
  rooms.delete(roomId)
}

