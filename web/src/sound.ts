import { useEffect, useRef, useState } from "react";

/**
 * Plays a short tone for completed chats. Browsers allow audio only after a user gesture, so
 * callers must invoke `enable` from a click or key press before `play` can be heard.
 */
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
      tone.addEventListener(
        "ended",
        () => {
          tone.disconnect();
          gain.disconnect();
        },
        { once: true },
      );
      tone.start();
      tone.stop(context.currentTime + 0.2);
    } catch {
      setReady(false);
    }
  }

  // A page that already unlocked audio stays unlocked when the saved preference is turned back on.
  return { ready: enabled && ready, enable, play };
}
