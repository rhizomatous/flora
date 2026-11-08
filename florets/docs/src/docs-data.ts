import upstream from "./examples/upstream.json";

const descriptions: Record<string, string> = {
  accordion: "Reveal related sections of content one at a time or together.",
  alert: "Call attention to information, warnings, or the outcome of an action.",
  "alert-dialog": "Ask for confirmation before an action that needs a deliberate decision.",
  "aspect-ratio": "Keep images and other content at a consistent width-to-height ratio.",
  attachment: "Display attached files with previews, details, and actions.",
  avatar: "Represent a person with an image or a fallback.",
  badge: "Label a status, category, or count in a compact space.",
  breadcrumb: "Show the current page's position within a navigation hierarchy.",
  bubble: "Group conversational content into message bubbles.",
  button: "Trigger an action with a button in a choice of styles and sizes.",
  "button-group": "Arrange related buttons into a connected group.",
  calendar: "Browse dates and select a day or a date range.",
  card: "Group related content and actions in a bordered container.",
  carousel: "Browse a sequence of items with previous and next controls.",
  chart: "Visualize data with charts, tooltips, and legends built on Recharts.",
  checkbox: "Select an option independently or as part of a set.",
  "code-block": "Display formatted source code with file labels and copy controls.",
  collapsible: "Expand and collapse a section of content.",
  combobox: "Search a list of options and select a value.",
  command: "Find commands and options with a searchable keyboard-friendly menu.",
  "context-menu": "Offer contextual actions when a user right-clicks an element.",
  dialog: "Present a focused task in a modal over the current page.",
  direction: "Set the reading direction for layouts and interactive components.",
  drawer: "Present content in a panel that slides in from an edge.",
  "dropdown-menu": "Open a menu of actions from a trigger.",
  empty: "Explain an empty state and offer a useful next action.",
  field: "Compose form labels, controls, descriptions, and validation messages.",
  "hover-card": "Preview supporting information when a link receives focus or hover.",
  input: "Enter a single line of text, a number, or another native input value.",
  "input-group": "Combine an input with icons, text, or action buttons.",
  "input-otp": "Enter a one-time code across individual character slots.",
  item: "Arrange an icon, content, and actions in a flexible list item.",
  kbd: "Display keyboard keys and shortcuts.",
  label: "Give a form control a visible, associated label.",
  marker: "Highlight a label with an icon and supporting content.",
  menubar: "Organize application commands in a row of menus.",
  message: "Compose conversational messages with content and actions.",
  "message-scroller": "Keep a conversation scrollable with controls to return to recent messages.",
  "native-select": "Choose an option using the browser's native select control.",
  "navigation-menu": "Organize website links in a menu with expandable content.",
  pagination: "Navigate between pages in a collection of results.",
  popover: "Show contextual content in a floating panel beside its trigger.",
  progress: "Show how much of a task has been completed.",
  questionnaire: "Guide someone through a sequence of questions and choices.",
  "radio-group": "Choose one option from a set of mutually exclusive choices.",
  resizable: "Divide a layout into panels that users can resize.",
  "scroll-area": "Display overflowing content with styled scrollbars.",
  select: "Choose a value from a popup list of options.",
  separator: "Visually separate groups of related content.",
  sheet: "Open a dialog panel along an edge of the viewport.",
  sidebar: "Build application navigation with grouped items and collapsible sections.",
  "sidebar-floating": "Place sidebar navigation in a floating, bordered container.",
  "sidebar-icon": "Collapse sidebar navigation into a compact strip of icons.",
  "sidebar-inset": "Place the main content in an inset panel beside navigation.",
  skeleton: "Reserve space and suggest the shape of content while it loads.",
  slider: "Choose a number or range by moving a handle along a track.",
  sonner: "Show temporary toast notifications for actions and updates.",
  spinner: "Indicate that an operation is in progress.",
  switch: "Turn a setting on or off.",
  table: "Display structured information in rows and columns.",
  tabs: "Switch between related panels within the same view.",
  textarea: "Enter and edit multiple lines of text.",
  toggle: "Switch a button between pressed and unpressed states.",
  "toggle-group": "Group toggle buttons with single or multiple selection.",
  tooltip: "Provide a short description when an element receives focus or hover.",
  trace: "Display a sequence of steps and their details.",
};

