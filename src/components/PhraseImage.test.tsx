// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PhraseImage from "./PhraseImage";
import PhraseLearningHintModal from "./PhraseLearningHintModal";
import { usePrefetchPhraseImage } from "../lib/hooks/usePrefetchPhraseImage";
import { phraseImageCache } from "../lib/phrase-image-cache";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), token: "test-token" as string | null }));

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
  phraseImageCache.clear();
  mocks.apiFetch.mockReset();
  mocks.token = "test-token";
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
  phraseImageCache.clear();
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

vi.mock("../lib/hooks/useApi", () => ({ useApi: () => ({ apiFetch: mocks.apiFetch, token: mocks.token }) }));

const storedUrl = "/api/phrase-images/550e8400-e29b-41d4-a716-446655440000/550e8400-e29b-41d4-a716-446655440001.webp";
function Question({ revealed, imageUrl = storedUrl }: { revealed: boolean; imageUrl?: string }) {
  usePrefetchPhraseImage(imageUrl);
  return revealed ? <PhraseImage url={imageUrl} revealed /> : <p>Read the question</p>;
}
function mockImageDownload() {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:cached-image");
      static revokeObjectURL = vi.fn();
    }
  );
  mocks.apiFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(["image"], { type: "image/webp" }) });
}

describe("image prefetch and session cache", () => {
  it("downloads during the question without revealing it and reuses the image across remounts", async () => {
    mockImageDownload();
    await act(async () => root.render(<Question revealed={false} />));
    expect(mocks.apiFetch).toHaveBeenCalledOnce();
    expect(container.querySelector("img")).toBeNull();
    await act(async () => root.render(<Question revealed />));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:cached-image");
    expect(mocks.apiFetch).toHaveBeenCalledOnce();
    await act(async () => root.render(<Question revealed={false} />));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cached-image");
    await act(async () => root.render(<Question revealed />));
    expect(mocks.apiFetch).toHaveBeenCalledOnce();
  });
  it("shares an unfinished prefetch when the answer is revealed immediately", async () => {
    mockImageDownload();
    let resolve: (response: unknown) => void = () => undefined;
    mocks.apiFetch.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    await act(async () => root.render(<Question revealed={false} />));
    await act(async () => root.render(<Question revealed />));
    expect(container.textContent).toContain("Loading image");
    expect(mocks.apiFetch).toHaveBeenCalledOnce();
    await act(async () => resolve({ ok: true, blob: async () => new Blob(["image"]) }));
    expect(container.querySelector("img")).not.toBeNull();
  });
  it("keeps preload errors hidden and retries when the answer opens", async () => {
    mockImageDownload();
    mocks.apiFetch.mockRejectedValueOnce(new Error("Offline"));
    await act(async () => root.render(<Question revealed={false} />));
    expect(container.textContent).toBe("Read the question");
    await act(async () => root.render(<Question revealed />));
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    expect(container.querySelector("img")).not.toBeNull();
  });
  it("hides the old account image and loads again after authentication changes", async () => {
    mockImageDownload();
    await act(async () => root.render(<PhraseImage url={storedUrl} revealed />));
    mocks.token = null;
    await act(async () => root.render(<PhraseImage url={storedUrl} revealed />));
    expect(container.querySelector("img")).toBeNull();
    mocks.token = "another-account";
    await act(async () => root.render(<PhraseImage url={storedUrl} revealed />));
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });
  it("uses the new version URL after replacement instead of the cached old image", async () => {
    mockImageDownload();
    await act(async () => root.render(<Question revealed />));
    const replacement = storedUrl.replace("440001.webp", "440002.webp");
    await act(async () => root.render(<Question revealed imageUrl={replacement} />));
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    expect(mocks.apiFetch).toHaveBeenLastCalledWith(replacement, expect.anything());
  });
});
