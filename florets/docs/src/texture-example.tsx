import { useState, useSyncExternalStore } from "react";

import {
  Button,
  ButtonLink,
  Field,
  FieldLabel,
  TextureBackground,
  Text,
  type TextureBackgroundProps,
} from "@flora/florets";

function subscribeToMotionPreference(onChange: () => void) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", onChange);
  return () => {
    preference.removeEventListener("change", onChange);
  };
}

const directions = [
  {
    value: "silk",
    label: "Silk",
    description: "Luminous folds, fine threads, sage and warm copper.",
  },
  {
    value: "veil",
    label: "Veil",
    description: "Grainy light drifting through a soft, smoky field.",
  },
  {
    value: "ribbons",
    label: "Ribbons",
    description: "Engraved curves flowing around an open center.",
  },
] as const;

export function TextureExample({ dark }: { dark: boolean }) {
  const reducedMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const [variant, setVariant] = useState<NonNullable<TextureBackgroundProps["variant"]>>("silk");
  const [intensity, setIntensity] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [motion, setMotion] = useState(true);
  const [seed, setSeed] = useState(1);
  let motionDescription = "Animation is paused.";
  if (motion && speed > 0) motionDescription = "Animation is playing.";
  if (reducedMotion) {
    motionDescription = "Your device has reduced motion enabled, so the texture is still.";
  }
  const query = new URLSearchParams({
    texture: variant,
    theme: dark ? "dark" : "light",
    intensity: String(intensity),
    speed: String(speed),
    seed: String(seed),
    motion: String(motion),
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Texture direction">
        {directions.map((direction) => (
          <Button
            key={direction.value}
            variant={variant === direction.value ? "default" : "outline"}
            aria-pressed={variant === direction.value}
            onClick={() => {
              setVariant(direction.value);
            }}
          >
            {direction.label}
          </Button>
        ))}
      </div>
      <Text size="sm" tone="muted">
        {directions.find((direction) => direction.value === variant)?.description}
      </Text>
      <div className="relative isolate aspect-video min-h-72 w-full overflow-hidden rounded-xl border border-border bg-background">
        <TextureBackground
          variant={variant}
          intensity={intensity}
          speed={speed}
          motion={motion}
          seed={seed}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="texture-intensity">
            Intensity · {Math.round(intensity * 100)}%
          </FieldLabel>
          <input
            id="texture-intensity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={intensity}
            onChange={(event) => {
              setIntensity(event.currentTarget.valueAsNumber);
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="texture-speed">Speed · {speed.toFixed(1)}×</FieldLabel>
          <input
            id="texture-speed"
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={speed}
            onChange={(event) => {
              setSpeed(event.currentTarget.valueAsNumber);
            }}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={motion}
          onClick={() => {
            setMotion(!motion);
          }}
        >
          {motion ? "Pause" : "Play"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSeed(seed + 1);
          }}
        >
          New pattern
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setIntensity(1);
            setSpeed(1);
            setMotion(true);
            setSeed(1);
          }}
        >
          Reset
        </Button>
        <ButtonLink href={`?${query.toString()}`} target="_blank" rel="noreferrer">
          Open full-screen preview
        </ButtonLink>
      </div>
      <Text size="xs" tone="muted">
        {motionDescription}
      </Text>
    </div>
  );
}

export function TexturePreview({ search }: { search: URLSearchParams }) {
  const requested = search.get("texture");
  const variant = directions.find((direction) => direction.value === requested)?.value ?? "silk";
  return (
    <main
      aria-label={`${variant} background preview`}
      className="relative h-svh overflow-hidden bg-background"
    >
      <TextureBackground
        variant={variant}
        intensity={Number(search.get("intensity") ?? 1)}
        speed={Number(search.get("speed") ?? 1)}
        seed={Number(search.get("seed") ?? 1)}
        motion={search.get("motion") !== "false"}
      />
    </main>
  );
}
