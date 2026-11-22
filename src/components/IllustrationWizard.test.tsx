// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import IllustrationWizard from "./IllustrationWizard";

const mocks = vi.hoisted(() => ({ apiCall: vi.fn(), readZip: vi.fn(), compress: vi.fn(), clipboard: vi.fn() }));
vi.mock("../lib/hooks/useApi", () => ({
  useApi: () => ({ apiCall: mocks.apiCall, userId: "test-user", isAuthenticated: true }),
}));
vi.mock("../lib/illustration-import", async (original) => ({
  ...(await original<typeof import("../lib/illustration-import")>()),
  readIllustrationZip: mocks.readZip,
  compressIllustration: mocks.compress,
}));
const phrase = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  en_text: "**Break** the ice",
  pl_text: "Przełam lody",
  image_url: "https://example.com/old.png",
  updated_at: "v1",
};
let container: HTMLDivElement;
let root: Root;
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((element) => element.textContent?.startsWith(text));
  if (!button) throw new Error(`Missing button ${text}`);
  await act(async () => button.click());
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.clipboard } });
  vi.stubGlobal("URL", { createObjectURL: () => "blob:preview", revokeObjectURL: vi.fn() });
  mocks.clipboard.mockResolvedValue(undefined);
  mocks.readZip.mockResolvedValue({
    mapping: "```json\n" + JSON.stringify({ version: 1, images: [{ id: phrase.id, file: "a.png" }] }) + "\n```",
    files: new Map([["a.png", new Uint8Array([1])]]),
  });
  mocks.compress.mockResolvedValue(new Blob(["compressed"], { type: "image/webp" }));
  mocks.apiCall.mockImplementation(async (path: string) =>
    path.endsWith("image-import") ? { items: [phrase] } : { image_url: "/new.webp" }
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("runs the wizard, resumes after closing and uploads only after replacement is selected", async () => {
  const onImported = vi.fn();
  await act(async () => root.render(<IllustrationWizard phrases={[phrase, phrase]} onImported={onImported} />));
  await click("Add illustrations");
  expect(container.textContent).toContain("Copy prompt · 1 phrases");
  await click("Copy prompt");
  expect(mocks.clipboard).toHaveBeenCalledOnce();
  expect(localStorage.getItem("illustration-draft-v1:test-user")).toContain(phrase.id);
  await click("Close");
  await click("Resume illustrations");
  expect(container.textContent).toContain("2/3");
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Missing ZIP input");
  Object.defineProperty(input, "files", { value: [new File(["zip"], "images.zip")] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(container.textContent).toContain("Existing image — skipped");
  expect(mocks.apiCall).toHaveBeenCalledTimes(1);
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  await act(async () => checkbox?.click());
  await click("Import 1 images");
  expect(mocks.apiCall).toHaveBeenLastCalledWith(
    `/api/phrases/${phrase.id}/image`,
    expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "image/webp", "X-Phrase-Version": "v1" },
      body: expect.any(Blob),
    })
  );
  expect(onImported).toHaveBeenCalledWith(phrase.id, "/new.webp");
  expect(container.textContent).toContain("Saved 1 image(s)");
  expect(localStorage.getItem("illustration-draft-v1:test-user")).toBeNull();
});

function dragEvent(type: string, files: File[] = []) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files, dropEffect: "none" } });
  return event;
}

it("highlights the drop zone and opens a preview from a dropped ZIP", async () => {
  await act(async () => root.render(<IllustrationWizard phrases={[phrase]} />));
  await click("Add illustrations");
  expect(container.querySelector("textarea")?.value).toBe("Różnorodne, kwadratowe ilustracje.");
  await click("Copy prompt");
  expect(mocks.clipboard).toHaveBeenCalledWith(expect.stringContaining("Styl: Różnorodne, kwadratowe ilustracje."));
  const zone = container.querySelector('input[type="file"]')?.closest("label");
  if (!zone) throw new Error("Missing drop zone");
  await act(async () => zone.dispatchEvent(dragEvent("dragenter")));
  expect(zone.textContent).toContain("Drop your ZIP here");
  const file = new File(["zip"], "illustrations.zip");
  const event = dragEvent("drop", [file]);
  await act(async () => zone.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(mocks.readZip).toHaveBeenCalledWith(file);
  expect(container.textContent).toContain("3/3");
  expect(container.querySelector("img")?.src).toBe("blob:preview");
});

it("rejects non-ZIP and multiple-file drops before unpacking", async () => {
  await act(async () => root.render(<IllustrationWizard phrases={[phrase]} />));
  await click("Add illustrations");
  await click("Copy prompt");
  const zone = container.querySelector('input[type="file"]')?.closest("label");
  if (!zone) throw new Error("Missing drop zone");
  for (const files of [[new File(["png"], "image.png")], [new File(["zip"], "a.zip"), new File(["zip"], "b.zip")]]) {
    await act(async () => zone.dispatchEvent(dragEvent("drop", files)));
    expect(container.textContent).toContain("Choose or drop exactly one ZIP file.");
  }
  expect(mocks.readZip).not.toHaveBeenCalled();
});
