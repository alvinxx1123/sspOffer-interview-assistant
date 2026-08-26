import { NavLink } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import {
  House, FileText, Target, MagnifyingGlass,
  Robot, ChartLineUp, Code, Gear,
  Sun, Moon,
} from '@phosphor-icons/react'
import './Nav.css'

const navSections = [
  {
    items: [
      { path: '/', label: '首页', icon: House },
    ],
  },
  {
    label: '准备',
    items: [
      { path: '/resumes', label: '简历+投递', icon: FileText },
      { path: '/mastery', label: '实习经历', icon: Target },
    ],
  },
  {
    label: '实战',
    items: [
      { path: '/interviews', label: '面经搜索', icon: MagnifyingGlass },
      { path: '/ai-interview', label: 'AI 面试', icon: Robot },
      { path: '/ide', label: '在线 IDE', icon: Code },
    ],
  },
  {
    label: '复盘',
    items: [
      { path: '/replay', label: '面试复盘', icon: ChartLineUp },
    ],
  },
]

function NavItem({ path, label, icon: Icon }) {
  return (
    <NavLink to={path} className={({ isActive }) => isActive ? 'sidebar-item active' : 'sidebar-item'}>
      {({ isActive }) => (
        <>
          <Icon size={20} weight={isActive ? 'fill' : 'regular'} className="sidebar-icon" />
          <span className="sidebar-label">{label}</span>
        </>
      )}
    </NavLink>
  )
}

export default function Nav() {
  const { theme, toggleTheme } = useTheme()
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img src="./logo.png" alt="sspOffer" className="sidebar-logo" />
        <span className="sidebar-title">sspOffer</span>
      </div>

      <nav className="sidebar-nav">
        {navSections.map((section, i) => (
          <div key={i} className="sidebar-section">
            {section.label && <div className="sidebar-section-label">{section.label}</div>}
            {section.items.map((item) => (
              <NavItem key={item.path} {...item} />
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <NavLink to="/settings" className="sidebar-item">
          {({ isActive }) => (
            <>
              <Gear size={20} weight={isActive ? 'fill' : 'regular'} className="sidebar-icon" />
              <span className="sidebar-label">设置</span>
            </>
          )}
        </NavLink>
        <button className="sidebar-item theme-toggle-item" onClick={toggleTheme} title={theme === 'dark' ? '切换浅色' : '切换深色'}>
          {theme === 'dark' ? <Sun size={20} weight="regular" className="sidebar-icon" /> : <Moon size={20} weight="regular" className="sidebar-icon" />}
          <span className="sidebar-label">{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
        </button>
      </div>
    </aside>
  )
}
