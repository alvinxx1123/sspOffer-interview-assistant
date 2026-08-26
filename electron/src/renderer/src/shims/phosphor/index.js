// phosphor-icons shim: 通用 fallback
import * as React from 'react'

const Fallback = React.forwardRef(function Fallback(props, ref) {
  return React.createElement('span', { ...props, ref, 'data-icon-shim': 'true' }, '⚙')
})
Fallback.displayName = 'PhosphorIconShim'

// 显式导出常用图标
export const House = Fallback
export const FileText = Fallback
export const Target = Fallback
export const MagnifyingGlass = Fallback
export const Robot = Fallback
export const ChartLineUp = Fallback
export const Code = Fallback
export const Gear = Fallback
export const Sun = Fallback
export const Moon = Fallback
export const ArrowRight = Fallback
export const X = Fallback
export const Plus = Fallback
export const Check = Fallback
export const Trash = Fallback
export const Pencil = Fallback
export const User = Fallback
export const Users = Fallback
export const Buildings = Fallback
export const CaretDown = Fallback
export const CaretUp = Fallback
export const CaretRight = Fallback
export const CaretLeft = Fallback
export const Calendar = Fallback
export const Clock = Fallback
export const Envelope = Fallback
export const Phone = Fallback
export const ChatCircle = Fallback
export const Heart = Fallback
export const Star = Fallback
export const BookmarkSimple = Fallback
export const Download = Fallback
export const Upload = Fallback
export const Eye = Fallback
export const EyeSlash = Fallback
export const Lock = Fallback
export const LockKey = Fallback
export const SignIn = Fallback
export const SignOut = Fallback
export const MagnifyingGlassPlus = Fallback
export const Funnel = Fallback
export const Export = Fallback
export const Copy = Fallback
export const ArrowsClockwise = Fallback
export const ArrowsCounterClockwise = Fallback
export const Warning = Fallback
export const CheckCircle = Fallback
export const XCircle = Fallback
export const Info = Fallback
export const Question = Fallback
export const PlusCircle = Fallback
export const MinusCircle = Fallback

// Proxy fallback for any other named export
const handler = {
  get(_, name) {
    if (name === 'default') return proxy
    if (name === 'Icon') return Fallback
    if (name === 'displayName') return undefined
    if (name === '__esModule') return true
    if (typeof name === 'symbol') return undefined
    return Fallback
  },
}
const proxy = new Proxy(function() {}, handler)

export default proxy
