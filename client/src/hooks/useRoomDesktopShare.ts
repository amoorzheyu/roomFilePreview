import { useCallback, useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'

import { getRtcIceServers } from '../lib/config'
import type { ClientToServerEvents, ServerToClientEvents, WebrtcIceCandidatePayload } from '../lib/socket'

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>

function createPc(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: getRtcIceServers() })
}

function toCandPayload(c: RTCIceCandidate | null): WebrtcIceCandidatePayload | null {
  if (!c?.candidate) return null
  const o: WebrtcIceCandidatePayload = { candidate: c.candidate }
  if (c.sdpMid != null) o.sdpMid = c.sdpMid
  if (c.sdpMLineIndex != null) o.sdpMLineIndex = c.sdpMLineIndex
  return o
}

/** 在 setRemoteDescription 完成前暂存对端 ICE */
class RemoteIceBuffer {
  private queue: RTCIceCandidateInit[] = []
  private remoteReady = false

  constructor(private readonly pc: RTCPeerConnection) {}

  setRemoteDescriptionDone() {
    this.remoteReady = true
    for (const c of this.queue) {
      this.pc.addIceCandidate(c).catch(() => {})
    }
    this.queue = []
  }

  push(init: RTCIceCandidateInit) {
    if (!init.candidate) return
    if (!this.remoteReady) this.queue.push(init)
    else this.pc.addIceCandidate(init).catch(() => {})
  }
}

