import http from 'node:http'
import cors from 'cors'
import express from 'express'
import { Server as SocketIOServer } from 'socket.io'

import { roomsRouter } from './routes/rooms.js'
import { attachIo } from './realtime/bus.js'
import { registerSocketHandlers } from './socket/handlers.js'

const PORT = Number(process.env.PORT ?? 8787)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'

const app = express()
app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  }),
)
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))
app.use('/api/rooms', roomsRouter)

const server = http.createServer(app)
const io = new SocketIOServer(server, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
})

attachIo(io)
registerSocketHandlers(io)

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`)
})

