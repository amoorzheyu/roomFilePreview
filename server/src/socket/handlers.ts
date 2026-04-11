import type { Server as SocketIOServer } from 'socket.io'
import { z } from 'zod'

import {
  closeRoom,
  getRoom,
  isOwner,
  requireRoom,
  setAnnotations,
  setScroll,
  toPublicState,
} from '../rooms/store.js'

const joinSchema = z.object({
  roomId: z.string().min(1),
  ownerToken: z.string().optional(),
})

const scrollSchema = z.object({
  roomId: z.string().min(1),
  version: z.number().int().nonnegative(),
  ratio: z.number().min(0).max(1),
  kind: z.enum(['pdf', 'md']),
})

const closeSchema = z.object({
  roomId: z.string().min(1),
})

const pointTuple = z.tuple([z.number(), z.number()])
const strokeSchema = z.object({
  id: z.string().max(128),
  points: z.array(pointTuple).max(16000),
  color: z.string().max(32),
  width: z.number().min(0.5).max(80),
})
const textAnnSchema = z.object({
  id: z.string().max(128),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  text: z.string().max(8000),
  color: z.string().max(32),
  fontSize: z.number().min(8).max(96).optional(),
})
const annotationsSetSchema = z.object({
  roomId: z.string().min(1),
  version: z.number().int().nonnegative(),
  strokes: z.array(strokeSchema).max(2000),
  texts: z.array(textAnnSchema).max(600),
})

export function registerSocketHandlers(io: SocketIOServer) {
  io.on('connection', (socket) => {
    let joinedRoomId: string | null = null
    let isThisSocketOwner = false

    socket.on('room:join', (payload, ack?: (resp: unknown) => void) => {
      const parsed = joinSchema.safeParse(payload)
      if (!parsed.success) {
        ack?.({ ok: false, error: 'bad_request' })
        return
      }

      const { roomId, ownerToken } = parsed.data
      const room = getRoom(roomId)
      if (!room) {
        ack?.({ ok: false, error: 'room_not_found' })
        return
      }

      socket.join(roomId)
      joinedRoomId = roomId

      isThisSocketOwner = isOwner(room, ownerToken)
      if (isThisSocketOwner) {
        room.ownerSocketId = socket.id
      }

      socket.emit('room:state', { state: toPublicState(room), isOwner: isThisSocketOwner })
      ack?.({ ok: true })
    })

    socket.on('room:scroll', (payload) => {
      const parsed = scrollSchema.safeParse(payload)
      if (!parsed.success) return

      const { roomId, ratio, kind, version } = parsed.data
      const room = getRoom(roomId)
      if (!room) return
      if (!room.shareEnabled) return

      const contentVersion = room.content?.version ?? 0
      if (contentVersion !== version) return

      if (room.ownerSocketId !== socket.id && !isThisSocketOwner) return

      setScroll(room, { kind, ratio, updatedAt: Date.now() })
      socket.to(roomId).emit('room:scrollSync', { kind, ratio, version })
    })

    socket.on('room:annotationsSet', (payload) => {
      const parsed = annotationsSetSchema.safeParse(payload)
      if (!parsed.success) return

      const { roomId, version, strokes, texts } = parsed.data
      const room = getRoom(roomId)
      if (!room) return
      if (!room.shareEnabled) return
      if (room.ownerSocketId !== socket.id && !isThisSocketOwner) return

      const contentVersion = room.content?.version ?? 0
      if (contentVersion !== version) return

      const ok = setAnnotations(room, { contentVersion: version, strokes, texts })
      if (!ok) return
      socket.to(roomId).emit('room:annotationsSync', { version, strokes, texts })
    })

    socket.on('room:close', (payload) => {
      const parsed = closeSchema.safeParse(payload)
      if (!parsed.success) return
      const room = getRoom(parsed.data.roomId)
      if (!room) return
      if (room.ownerSocketId !== socket.id && !isThisSocketOwner) return

      io.to(room.roomId).emit('room:closed')
      closeRoom(room.roomId)
    })

    socket.on('disconnect', () => {
      if (!joinedRoomId) return
      try {
        const room = requireRoom(joinedRoomId)
        if (room.ownerSocketId === socket.id) {
          room.ownerSocketId = undefined
        }
      } catch {
        // room already closed
      }
    })
  })
}