export function useRoomDesktopShare(opts: {
  /** 须与 RoomPage 中已 connect 的实例一致；为 null 时不注册信令 */
  socket: Sock | null
  roomId: string
  isOwner: boolean
  enabled: boolean
}) {
  const { socket, roomId, isOwner, enabled } = opts
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)

  const [desktopError, setDesktopError] = useState<string | null>(null)
  const [isHostSharing, setIsHostSharing] = useState(false)
  const [isReceivingDesktop, setIsReceivingDesktop] = useState(false)

  const displayStreamRef = useRef<MediaStream | null>(null)
  const hostPcByViewerRef = useRef(new Map<string, RTCPeerConnection>())
  const hostIceByViewerRef = useRef(new Map<string, RemoteIceBuffer>())
  const viewerPcRef = useRef<RTCPeerConnection | null>(null)
  const viewerIceRef = useRef<RemoteIceBuffer | null>(null)
  const viewerHostIdRef = useRef<string | null>(null)
  const viewerRemoteStreamRef = useRef<MediaStream | null>(null)

  const isOwnerRef = useRef(isOwner)
  isOwnerRef.current = isOwner
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId

  const teardownHostConnections = useCallback(() => {
    for (const pc of hostPcByViewerRef.current.values()) {
      pc.close()
    }
    hostPcByViewerRef.current.clear()
    hostIceByViewerRef.current.clear()
  }, [])

  const teardownViewer = useCallback(() => {
    viewerPcRef.current?.close()
    viewerPcRef.current = null
    viewerIceRef.current = null
    viewerHostIdRef.current = null
    viewerRemoteStreamRef.current = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    setIsReceivingDesktop(false)
  }, [])

  const stopDesktopShare = useCallback(() => {
    const rid = roomIdRef.current
    if (socket && isOwnerRef.current) socket.emit('webrtc:notifySharingStopped', { roomId: rid })
    teardownHostConnections()
    const s = displayStreamRef.current
    if (s) {
      s.getTracks().forEach((t) => t.stop())
      displayStreamRef.current = null
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    setIsHostSharing(false)
  }, [socket, teardownHostConnections])

  const attachHostPeerForViewer = useCallback(
    async (viewerSocketId: string) => {
      const stream = displayStreamRef.current
      const rid = roomIdRef.current
      if (!socket || !stream || !isOwnerRef.current) return
      const vt = stream.getVideoTracks()[0]
      if (!vt) return

      hostPcByViewerRef.current.get(viewerSocketId)?.close()
      hostPcByViewerRef.current.delete(viewerSocketId)
      hostIceByViewerRef.current.delete(viewerSocketId)

      const pc = createPc()
      const iceBuf = new RemoteIceBuffer(pc)
      hostIceByViewerRef.current.set(viewerSocketId, iceBuf)
      hostPcByViewerRef.current.set(viewerSocketId, pc)

      const clone = vt.clone()
      pc.addTrack(clone, stream)

      pc.onicecandidate = (ev) => {
        const p = toCandPayload(ev.candidate)
        if (p) socket.emit('webrtc:candidate', { roomId: rid, targetSocketId: viewerSocketId, candidate: p })
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          try {
            clone.stop()
          } catch {
            /* ignore */
          }
        }
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socket.emit('webrtc:offer', {
        roomId: rid,
        targetSocketId: viewerSocketId,
        sdp: offer.sdp ?? '',
      })
    },
    [socket],
  )

  const startDesktopShare = useCallback(async () => {
    if (!isOwnerRef.current) return
    setDesktopError(null)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })
      displayStreamRef.current = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopDesktopShare()
      })
      setIsHostSharing(true)
      socket?.emit('webrtc:notifySharing', { roomId: roomIdRef.current })
    } catch {
      setDesktopError('无法开始屏幕共享（需浏览器授权，生产环境建议 HTTPS）')
    }
  }, [socket, stopDesktopShare])

  useEffect(() => {
    if (!isHostSharing) return
    const stream = displayStreamRef.current
    const el = localVideoRef.current
    if (stream && el) el.srcObject = stream
  }, [isHostSharing])

  useEffect(() => {
    if (!isReceivingDesktop) return
    const stream = viewerRemoteStreamRef.current
    const el = remoteVideoRef.current
    if (stream && el) el.srcObject = stream
  }, [isReceivingDesktop])

  const requestViewerOffer = useCallback(() => {
    if (!socket || isOwnerRef.current) return
    socket.emit('webrtc:requestOffer', { roomId: roomIdRef.current })
  }, [socket])

  useEffect(() => {
    if (!enabled || !socket || roomId.length !== 6) return
    const sock = socket
    const subscribedAsOwner = isOwner

    const onRequestOffer = (p: { viewerSocketId: string }) => {
      if (!isOwnerRef.current || !displayStreamRef.current) return
      void attachHostPeerForViewer(p.viewerSocketId)
    }

    const onSharingOn = () => {
      if (isOwnerRef.current) return
      requestViewerOffer()
    }

    const onSharingOff = () => {
      if (isOwnerRef.current) return
      teardownViewer()
    }

    const onOffer = async (payload: { sdp: string; fromSocketId: string }) => {
      if (isOwnerRef.current) return
      teardownViewer()
      const rid = roomIdRef.current
      const pc = createPc()
      viewerPcRef.current = pc
      const iceBuf = new RemoteIceBuffer(pc)
      viewerIceRef.current = iceBuf
      viewerHostIdRef.current = payload.fromSocketId

      pc.ontrack = (ev) => {
        const [stream] = ev.streams
        if (!stream) return
        viewerRemoteStreamRef.current = stream
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream
        setIsReceivingDesktop(true)
      }
      pc.onicecandidate = (ev) => {
        const p = toCandPayload(ev.candidate)
        const hostId = viewerHostIdRef.current
        if (p && hostId) sock.emit('webrtc:candidate', { roomId: rid, targetSocketId: hostId, candidate: p })
      }

      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
        iceBuf.setRemoteDescriptionDone()
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        sock.emit('webrtc:answer', {
          roomId: rid,
          targetSocketId: payload.fromSocketId,
          sdp: answer.sdp ?? '',
        })
      } catch {
        teardownViewer()
      }
    }

    const onAnswer = async (payload: { sdp: string; fromSocketId: string }) => {
      if (!isOwnerRef.current) return
      const viewerId = payload.fromSocketId
      const pc = hostPcByViewerRef.current.get(viewerId)
      const iceBuf = hostIceByViewerRef.current.get(viewerId)
      if (!pc || !iceBuf) return
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
        iceBuf.setRemoteDescriptionDone()
      } catch {
        /* ignore */
      }
    }

    const onCand = (payload: { candidate: WebrtcIceCandidatePayload; fromSocketId: string }) => {
      const init: RTCIceCandidateInit = {
        candidate: payload.candidate.candidate ?? '',
        sdpMid: payload.candidate.sdpMid ?? undefined,
        sdpMLineIndex: payload.candidate.sdpMLineIndex ?? undefined,
      }
      if (!init.candidate) return

      if (isOwnerRef.current) {
        hostIceByViewerRef.current.get(payload.fromSocketId)?.push(init)
      } else {
        viewerIceRef.current?.push(init)
      }
    }

    sock.on('webrtc:requestOffer', onRequestOffer)
    sock.on('webrtc:sharingOn', onSharingOn)
    sock.on('webrtc:sharingOff', onSharingOff)
    sock.on('webrtc:offer', onOffer)
    sock.on('webrtc:answer', onAnswer)
    sock.on('webrtc:candidate', onCand)

    const onReconnect = () => {
      if (!isOwnerRef.current) requestViewerOffer()
    }
    sock.on('connect', onReconnect)

    if (!subscribedAsOwner) {
      requestViewerOffer()
    }

    return () => {
      sock.off('webrtc:requestOffer', onRequestOffer)
      sock.off('webrtc:sharingOn', onSharingOn)
      sock.off('webrtc:sharingOff', onSharingOff)
      sock.off('webrtc:offer', onOffer)
      sock.off('webrtc:answer', onAnswer)
      sock.off('webrtc:candidate', onCand)
      sock.off('connect', onReconnect)
      if (subscribedAsOwner) stopDesktopShare()
      else teardownViewer()
    }
  }, [
    attachHostPeerForViewer,
    enabled,
    isOwner,
    requestViewerOffer,
    roomId,
    socket,
    stopDesktopShare,
    teardownViewer,
  ])

  return {
    localVideoRef,
    remoteVideoRef,
    desktopError,
    setDesktopError,
    isHostSharing,
    isReceivingDesktop,
    startDesktopShare,
    stopDesktopShare,
  }
}
