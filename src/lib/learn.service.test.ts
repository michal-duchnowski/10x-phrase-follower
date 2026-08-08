import { describe, expect, it } from "vitest";
import { compareAnswers } from "./learn.service";

describe("compareAnswers", () => {
  it("accepts a Polish synonym followed by a comma in contains mode", () => {
    const result = compareAnswers("porządny", "porządny, przyzwoity", true);

    expect(result.isCorrect).toBe(true);
  });

  it("accepts a Polish synonym followed by a semicolon in contains mode", () => {
    const result = compareAnswers("rozproszyć", "rozrzucić, rozproszyć; rozsypać się", true);

    expect(result.isCorrect).toBe(true);
  });

  it("keeps exact mode strict for multi-synonym answers", () => {
    const result = compareAnswers("porządny", "porządny, przyzwoity", false);

    expect(result.isCorrect).toBe(false);
  });
});
