export interface PdfCropSession {
  uploadId: string;
  ownerId: string;
  filename: string;
  tempFileKey: string;
  pageCount: number;
  pages: PdfPageInfo[];
  createdAt: string;
}

export interface PdfPageInfo {
  pageNumber: number;
  width: number;
  height: number;
}

export interface PdfCropSessionStore {
  save(session: PdfCropSession): Promise<void>;
  findById(uploadId: string): Promise<PdfCropSession | null>;
  delete(uploadId: string): Promise<void>;
}

export interface PdfCropRenderer {
  /**
   * Renders a cropped region of a PDF page as PNG.
   * x, y, width, height are in PDF points (as returned by the page extractor).
   */
  renderCrop(input: {
    pdfData: Uint8Array;
    pageNumber: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<Uint8Array>;
}

export interface PdfPageExtractor {
  extract(pdfData: Uint8Array): Promise<{
    pageCount: number;
    pages: PdfPageInfo[];
  }>;
}
