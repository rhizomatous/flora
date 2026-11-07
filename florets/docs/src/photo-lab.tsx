import { useEffect, useRef, useState } from "react";

import { Button, Field, FieldLabel, Heading, Link, Text } from "@flora/florets";

import { createPhotoFilter, type PhotoFilterSettings } from "./photo-filter";

const treatments = [
  {
    value: "stipple",
    label: "Soft stippling",
    description: "Soft scattered marks that retain the photograph’s detail and shading.",
  },
  {
    value: "mezzotint",
    label: "Tonal grain",
    description: "Fine tonal grain, preserving colors and smooth highlights.",
  },
  {
    value: "source",
    label: "Source",
    description: "The same crop and tonal settings, without a texture filter.",
  },
] as const;

function PhotoPreview({
  image,
  settings,
}: {
  image: HTMLImageElement;
  settings: PhotoFilterSettings;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const current = useRef(settings);
  const paint = useRef<(() => void) | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    current.current = settings;
    paint.current?.();
  }, [settings]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let renderer: ReturnType<typeof createPhotoFilter> = null;
    function draw() {
      renderer?.draw(current.current);
    }
    function initialize() {
      if (canvas === null) return;
      renderer = createPhotoFilter(canvas, image);
      setError(
        renderer === null ? "This preview needs WebGL, which is unavailable in this browser." : "",
      );
      draw();
    }
    function lost(event: Event) {
      event.preventDefault();
      renderer?.dispose();
      renderer = null;
      setError(
        "Graphics were interrupted. The preview will return when the browser restores them.",
      );
    }
    initialize();
    paint.current = draw;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", initialize);
    return () => {
      paint.current = null;
      observer.disconnect();
      renderer?.dispose();
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", initialize);
    };
  }, [image]);
  async function expand() {
    try {
      await panelRef.current?.requestFullscreen();
    } catch {
      setError("Full-screen preview is unavailable in this browser.");
    }
  }
  const treatment = treatments.find((entry) => entry.value === settings.treatment);
  return (
    <article className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Heading level={2}>{treatment?.label}</Heading>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void expand();
          }}
        >
          Expand
        </Button>
      </div>
      <div
        ref={panelRef}
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-[#0b0d0c] [&:fullscreen]:h-screen [&:fullscreen]:w-screen [&:fullscreen]:rounded-none"
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${treatment?.label} photograph preview`}
          className="absolute inset-0 h-full w-full"
        />
      </div>
      {error !== "" && (
        <Text role="status" size="sm">
          {error}
        </Text>
      )}
      <Text size="sm" tone="muted">
        {treatment?.description}
      </Text>
    </article>
  );
}

export function PhotoLab() {
  const [source, setSource] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("image");
    return import.meta.env.DEV && requested === "/local-reference.avif" ? requested : "";
  });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"compare" | PhotoFilterSettings["treatment"]>("compare");
  const [size, setSize] = useState(1.75);
  const [strength, setStrength] = useState(0.65);
  const [exposure, setExposure] = useState(1);
  const [intensity, setIntensity] = useState(0.55);
  const [fade, setFade] = useState(0.7);
  useEffect(() => {
    if (source === "") return;
    let active = true;
    const photo = new Image();
    photo.src = source;
    async function decode() {
      try {
        await photo.decode();
        if (active) setImage(photo);
      } catch {
        if (active) setError("Could not open this image. Try a JPEG, PNG, WebP, or AVIF file.");
      }
    }
    void decode();
    return () => {
      active = false;
      if (source.startsWith("blob:")) URL.revokeObjectURL(source);
    };
  }, [source]);
  const controls = [
    {
      id: "strength",
      label: "Texture strength",
      value: strength,
      min: 0,
      max: 1,
      step: 0.05,
      set: setStrength,
    },
    { id: "size", label: "Texture size", value: size, min: 1, max: 6, step: 0.25, set: setSize },
    {
      id: "exposure",
      label: "Exposure",
      value: exposure,
      min: 0.5,
      max: 2.5,
      step: 0.1,
      set: setExposure,
    },
    {
      id: "intensity",
      label: "Brightness",
      value: intensity,
      min: 0.1,
      max: 1,
      step: 0.05,
      set: setIntensity,
    },
    { id: "fade", label: "Bottom fade", value: fade, min: 0, max: 1, step: 0.05, set: setFade },
  ];
  return (
    <main className="mx-auto max-w-[1600px] space-y-8 px-5 py-8 sm:px-10">
      <header className="space-y-3">
        <Link href="./">Florets component guide</Link>
        <Heading level={1}>Photo texture lab</Heading>
        <Text tone="muted">
          Compare two browser-side texture filters on a still photograph. Images stay in this
          browser.
        </Text>
      </header>
      <div className="flex flex-wrap items-end gap-5">
        <Field className="max-w-sm">
          <FieldLabel htmlFor="photo-file">Choose a photograph</FieldLabel>
          <input
            id="photo-file"
            type="file"
            accept="image/*"
            className="max-w-full text-sm"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file !== undefined) {
                setImage(null);
                setError("");
                setSource(URL.createObjectURL(file));
              }
            }}
          />
        </Field>
        <div role="group" aria-label="Preview treatment" className="flex flex-wrap gap-2">
          {([{ value: "compare", label: "Compare" }, ...treatments] as const).map((entry) => (
            <Button
              key={entry.value}
              size="sm"
              variant={view === entry.value ? "default" : "outline"}
              aria-pressed={view === entry.value}
              onClick={() => {
                setView(entry.value);
              }}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {controls.map((control) => (
          <Field key={control.id}>
            <FieldLabel htmlFor={control.id}>
              {control.label} · {control.value.toFixed(2)}
            </FieldLabel>
            <input
              id={control.id}
              type="range"
              min={control.min}
              max={control.max}
              step={control.step}
              value={control.value}
              onChange={(event) => {
                control.set(event.currentTarget.valueAsNumber);
              }}
            />
          </Field>
        ))}
      </div>
      {error !== "" && <Text role="alert">{error}</Text>}
      {image === null ? (
        <div className="rounded-xl border border-dashed border-border p-16 text-center">
          <Text tone="muted">
            {source === ""
              ? "Choose a photograph to compare the treatments."
              : "Waiting for an image."}
          </Text>
        </div>
      ) : (
        <div className={view === "compare" ? "grid gap-8 lg:grid-cols-2" : "mx-auto max-w-6xl"}>
          {treatments
            .filter((entry) =>
              view === "compare" ? entry.value !== "source" : entry.value === view,
            )
            .map((entry) => (
              <PhotoPreview
                key={entry.value}
                image={image}
                settings={{ treatment: entry.value, size, strength, exposure, intensity, fade }}
              />
            ))}
        </div>
      )}
    </main>
  );
}
