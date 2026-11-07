import { useEffect, useRef } from "react";

import { createTextureRenderer } from "../lib/texture-renderer";
import { textureFragmentShader } from "../lib/texture-shader";
import { cn } from "../lib/utils";

export type TextureBackgroundProps = {
  className?: string;
  variant?: "silk" | "veil" | "ribbons";
  /** Overall opacity, clamped to 0–1. */
  intensity?: number;
  /** Playback rate, clamped to 0–2. Zero holds the current frame. */
  speed?: number;
  motion?: boolean;
  seed?: number;
};

function bounded(value: number, fallback: number, max = 1) {
  return Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
}

/** Place inside a positioned container, with content in a relative sibling above it. */
export function TextureBackground({
  className,
  variant = "silk",
  intensity = 1,
  speed = 1,
  motion = true,
  seed = 1,
}: TextureBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ variant, speed, motion, seed });
  const synchronize = useRef<(() => void) | null>(null);

  useEffect(() => {
    settings.current = {
      variant,
      speed: bounded(speed, 1, 2),
      motion,
      seed: Number.isFinite(seed) ? seed % 1000 : 1,
    };
    synchronize.current?.();
  }, [variant, speed, motion, seed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let renderer = createTextureRenderer(canvas, textureFragmentShader);
    let frame = 0;
    let elapsed = 0;
    let previous = 0;
    let drawn = 0;
    let visible = false;
    let light = false;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");

    function paint() {
      const { current } = settings;
      const variants = { silk: 0, veil: 1, ribbons: 2 };
      renderer?.draw(elapsed, { light, variant: variants[current.variant], seed: current.seed });
    }
    function tick(now: number) {
      elapsed +=
        previous === 0 ? 0 : (Math.min(now - previous, 100) / 1000) * settings.current.speed;
      previous = now;
      if (now - drawn >= 1000 / 30) {
        paint();
        drawn = now - ((now - drawn) % (1000 / 30));
      }
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame);
      previous = 0;
      paint();
      if (
        renderer !== null &&
        settings.current.motion &&
        settings.current.speed > 0 &&
        !preference.matches &&
        visible &&
        !document.hidden
      ) {
        frame = requestAnimationFrame(tick);
      }
    }
    function resize() {
      renderer?.resize();
      paint();
    }
    function theme() {
      if (canvas === null) return;
      light = getComputedStyle(canvas).colorScheme === "light";
      paint();
    }
    function lost(event: Event) {
      event.preventDefault();
      cancelAnimationFrame(frame);
      renderer?.dispose();
      renderer = null;
      if (canvas !== null) canvas.style.visibility = "hidden";
    }
    function restored() {
      if (canvas === null) return;
      renderer = createTextureRenderer(canvas, textureFragmentShader);
      canvas.style.visibility = renderer === null ? "hidden" : "visible";
      resize();
      sync();
    }
    canvas.style.visibility = renderer === null ? "hidden" : "visible";
    const sizeObserver = new ResizeObserver(resize);
    const visibilityObserver = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    const themeObserver = new MutationObserver(theme);
    for (
      let ancestor: HTMLElement | null = canvas.parentElement;
      ancestor !== null;
      ancestor = ancestor.parentElement
    ) {
      themeObserver.observe(ancestor, { attributes: true, attributeFilter: ["class", "style"] });
    }
    synchronize.current = sync;
    sizeObserver.observe(canvas);
    visibilityObserver.observe(canvas);
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("resize", resize);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    theme();
    resize();
    return () => {
      synchronize.current = null;
      cancelAnimationFrame(frame);
      renderer?.dispose();
      sizeObserver.disconnect();
      visibilityObserver.disconnect();
      themeObserver.disconnect();
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden bg-background",
        className,
      )}
      style={{ opacity: bounded(intensity, 1) }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_25%,#39745b40,transparent_60%),radial-gradient(ellipse_at_90%_75%,#39745b26,transparent_50%)]" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
