import { describe, it, expect } from "vitest";
import {
  stringOp,
  mathOp,
  collectionOp,
  applyTransform,
  computeExpression,
  isStringOp,
  isMathOp,
  isCollectionOp,
} from "../../actions/data-ops-extended";

// ---------------------------------------------------------------------------
// stringOp
// ---------------------------------------------------------------------------

describe("stringOp", () => {
  it("concat appends a string", () => {
    expect(stringOp("hello", "concat", " world")).toBe("hello world");
  });

  it("split splits by delimiter", () => {
    expect(stringOp("a,b,c", "split", ",")).toEqual(["a", "b", "c"]);
  });

  it("replace replaces first occurrence", () => {
    expect(stringOp("foo bar foo", "replace", "foo", "baz")).toBe("baz bar foo");
  });

  it("toUpperCase converts to uppercase", () => {
    expect(stringOp("hello", "toUpperCase")).toBe("HELLO");
  });

  it("toLowerCase converts to lowercase", () => {
    expect(stringOp("HELLO", "toLowerCase")).toBe("hello");
  });

  it("trim removes whitespace", () => {
    expect(stringOp("  hello  ", "trim")).toBe("hello");
  });

  it("substring extracts range", () => {
    expect(stringOp("hello world", "substring", 0, 5)).toBe("hello");
  });

  it("startsWith checks prefix", () => {
    expect(stringOp("hello", "startsWith", "hel")).toBe(true);
    expect(stringOp("hello", "startsWith", "world")).toBe(false);
  });

  it("endsWith checks suffix", () => {
    expect(stringOp("hello", "endsWith", "llo")).toBe(true);
  });

  it("includes checks substring", () => {
    expect(stringOp("hello world", "includes", "world")).toBe(true);
  });

  it("length returns string length", () => {
    expect(stringOp("hello", "length")).toBe(5);
  });

  it("padStart pads from left", () => {
    expect(stringOp("5", "padStart", 3, "0")).toBe("005");
  });

  it("padEnd pads from right", () => {
    expect(stringOp("5", "padEnd", 3, "0")).toBe("500");
  });
});

// ---------------------------------------------------------------------------
// mathOp
// ---------------------------------------------------------------------------

describe("mathOp", () => {
  it("add sums two values", () => {
    expect(mathOp([3, 4], "add")).toBe(7);
  });

  it("subtract subtracts", () => {
    expect(mathOp([10, 3], "subtract")).toBe(7);
  });

  it("multiply multiplies", () => {
    expect(mathOp([3, 4], "multiply")).toBe(12);
  });

  it("divide divides", () => {
    expect(mathOp([10, 4], "divide")).toBe(2.5);
  });

  it("divide throws on zero", () => {
    expect(() => mathOp([10, 0], "divide")).toThrow("Division by zero");
  });

  it("mod returns remainder", () => {
    expect(mathOp([10, 3], "mod")).toBe(1);
  });

  it("min returns minimum", () => {
    expect(mathOp([5, 2, 8, 1], "min")).toBe(1);
  });

  it("max returns maximum", () => {
    expect(mathOp([5, 2, 8, 1], "max")).toBe(8);
  });

  it("sum totals all values", () => {
    expect(mathOp([1, 2, 3, 4], "sum")).toBe(10);
  });

  it("avg averages all values", () => {
    expect(mathOp([2, 4, 6], "avg")).toBe(4);
  });

  it("round rounds to nearest integer", () => {
    expect(mathOp([3.7], "round")).toBe(4);
    expect(mathOp([3.2], "round")).toBe(3);
  });

  it("floor rounds down", () => {
    expect(mathOp([3.9], "floor")).toBe(3);
  });

  it("ceil rounds up", () => {
    expect(mathOp([3.1], "ceil")).toBe(4);
  });

  it("abs returns absolute value", () => {
    expect(mathOp([-5], "abs")).toBe(5);
  });

  it("throws on empty array", () => {
    expect(() => mathOp([], "sum")).toThrow("requires at least one value");
  });
});

// ---------------------------------------------------------------------------
// collectionOp
// ---------------------------------------------------------------------------

