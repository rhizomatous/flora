import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  GitBranch,
  Menu,
  Moon,
  Search,
  Sun,
} from "lucide-react";
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import {
  Button,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  FlowerMark,
  Input,
  Kbd,
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  Separator,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Toaster,
  TooltipProvider,
} from "@flora/florets";

import { CodeExample } from "./code-example";
import { aiDocs, componentDocs, foundationDocs } from "./docs-data";
import { ExampleSourceProvider } from "./example-source";
import { standaloneSource } from "./example-source-utils";
import { FoundationPage } from "./foundations";

const loaders = import.meta.glob<{ Preview: ComponentType }>("./examples/upstream/*.tsx");
const aiLoaders = import.meta.glob<Record<string, ComponentType>>("./ai/examples/*-demo.tsx");
const sources = import.meta.glob<string>(
  ["./examples/upstream/*.tsx", "./ai/examples/*-demo.tsx", "./ai/lib/message-animations.ts"],
  { query: "?raw", import: "default" },
);
const previews = Object.fromEntries(
  Object.entries(loaders).map(([path, load]) => [
    path,
    lazy(async () => {
      const module = await load();
      return { default: module.Preview };
    }),
  ]),
);
const aiPreviews = Object.fromEntries(
  Object.entries(aiLoaders).map(([path, load]) => [
    path,
    lazy(async () => {
      const module = await load();
      const entry = Object.entries(module).find(([key]) => key.endsWith("Demo"));
      if (!entry) throw new Error(`No demo exported by ${path}`);
      return { default: entry[1] };
    }),
  ]),
);
const sections = [
  {
    title: "Sections",
    pages: [
      ...foundationDocs.slice(0, 1).map((doc) => ({ ...doc, route: doc.id })),
      {
        id: "components",
        title: "Components",
        description: "Browse all interface components.",
        route: "components",
      },
      { id: "ai", title: "AI Elements", description: "Browse conversation patterns.", route: "ai" },
      ...foundationDocs.slice(1).map((doc) => ({ ...doc, route: doc.id })),
    ],
  },
  {
    title: "Components",
    pages: componentDocs.map((doc) => ({ ...doc, route: `components/${doc.id}` })),
  },
  { title: "AI Elements", pages: aiDocs.map((doc) => ({ ...doc, route: `ai/${doc.id}` })) },
];
const pages = sections.flatMap((group) => group.pages);
function routeFromLocation() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash.startsWith("example-")) return `components/${hash.slice(8)}`;
  if (hash === "catalog") return "components";
  const segments = hash.split("/");
  if ((segments[0] === "components" || segments[0] === "ai") && segments[1] === "all-components") {
    return segments[0];
  }
  return (
    segments.slice(0, segments[0] === "components" || segments[0] === "ai" ? 2 : 1).join("/") ||
    "introduction"
  );
}
function href(route: string) {
  return `#${route}`;
}

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <p role="alert" className="rounded-xl border p-6">
        This example could not load. Refresh the page to try again.
      </p>
    ) : (
      this.props.children
    );
  }
}

function ComponentPage({ id, ai, dark }: { id: string; ai: boolean; dark: boolean }) {
  const path = ai ? `./ai/examples/${id}-demo.tsx` : `./examples/upstream/${id}.tsx`;
  const Preview = (ai ? aiPreviews : previews)[path];
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    async function loadSource() {
      try {
        let text = await sources[path]?.();
        if (text !== undefined && (ai || id.startsWith("sidebar"))) {
          const animationSource = await sources["./ai/lib/message-animations.ts"]?.();
          text = standaloneSource(text, animationSource);
        }
        if (active) setSource(text ?? "// Source unavailable.");
      } catch {
        if (active) setSource("// Source could not load. Refresh to try again.");
      }
    }
    void loadSource();
    return () => {
      active = false;
    };
  }, [path, ai, id]);
  const doc = componentDocs.find((item) => item.id === id);
  let previewContent: ReactNode = null;
  if (Preview) {
    if (id.startsWith("sidebar")) {
      previewContent = (
        <div className="overflow-hidden rounded-2xl border">
          {/* These trusted local demos need their own viewport for fixed-position sidebars. */}
          {/* oxlint-disable-next-line react/iframe-missing-sandbox */}
          <iframe
            title={`${doc?.title ?? id} example`}
            src={`./example.html?component=${encodeURIComponent(id)}&theme=${dark ? "dark" : "light"}`}
            className="h-[36rem] w-full border-0"
          />
          <div className="border-t">
            <CodeExample code={source || "// Loading source…"} collapsible />
          </div>
        </div>
      );
    } else if (ai) {
      previewContent = (
        <div className="overflow-hidden rounded-2xl border">
          <div className="flex min-h-80 items-center justify-center overflow-x-auto p-6">
            <Preview />
          </div>
          <div className="border-t">
            <CodeExample code={source || "// Loading source…"} collapsible />
          </div>
        </div>
      );
    } else {
      previewContent = (
        <ExampleSourceProvider source={source}>
          <Preview />
        </ExampleSourceProvider>
      );
    }
  }

  return (
    <>
      <section className="docs-section" id="usage">
        <h2>Usage</h2>
        <CodeExample
          code={
            ai
              ? 'import { Markdown, Button } from "@flora/florets/ai";\nimport "@flora/florets/styles.css";\nimport "@flora/florets/ai/styles.css";'
              : `import { ${doc?.importName ?? "Button"} } from "@flora/florets";\nimport "@flora/florets/styles.css";`
          }
        />
      </section>
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Delegates native link activation, including keyboard activation, from example children. */}
      <section
        className="docs-section"
        id="examples"
        onClick={(event) => {
          // Placeholder links demonstrate styling without leaving the documentation.
          if (event.target instanceof Element && event.target.closest('a[href="#"]')) {
            event.preventDefault();
          }
        }}
      >
        <h2>Examples</h2>
        <PreviewBoundary key={path}>
          <Suspense
            fallback={
              <p role="status" className="py-20 text-center text-muted-foreground">
                Loading examples…
              </p>
            }
          >
            {previewContent}
          </Suspense>
        </PreviewBoundary>
      </section>
    </>
  );
}

