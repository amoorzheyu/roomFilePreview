import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'

import {
  clearContent,
  closeRoom,
  createRoom,
  isOwner,
  requireRoom,
  setMd,
  setPdf,
  setShareEnabled,
  toPublicState,
} from '../rooms/store.js'
import { emitRoom } from '../realtime/bus.js'

export const roomsRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

function getBearerToken(authHeader: unknown): string | undefined {
  if (typeof authHeader !== 'string') return undefined
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  return m?.[1]
}

roomsRouter.post('/', (_req, res) => {
  const { roomId, ownerToken } = createRoom()
  res.json({ roomId, ownerToken })
})

roomsRouter.get('/:roomId/state', (req, res) => {
  try {
    const room = requireRoom(req.params.roomId)
    res.json({ state: toPublicState(room) })
  } catch {
    res.status(404).json({ error: 'room_not_found' })
  }
})

roomsRouter.get('/:roomId/content/pdf', (req, res) => {
  try {
    const room = requireRoom(req.params.roomId)
    if (!room.content || room.content.type !== 'pdf') {
      return res.status(404).json({ error: 'no_pdf' })
    }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(room.content.name)}"`,
    )
    res.send(room.content.bytes)
  } catch {
    res.status(404).json({ error: 'room_not_found' })
  }
})

roomsRouter.get('/:roomId/content/md', (req, res) => {
  try {
    const room = requireRoom(req.params.roomId)
    if (!room.content || room.content.type !== 'md') {
      return res.status(404).json({ error: 'no_md' })
    }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.send(room.content.text)
  } catch {
    res.status(404).json({ error: 'room_not_found' })
  }
})

roomsRouter.post('/:roomId/share', (req, res) => {
  const bodySchema = z.object({ enabled: z.boolean() })
  const parsed = bodySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' })

  try {
    const room = requireRoom(req.params.roomId)
    const ownerToken = getBearerToken(req.headers.authorization)
    if (!isOwner(room, ownerToken)) return res.status(403).json({ error: 'forbidden' })
    setShareEnabled(room, parsed.data.enabled)
    emitRoom(room.roomId, 'room:shareChanged', { shareEnabled: room.shareEnabled })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'room_not_found' })
  }
})

roomsRouter.delete('/:roomId/content', (req, res) => {
  try {
    const room = requireRoom(req.params.roomId)
    const ownerToken = getBearerToken(req.headers.authorization)
    if (!isOwner(room, ownerToken)) return res.status(403).json({ error: 'forbidden' })
    clearContent(room)
    emitRoom(room.roomId, 'room:contentCleared')
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'room_not_found' })
  }
})

roomsRouter.post('/:roomId/close', (req, res) => {
  try {
    const room = requireRoom(req.params.roomId)
    const ownerToken = getBearerToken(req.headers.authorization)
    if (!isOwner(room, ownerToken)) return res.status(403).json({ error: 'forbidden' })
    emitRoom(room.roomId, 'room:closed')
    closeRoom(room.roomId)
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'room_not_found' })
  }
})

roomsRouter.post('/:roomId/content', upload.single('file'), (req, res) => {
  try {
    const room = requireRoom(req.params.roomId)
    const ownerToken = getBearerToken(req.headers.authorization)
    if (!isOwner(room, ownerToken)) return res.status(403).json({ error: 'forbidden' })

    const file = req.file
    if (!file) return res.status(400).json({ error: 'missing_file' })

    const name = file.originalname || 'upload'
    const lower = name.toLowerCase()
    if (lower.endsWith('.pdf')) {
      setPdf(room, name, file.buffer)
      emitRoom(room.roomId, 'room:contentChanged', {
        version: room.content?.version ?? 0,
        type: 'pdf',
        name,
      })
      return res.json({ version: room.content?.version })
    }
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
      const text = file.buffer.toString('utf8')
      setMd(room, name, text)
      emitRoom(room.roomId, 'room:contentChanged', {
        version: room.content?.version ?? 0,
        type: 'md',
        name,
      })
      return res.json({ version: room.content?.version })
    }

    return res.status(415).json({ error: 'unsupported_file_type' })
  } catch {
    res.status(404).json({ error: 'room_not_found' })
  }
})

