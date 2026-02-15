import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import InterviewSearch from './pages/InterviewSearch'
import AIInterview from './pages/AIInterview'
import Replay from './pages/Replay'
import OnlineIDE from './pages/OnlineIDE'
import Resumes from './pages/Resumes'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="resumes" element={<Resumes />} />
        <Route path="interviews" element={<InterviewSearch />} />
        <Route path="ai-interview" element={<AIInterview />} />
        <Route path="replay" element={<Replay />} />
        <Route path="ide" element={<OnlineIDE />} />
      </Route>
    </Routes>
  )
}

export default App
