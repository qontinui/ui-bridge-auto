/**
 * Minimal type declarations for tesseract.js (optional peer dependency).
 * Only declares the parts we use — createWorker and recognition result types.
 */
declare module "tesseract.js" {
  interface Word {
    text: string;
    confidence: number;
    bbox: {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    };
  }

  interface RecognizeResult {
    data: {
      text: string;
      words: Word[];
    };
  }

  interface Worker {
    recognize(image: string): Promise<RecognizeResult>;
    terminate(): Promise<void>;
  }

  export function createWorker(lang: string): Promise<Worker>;
}
