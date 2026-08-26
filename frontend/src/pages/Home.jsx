import { Link } from 'react-router-dom'
import './Home.css'

const phases = [
  {
    label: '阶段一',
    title: '梳理个人素材',
    hint: '先把简历和经历整理成可被 AI 深挖的结构化素材',
    features: [
      {
        path: '/resumes', icon: '📄', title: '简历 + 投递',
        desc: '多版本简历预览/下载，追踪每家公司的投递渠道、状态与时间线',
      },
      {
        path: '/mastery', icon: '🎯', title: '实习经历掌握度',
        desc: '录入实习/项目，AI 拆解掌握度步骤、识别项目骨架，辅助 STAR 讲述',
      },
    ],
  },
  {
    label: '阶段二',
    title: '研读面经情报',
    hint: '检索目标公司的真实面经，摸清考察重点',
    features: [
      {
        path: '/interviews', icon: '🔍', title: '面经搜索',
        desc: '按公司/部门检索整合面经，支持上传文字/图片面经 RAG 入库，关联八股与算法题',
      },
    ],
  },
  {
    label: '阶段三',
    title: '实战模拟',
    hint: 'AI 模拟深挖 + 算法手撕，先练后上',
    features: [
      {
        path: '/ai-interview', icon: '🤖', title: 'AI 面试模拟',
        desc: '基于目标公司面经 + 你的简历生成深挖问题，给评分、亮点不足与改进，并对比历史',
      },
      {
        path: '/ide', icon: '💻', title: '在线 IDE',
        desc: 'Java / Python / Go ACM 模式在线运行，自带题库可增删与难度标注',
      },
    ],
  },
  {
    label: '阶段四',
    title: '面试复盘',
    hint: '面完后贴回面经，AI 找出不足、沉淀改进点',
    features: [
      {
        path: '/replay', icon: '🔁', title: '面试复盘',
        desc: '粘贴真实面经（问题或问答），AI 侧重点分析 + 回答评估，给出改进建议并保存',
      },
    ],
  },
]

export default function Home() {
  return (
    <div className="home">
      <header className="hero">
        <img src="/logo.png" alt="sspOffer" className="hero-logo" />
        <h1>sspOffer 面经助手</h1>
        <p className="hero-sub">
          互联网后端面试准备平台 · 简历投递 · 经历掌握度 · 面经情报 · AI 模拟 · 深度复盘 · 在线刷题
        </p>
      </header>

      {phases.map((phase, pi) => (
        <section key={phase.label} className="phase" style={{ animationDelay: `${0.1 * pi}s` }}>
          <div className="phase-head">
            <span className="phase-label">{phase.label}</span>
            <div className="phase-title-wrap">
              <h2 className="phase-title">{phase.title}</h2>
              <p className="phase-hint">{phase.hint}</p>
            </div>
          </div>
          <div className="features">
            {phase.features.map((f, fi) => (
              <Link
                key={f.path}
                to={f.path}
                className="feature-card"
                style={{ animationDelay: `${0.1 * pi + 0.05 * fi}s` }}
              >
                <div className="feature-top">
                  <span className="feature-icon">{f.icon}</span>
                  <span className="arrow">→</span>
                </div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <footer className="home-footer">
        <Link to="/settings" className="settings-link">⚙️ 模型与 RAG 配置</Link>
        <span className="home-tip">提示：按阶段顺序使用，效果最佳 · 面经/简历/经历会跨模块联动</span>
      </footer>
    </div>
  )
}
