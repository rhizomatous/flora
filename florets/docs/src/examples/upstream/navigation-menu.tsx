// oxlint-disable import/no-namespace -- The upstream examples group React and chart APIs in namespaces.
// Adapted from https://ui.shadcn.com/r/styles/radix-nova/navigation-menu-example.json
"use client";

import { CircleAlertIcon } from "lucide-react";
import * as React from "react";

import { Link } from "@flora/florets";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@flora/florets/components/navigation-menu";

import { Example, ExampleWrapper } from "../example";

const components: { title: string; href: string; description: string }[] = [
  {
    title: "Alert Dialog",
    href: "/docs/primitives/alert-dialog",
    description:
      "A modal dialog that interrupts the user with important content and expects a response.",
  },
  {
    title: "Hover Card",
    href: "/docs/primitives/hover-card",
    description: "For sighted users to preview content available behind a link.",
  },
  {
    title: "Progress",
    href: "/docs/primitives/progress",
    description:
      "Displays an indicator showing the completion progress of a task, typically displayed as a progress bar.",
  },
  {
    title: "Scroll-area",
    href: "/docs/primitives/scroll-area",
    description: "Visually or semantically separates content.",
  },
  {
    title: "Tabs",
    href: "/docs/primitives/tabs",
    description:
      "A set of layered sections of content—known as tab panels—that are displayed one at a time.",
  },
  {
    title: "Tooltip",
    href: "/docs/primitives/tooltip",
    description:
      "A popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it.",
  },
];

export function Preview() {
  return (
    <ExampleWrapper className="lg:grid-cols-1">
      <NavigationMenuWithViewport />
      <NavigationMenuWithoutViewport />
    </ExampleWrapper>
  );
}

function NavigationMenuWithViewport() {
  return (
    <Example title="With Viewport">
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuTrigger>Getting started</NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul className="w-96">
                <ListItem href="https://ui.shadcn.com/docs" title="Introduction">
                  Re-usable components built with Tailwind CSS.
                </ListItem>
                <ListItem href="https://ui.shadcn.com/docs" title="Installation">
                  How to install dependencies and structure your app.
                </ListItem>
                <ListItem href="https://ui.shadcn.com/docs" title="Typography">
                  Styles for headings, paragraphs, lists...etc
                </ListItem>
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuTrigger>Components</NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul className="grid w-[400px] gap-1 md:w-[500px] md:grid-cols-2 lg:w-[600px]">
                {components.map((component) => (
                  <ListItem key={component.title} title={component.title} href={component.href}>
                    {component.description}
                  </ListItem>
                ))}
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
              <Link href="https://ui.shadcn.com/docs">Documentation</Link>
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </Example>
  );
}

function NavigationMenuWithoutViewport() {
  return (
    <Example title="Without Viewport">
      <NavigationMenu viewport={false}>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
              <Link href="https://ui.shadcn.com/docs">Documentation</Link>
            </NavigationMenuLink>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuTrigger>List</NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul className="w-72">
                <li>
                  <NavigationMenuLink asChild>
                    <Link href="#">
                      <div className="flex flex-col">
                        <div className="style-sera:font-heading style-sera:tracking-wide style-sera:uppercase font-medium">
                          Components
                        </div>
                        <div className="style-sera:mt-0.5 style-sera:leading-relaxed text-muted-foreground">
                          Browse all components in the library.
                        </div>
                      </div>
                    </Link>
                  </NavigationMenuLink>
                  <NavigationMenuLink asChild>
                    <Link href="#">
                      <div className="flex flex-col">
                        <div className="style-sera:font-heading style-sera:tracking-wide style-sera:uppercase font-medium">
                          Documentation
                        </div>
                        <div className="style-sera:mt-0.5 style-sera:leading-relaxed text-muted-foreground">
                          Learn how to use the library.
                        </div>
                      </div>
                    </Link>
                  </NavigationMenuLink>
                  <NavigationMenuLink asChild>
                    <Link href="#">
                      <div className="flex flex-col">
                        <div className="style-sera:font-heading style-sera:tracking-wide style-sera:uppercase font-medium">
                          Blog
                        </div>
                        <div className="style-sera:mt-0.5 style-sera:leading-relaxed text-muted-foreground">
                          Read our latest blog posts.
                        </div>
                      </div>
                    </Link>
                  </NavigationMenuLink>
                </li>
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuTrigger>Simple List</NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul>
                <li>
                  <NavigationMenuLink asChild>
                    <Link href="#">Components</Link>
                  </NavigationMenuLink>
                  <NavigationMenuLink asChild>
                    <Link href="#">Documentation</Link>
                  </NavigationMenuLink>
                  <NavigationMenuLink asChild>
                    <Link href="#">Blocks</Link>
                  </NavigationMenuLink>
                </li>
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuTrigger>With Icon</NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul className="grid w-[200px]">
                <li>
                  <NavigationMenuLink asChild>
                    <Link href="#" className="flex-row items-center gap-2">
                      <CircleAlertIcon />
                      Backlog
                    </Link>
                  </NavigationMenuLink>
                  <NavigationMenuLink asChild>
                    <Link href="#" className="flex-row items-center gap-2">
                      <CircleAlertIcon />
                      To Do
                    </Link>
                  </NavigationMenuLink>
                  <NavigationMenuLink asChild>
                    <Link href="#">
                      <CircleAlertIcon />
                      Done
                    </Link>
                  </NavigationMenuLink>
                </li>
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </Example>
  );
}

function ListItem({
  title,
  children,
  href,
  ...props
}: React.ComponentPropsWithoutRef<"li"> & { href: string }) {
  return (
    <li {...props}>
      <NavigationMenuLink asChild>
        <Link href={href}>
          <div className="style-vega:text-sm style-nova:text-sm style-lyra:text-xs style-maia:text-sm style-mira:text-xs style-luma:text-sm flex flex-col gap-1">
            <div className="style-sera:font-heading style-sera:tracking-wide style-sera:uppercase leading-none font-medium">
              {title}
            </div>
            <div className="style-sera:mt-0.5 style-sera:leading-relaxed line-clamp-2 text-muted-foreground">
              {children}
            </div>
          </div>
        </Link>
      </NavigationMenuLink>
    </li>
  );
}