describe("collectionOp", () => {
  const items = [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 },
    { name: "Charlie", age: 35 },
  ];

  it("filter by property value", () => {
    const result = collectionOp(items, "filter", "name", "Bob") as typeof items;
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Bob");
  });

  it("map extracts property", () => {
    const result = collectionOp(items, "map", "name");
    expect(result).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("sort by property ascending", () => {
    const result = collectionOp(items, "sort", "age") as typeof items;
    expect(result[0].name).toBe("Bob");
    expect(result[2].name).toBe("Charlie");
  });

  it("sort by property descending", () => {
    const result = collectionOp(items, "sort", "age", "desc") as typeof items;
    expect(result[0].name).toBe("Charlie");
  });

  it("find by property", () => {
    const result = collectionOp(items, "find", "age", 25) as typeof items[0];
    expect(result.name).toBe("Bob");
  });

  it("every checks all match", () => {
    expect(collectionOp([1, 1, 1], "every", undefined, 1)).toBe(true);
    expect(collectionOp([1, 2, 1], "every", undefined, 1)).toBe(false);
  });

  it("some checks any match", () => {
    expect(collectionOp([1, 2, 3], "some", undefined, 2)).toBe(true);
  });

  it("includes checks presence", () => {
    expect(collectionOp([1, 2, 3], "includes", 2)).toBe(true);
    expect(collectionOp([1, 2, 3], "includes", 5)).toBe(false);
  });

  it("length returns count", () => {
    expect(collectionOp([1, 2, 3], "length")).toBe(3);
  });

  it("first returns first element", () => {
    expect(collectionOp([10, 20, 30], "first")).toBe(10);
  });

  it("last returns last element", () => {
    expect(collectionOp([10, 20, 30], "last")).toBe(30);
  });

  it("slice extracts range", () => {
    expect(collectionOp([1, 2, 3, 4, 5], "slice", 1, 3)).toEqual([2, 3]);
  });

  it("flatten flattens nested arrays", () => {
    expect(collectionOp([[1, 2], [3, 4]], "flatten")).toEqual([1, 2, 3, 4]);
  });

  it("unique removes duplicates", () => {
    expect(collectionOp([1, 2, 2, 3, 3, 3], "unique")).toEqual([1, 2, 3]);
  });

  it("reduce sums numbers by default", () => {
    expect(collectionOp([1, 2, 3, 4], "reduce")).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// applyTransform (auto-detection)
// ---------------------------------------------------------------------------

describe("applyTransform", () => {
  it("detects string operations", () => {
    expect(applyTransform("hello", "toUpperCase", [])).toBe("HELLO");
  });

  it("detects math operations on numbers", () => {
    expect(applyTransform(5, "add", [3])).toBe(8);
  });

  it("detects collection operations on arrays", () => {
    expect(applyTransform([3, 1, 2], "sort", [])).toEqual([1, 2, 3]);
  });

  it("detects math operations on number arrays", () => {
    expect(applyTransform([1, 2, 3], "sum", [])).toBe(6);
  });

  it("throws for incompatible type/operation", () => {
    expect(() => applyTransform(true, "concat", [])).toThrow("Cannot apply");
  });
});

// ---------------------------------------------------------------------------
// computeExpression
// ---------------------------------------------------------------------------

describe("computeExpression", () => {
  it("evaluates addition", () => {
    expect(computeExpression("a + b", { a: 3, b: 4 })).toBe(7);
  });

  it("evaluates subtraction", () => {
    expect(computeExpression("total - tax", { total: 100, tax: 15 })).toBe(85);
  });

  it("evaluates multiplication", () => {
    expect(computeExpression("price * qty", { price: 9.99, qty: 3 })).toBeCloseTo(29.97);
  });

  it("evaluates division", () => {
    expect(computeExpression("total / count", { total: 100, count: 4 })).toBe(25);
  });

  it("handles literal numbers", () => {
    expect(computeExpression("count - 1", { count: 10 })).toBe(9);
  });

  it("handles single variable", () => {
    expect(computeExpression("count", { count: 42 })).toBe(42);
  });

  it("handles single literal", () => {
    expect(computeExpression("42", {})).toBe(42);
  });

  it("throws for unknown variable", () => {
    expect(() => computeExpression("unknown + 1", {})).toThrow('Unknown variable');
  });

  it("throws for non-numeric variable", () => {
    expect(() => computeExpression("name + 1", { name: "Alice" })).toThrow("not numeric");
  });
});

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe("type guards", () => {
  it("isStringOp identifies string operations", () => {
    expect(isStringOp("concat")).toBe(true);
    expect(isStringOp("add")).toBe(false);
  });

  it("isMathOp identifies math operations", () => {
    expect(isMathOp("sum")).toBe(true);
    expect(isMathOp("concat")).toBe(false);
  });

  it("isCollectionOp identifies collection operations", () => {
    expect(isCollectionOp("filter")).toBe(true);
    expect(isCollectionOp("add")).toBe(false);
  });
});
