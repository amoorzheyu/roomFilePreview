import type { Server as SocketIOServer } from 'socket.io'
import { z } from 'zod'

import {
  closeRoom,
  getRoom,
  isOwner,
  requireRoom,
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

