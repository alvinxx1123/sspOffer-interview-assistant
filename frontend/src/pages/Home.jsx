import { Link } from 'react-router-dom'
import './Home.css'

const features = [
  { path: '/interviews', title: '面经搜索', desc: '按公司、部门检索整合的面经，支持多平台数据统一查看' },
  { path: '/ai-interview', title: 'AI 面试模拟', desc: '根据目标公司/部门面经，结合你的简历生成深挖问题' },
  { path: '/replay', title: '面试复盘', desc: '上传真实面经，AI 进行深度复盘分析，给出改进建议' },
  { path: '/ide', title: '在线 IDE', desc: '支持 Java、Python、Go 等 ACM 模式运行' },
]

export default function Home() {
  return (
    <div className="home">
      <header className="hero">
        <img src="/logo.png" alt="sspOffer" className="hero-logo" />
        <h1>sspOffer面经助手</h1>
        <p className="hero-sub">互联网后端面试准备平台 · 面经整合 · AI 模拟 · 深度复盘 · 在线刷题</p>
      </header>
      <section className="features">
        {features.map((f) => (
          <Link key={f.path} to={f.path} className="feature-card">
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
            <span className="arrow">→</span>
          </Link>
        ))}
      </section>
    </div>
  )
}
