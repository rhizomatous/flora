"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";

import { cn } from "../lib/utils";

type DropdownMenuSearch = {
  label?: string;
  placeholder?: string;
  query?: string;
  onQueryChange?: (query: string) => void;
  filter?: ((text: string, query: string) => boolean) | null;
  emptyText?: ReactNode;
  listLabel?: string;
  listClassName?: string;
};
const defaultSearch: DropdownMenuSearch = { label: "Search" };
function searchOptions(search: boolean | DropdownMenuSearch | undefined) {
  if (search === true) return defaultSearch;
  return search === false ? null : (search ?? null);
}
const SearchContext = createContext<DropdownMenuSearch | null>(null);

function FilteredRoot({
  search,
  children,
}: {
  search: DropdownMenuSearch | null;
  children: ReactNode;
}) {
  return (
    <SearchContext value={search}>
      {search === null ? (
        children
      ) : (
        <MenuPrimitive.FilterProvider
          filter={search.filter}
          autoHighlight="always"
          value={search.query}
          onValueChange={(value) => {
            search.onQueryChange?.(value);
          }}
        >
          {children}
        </MenuPrimitive.FilterProvider>
      )}
    </SearchContext>
  );
}

/** Keeps focus in the search field while menu items, checkboxes, and submenus handle selection. */
function DropdownMenu({
  search,
  ...props
}: MenuPrimitive.Root.Props & { search?: boolean | DropdownMenuSearch }) {
  const options = searchOptions(search);
  return (
    <FilteredRoot search={options}>
      <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
    </FilteredRoot>
  );
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  children,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  const search = useContext(SearchContext);
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "florets-menu-surface florets-dropdown-content z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-surface-overlay p-1 text-surface-overlay-foreground shadow-md ring-1 ring-border duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95",
            search !== null &&
              "w-72 max-w-[calc(100vw-24px)] overflow-hidden p-0 data-closed:animate-none data-open:animate-none duration-0",
            className,
          )}
          {...props}
        >
          {search === null ? (
            children
          ) : (
            <>
              <div
                data-slot="dropdown-menu-search"
                className="shrink-0 border-b border-border px-3"
              >
                <MenuPrimitive.Input
                  aria-label={search.label ?? "Search"}
                  placeholder={search.placeholder ?? "Search"}
                  className="h-9 w-full rounded-none border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <MenuPrimitive.List
                aria-label={search.listLabel ?? search.label ?? "Choices"}
                className={cn(
                  "no-scrollbar max-h-[min(360px,calc(var(--available-height)-44px))] overflow-y-auto overscroll-contain p-1",
                  search.listClassName,
                )}
              >
                {search.emptyText !== null && (
                  <DropdownMenuEmpty>
                    {search.emptyText ?? "No matching results."}
                  </DropdownMenuEmpty>
                )}
                {children}
              </MenuPrimitive.List>
            </>
          )}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({
  label,
  children,
  ...props
}: MenuPrimitive.Group.Props & { label?: ReactNode }) {
  return (
    <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props}>
      {label !== undefined && <DropdownMenuLabel>{label}</DropdownMenuLabel>}
      {children}
    </MenuPrimitive.Group>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  value,
  keywords,
  onSelect,
  "data-checked": checked,
  ...props
}: Omit<MenuPrimitive.Item.Props, "onSelect"> & {
  value?: string;
  keywords?: string[];
  onSelect?: (value: string) => void;
  "data-checked"?: boolean;
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:data-highlighted:bg-destructive/10 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:data-highlighted:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className,
      )}
      {...props}
      data-value={value}
      data-checked={checked}
      {...(keywords === undefined
        ? {}
        : { label: [props.label ?? "", value ?? "", ...keywords].join(" ") })}
      {...(checked === undefined
        ? {}
        : {
            children: (
              <>
                {props.children}
                <CheckIcon
                  aria-hidden="true"
                  className={cn("ml-auto size-4 shrink-0", !checked && "invisible")}
                />
              </>
            ),
          })}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) onSelect?.(value ?? "");
      }}
    />
  );
}

function DropdownMenuEmpty({ children, ...props }: ComponentProps<typeof MenuPrimitive.Empty>) {
  return (
    <MenuPrimitive.Empty
      data-slot="dropdown-menu-empty"
      className="px-3 py-4 text-sm text-muted-foreground"
      {...props}
    >
      <span>{children}</span>
    </MenuPrimitive.Empty>
  );
}

function DropdownMenuSub({
  search,
  ...props
}: MenuPrimitive.SubmenuRoot.Props & { search?: boolean | DropdownMenuSearch }) {
  const options = searchOptions(search);
  return (
    <FilteredRoot search={options}>
      <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
    </FilteredRoot>
  );
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground data-inset:pl-7 data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="florets-rtl-flip ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "florets-menu-surface florets-dropdown-content w-auto min-w-[96px] rounded-lg bg-surface-overlay p-1 text-surface-overlay-foreground shadow-lg ring-1 ring-border duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className,
      )}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuEmpty,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
