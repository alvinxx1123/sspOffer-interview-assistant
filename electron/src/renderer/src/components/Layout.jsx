import { Outlet } from 'react-router-dom'
import Nav from './Nav'
import PasswordModal from './PasswordModal'
import './Layout.css'

export default function Layout() {
  return (
    <div className="app-layout">
      <Nav />
      <main className="app-main">
        <Outlet />
      </main>
      <PasswordModal />
    </div>
  )
}
