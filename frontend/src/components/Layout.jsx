import { Outlet } from 'react-router-dom'
import Nav from './Nav'
import PasswordModal from './PasswordModal'
import './Layout.css'

export default function Layout() {
  return (
    <div className="layout">
      <Nav />
      <main className="main-content">
        <Outlet />
      </main>
      <PasswordModal />
    </div>
  )
}
