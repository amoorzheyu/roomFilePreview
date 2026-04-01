const keyFor = (roomId: string) => `room:${roomId}:ownerToken`

export function saveOwnerToken(roomId: string, token: string) {
  localStorage.setItem(keyFor(roomId), token)
}

export function loadOwnerToken(roomId: string): string | null {
  return localStorage.getItem(keyFor(roomId))
}

