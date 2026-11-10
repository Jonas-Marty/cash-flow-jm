import { describe, it, expect } from "vitest";
import { amountToInput, formatAmountInput } from "./amountInput";

describe("formatAmountInput", () => {
  it("adds the cents", () => {
    expect(formatAmountInput("5")).toBe("5.00");
    expect(formatAmountInput("2.5")).toBe("2.50");
    expect(formatAmountInput("12,5")).toBe("12.50");
  });
  it("rounds to cents", () => {
    expect(formatAmountInput("1.005")).toBe("1.01");
    expect(formatAmountInput("3.14159")).toBe("3.14");
  });
  it("keeps a negative sign", () => {
    expect(formatAmountInput("-500")).toBe("-500.00");
  });
  it("leaves empty and unreadable input alone", () => {
    expect(formatAmountInput("")).toBe("");
    expect(formatAmountInput("  ")).toBe("  ");
    expect(formatAmountInput("abc")).toBe("abc");
    expect(formatAmountInput(".")).toBe(".");
  });
});

describe("amountToInput", () => {
  it("writes a stored amount with cents", () => {
    expect(amountToInput(12.5)).toBe("12.50");
    expect(amountToInput("40")).toBe("40.00");
    expect(amountToInput(0)).toBe("0.00");
  });
  it("is empty for no amount", () => {
    expect(amountToInput(null)).toBe("");
    expect(amountToInput(undefined)).toBe("");
  });
});
