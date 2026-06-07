export function buildFilename(type: string, year: number, month?: number): string {
  const suffix = month !== undefined ? `${year}${String(month).padStart(2, "0")}` : `${year}`;
  return `finance_${type}_${suffix}`;
}

export async function captureAsImage(element: HTMLElement, filename: string): Promise<void> {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });
  const link = document.createElement("a");
  link.download = `${filename}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export async function captureAsPDF(element: HTMLElement, filename: string): Promise<void> {
  const { default: html2canvas } = await import("html2canvas");
  const { jsPDF } = await import("jspdf");

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgH = (canvas.height * pageW) / canvas.width;

  if (imgH <= pageH) {
    pdf.addImage(imgData, "PNG", 0, 0, pageW, imgH);
  } else {
    let yOffset = 0;
    let remaining = imgH;
    while (remaining > 0) {
      pdf.addImage(imgData, "PNG", 0, yOffset, pageW, imgH);
      remaining -= pageH;
      yOffset -= pageH;
      if (remaining > 0) pdf.addPage();
    }
  }

  pdf.save(`${filename}.pdf`);
}
