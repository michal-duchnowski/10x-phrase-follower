// @vitest-environment jsdom
import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlashcardViewport } from "./useFlashcardViewport";

let container: HTMLDivElement;
let root: Root;
let viewport: EventTarget & { height: number; offsetTop: number; scale: number };
let mobile: boolean;
let scroll: ReturnType<typeof vi.fn>;

function Session({ editing = true, answer = "My answer" }: { editing?: boolean; answer?: string }) {
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  useFlashcardViewport(answerRef, actionsRef, { active: true, answer, editing });
  return (
    <>
      <textarea ref={answerRef} defaultValue={answer} />
      <div ref={actionsRef}>{editing ? "Check answer" : "Again / Good"}</div>
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("innerHeight", 800);
  mobile = true;
  vi.stubGlobal("matchMedia", () => ({ matches: mobile }));
  viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", viewport);
  scroll = vi.fn();
  vi.stubGlobal("scrollBy", scroll);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return (this.tagName === "TEXTAREA" ? { top: 400, bottom: 450, height: 50 } : { height: 68 }) as DOMRect;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("flashcard keyboard layout", () => {
  it("moves actions above the keyboard and scrolls the focused answer above them", () => {
    act(() => root.render(<Session />));
    act(() => container.querySelector("textarea")?.focus());
    viewport.height = 400;
    act(() => viewport.dispatchEvent(new Event("resize")));
    expect(container.querySelector("div")?.style.getPropertyValue("--flashcard-keyboard-inset")).toBe("400px");
    expect(scroll).toHaveBeenLastCalledWith({ top: 130, behavior: "instant" });
    expect(container.querySelector("textarea")?.style.maxHeight).toBe("300px");
    // The input remains focused so typing can continue without reopening the keyboard.
    expect(document.activeElement).toBe(container.querySelector("textarea"));
  });

  it("accounts for viewport panning and resets the dock when the keyboard closes", () => {
    act(() => root.render(<Session />));
    viewport.height = 400;
    viewport.offsetTop = 100;
    act(() => viewport.dispatchEvent(new Event("scroll")));
    expect(container.querySelector("div")?.style.getPropertyValue("--flashcard-keyboard-inset")).toBe("300px");
    act(() => root.render(<Session editing={false} />));
    viewport.height = 800;
    viewport.offsetTop = 0;
    act(() => viewport.dispatchEvent(new Event("resize")));
    expect(container.querySelector("div")?.style.getPropertyValue("--flashcard-keyboard-inset")).toBe("0px");
    expect(container.textContent).toContain("Again / Good");
    expect(scroll).not.toHaveBeenCalled();
  });

  it("leaves desktop layout and pinch zoom alone", () => {
    mobile = false;
    viewport.height = 400;
    act(() => root.render(<Session />));
    act(() => container.querySelector("textarea")?.focus());
    expect(container.querySelector("div")?.style.getPropertyValue("--flashcard-keyboard-inset")).toBe("0px");
    expect(container.querySelector("textarea")?.style.maxHeight).toBe("none");
    mobile = true;
    viewport.scale = 2;
    act(() => viewport.dispatchEvent(new Event("resize")));
    expect(scroll).not.toHaveBeenCalled();
  });

  it("supports browsers without VisualViewport", () => {
    vi.stubGlobal("visualViewport", undefined);
    act(() => root.render(<Session />));
    expect(container.querySelector("div")?.style.getPropertyValue("--flashcard-keyboard-inset")).toBe("0px");
    act(() => window.dispatchEvent(new Event("resize")));
    expect(container.querySelector("textarea")?.style.maxHeight).toBe("700px");
  });
});
