// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PhraseLearningHintModal from "./PhraseLearningHintModal";

let container: HTMLDivElement;
let root: Root;
const onSave = vi.fn();
const onSaveImage = vi.fn();
const onClose = vi.fn();
const props = {
  open: true,
  phraseLabel: "cat",
  initialValue: "A hint",
  imageUrl: null,
  isSaving: false,
  error: null,
  onSave,
  onSaveImage,
  onClose,
};

function button(label: string): HTMLButtonElement {
  const result = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
function render(overrides = {}) {
  act(() => root.render(<PhraseLearningHintModal {...props} {...overrides} />));
}
function setImage(value: string) {
  const input = container.querySelector<HTMLInputElement>("#phrase-image-url");
  if (!input) throw new Error("Image editor is not open");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Description image editor", () => {
  it("does not turn the pane-switch button into a submit button during its click", () => {
    render();
    const editButton = button("Edit image link");
    act(() => editButton.click());
    // Browser click default actions must not see a button morphed into Save.
    expect(editButton.type).toBe("button");
    expect(container.querySelector("#phrase-image-url")).not.toBeNull();
    expect(onSaveImage).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps an unsaved URL through mouse movement, elapsed time and parent rerenders", async () => {
    render();
    act(() => button("Edit image link").click());
    const url = "https://encrypted-tbn0.gstatic.com/images?q=example&s";
    setImage(url);
    act(() => document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    render();
    expect(container.querySelector<HTMLInputElement>("#phrase-image-url")?.value).toBe(url);
    expect(onSaveImage).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    act(() => button("Save").click());
    expect(onSaveImage).toHaveBeenCalledExactlyOnceWith("https://encrypted-tbn0.gstatic.com/images?q=example&s");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears a saved link only after an explicit Save", () => {
    render({ imageUrl: "https://example.com/cat.jpg" });
    act(() => button("Edit image link").click());
    setImage("");
    expect(onSaveImage).not.toHaveBeenCalled();
    act(() => button("Save").click());
    expect(onSaveImage).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("keeps hint editing independent from image editing", () => {
    render();
    act(() => button("Edit").click());
    act(() => button("Save").click());
    expect(onSave).toHaveBeenCalledExactlyOnceWith("A hint");
    expect(onSaveImage).not.toHaveBeenCalled();
  });
});
