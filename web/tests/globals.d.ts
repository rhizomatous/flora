// Properties that browser tests attach to the page's window to observe app behavior. This file
// has no imports or exports, so the declaration merges into the global Window type.

// oxlint-disable-next-line typescript/consistent-type-definitions -- Only an interface can merge into the DOM Window declaration.
interface Window {
  /** Makes the fake AudioContext in notifications.spec.ts reject resume() like blocked autoplay. */
  audioDenied: boolean;
  /** Number of tones started through the fake AudioContext in settings.spec.ts. */
  tones: number;
  /** Focus observed by projects.spec.ts when a repository row is inserted. */
  repositoryFocusAtInsert: Promise<{ insertedFocused: boolean; branchRetained: boolean }>;
}
