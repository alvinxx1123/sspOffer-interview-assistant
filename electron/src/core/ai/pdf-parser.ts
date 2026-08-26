// PDF 文本提取 — 对标 Java PDFBox PDFTextStripper
// 使用 pdf-parse v1 (纯 JS, 无原生依赖)

export async function parsePdf(buffer: Buffer): Promise<{ text: string; numpages?: number }> {
  // pdf-parse v1 默认导出为函数,直接调用
  const pdfParse = require('pdf-parse')
  const data = await pdfParse(buffer)
  return {
    text: data?.text || '',
    numpages: data?.numpages,
  }
}
