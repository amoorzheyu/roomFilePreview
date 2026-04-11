import { io, type Socket } from 'socket.io-client'

import { SERVER_SOCKET_BASE } from './config'
import type { RoomAnnotationStroke, RoomAnnotationText, RoomPublicState } from './api'

export type ServerToClientEvents = {
  'room:state': (payload: { state: RoomPublicState; isOwner: boolean }) => void
  'room:contentChanged': (payload: {
    version: number
    type: 'pdf' | 'md'
    name: string
  }) => void
  'room:contentCleared': () => void
  'room:shareChanged': (payload: { shareEnabled: boolean }) => void
  'room:scrollSync': (payload: { version: number; ratio: number; kind: 'pdf' | 'md' }) => void
  'room:annotationsSync': (payload: {
    version: number
    strokes: RoomAnnotationStroke[]
    texts: RoomAnnotationText[]
  }) => void
  'room:closed': () => void
  'room:error': (payload: { error: string }) => void
}

export type ClientToServerEvents = {
  'room:join': (
    payload: { roomId: string; ownerToken?: string },
    ack?: (resp: unknown) => void,
  ) => void
  'room:scroll': (payload: {
    roomId: string
    version: number
    ratio: number
    kind: 'pdf' | 'md'
  }) => void
  'room:annotationsSet': (payload: {
    roomId: string
    version: number
    strokes: RoomAnnotationStroke[]
    texts: RoomAnnotationText[]
  }) => void
  'room:close': (payload: { roomId: string }) => void
}

export function createSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  return io(SERVER_SOCKET_BASE, {
    transports: ['websocket'],
    autoConnect: true,
  })
}

