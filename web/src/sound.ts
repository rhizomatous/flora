import { useEffect } from "react";
import { request } from "./request";

// Browsers require a user gesture before audio can play. Never alert for the
// initial history load or repeat an alert for an unchanged idle chat.
export function useCompletionSound(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let audio: AudioContext | undefined;
    let active = true;
    let loading = false;
    const previous = new Map<string, string>();
    const unlock = () => {
      try {
        audio ??= new AudioContext();
        void audio.resume().catch(() => {});
      } catch { /* Audio is optional when the browser does not support it. */ }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const chats = await request<{ ID: string; Status: string; StatusReason: string }[]>("chats");
        if (!active) return;
        for (const c of chats) {
          if (c.Status === "idle" && c.StatusReason === "Turn completed; ready for a follow-up" && ["working", "waiting"].includes(previous.get(c.ID) || "") && audio?.state === "running") {
            const tone = audio.createOscillator();
            const gain = audio.createGain();
            tone.frequency.value = 660;
            gain.gain.setValueAtTime(0.08, audio.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.2);
            tone.connect(gain); gain.connect(audio.destination);
            tone.start(); tone.stop(audio.currentTime + 0.2);
          }
          previous.set(c.ID, c.Status);
        }
      } catch { /* Connection and session errors are shown by the current view. */ }
      finally { loading = false; }
    };
    void load();
    const timer = window.setInterval(load, 1000);
    return () => { active = false; clearInterval(timer); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); void audio?.close(); };
  }, [enabled]);
}
