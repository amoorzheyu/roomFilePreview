export const SERVER_HTTP_BASE =
  (import.meta.env.VITE_SERVER_HTTP_BASE as string | undefined) ??
  window.location.origin

export const SERVER_SOCKET_BASE =
  (import.meta.env.VITE_SERVER_SOCKET_BASE as string | undefined) ??
  window.location.origin

export const GITHUB_REPO_URL = 'https://github.com/amoorzheyu/roomFilePreview'

