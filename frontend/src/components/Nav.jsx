import { NavLink } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import './Nav.css'

const navItems = [
  { path: '/', label: '首页' },
  { path: '/resumes', label: '简历+投递' },
  { path: '/interviews', label: '面经搜索' },
  { path: '/ai-interview', label: 'AI 面试模拟' },
  { path: '/replay', label: '面试复盘' },
  { path: '/ide', label: '在线 IDE' },
]

export default function Nav() {
  const { theme, toggleTheme } = useTheme()
  return (
    <nav className="nav">
      <div className="nav-brand">
        <NavLink to="/">
          <img src="/logo.png" alt="sspOffer" className="nav-logo" />
          <span className="nav-brand-text">sspOffer面经助手</span>
        </NavLink>
      </div>
      <div className="nav-right">
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换为浅色模式' : '切换为深色模式'}
          aria-label={theme === 'dark' ? '切换为浅色模式' : '切换为深色模式'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <ul className="nav-links">
          {navItems.map(({ path, label }) => (
            <li key={path}>
              <NavLink to={path} className={({ isActive }) => isActive ? 'active' : ''}>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
