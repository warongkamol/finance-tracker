export function buildFilename(type: string, year: number, month?: number): string {
  const suffix = month !== undefined ? `${year}${String(month).padStart(2, "0")}` : `${year}`;
  return `finance_${type}_${suffix}`;
}

export async function captureAsImage(element: HTMLElement, filename: string): Promise<void> {
  const { domToBlob } = await import("modern-screenshot");
  const blob = await domToBlob(element, {
    scale: 2,
    backgroundColor: "#ffffff",
  });
  if (!blob) throw new Error("captureAsImage: domToBlob returned null");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `${filename}.png`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export async function captureAsPDF(element: HTMLElement, filename: string): Promise<void> {
  const { domToCanvas } = await import("modern-screenshot");
  const { jsPDF } = await import("jspdf");

  const canvas = await domToCanvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
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
