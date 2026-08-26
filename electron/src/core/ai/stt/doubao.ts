/**
 * 字节火山 豆包流式语音识别模型 2.0 STT Provider
 * - 走 WebSocket nostream 模式：wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream
 * - 自定义二进制帧：4B header + 4B payload size（大端）+ gzip(JSON 或 音频)
 * - nostream 模式：一次性发完整段音频 → 服务端一次性返回识别结果
 * - **WebSocket 客户端用手写的 net+TLS 实现**（不依赖 ws 包，Node 20 默认无 WebSocket 全局）
 */
import { apiConfig } from '../../api-config'
import { Buffer } from 'node:buffer'
import * as net from 'node:net'
import * as tls from 'node:tls'
import * as crypto from 'node:crypto'
import type { AudioMeta, SttProvider, SttResult } from './base'

// ----- 二进制帧字段常量 -----
const VERSION = 0b0001
const HEADER_SIZE = 0b0001
const MSG_FULL_REQ = 0b0001
const MSG_AUDIO_ONLY = 0b0010
const FLAG_NO_SEQ = 0b0000
const FLAG_POSITIVE_SEQ = 0b0001
const FLAG_LAST_NO_SEQ = 0b0010
const SER_NONE = 0b0000
const SER_JSON = 0b0001
const CMP_GZIP = 0b0001

const HOST = 'openspeech.bytedance.com'
const PORT = 443
const PATH = '/api/v3/sauc/bigmodel_nostream'

