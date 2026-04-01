import { Navigate, Route, Routes } from 'react-router-dom'

import { HomePage } from '../views/HomePage'
import { RoomPage } from '../views/RoomPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/room/:roomId" element={<RoomPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

