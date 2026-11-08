import { FolderIcon } from "lucide-react";
import { useState } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@flora/florets";

export function Example() {
  const [project, setProject] = useState("Flora");
  return (
    <SidebarProvider className="min-h-0 w-full overflow-hidden rounded-xl border">
      <Sidebar collapsible="none" className="w-full">
        <SidebarHeader>
          <p className="px-2 font-medium">Workspace</p>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {["Flora", "Website", "Mobile app"].map((name) => (
                  <SidebarMenuItem key={name}>
                    <SidebarMenuButton
                      isActive={project === name}
                      onClick={() => {
                        setProject(name);
                      }}
                    >
                      <FolderIcon />
                      <span>{name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <p className="px-2 text-xs text-muted-foreground">Selected: {project}</p>
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  );
}
