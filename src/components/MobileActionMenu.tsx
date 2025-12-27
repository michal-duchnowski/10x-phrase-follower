import React, { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

interface MobileActionMenuRenderProps {
  close: () => void;
}

type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type MenuSide = "top" | "bottom";
type ButtonSize = "default" | "sm" | "lg" | "icon";

interface MobileActionMenuProps {
  triggerLabel?: string;
  triggerIcon?: boolean;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  triggerClassName?: string;
  side?: MenuSide;
  className?: string;
  panelClassName?: string;
  children: (props: MobileActionMenuRenderProps) => React.ReactNode;
}

export default function MobileActionMenu({
  triggerLabel = "Options",
  triggerIcon = true,
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
  side = "bottom",
  className,
  panelClassName,
  children,
}: MobileActionMenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const iconOnly = triggerSize === "icon";
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | { bottom: number; right: number } | null>(
    null
  );

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      setOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }

    const compute = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const margin = 8;

      // Prefer right alignment to the trigger. Keep at least 8px from viewport edge.
      const right = Math.max(8, window.innerWidth - rect.right);

      if (side === "bottom") {
        const top = Math.min(window.innerHeight - 8, rect.bottom + margin);
        setPanelPos({ top, right });
        return;
      }

      const bottom = Math.max(8, window.innerHeight - rect.top + margin);
      setPanelPos({ bottom, right });
    };

    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, side]);

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        aria-haspopup="menu"
        aria-controls={id}
        aria-expanded={open}
        aria-label={iconOnly ? triggerLabel : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(iconOnly ? undefined : "gap-2", triggerClassName)}
      >
        {(triggerIcon || iconOnly) && <MoreHorizontal className="size-4" />}
        {iconOnly ? <span className="sr-only">{triggerLabel}</span> : <span>{triggerLabel}</span>}
      </Button>

      {open && (
        <div
          id={id}
          role="menu"
          aria-label={triggerLabel}
          style={panelPos ?? undefined}
          className={cn(
            // Render as fixed to avoid clipping by any parent overflow/stacking contexts.
            "fixed w-[min(92vw,18rem)] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
            "p-2 z-[100] max-h-[60vh] overflow-auto",
            panelClassName
          )}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}
