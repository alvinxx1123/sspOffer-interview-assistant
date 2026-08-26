const STORAGE_KEY = 'adminPassword'

let passwordResolve = null

export function getPassword() {
  return sessionStorage.getItem(STORAGE_KEY)
}

export function setPassword(p) {
  if (p) sessionStorage.setItem(STORAGE_KEY, p)
  else sessionStorage.removeItem(STORAGE_KEY)
}

export function clearPassword() {
  sessionStorage.removeItem(STORAGE_KEY)
}

/** 获取密码，若无则派发事件等待用户输入，返回 Promise */
export function getPasswordAsync() {
  const p = getPassword()
  if (p) return Promise.resolve(p)
  return new Promise((resolve) => {
    passwordResolve = resolve
    window.dispatchEvent(new CustomEvent('admin:needPassword'))
  })
}

/** 用户输入密码后调用 */
export function submitPassword(password) {
  if (passwordResolve) {
    passwordResolve(password || '')
    passwordResolve = null
  }
  if (password) setPassword(password)
}
