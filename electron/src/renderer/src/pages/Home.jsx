import { Link } from 'react-router-dom'
import { FileText, Target, MagnifyingGlass, Robot, Code, ChartLineUp, ArrowRight } from '@phosphor-icons/react'
import './Home.css'

const phases = [
  {
    label: '阶段一',
    title: '梳理个人素材',
    hint: '先把简历和经历整理成可被 AI 深挖的结构化素材',
    features: [
      { path: '/resumes', icon: FileText, title: '简历 + 投递', desc: '多版本简历预览/下载，追踪每家公司的投递渠道、状态与时间线' },
      { path: '/mastery', icon: Target, title: '实习经历掌握度', desc: '录入实习/项目，AI 拆解掌握度步骤、识别项目骨架，辅助 STAR 讲述' },
    ],
  },
  {
    label: '阶段二',
    title: '研读面经情报',
    hint: '检索目标公司的真实面经，摸清考察重点',
    features: [
      { path: '/interviews', icon: MagnifyingGlass, title: '面经搜索', desc: '按公司/部门检索整合面经，支持上传文字/图片面经 RAG 入库，关联八股与算法题' },
    ],
  },
  {
    label: '阶段三',
    title: '实战模拟',
    hint: 'AI 模拟深挖 + 算法手撕，先练后上',
    features: [
      { path: '/ai-interview', icon: Robot, title: 'AI 面试模拟', desc: '基于目标公司面经 + 你的简历生成深挖问题，给评分、亮点不足与改进，并对比历史' },
      { path: '/ide', icon: Code, title: '在线 IDE', desc: 'Java / Python / Go ACM 模式在线运行，自带题库可增删与难度标注' },
    ],
  },
  {
    label: '阶段四',
    title: '面试复盘',
    hint: '面完后贴回面经，AI 找出不足、沉淀改进点',
    features: [
      { path: '/replay', icon: ChartLineUp, title: '面试复盘', desc: '录入面经原文，AI 分析考察侧重点与难易度，给针对性准备建议' },
    ],
  },
]

export default function Home() {
  return (
    <div className="home">
      <div className="home-hero">
        <h1 className="home-title">sspOffer <span className="home-subtitle">面经助手</span></h1>
        <p className="home-desc">从简历投递到 AI 模拟面试，全流程搞定后端面试准备。</p>
      </div>

      {phases.map((phase, i) => (
        <section key={i} className="phase-section">
          <div className="phase-header">
            <span className="phase-badge">{phase.label}</span>
            <h2 className="phase-title">{phase.title}</h2>
          </div>
          <p className="phase-hint">{phase.hint}</p>
          <div className="feature-grid">
            {phase.features.map((f) => {
              const Icon = f.icon
              return (
                <Link key={f.path} to={f.path} className="feature-card">
                  <div className="feature-icon-wrap">
                    <Icon size={24} weight="duotone" className="feature-icon" />
                  </div>
                  <div className="feature-body">
                    <h3 className="feature-title">{f.title}</h3>
                    <p className="feature-desc">{f.desc}</p>
                  </div>
                  <ArrowRight size={18} weight="bold" className="feature-arrow" />
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