const importNames: Record<string, string> = {
  chart: "ChartContainer",
  direction: "DirectionProvider",
  "input-otp": "InputOTP",
  resizable: "ResizablePanelGroup",
  "sidebar-floating": "Sidebar",
  "sidebar-icon": "Sidebar",
  "sidebar-inset": "Sidebar",
  sonner: "Toaster",
};

export const componentDocs = upstream
  .map(({ name, url, examples }) => ({
    id: name,
    title:
      name === "input-otp"
        ? "Input OTP"
        : name
            .split("-")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" "),
    description: descriptions[name] ?? "Explore interactive examples and usage.",
    importName:
      importNames[name] ??
      name
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(""),
    url,
    examples,
  }))
  .toSorted((a, b) => a.title.localeCompare(b.title));

export const aiDocs = [
  {
    id: "chain-of-thought",
    title: "Chain of Thought",
    description: "Present a sequence of visible reasoning steps and their status.",
  },
  {
    id: "chat",
    title: "Chat",
    description: "Compose messages, tools, and input into a conversational interface.",
  },
  {
    id: "checkpoint",
    title: "Checkpoint",
    description: "Mark a saved point in a conversation with an action to restore it.",
  },
  {
    id: "confirmation",
    title: "Confirmation",
    description: "Ask a user to approve or reject an action before it runs.",
  },
  {
    id: "context",
    title: "Context",
    description: "Show token usage and the available context window.",
  },
  {
    id: "file-tree",
    title: "File Tree",
    description: "Browse nested files and folders in a compact tree.",
  },
  {
    id: "inline-citation",
    title: "Inline Citation",
    description: "Connect a passage of text to its supporting sources.",
  },
  {
    id: "message",
    title: "Message",
    description: "Render conversation messages with formatted text and actions.",
  },
  {
    id: "model-selector",
    title: "Model Selector",
    description: "Search and choose a model for a conversation.",
  },
  {
    id: "plan",
    title: "Plan",
    description: "Show a proposed plan with supporting details and actions.",
  },
  {
    id: "prompt-input",
    title: "Prompt Input",
    description: "Compose a prompt with attachments and submission controls.",
  },
  {
    id: "queue",
    title: "Queue",
    description: "Display queued messages and tasks with their status.",
  },
  {
    id: "reasoning",
    title: "Reasoning",
    description: "Expand or collapse a model's visible reasoning text.",
  },
  { id: "sources", title: "Sources", description: "Collect the references used in a response." },
  {
    id: "stack-trace",
    title: "Stack Trace",
    description: "Inspect an error and the stack frames that led to it.",
  },
  {
    id: "subagent",
    title: "Subagent",
    description: "Show a delegated task, its progress, and its result.",
  },
  {
    id: "suggestion",
    title: "Suggestion",
    description: "Offer suggested prompts as selectable actions.",
  },
  { id: "task", title: "Task", description: "Group the steps and files involved in a task." },
  {
    id: "terminal",
    title: "Terminal",
    description: "Display command output in a terminal-style panel.",
  },
  {
    id: "test-results",
    title: "Test Results",
    description: "Summarize test results and inspect individual failures.",
  },
  {
    id: "tool",
    title: "Tool",
    description: "Display a tool invocation with its input, output, and status.",
  },
];

export const foundationDocs = [
  {
    id: "introduction",
    title: "Introduction",
    description: "Flora's shared React components, styles, and conversational patterns.",
  },
  {
    id: "installation",
    title: "Installation",
    description: "Use Florets in an application in the Flora workspace.",
  },
  {
    id: "theming",
    title: "Theming",
    description: "Use shared color tokens and switch between light and dark themes.",
  },
  {
    id: "typography",
    title: "Typography",
    description: "Headings and text with a consistent scale and semantic markup.",
  },
  {
    id: "links",
    title: "Links",
    description: "Navigate with a text link or an anchor styled as a button.",
  },
  {
    id: "feedback",
    title: "Feedback",
    description: "Announce loading progress with a readable status message.",
  },
  { id: "identity", title: "Identity", description: "Use Flora's flower mark and wordmark." },
];
