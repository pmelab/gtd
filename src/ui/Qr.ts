import qrcodeTerminal from "qrcode-terminal"

/**
 * Renders a URL as a terminal-printable ASCII QR code. `qrcode-terminal`'s
 * `generate` invokes its callback synchronously (no I/O), so this can stay a
 * plain synchronous function.
 */
export const renderQrCode = (url: string): string => {
  let output = ""
  qrcodeTerminal.generate(url, { small: true }, (qr) => {
    output = qr
  })
  return output
}
