// Renders an on-screen element (the issued certificate) to a high-resolution
// image and saves it as a single-page A4 PDF. Both libraries are loaded on
// demand so they never weigh down the normal app bundle.
export async function downloadElementAsPdf(element: HTMLElement, fileName: string, title: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')])

  // Fonts (Cormorant / Lora / Plex Mono) must be ready or the capture falls
  // back to system fonts.
  await document.fonts.ready

  const canvas = await html2canvas(element, {
    scale: 2.5,
    backgroundColor: '#FFFEFA',
    useCORS: true,
    // Lay the copy out at desktop width so the certificate keeps its full
    // design even when downloaded from a phone.
    windowWidth: 1280,
    onclone: (_doc, clone) => {
      clone.style.animation = 'none'
      clone.style.opacity = '1'
      clone.style.transform = 'none'
      clone.style.width = '860px'
      clone.style.maxWidth = '860px'
      clone.style.boxShadow = 'none'
    },
  })

  const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 10
  const ratio = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height)
  const w = canvas.width * ratio
  const h = canvas.height * ratio

  // Warm paper behind the certificate so the margins don't read as stark white.
  pdf.setFillColor(233, 229, 216)
  pdf.rect(0, 0, pageW, pageH, 'F')
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (pageW - w) / 2, (pageH - h) / 2, w, h)
  pdf.setProperties({ title, subject: 'USOP Certificate of Skill Completion', creator: 'USOP' })
  pdf.save(fileName)
}

export function certificateFileName(parts: (string | null | undefined)[]): string {
  const slug = parts
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `USOP-Certificate-${slug || 'download'}.pdf`
}
