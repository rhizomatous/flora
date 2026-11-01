import { useEffect, useRef, useState } from "react";

export function useCompletionSound(enabled: boolean) {
  const audio = useRef<AudioContext | undefined>(undefined);
  const [ready, setReady] = useState(false);
  useEffect(
    () => () => {
      void audio.current?.close();
      audio.current = undefined;
    },
    [],
  );
  useEffect(() => {
    if (!enabled) setReady(false);
  }, [enabled]);

  async function enable() {
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      setReady(audio.current.state === "running");
    } catch {
      setReady(false);
    }
  }

  function play() {
    if (!enabled) return;
    const context = audio.current;
    if (context?.state !== "running") {
      setReady(false);
      return;
    }
    try {
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.frequency.value = 660;
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
      tone.connect(gain);
      gain.connect(context.destination);
      tone.onended = () => {
        tone.disconnect();
        gain.disconnect();
      };
      tone.start();
      tone.stop(context.currentTime + 0.2);
    } catch {
      setReady(false);
    }
  }

  return { ready, enable, play };
}