function uuid(): string {
  const b = new Uint8Array(16)
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const { gzipSync, gunzipSync } = require('node:zlib') as typeof import('node:zlib')

function buildHeader(msgType: number, flags: number, serialization: number, compression: number): Buffer {
  const b0 = ((VERSION & 0x0f) << 4) | (HEADER_SIZE & 0x0f)
  const b1 = ((msgType & 0x0f) << 4) | (flags & 0x0f)
  const b2 = ((serialization & 0x0f) << 4) | (compression & 0x0f)
  const b3 = 0x00
  return Buffer.from([b0, b1, b2, b3])
}

function buildFullRequest(payload: object): Buffer {
  const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf-8')
  const gz = gzipSync(jsonBuf)
  const header = buildHeader(MSG_FULL_REQ, FLAG_NO_SEQ, SER_JSON, CMP_GZIP)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(gz.length, 0)
  return Buffer.concat([header, size, gz])
}

function buildAudioChunk(pcm: Buffer, seq: number, isLast: boolean): Buffer {
  const gz = gzipSync(pcm)
  const flags = isLast ? FLAG_LAST_NO_SEQ : FLAG_POSITIVE_SEQ
  const header = buildHeader(MSG_AUDIO_ONLY, flags, SER_NONE, CMP_GZIP)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(gz.length, 0)
  if (isLast) {
    return Buffer.concat([header, size, gz])
  } else {
    const seqBuf = Buffer.alloc(4)
    seqBuf.writeInt32BE(seq, 0)
    return Buffer.concat([header, size, seqBuf, gz])
  }
}

function parseServerFrame(buf: Buffer): { isError: boolean; code?: number; msg?: string; payload: Buffer } {
  if (buf.length < 8) return { isError: false, payload: Buffer.alloc(0) }
  const msgType = (buf[1] >> 4) & 0x0f
  const size = buf.readUInt32BE(4)
  if (msgType === 0b1111) {
    if (buf.length < 16) return { isError: true, payload: Buffer.alloc(0) }
    const code = buf.readUInt32BE(8)
    const msgSize = buf.readUInt32BE(12)
    const msg = buf.toString('utf-8', 16, 16 + Math.min(msgSize, buf.length - 16))
    return { isError: true, code, msg, payload: Buffer.alloc(0) }
  }
  const payload = buf.slice(8, 8 + Math.min(size, buf.length - 8))
  return { isError: false, payload }
}

// ===== 最小 WebSocket 客户端（裸 TCP/TLS + 手写 frame）=====
// 为什么不用 ws：依赖装不上，sandbox 装不了 npm 包。
// WebSocket 协议很简单：HTTP Upgrade 之后是二进制帧（FIN/len/mask/payload）。
// 服务端（火山）只发服务端帧（mask=0），客户端发客户端帧（mask=1）。

class MiniWebSocket {
  private socket: net.Socket | tls.TLSSocket | null = null
  private buffer: Buffer = Buffer.alloc(0)
  private resolveOpen: (() => void) | null = null
  private rejectOpen: ((e: Error) => void) | null = null
  private messageHandlers: Array<(data: Buffer) => void> = []
  private closeHandlers: Array<(code: number, reason: string) => void> = []
  private errorHandlers: Array<(e: Error) => void> = []
  private opened = false
  private closed = false

  constructor(private url: string, private headers: Record<string, string>) {}

  async connect(): Promise<void> {
    const u = new URL(this.url)
    const isSecure = u.protocol === 'wss:'
    const port = u.port ? parseInt(u.port) : (isSecure ? 443 : 80)
    const path = u.pathname + u.search

    return new Promise((resolve, reject) => {
      this.resolveOpen = resolve
      this.rejectOpen = reject

    const opts: net.NetConnectOpts = { host: u.hostname, port }
    if (isSecure) {
        this.socket = tls.connect({ ...opts, servername: u.hostname }, () => {
          this.onOpen()
        })
      } else {
        this.socket = net.connect(opts, () => this.onOpen())
      }
      this.socket.on('data', (chunk) => this.onData(chunk))
      this.socket.on('error', (e) => this.handleError(e))
      this.socket.on('close', () => this.handleClose())
      this.socket.setNoDelay(true)
    })
  }

  private onOpen() {
    // 发送 HTTP Upgrade 请求
    const req =
      `GET ${new URL(this.url).pathname || '/'} HTTP/1.1\r\n` +
      `Host: ${this.url.includes('wss://') ? this.url.split('wss://')[1].split('/')[0] : this.url.split('ws://')[1].split('/')[0]}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n` +
      `Sec-WebSocket-Version: 13\r\n` +
      Object.entries(this.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n' +
      '\r\n'
    this.socket!.write(req)
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])

    if (!this.opened) {
      // 解析 HTTP Upgrade 响应
      const idx = this.buffer.indexOf('\r\n\r\n')
      if (idx < 0) return
      const head = this.buffer.subarray(0, idx).toString('ascii')
      this.buffer = this.buffer.subarray(idx + 4)
      if (!/^HTTP\/1\.1 101/.test(head)) {
        const err = new Error('WebSocket 升级失败: ' + head.split('\r\n')[0])
        this.handleError(err)
        return
      }
      this.opened = true
      const r = this.resolveOpen
      this.resolveOpen = null
      this.rejectOpen = null
      r?.()
    }

    // 解析 WebSocket frames
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0]
      const b1 = this.buffer[1]
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let len = b1 & 0x7f
      let offset = 2
      if (len === 126) {
        if (this.buffer.length < 4) return
        len = this.buffer.readUInt16BE(2)
        offset = 4
      } else if (len === 127) {
        if (this.buffer.length < 10) return
        const hi = this.buffer.readUInt32BE(2)
        const lo = this.buffer.readUInt32BE(6)
        len = hi * 0x100000000 + lo
        offset = 10
      }
      if (this.buffer.length < offset + len) return
      const payload = this.buffer.subarray(offset, offset + len)
      this.buffer = this.buffer.subarray(offset + len)

      if (opcode === 0x1 || opcode === 0x2) {
        this.messageHandlers.forEach((h) => h(payload))
      } else if (opcode === 0x8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf-8') : ''
        this.closeHandlers.forEach((h) => h(code, reason))
        this.closed = true
        try { this.socket?.end() } catch (_) {}
      }
    }
  }

  private handleError(e: Error) {
    if (!this.opened) {
      const r = this.rejectOpen
      this.resolveOpen = null
      this.rejectOpen = null
      r?.(e)
    }
    this.errorHandlers.forEach((h) => h(e))
  }

  private handleClose() {
    if (this.closed) return
    this.closed = true
    this.closeHandlers.forEach((h) => h(1006, 'connection closed'))
  }

  onMessage(fn: (data: Buffer) => void) { this.messageHandlers.push(fn) }
  addCloseHandler(fn: (code: number, reason: string) => void) { this.closeHandlers.push(fn) }
  addErrorHandler(fn: (e: Error) => void) { this.errorHandlers.push(fn) }

  send(data: Buffer) {
    if (!this.socket || this.closed) throw new Error('WebSocket 未连接')
    const len = data.length
    let header: Buffer
    if (len < 126) {
      header = Buffer.alloc(2)
      header[0] = 0x82  // FIN=1, opcode=2 (binary)
      header[1] = 0x80 | len  // MASK=1, len
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x82
      header[1] = 0x80 | 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x82
      header[1] = 0x80 | 127
      header.writeUInt32BE(Math.floor(len / 0x100000000), 2)
      header.writeUInt32BE(len & 0xffffffff, 6)
    }
    const mask = crypto.randomBytes(4)
    const masked = Buffer.alloc(len)
    for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4]
    this.socket.write(Buffer.concat([header, mask, masked]))
  }

  close(code = 1000, reason = '') {
    if (this.closed) return
    this.closed = true
    const buf = Buffer.alloc(2 + Buffer.byteLength(reason))
    buf.writeUInt16BE(code, 0)
    buf.write(reason, 2)
    try { this.send(buf) } catch (_) {}
    try { this.socket?.end() } catch (_) {}
  }
}

