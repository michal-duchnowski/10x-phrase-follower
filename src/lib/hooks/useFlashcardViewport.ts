import { useEffect, type RefObject } from "react";

// Keep the action bar above the software keyboard and the answer above the bar.
export function useFlashcardViewport(
  answerRef: RefObject<HTMLTextAreaElement | null>,
  actionsRef: RefObject<HTMLDivElement | null>,
  { active, answer, editing }: { active: boolean; answer: string; editing: boolean }
) {
  useEffect(() => {
    if (!active) return;
    const viewport = window.visualViewport;
    const mobile = window.matchMedia("(max-width: 639px)");
    let frame = 0;
    const update = () => {
      const textarea = answerRef.current;
      const actions = actionsRef.current;
      if (!textarea || !actions) return;
      const isMobile = mobile.matches && (!viewport || viewport.scale === 1);
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      const inset = isMobile ? Math.max(0, window.innerHeight - height - top) : 0;
      actions.style.setProperty("--flashcard-keyboard-inset", `${inset}px`);
      const barHeight = actions.getBoundingClientRect().height;
      textarea.style.setProperty("max-height", isMobile ? `${Math.max(44, height - barHeight - 32)}px` : "none");
      textarea.style.setProperty("height", "auto");
      textarea.style.setProperty("height", `${textarea.scrollHeight + 2}px`);
      if (!isMobile || !editing || document.activeElement !== textarea) return;
      const bounds = textarea.getBoundingClientRect();
      const visibleBottom = top + height - barHeight - 12;
      if (bounds.bottom > visibleBottom) {
        window.scrollBy({ top: bounds.bottom - visibleBottom, behavior: "instant" });
      } else if (bounds.top < top + 12) {
        window.scrollBy({ top: bounds.top - top - 12, behavior: "instant" });
      }
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    schedule();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
    };
  }, [active, answer, editing, answerRef, actionsRef]);
}
