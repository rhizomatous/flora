// oxlint-disable react/forbid-component-props -- Dynamic CSS variables are passed to the underlying primitive.
// oxlint-disable typescript/no-unsafe-type-assertion -- The upstream API uses assertions for CSS custom properties and keyed chart config.
"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { Toaster as Sonner, toast, useSonner, type ToasterProps, type ToastT } from "sonner";

function setDuration(notification: ToastT, duration: number) {
  const update = {
    success: toast.success,
    error: toast.error,
    warning: toast.warning,
    info: toast.info,
    loading: toast.loading,
    normal: toast,
    default: toast,
    action: toast,
  }[notification.type ?? "normal"];
  update(notification.title, {
    id: notification.id,
    dismissible: notification.dismissible ?? true,
    duration,
  });
}

function Toaster({ id, expand = false, duration = 4000, toastOptions, ...props }: ToasterProps) {
  const { theme = "system" } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(() => {
    if (typeof document === "undefined") return false;
    return document.hidden;
  });
  const { toasts } = useSonner();
  const paused = useRef(new Map<string | number, number>());
  const lifetime = toastOptions?.duration ?? duration;
  const hold = focused || hovered || hidden;

  useEffect(() => {
    const changed = () => {
      setHidden(document.hidden);
    };
    document.addEventListener("visibilitychange", changed);
    return () => {
      document.removeEventListener("visibilitychange", changed);
    };
  }, []);

  useEffect(() => {
    const liveIDs = new Set(toast.getToasts().map((item) => item.id));
    const active = toasts.filter(
      (item) => liveIDs.has(item.id) && (item.toasterId ?? "") === (id ?? ""),
    );
    const activeIDs = new Set(active.map((item) => item.id));
    for (const pausedID of paused.current.keys()) {
      if (!activeIDs.has(pausedID)) paused.current.delete(pausedID);
    }
    for (const notification of active) {
      const saved = paused.current.get(notification.id);
      if (hold) {
        if (saved === undefined) {
          paused.current.set(notification.id, notification.duration ?? lifetime);
        }
        if (notification.duration !== Infinity) setDuration(notification, Infinity);
      } else if (saved !== undefined) {
        paused.current.delete(notification.id);
        // Give the user a fresh reading window after returning to the page or leaving the stack.
        setDuration(notification, saved);
      }
    }
  }, [hold, toasts, id, lifetime]);

  useEffect(() => {
    const saved = paused.current;
    return () => {
      for (const notification of toast.getToasts()) {
        if ("dismiss" in notification) continue;
        const remaining = saved.get(notification.id);
        if (remaining !== undefined) setDuration(notification, remaining);
      }
      saved.clear();
    };
  }, []);

  return (
    <div
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onFocusCapture={() => {
        setFocused(true);
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setFocused(false);
        // Sonner restores the old focus on blur; preserve an intentional move outside the stack.
        if (event.relatedTarget instanceof HTMLElement) event.relatedTarget.focus();
      }}
    >
      <Sonner
        {...(id === undefined ? {} : { id })}
        theme={theme === "dark" || theme === "light" ? theme : "system"}
        className="toaster group"
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />,
        }}
        style={
          {
            "--normal-bg": "var(--surface-overlay)",
            "--normal-text": "var(--surface-overlay-foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "var(--radius)",
          } as React.CSSProperties
        }
        toastOptions={{
          ...toastOptions,
          classNames: {
            toast: "florets-toast",
            ...toastOptions?.classNames,
          },
        }}
        {...props}
        expand={focused || expand}
        duration={duration}
      />
    </div>
  );
}

export { Toaster };
