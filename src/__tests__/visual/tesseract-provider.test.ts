import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock tesseract.js module
// ---------------------------------------------------------------------------

const mockRecognize = vi.fn();
const mockTerminate = vi.fn();
const mockCreateWorker = vi.fn();

vi.mock("tesseract.js", () => ({
  createWorker: (...args: unknown[]) => mockCreateWorker(...args),
}));

import { TesseractOCRProvider } from "../../visual/tesseract-provider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupMockWorker(text: string, words: Array<{
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}> = []) {
  const worker = {
    recognize: mockRecognize,
    terminate: mockTerminate,
  };
  mockCreateWorker.mockResolvedValue(worker);
  mockRecognize.mockResolvedValue({
    data: { text, words },
  });
  return worker;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TesseractOCRProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialize", () => {
    it("creates a worker with the configured language", async () => {
      setupMockWorker("");
      const provider = new TesseractOCRProvider({ language: "fra" });

      await provider.initialize();

      expect(mockCreateWorker).toHaveBeenCalledWith("fra");
    });

    it("defaults to English language", async () => {
      setupMockWorker("");
      const provider = new TesseractOCRProvider();

      await provider.initialize();

      expect(mockCreateWorker).toHaveBeenCalledWith("eng");
    });

    it("only initializes once across multiple calls", async () => {
      setupMockWorker("");
      const provider = new TesseractOCRProvider();

      await Promise.all([
        provider.initialize(),
        provider.initialize(),
        provider.initialize(),
      ]);

      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });

    it("throws a helpful error when tesseract.js is not installed", async () => {
      mockCreateWorker.mockRejectedValue(new Error("Cannot find module"));
      const provider = new TesseractOCRProvider();

      await expect(provider.initialize()).rejects.toThrow(
        /Failed to initialize Tesseract\.js/,
      );
    });
  });

  describe("extractText", () => {
    it("extracts text from base64 image data", async () => {
      setupMockWorker("Hello World\n");
      const provider = new TesseractOCRProvider();

      const text = await provider.extractText("base64data", 100, 50);

      expect(text).toBe("Hello World");
      expect(mockRecognize).toHaveBeenCalledWith(
        "data:image/png;base64,base64data",
      );
    });

    it("trims whitespace from extracted text", async () => {
      setupMockWorker("  spaced  \n\n");
      const provider = new TesseractOCRProvider();

      const text = await provider.extractText("data", 100, 50);
      expect(text).toBe("spaced");
    });

    it("lazily initializes the worker on first call", async () => {
      setupMockWorker("text");
      const provider = new TesseractOCRProvider();

      expect(mockCreateWorker).not.toHaveBeenCalled();
      await provider.extractText("data", 100, 50);
      expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    });
  });

  describe("getTextRegions", () => {
    it("maps Tesseract words to TextRegion array", async () => {
      setupMockWorker("Hello World", [
        {
          text: "Hello",
          confidence: 95,
          bbox: { x0: 10, y0: 20, x1: 60, y1: 40 },
        },
        {
          text: "World",
          confidence: 88,
          bbox: { x0: 70, y0: 20, x1: 130, y1: 40 },
        },
      ]);
      const provider = new TesseractOCRProvider();

      const regions = await provider.getTextRegions("data", 200, 50);

      expect(regions).toHaveLength(2);
      expect(regions[0]).toEqual({
        text: "Hello",
        x: 10,
        y: 20,
        width: 50,
        height: 20,
        confidence: 0.95,
      });
      expect(regions[1]).toEqual({
        text: "World",
        x: 70,
        y: 20,
        width: 60,
        height: 20,
        confidence: 0.88,
      });
    });

    it("returns empty array when no words detected", async () => {
      setupMockWorker("", []);
      const provider = new TesseractOCRProvider();

      const regions = await provider.getTextRegions("data", 100, 50);
      expect(regions).toEqual([]);
    });
  });

  describe("dispose", () => {
    it("terminates the worker", async () => {
      setupMockWorker("");
      mockTerminate.mockResolvedValue(undefined);
      const provider = new TesseractOCRProvider();

      await provider.initialize();
      await provider.dispose();

      expect(mockTerminate).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when worker is not initialized", async () => {
      const provider = new TesseractOCRProvider();
      await provider.dispose(); // should not throw
      expect(mockTerminate).not.toHaveBeenCalled();
    });

    it("allows re-initialization after dispose", async () => {
      setupMockWorker("first");
      mockTerminate.mockResolvedValue(undefined);
      const provider = new TesseractOCRProvider();

      await provider.extractText("data", 100, 50);
      await provider.dispose();

      setupMockWorker("second");
      const text = await provider.extractText("data", 100, 50);
      expect(text).toBe("second");
      expect(mockCreateWorker).toHaveBeenCalledTimes(2);
    });
  });
});
