import { useState } from "react";

import { Button, Field, FieldLabel, StippleBackground, Text } from "@flora/florets";

export function StippleExample() {
  const [intensity, setIntensity] = useState(0.32);
  const [density, setDensity] = useState(0.75);
  const [motion, setMotion] = useState(true);
  const [seed, setSeed] = useState(1);
  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="stipple-intensity">
            Intensity · {Math.round(intensity * 100)}%
          </FieldLabel>
          <input
            id="stipple-intensity"
            type="range"
            min="0"
            max="0.6"
            step="0.01"
            value={intensity}
            onChange={(event) => {
              setIntensity(event.currentTarget.valueAsNumber);
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="stipple-density">Density · {Math.round(density * 100)}%</FieldLabel>
          <input
            id="stipple-density"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={density}
            onChange={(event) => {
              setDensity(event.currentTarget.valueAsNumber);
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
          Animate
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
            setIntensity(0.32);
            setDensity(0.75);
            setMotion(true);
            setSeed(1);
          }}
        >
          Reset
        </Button>
      </div>
      <Text size="xs" tone="muted">
        Motion stays still when your device requests reduced motion. Use the guide’s theme switch to
        compare light and dark.
      </Text>
      <div className="relative isolate aspect-[16/10] min-h-64 overflow-hidden rounded-xl border border-border bg-background">
        <StippleBackground intensity={intensity} density={density} motion={motion} seed={seed} />
      </div>
    </div>
  );
}
