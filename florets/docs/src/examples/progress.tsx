import { useState } from "react";

import { Button, Progress } from "@flora/florets";

export function Example() {
  const [progress, setProgress] = useState(40);
  return (
    <div className="grid w-full gap-3">
      <Progress value={progress} aria-label="Upload progress" />
      <div className="flex items-center justify-between">
        <span className="text-sm">{progress}% complete</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setProgress((current) => (current >= 100 ? 0 : current + 20));
          }}
        >
          Advance
        </Button>
      </div>
    </div>
  );
}
