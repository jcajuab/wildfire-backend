import { PDFDocument } from "pdf-lib";
import {
  type PdfPageExtractor,
  type PdfPageInfo,
} from "#/application/ports/pdf-crop";

export class PdfLibPageExtractor implements PdfPageExtractor {
  async extract(pdfData: Uint8Array): Promise<{
    pageCount: number;
    pages: PdfPageInfo[];
  }> {
    const doc = await PDFDocument.load(pdfData, { ignoreEncryption: true });
    const pages = doc.getPages();

    const pageInfos: PdfPageInfo[] = pages.map((page, index) => {
      const { width, height } = page.getSize();
      return {
        pageNumber: index + 1,
        width: Math.round(width),
        height: Math.round(height),
      };
    });

    return {
      pageCount: pages.length,
      pages: pageInfos,
    };
  }
}
