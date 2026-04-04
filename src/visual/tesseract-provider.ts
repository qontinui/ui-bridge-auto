/**
 * Tesseract.js OCR Provider
 *
 * Implements {@link IOCRProvider} using Tesseract.js for browser-side
 * optical character recognition. Extracts text from canvas, image, video,
 * and SVG element screenshots captured by the UI Bridge SDK.
 *
 * **Requires `tesseract.js` as an optional peer dependency.**
 * Install it separately: `npm install tesseract.js`
 *
 * @example
 * ```ts
 * const provider = new TesseractOCRProvider({ language: 'eng' });
 *
 * const text = await provider.extractText(base64Data, 800, 600);
 * console.log(text);
 *
 * // Clean up when done
 * await provider.dispose();
 * ```
 */

import type { IOCRProvider, TextRegion } from "./types";
import type { Worker as TesseractWorker } from "tesseract.js";

// ---------------------------------------------------------------------------
// TesseractOCRProvider
// ---------------------------------------------------------------------------

/** Options for configuring the Tesseract OCR provider. */
export interface TesseractProviderOptions {
  /** OCR language code (e.g., 'eng', 'fra', 'deu'). Default: 'eng'. */
  language?: string;
}

/**
 * OCR provider backed by Tesseract.js.
 *
 * Uses dynamic `import()` to load Tesseract.js at runtime, so the package
 * is not required at build time. Consumers must install `tesseract.js`
 * as a peer dependency.
 *
 * The worker is lazily initialized on the first `extractText` or
 * `getTextRegions` call. Call {@link dispose} to terminate the worker
 * and free resources.
 */
export class TesseractOCRProvider implements IOCRProvider {
  private worker: TesseractWorker | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly language: string;

  constructor(options?: TesseractProviderOptions) {
    this.language = options?.language ?? "eng";
  }

  /**
   * Initialize the Tesseract.js worker.
   *
   * Called automatically on first use. Can be called explicitly to
   * pre-warm the worker before the first recognition request.
   */
  async initialize(): Promise<void> {
    if (this.worker) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const tesseract = await import("tesseract.js");
        this.worker = await tesseract.createWorker(this.language);
      } catch (e: unknown) {
        this.initPromise = null;
        throw new Error(
          `Failed to initialize Tesseract.js. Is it installed? npm install tesseract.js — ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    })();

    return this.initPromise;
  }

  /**
   * Extract all text from a base64-encoded image.
   *
   * @param imageData - Base64-encoded PNG image data (no data URL prefix).
   * @param _width - Image width (unused, Tesseract reads from image).
   * @param _height - Image height (unused, Tesseract reads from image).
   * @returns The extracted text content.
   */
  async extractText(imageData: string, _width: number, _height: number): Promise<string> {
    await this.initialize();
    const result = await this.worker!.recognize(`data:image/png;base64,${imageData}`);
    return result.data.text.trim();
  }

  /**
   * Extract text regions with bounding boxes and confidence scores.
   *
   * @param imageData - Base64-encoded PNG image data (no data URL prefix).
   * @param _width - Image width (unused, Tesseract reads from image).
   * @param _height - Image height (unused, Tesseract reads from image).
   * @returns Array of text regions with location and confidence.
   */
  async getTextRegions(imageData: string, _width: number, _height: number): Promise<TextRegion[]> {
    await this.initialize();
    const result = await this.worker!.recognize(`data:image/png;base64,${imageData}`);

    return result.data.words.map((word) => ({
      text: word.text,
      x: word.bbox.x0,
      y: word.bbox.y0,
      width: word.bbox.x1 - word.bbox.x0,
      height: word.bbox.y1 - word.bbox.y0,
      confidence: word.confidence / 100, // Tesseract returns 0-100, we use 0-1
    }));
  }

  /**
   * Terminate the Tesseract.js worker and free resources.
   *
   * After calling dispose, the provider can still be used — the worker
   * will be re-initialized on the next call.
   */
  async dispose(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initPromise = null;
    }
  }
}