// ===== Provider =====
export class DoubaoProvider implements SttProvider {
  readonly name = 'doubao'

  isConfigured(): boolean {
    return !!apiConfig.sttApiKey.trim()
  }

  async transcribe(audioBase64: string, meta: AudioMeta): Promise<SttResult> {
    if (!this.isConfigured()) {
      throw new Error('字节豆包未配置：请在设置页填入 App Key（X-Api-Key）。火山控制台：https://console.volcengine.com/speech/new/setting/apikeys')
    }
    const appKey = apiConfig.sttApiKey.trim()
    const baseUrl = (apiConfig.sttBaseUrl || '').toLowerCase()
    const resourceId = baseUrl.includes('concurrent')
      ? 'volc.seedasr.sauc.concurrent'
      : 'volc.seedasr.sauc.duration'

    const mime = (meta.mimeType || '').toLowerCase()
    if (!mime.includes('pcm') && !mime.includes('s16le') && !mime.includes('l16') && !mime.includes('octet-stream')) {
      throw new Error('豆包 WebSocket 流式识别需要 PCM s16le 16kHz mono 音频。前端会通过 Web Audio API 自动解码重采样，但收到意外的 mime=' + mime)
    }
    const pcm = Buffer.from(audioBase64, 'base64')

    return new Promise<SttResult>((resolve, reject) => {
      const t0 = Date.now()
      const ws = new MiniWebSocket(`wss://${HOST}${PATH}`, {
        'X-Api-Key': appKey,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Request-Id': uuid(),
        'X-Api-Sequence': '-1',
      })

      let fullText = ''
      let finished = false
      let seq = 1

      const finishOk = () => {
        if (finished) return
        finished = true
        try { ws.close() } catch (_) {}
        resolve({ text: fullText, durationMs: Date.now() - t0 })
      }
      const finishErr = (msg: string) => {
        if (finished) return
        finished = true
        try { ws.close() } catch (_) {}
        reject(new Error(msg))
      }

      ws.onMessage((data) => {
        try {
          const { isError, msg, payload } = parseServerFrame(data)
          if (isError) return finishErr('豆包 ASR 错误：' + (msg || '未知'))
          if (payload.length === 0) return
          let jsonText: string
          try { jsonText = gunzipSync(payload).toString('utf-8') } catch { jsonText = payload.toString('utf-8') }
          let resp: any
          try { resp = JSON.parse(jsonText) } catch { return }
          const utterances: any[] = resp?.result?.utterances || []
          if (typeof resp?.result?.latest_text === 'string') {
            fullText = resp.result.latest_text
          }
          const last = utterances[utterances.length - 1]
          if (last?.definite === true) {
            fullText = utterances.map((u: any) => u.text || '').join('')
            return finishOk()
          }
        } catch (e: any) {
          console.warn('[doubao] 解析响应失败:', e?.message)
        }
      })

      ws.addErrorHandler((e) => finishErr('WebSocket 错误：' + (e?.message || '未知')))
      ws.addCloseHandler((code, reason) => {
        if (!finished) {
          if (fullText.trim()) finishOk()
          else finishErr(`WebSocket 关闭 (code=${code}${reason ? ', reason=' + reason : ''})`)
        }
      })

      ws.connect().then(() => {
        // 1. 发送 full client request
        const fullReq = buildFullRequest({
          user: { uid: 'sspoffer-desktop', platform: 'Electron', sdk_version: '1.0.0', app_version: '0.1.0' },
          audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1, language: 'zh-CN' },
          request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, enable_ddc: false, enable_nonstream: true },
        })
        ws.send(fullReq)
        // 2. 分片发送音频：每片 ~200ms = 16000 Hz × 2 bytes × 0.2s = 6400 字节
        const FRAME_BYTES = 6400
        for (let off = 0; off < pcm.length; off += FRAME_BYTES) {
          const chunk = pcm.slice(off, Math.min(off + FRAME_BYTES, pcm.length))
          const isLast = off + chunk.length >= pcm.length
          ws.send(buildAudioChunk(chunk, seq, isLast))
          seq += 1
        }
      }).catch((e) => finishErr('连接失败：' + (e?.message || '未知')))

      // 30 秒兜底超时
      setTimeout(() => {
        if (!finished) {
          if (fullText.trim()) finishOk()
          else finishErr('豆包 ASR 30 秒内未返回结果')
        }
      }, 30000)
    })
  }
}
