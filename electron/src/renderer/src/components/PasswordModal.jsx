import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { submitPassword, clearPassword } from '../utils/adminAuth'
import './PasswordModal.css'

export default function PasswordModal() {
  const [show, setShow] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const handler = () => {
      setShow(true)
      setValue('')
      setError('')
    }
    window.addEventListener('admin:needPassword', handler)
    return () => window.removeEventListener('admin:needPassword', handler)
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!value.trim()) {
      setError('请输入密码')
      return
    }
    submitPassword(value.trim())
    setShow(false)
    setValue('')
    setError('')
  }

  const handleClose = () => {
    submitPassword('')
    setShow(false)
    setValue('')
    setError('')
  }

  if (!show) return null

  return createPortal(
    <div className="password-modal-overlay" onClick={handleClose}>
      <div className="password-modal" onClick={(e) => e.stopPropagation()}>
        <h3>管理员密码</h3>
        <p className="password-modal-desc">进行修改操作需要验证管理员密码</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError('') }}
            placeholder="请输入密码"
            autoFocus
          />
          {error && <p className="password-modal-error">{error}</p>}
          <div className="password-modal-actions">
            <button type="submit" className="btn-primary">确认</button>
            <button type="button" className="btn-secondary" onClick={handleClose}>取消</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
