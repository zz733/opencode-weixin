declare module "qrcode" {
  interface QRCodeOptions {
    type?: "terminal" | "svg" | "utf8"
    small?: boolean
    errorCorrectionLevel?: "L" | "M" | "Q" | "H"
    margin?: number
    width?: number
    color?: {
      dark?: string
      light?: string
    }
  }

  function toString(text: string, options?: QRCodeOptions): Promise<string>
  function toDataURL(text: string, options?: QRCodeOptions): Promise<string>
  function toBuffer(text: string, options?: QRCodeOptions): Promise<Buffer>

  export default {
    toString,
    toDataURL,
    toBuffer,
  }
}
