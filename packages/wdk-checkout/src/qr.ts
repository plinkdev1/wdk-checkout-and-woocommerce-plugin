// qrcode-generator is a tiny, dependency-free, browser-safe QR encoder.
// We declare the minimal surface we use rather than relying on its types.
import qrcode from 'qrcode-generator'

interface QrModel {
  addData (data: string): void
  make (): void
  createDataURL (cellSize?: number, margin?: number): string
}
type QrFactory = (typeNumber: number, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H') => QrModel

/** Returns a PNG data URL encoding `text` as a QR code. */
export function qrDataUrl (text: string, cellSize = 5, margin = 4): string {
  const make = qrcode as unknown as QrFactory
  const model = make(0, 'M')
  model.addData(text)
  model.make()
  return model.createDataURL(cellSize, margin)
}
