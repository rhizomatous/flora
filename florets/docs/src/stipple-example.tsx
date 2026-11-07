import { useState } from "react";

import {
  Button,
  Field,
  FieldLabel,
  Heading,
  StippleBackground,
  Text,
  Textarea,
  Wordmark,
} from "@flora/florets";

export function StippleExample() {
  const [intensity, setIntensity] = useState(0.22);
  const [density, setDensity] = useState(0.5);
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
            setIntensity(0.22);
            setDensity(0.5);
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
      <div className="relative isolate min-h-[32rem] overflow-hidden rounded-xl border border-border bg-background">
        <StippleBackground intensity={intensity} density={density} motion={motion} seed={seed} />
        <div className="relative space-y-20 p-6 sm:p-8">
          <Wordmark />
          <div className="mx-auto max-w-lg space-y-6">
            <Heading level={3} className="text-center text-xl">
              What would you like to work on?
            </Heading>
            <Field>
              <FieldLabel htmlFor="stipple-task" className="sr-only">
                Task preview
              </FieldLabel>
              <Textarea
                id="stipple-task"
                className="min-h-36 bg-background/90"
                placeholder="Describe a task…"
              />
            </Field>
          </div>
        </div>
      </div>
    </div>
  );
}
