import { createContext, useContext, type ReactNode } from "react";

const ExampleSourceContext = createContext<string | undefined>(undefined);

export function ExampleSourceProvider({
  source,
  children,
}: {
  source: string;
  children: ReactNode;
}) {
  return <ExampleSourceContext value={source}>{children}</ExampleSourceContext>;
}

// oxlint-disable-next-line react/only-export-components -- Examples share the source context through this hook.
export function useExampleSource() {
  return useContext(ExampleSourceContext);
}
