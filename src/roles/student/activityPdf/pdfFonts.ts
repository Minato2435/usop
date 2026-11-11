import { Font } from '@react-pdf/renderer'
// Inter — the clean, highly legible sans used across clinical / hospital
// documents. Self-hosted from @fontsource (.woff via Vite `?url`), so the PDF
// never calls a CDN. (.woff, not .woff2: fontkit handles these reliably.)
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff?url'
import inter400i from '@fontsource/inter/files/inter-latin-400-italic.woff?url'
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff?url'
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff?url'
import inter600i from '@fontsource/inter/files/inter-latin-600-italic.woff?url'
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff?url'
import inter700i from '@fontsource/inter/files/inter-latin-700-italic.woff?url'
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff?url'

let registered = false

export function registerPdfFonts() {
  if (registered) return
  registered = true
  Font.register({
    family: 'Inter',
    fonts: [
      { src: inter400 },
      { src: inter400i, fontStyle: 'italic' },
      { src: inter500, fontWeight: 500 },
      { src: inter600, fontWeight: 600 },
      { src: inter600i, fontWeight: 600, fontStyle: 'italic' },
      { src: inter700, fontWeight: 700 },
      { src: inter700i, fontWeight: 700, fontStyle: 'italic' },
      { src: inter800, fontWeight: 800 },
    ],
  })
  // Never break words with hyphens — names and medical terms read badly split.
  Font.registerHyphenationCallback((word) => [word])
}
