// Properties that browser scripts attach to the page's window to observe app behavior. This file
// has no imports or exports, so the declaration merges into the global Window type.

// oxlint-disable-next-line typescript/consistent-type-definitions -- Only an interface can merge into the DOM Window declaration.
interface Window {
  /** Makes the fake AudioContext in notifications.browser.ts reject resume() like blocked autoplay. */
  audioDenied: boolean;
  /** Number of tones started through the fake AudioContext in settings.browser.ts. */
  tones: number;
  /** Focus observed by projects.browser.ts when a repository row is inserted. */
  repositoryFocusAtInsert: Promise<{ insertedFocused: boolean; branchRetained: boolean }>;
}
