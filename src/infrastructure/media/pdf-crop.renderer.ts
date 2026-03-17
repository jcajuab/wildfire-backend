import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type PdfCropRenderer } from "#/application/ports/pdf-crop";

const DEFAULT_DPI = 150;

export class PdftoppmCropRenderer implements PdfCropRenderer {
  constructor(private readonly dpi: number = DEFAULT_DPI) {}

  async renderCrop(input: {
    pdfData: Uint8Array;
    pageNumber: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<Uint8Array> {
    const id = randomUUID();
    const sourcePath = join("/tmp", `wildfire-pdf-crop-${id}.pdf`);
    const outputPathPrefix = join("/tmp", `wildfire-pdf-crop-out-${id}`);
    const outputPath = `${outputPathPrefix}.png`;

    await writeFile(sourcePath, input.pdfData);

    try {
      // pdftoppm uses PDF points for crop coordinates.
      // -x, -y: top-left corner offset in pixels at target DPI
      // -W, -H: crop width/height in pixels at target DPI
      // PDF points to pixels: pixels = points * dpi / 72
      const scale = this.dpi / 72;
      const xPx = Math.round(input.x * scale);
      const yPx = Math.round(input.y * scale);
      const wPx = Math.round(input.width * scale);
      const hPx = Math.round(input.height * scale);

      const args = [
        "-f",
        String(input.pageNumber),
        "-l",
        String(input.pageNumber),
        "-singlefile",
        "-png",
        "-r",
        String(this.dpi),
        "-x",
        String(xPx),
        "-y",
        String(yPx),
        "-W",
        String(wPx),
        "-H",
        String(hPx),
        sourcePath,
        outputPathPrefix,
      ];

      await new Promise<void>((resolve, reject) => {
        const proc = spawn("pdftoppm", args);
        proc.once("error", reject);
        proc.once("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`pdftoppm exited with code ${String(code)}`));
          }
        });
      });

      const result = await readFile(outputPath);
      return new Uint8Array(result);
    } finally {
      await unlink(sourcePath).catch(() => undefined);
      await unlink(outputPath).catch(() => undefined);
    }
  }
}
