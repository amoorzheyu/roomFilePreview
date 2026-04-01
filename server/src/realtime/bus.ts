import type { Server as SocketIOServer } from 'socket.io'

type Bus = {
  io?: SocketIOServer
}

const bus: Bus = {}

export function attachIo(io: SocketIOServer) {
  bus.io = io
}

export function emitRoom(roomId: string, event: string, payload?: unknown) {
  bus.io?.to(roomId).emit(event, payload)
}

