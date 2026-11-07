import { useEffect, useRef } from "react";

import { cn } from "../lib/utils";

export type StippleBackgroundProps = {
  className?: string;
  /** Overall opacity, clamped to 0–1. */
  intensity?: number;
  /** Dot density, clamped to 0–1. */
  density?: number;
  motion?: boolean;
  seed?: number;
};

function bounded(value: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

/** Place inside a positioned container, with content in a relative sibling above it. */
export function StippleBackground({
  className,
  intensity = 0.32,
  density = 0.75,
  motion = true,
  seed = 1,
}: StippleBackgroundProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (ref.current !== null) ref.current.style.opacity = String(bounded(intensity, 0.32));
  }, [intensity]);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const layers = Array.from({ length: 3 }, () => document.createElement("canvas"));
    let scale = 1;
    const padding = 36;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let visible = false;
    let elapsed = 0;
    let previous = 0;
    let drawn = 0;

    // Move cached sheets of stippling at different rates so the clusters visibly flow.
    function paint() {
      if (canvas === null || context === null) return;
      const t = elapsed / 1000;
      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (const [index, layer] of layers.entries()) {
        const phase = index * 2.1;
        const dx = Math.sin(t / 5 + phase) * 22;
        const dy = Math.sin(t / 7 + phase) * 12;
        context.drawImage(layer, (dx - padding) * scale, (dy - padding) * scale);
      }
      context.globalCompositeOperation = "source-in";
      context.fillStyle = getComputedStyle(canvas).color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = "source-over";
    }

    function resize() {
      if (canvas === null) return;
      const { width, height } = canvas.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      // Bound backing-store memory and total dot count on large or high-DPI screens.
      scale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2_000_000 / (width * height)));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      let randomState = Number.isFinite(seed) ? Math.abs(Math.trunc(seed) % 2_147_483_646) + 1 : 1;
      function random() {
        randomState = (randomState * 16_807) % 2_147_483_647;
        return randomState / 2_147_483_647;
      }
      const spacing = Math.max(
        5 - bounded(density, 0.75) * 2.8,
        Math.sqrt(((width + padding * 2) * (height + padding * 2)) / 65_000),
      );
      for (const [index, layer] of layers.entries()) {
        layer.width = Math.ceil((width + padding * 2) * scale);
        layer.height = Math.ceil((height + padding * 2) * scale);
        const dots = layer.getContext("2d");
        if (dots === null) continue;
        dots.setTransform(scale, 0, 0, scale, padding * scale, padding * scale);
        for (let y = -padding + index * spacing; y < height + padding; y += spacing * 3) {
          for (let x = -padding; x < width + padding; x += spacing) {
            const px = x + random() * spacing;
            const py = y + random() * spacing * 3;
            const u = px / width;
            const v = py / height;
            // Warped cloud boundaries vary density as well as opacity, leaving a quiet center.
            const warp = Math.sin(v * 15 + Math.sin(u * 12)) * 0.045;
            const left = Math.exp(-(((u - 0.09 - warp) / 0.22) ** 2 + ((v - 0.13) / 0.29) ** 2));
            const right = Math.exp(-(((u - 0.94 - warp) / 0.25) ** 2 + ((v - 0.2) / 0.3) ** 2));
            const ripples =
              0.65 +
              Math.sin(u * 29 + v * 18 + Math.sin(v * 19) * 2) * 0.2 +
              Math.cos(u * 17 - v * 27) * 0.15;
            const cloud = Math.min(1, (left + right) * ripples * 1.5);
            if (random() > cloud) continue;
            dots.fillStyle = `rgba(255,255,255,${(0.45 + random() * 0.55) * Math.min(1, cloud * 2)})`;
            dots.beginPath();
            dots.arc(px, py, 0.5 + random() * 0.5, 0, Math.PI * 2);
            dots.fill();
          }
        }
      }
      paint();
    }

    function tick(now: number) {
      elapsed += previous === 0 ? 0 : Math.min(now - previous, 100);
      previous = now;
      if (now - drawn >= 1000 / 30) {
        paint();
        drawn = now;
      }
      frame = requestAnimationFrame(tick);
    }

    function sync() {
      cancelAnimationFrame(frame);
      previous = 0;
      paint();
      if (motion && !preference.matches && visible && !document.hidden) {
        frame = requestAnimationFrame(tick);
      }
    }

    const sizeObserver = new ResizeObserver(resize);
    const visibilityObserver = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    // Repaint a still canvas when a containing theme or color class changes.
    const themeObserver = new MutationObserver(paint);
    for (
      let ancestor: HTMLElement | null = canvas;
      ancestor !== null;
      ancestor = ancestor.parentElement
    ) {
      themeObserver.observe(ancestor, { attributes: true, attributeFilter: ["class", "style"] });
    }
    sizeObserver.observe(canvas);
    visibilityObserver.observe(canvas);
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("resize", resize);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      visibilityObserver.disconnect();
      themeObserver.disconnect();
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("resize", resize);
    };
  }, [density, motion, seed]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full text-foreground",
        className,
      )}
    />
  );
}
