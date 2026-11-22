// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PhraseImage from "./PhraseImage";
import PhraseLearningHintModal from "./PhraseLearningHintModal";

let container: HTMLDivElement;
let root: Root;
const url = "https://example.com/photo.jpg";
function click(label: string) {
  const target = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!target) throw new Error(`Missing button: ${label}`);
  act(() => {
    target.focus();
    target.click();
  });
}
function key(value: string) {
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no native top layer; emulate the dialog's open/close operations.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.overflow = "";
  vi.unstubAllGlobals();
});

describe("full-screen image preview", () => {
  it("opens in the current page and closes without losing the answer or submitting its form", () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const location = window.location.href;
    act(() =>
      root.render(
        <form onSubmit={submit}>
          <textarea defaultValue="My current answer" />
          <p>Card 7</p>
          <PhraseImage url={url} revealed={true} />
        </form>
      )
    );
    click("Enlarge image");
    const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-label="Image preview"]');
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector("img")?.getAttribute("src")).toBe(url);
    expect(document.body.style.overflow).toBe("hidden");
    click("Close image preview");
    expect(document.querySelector("dialog")).toBeNull();
    expect(container.querySelector("textarea")?.value).toBe("My current answer");
    expect(container.textContent).toContain("Card 7");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Enlarge image");
    expect(submit).not.toHaveBeenCalled();
    expect(window.location.href).toBe(location);
  });

  it("blocks flashcard shortcuts and restores them and scrolling after Escape", () => {
    const shortcut = vi.fn();
    window.addEventListener("keydown", shortcut);
    document.body.style.overflow = "auto";
    act(() => root.render(<PhraseImage url={url} revealed={true} />));
    click("Enlarge image");
    key("3");
    expect(shortcut).not.toHaveBeenCalled();
    key("Escape");
    expect(shortcut).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
    key("3");
    expect(shortcut).toHaveBeenCalledOnce();
    window.removeEventListener("keydown", shortcut);
  });

  it("returns to the same Description image editor when Escape closes the preview", () => {
    const closeDescription = vi.fn();
    act(() =>
      root.render(
        <PhraseLearningHintModal
          open={true}
          phraseLabel="cat"
          initialValue="A hint"
          imageUrl={url}
          isSaving={false}
          error={null}
          onSave={vi.fn()}
          onSaveImage={vi.fn()}
          onClose={closeDescription}
        />
      )
    );
    const edit = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Edit image"
    );
    act(() => edit?.click());
    click("Enlarge image");
    key("Escape");
    expect(document.querySelector('dialog[aria-label="Image preview"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>("#phrase-image-url")?.value).toBe(url);
    expect(closeDescription).not.toHaveBeenCalled();
  });

  it("cleans up the overlay and scroll lock if the photo is removed", () => {
    act(() => root.render(<PhraseImage url={url} revealed={true} />));
    click("Enlarge image");
    act(() => root.render(<PhraseImage url={null} revealed={true} />));
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});

vi.mock("../lib/hooks/useApi", () => ({ useApi: () => ({ apiFetch: vi.fn(), token: "test-token" }) }));