function IndexPage({ ai }: { ai: boolean }) {
  const [query, setQuery] = useState("");
  const docs = ai ? aiDocs : componentDocs;
  const filtered = docs.filter((doc) =>
    `${doc.title} ${doc.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="docs-section">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h2 id="all-components" className="mb-0!">
          {ai ? "All AI Elements" : "All components"}
        </h2>
        <Input
          type="search"
          aria-label="Filter components"
          placeholder="Filter components…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="w-full sm:w-56"
        />
      </div>
      <div className="docs-index">
        {filtered.map((doc) => (
          <a key={doc.id} href={href(`${ai ? "ai" : "components"}/${doc.id}`)}>
            <span>{doc.title}</span>
            <ArrowRight className="size-4" />
          </a>
        ))}
      </div>
      {filtered.length === 0 && <p role="status">No components found. Try a different search.</p>}
    </section>
  );
}

export function Guide() {
  const [route, setRoute] = useState(routeFromLocation);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("florets-theme") !== "light";
    } catch {
      return true;
    }
  });
  const [toc, setToc] = useState<{ id: string; title: string; depth: number }[]>([]);
  const [activeHeading, setActiveHeading] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const article = useRef<HTMLElement>(null);
  const nav = useRef<HTMLDivElement>(null);
  const page = pages.find((item) => item.route === route);
  const isIndex = route === "components" || route === "ai";
  const indexTitle = route === "components" ? "Components" : "AI Elements";
  const title = page?.title ?? (isIndex ? indexTitle : "Page not found");
  let category = "Documentation";
  if (route.startsWith("components/")) category = "Components";
  if (route.startsWith("ai/")) category = "AI Elements";
  const description =
    page?.description ??
    (isIndex ? "" : "This documentation page doesn’t exist. Choose a page from the navigation.");
  const pageIndex = pages.findIndex((item) => item.route === route);
  const previous = pages[pageIndex - 1];
  const next = pages[pageIndex + 1];

  useEffect(() => {
    function navigate() {
      setRoute(routeFromLocation());
      setMenuOpen(false);
      setCopied(false);
      setCopyError(false);
    }
    function keyboard(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    }
    window.addEventListener("hashchange", navigate);
    window.addEventListener("keydown", keyboard);
    return () => {
      window.removeEventListener("hashchange", navigate);
      window.removeEventListener("keydown", keyboard);
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("florets-theme", dark ? "dark" : "light");
    } catch {
      /* Theme remains available when storage is disabled. */
    }
  }, [dark]);
  useEffect(() => {
    document.title = `${title} · Florets`;
    window.scrollTo(0, 0);
    const container = nav.current;
    if (!container) return;
    let restored = false;
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem("florets-docs-scroll") ?? "null");
      if (
        saved !== null &&
        typeof saved === "object" &&
        "route" in saved &&
        saved.route === route &&
        "top" in saved &&
        typeof saved.top === "number" &&
        Number.isFinite(saved.top)
      ) {
        container.scrollTop = saved.top;
        restored = true;
      }
    } catch {
      /* Navigation still works when browser storage is unavailable. */
    }
    const current = container.querySelector<HTMLElement>(`[href="#${CSS.escape(route)}"]`);
    if (!restored && current) {
      const bounds = current.getBoundingClientRect();
      const parent = container.getBoundingClientRect();
      if (bounds.bottom > parent.bottom || bounds.top < parent.top) {
        container.scrollTop += bounds.top - parent.top - (parent.height - bounds.height) / 2;
      }
    }
    function saveScroll() {
      if (!container || container.clientHeight === 0) return;
      try {
        sessionStorage.setItem(
          "florets-docs-scroll",
          JSON.stringify({ route, top: container.scrollTop }),
        );
      } catch {
        /* Keep scrolling when browser storage is unavailable. */
      }
    }
    saveScroll();
    container.addEventListener("scroll", saveScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", saveScroll);
    };
  }, [route, title]);
  useEffect(() => {
    const element = article.current;
    if (!element) return;
    let headings: { element: HTMLElement; id: string; title: string; depth: number }[] = [];
    let pendingAnchor = decodeURIComponent(location.hash.slice(1)).slice(route.length + 1);
    const scroll = () => {
      const current = headings.findLast(
        (heading) => heading.element.getBoundingClientRect().top < 150,
      );
      setActiveHeading(current?.id ?? headings[0]?.id ?? "");
    };
    const update = () => {
      headings = [
        ...element.querySelectorAll<HTMLElement>(
          "h2[id], h3[id], section[id] > h2, section[id] > h3",
        ),
      ]
        .map((heading) => ({
          element: heading,
          id: heading.id === "" ? (heading.parentElement?.id ?? "") : heading.id,
          title: heading.textContent,
          depth: heading.tagName === "H3" ? 3 : 2,
        }))
        .filter((heading) => heading.id);
      setToc(
        headings.map(({ id, title: headingTitle, depth }) => ({ id, title: headingTitle, depth })),
      );
      if (pendingAnchor) {
        const target = element.querySelector(`#${CSS.escape(pendingAnchor)}`);
        if (target) {
          pendingAnchor = "";
          target.scrollIntoView();
        }
      }
      scroll();
    };
    const navigateAnchor = () => {
      if (routeFromLocation() === route) {
        pendingAnchor = decodeURIComponent(location.hash.slice(1)).slice(route.length + 1);
        update();
      }
    };
    const frame = requestAnimationFrame(update);
    const observer = new MutationObserver(update);
    observer.observe(element, { childList: true, subtree: true });
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("hashchange", navigateAnchor);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("hashchange", navigateAnchor);
    };
  }, [route]);

  function navigation() {
    return sections.map((section) => (
      <SidebarGroup key={section.title} className="docs-nav-group">
        <SidebarGroupLabel className="px-2 text-muted-foreground">
          {section.title}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {section.pages.map((item) => (
              <SidebarMenuItem key={item.route}>
                <SidebarMenuButton
                  asChild
                  isActive={
                    route === item.route ||
                    ((item.route === "components" || item.route === "ai") &&
                      route.startsWith(`${item.route}/`))
                  }
                  className="docs-menu-link h-[30px] w-fit overflow-visible rounded-md border border-transparent px-2 text-[0.8rem] font-medium data-[active=true]:border-accent data-[active=true]:bg-accent"
                >
                  <a
                    href={href(item.route)}
                    onClick={() => {
                      setMenuOpen(false);
                    }}
                    aria-current={route === item.route ? "page" : undefined}
                  >
                    {item.title}
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    ));
  }
  async function copyPage() {
    try {
      await navigator.clipboard.writeText(
        `# ${title}\n\n${description}\n\n${article.current?.textContent ?? ""}`,
      );
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  let pageContent: ReactNode;
  if (isIndex) {
    pageContent = <IndexPage ai={route === "ai"} />;
  } else if (route.startsWith("components/") || route.startsWith("ai/")) {
    pageContent = page ? (
      <ComponentPage id={page.id} ai={route.startsWith("ai/")} dark={dark} />
    ) : (
      <a href="#components">Browse components</a>
    );
  } else {
    pageContent = page ? (
      <FoundationPage id={route} />
    ) : (
      <a href="#introduction">Go to introduction</a>
    );
  }
  return (
    <TooltipProvider>
      <SidebarProvider className="block">
        <Toaster theme={dark ? "dark" : "light"} />
        <a
          className="docs-skip"
          href="#content"
          onClick={(event) => {
            event.preventDefault();
            article.current?.focus();
          }}
        >
          Skip to content
        </a>
        <header className="docs-header">
          <div className="docs-header-inner">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open navigation"
              onClick={() => {
                setMenuOpen(true);
              }}
            >
              <Menu />
            </Button>
            <a className="docs-brand" href="#introduction">
              <FlowerMark /> <span>Florets</span>
            </a>
            <nav aria-label="Main navigation" className="docs-top-nav">
              {[
                { route: "introduction", title: "Docs" },
                { route: "components", title: "Components" },
                { route: "ai", title: "AI Elements" },
              ].map((item) => (
                <Button key={item.route} asChild variant="ghost" size="sm" className="px-2.5">
                  <a
                    href={href(item.route)}
                    aria-current={
                      (
                        item.route === "introduction"
                          ? !route.includes("/") && !isIndex
                          : route.startsWith(item.route)
                      )
                        ? "page"
                        : undefined
                    }
                  >
                    {item.title}
                  </a>
                </Button>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="secondary"
                className="docs-search"
                onClick={() => {
                  setSearchOpen(true);
                }}
                aria-label="Search documentation"
              >
                <Search className="size-4" />
                <span>Search documentation…</span>
                <Kbd>⌘ K</Kbd>
              </Button>
              <Separator orientation="vertical" className="hidden h-4! lg:block" />
              <Button asChild variant="ghost" size="icon" className="docs-github">
                <a
                  href="https://github.com/rhizomatous/flora/tree/main/florets"
                  aria-label="Florets on GitHub"
                >
                  <GitBranch className="size-4" />
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
                onClick={() => {
                  setDark(!dark);
                }}
              >
                {dark ? <Sun /> : <Moon />}
              </Button>
            </div>
          </div>
        </header>
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className="w-80">
            <SheetHeader>
              <SheetTitle>Florets documentation</SheetTitle>
            </SheetHeader>
            <nav aria-label="Mobile documentation" className="docs-mobile-nav">
              {navigation()}
            </nav>
          </SheetContent>
        </Sheet>
        <div className="docs-layout">
          <Sidebar collapsible="none" className="docs-sidebar">
            <SidebarContent ref={nav}>
              <nav aria-label="Documentation">{navigation()}</nav>
            </SidebarContent>
          </Sidebar>
          <main ref={article} id="content" tabIndex={-1} className="docs-article">
            <div className="docs-page-heading">
              <div>
                <p className="docs-eyebrow">{category}</p>
                <h1>{title}</h1>
              </div>
              <Button
                variant="secondary"
                aria-label={copied ? "Page copied" : "Copy page"}
                size="sm"
                onClick={() => {
                  void copyPage();
                }}
              >
                {copied ? <Check /> : <Copy />}
                <span>{copied ? "Copied" : "Copy page"}</span>
              </Button>
            </div>
            {description && <p className="docs-description">{description}</p>}
            {toc.length > 0 && (
              <div className="mb-6 xl:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Menu />
                      On this page
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-[60svh] overflow-y-auto">
                    {toc.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        asChild
                        className={item.depth === 3 ? "pl-6" : undefined}
                      >
                        <a
                          href={`#${route}/${item.id}`}
                          aria-current={activeHeading === item.id ? "location" : undefined}
                        >
                          {item.title}
                        </a>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {copyError && (
              <p role="alert" className="text-sm text-destructive">
                Couldn’t copy. Select the page text to copy it manually.
              </p>
            )}
            <div key={route}>{pageContent}</div>
            <footer className="docs-footer">
              {previous ? (
                <Button asChild variant="secondary" size="sm">
                  <a href={href(previous.route)}>
                    <ArrowLeft className="size-4" />
                    {previous.title}
                  </a>
                </Button>
              ) : (
                <span />
              )}
              {next && (
                <Button asChild variant="secondary" size="sm">
                  <a href={href(next.route)}>
                    {next.title}
                    <ArrowRight className="size-4" />
                  </a>
                </Button>
              )}
            </footer>
          </main>
          <aside className="docs-toc" aria-label="On this page">
            <p>On this page</p>
            {toc.map((item) => (
              <a
                key={item.id}
                data-depth={item.depth}
                href={`#${route}/${item.id}`}
                aria-current={activeHeading === item.id ? "location" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  history.replaceState(null, "", `#${route}/${item.id}`);
                  document
                    .querySelector(`#${CSS.escape(item.id)}`)
                    ?.scrollIntoView({ behavior: "smooth" });
                  setActiveHeading(item.id);
                }}
              >
                {item.title}
              </a>
            ))}
          </aside>
        </div>
        <CommandDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          title="Search documentation"
          description="Find components, AI Elements, and guides."
        >
          <Command>
            <CommandInput placeholder="Search documentation…" />
            <CommandList>
              <CommandEmpty>No results found. Try another component or topic.</CommandEmpty>
              {sections.map((group) => (
                <CommandGroup key={group.title} heading={group.title}>
                  {group.pages.map((item) => (
                    <CommandItem
                      key={item.route}
                      value={`${item.route} ${item.title} ${item.description}`}
                      onSelect={() => {
                        location.hash = item.route;
                        setSearchOpen(false);
                      }}
                    >
                      <span>{item.title}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {group.title}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </CommandDialog>
      </SidebarProvider>
    </TooltipProvider>
  );
}
