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
    const dots = document.createElement("canvas");
    const dotContext = dots.getContext("2d");
    const field = document.createElement("canvas");
    const fieldContext = field.getContext("2d");
    if (context === null || dotContext === null || fieldContext === null) return;
    field.width = 256;
    field.height = 128;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let visible = false;
    let elapsed = 0;
    let previous = 0;
    let drawn = 0;

    // Only the broad illumination moves. Dot positions, sizes, and edge fading stay fixed.
    function paint() {
      if (canvas === null || context === null || fieldContext === null) return;
      const t = elapsed / 1000;
      fieldContext.clearRect(0, 0, 256, 128);
      const pools = [
        { x: 35 + Math.sin(t / 8) * 32, y: 15 + Math.cos(t / 11) * 18, radius: 82 },
        { x: 228 + Math.sin(t / 10 + 2) * 30, y: 32 + Math.sin(t / 9) * 24, radius: 91 },
        { x: 5 + Math.cos(t / 13) * 22, y: 66 + Math.sin(t / 8) * 14, radius: 58 },
      ];
      for (const pool of pools) {
        const light = fieldContext.createRadialGradient(
          pool.x,
          pool.y,
          0,
          pool.x,
          pool.y,
          pool.radius,
        );
        light.addColorStop(0, "rgba(255,255,255,1)");
        light.addColorStop(0.4, "rgba(255,255,255,0.9)");
        light.addColorStop(0.7, "rgba(255,255,255,0.35)");
        light.addColorStop(1, "rgba(255,255,255,0)");
        fieldContext.fillStyle = light;
        fieldContext.fillRect(0, 0, 256, 128);
      }
      // Uneven bands break up the pools into organic patches instead of circular spotlights.
      fieldContext.globalCompositeOperation = "destination-out";
      for (let band = 0; band < 3; band++) {
        const x = 40 + band * 83 + Math.sin(t / 9 + band) * 26;
        const y = 25 + band * 27 + Math.cos(t / 12 + band) * 20;
        const shadow = fieldContext.createRadialGradient(x, y, 0, x, y, 42);
        shadow.addColorStop(0, "rgba(0,0,0,0.8)");
        shadow.addColorStop(1, "rgba(0,0,0,0)");
        fieldContext.fillStyle = shadow;
        fieldContext.fillRect(0, 0, 256, 128);
      }
      fieldContext.globalCompositeOperation = "source-over";
      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(dots, 0, 0);
      context.globalCompositeOperation = "source-in";
      context.fillStyle = getComputedStyle(canvas).color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = "destination-in";
      context.drawImage(field, 0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = "source-over";
    }

    function resize() {
      if (canvas === null || dotContext === null) return;
      const { width, height } = canvas.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      // Bound both backing-store memory and dot count on large or high-DPI screens.
      const scale = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(2_000_000 / (width * height)),
      );
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      dots.width = canvas.width;
      dots.height = canvas.height;
      dotContext.setTransform(scale, 0, 0, scale, 0, 0);
      let randomState = Number.isFinite(seed) ? Math.abs(Math.trunc(seed) % 2_147_483_646) + 1 : 1;
      function random() {
        randomState = (randomState * 16_807) % 2_147_483_647;
        return randomState / 2_147_483_647;
      }
      const spacing = Math.max(
        6 - bounded(density, 0.75) * 3.5,
        Math.sqrt((width * height) / 65_000),
      );
      for (let y = 0; y < height; y += spacing) {
        for (let x = 0; x < width; x += spacing) {
          const px = x + random() * spacing;
          const py = y + random() * spacing;
          const fade = 1 - Math.min(1, Math.max(0, (py / height - 0.25) / 0.65)) ** 1.5;
          dotContext.fillStyle = `rgba(255,255,255,${fade * (0.5 + random() * 0.5)})`;
          dotContext.beginPath();
          dotContext.arc(px, py, 0.4 + random() * 0.4, 0, Math.PI * 2);
          dotContext.fill();
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
