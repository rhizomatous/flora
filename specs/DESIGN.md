# Flora

## Overview 

Flora is an autonomous self-hosted coding agent. With Flora you can describe a task, let an agent work asynchronously, return to a persistent conversation, review changes, and request a draft pull request. If more details are needed, see [specs/PRD.md](specs/PRD.md).

## Brand

### Personality

Friendly, quiet, capable. The app uses restrained greyscale surfaces, system typography, and a dark default theme.

### Design Principles

- Make execution state and saved work easy to understand.
- Keep persistent conversations and review central to the workflow.
- Favor simple, familiar controls.
- Absolutely no decorative text. Only include text content that helps the user achieve their goal.

### Identity marks

#### Flora character

This is Flora:

```
(◠‿◠✿)
```

The Flora character is used in landing pages as a friendly face for the product.

#### Flower mark

Use the [Flora SVG mark](../florets/src/assets/flora.svg) for Flora's visual identity. It has five uneven petals, a black contour with extra depth along the lower-right edge, and an even white sticker rim. Keep its black-and-white colors and transparent background on both light and dark surfaces.

In UI code, use `FlowerMark` from `@flora/florets`, or `Wordmark` to include the Flora name. Use the same SVG for favicons and standalone artwork instead of a Unicode flower. The mark can appear small in UI, animate as a busy indicator, or scale up as a logo. Give icon-only controls an accessible name; `FlowerMark` itself is decorative.

## Colors

Flora uses a primarily greyscale color system, with emphasis on black & white ends of the spectrum. Flora sparingly uses peach and green as brand colors. Flora supports dark mode for all pages and components. Dark mode is the default mode.

### Brand Palette

TBD: leaf green #39745B, blossom peach #EF9D83 ?

### Surface Palette

Use four semantic surfaces across Flora and Florets. In dark mode, each level is lighter than the previous one.

| Token | Role | Used for |
| --- | --- | --- |
| `--surface-shell` | Darkest background | Sidebar and surrounding app chrome |
| `--surface-canvas` | Main working surface | Page content and its header |
| `--surface-panel` | Contained content | Cards, grouped settings, text fields, textareas, and the composer |
| `--surface-overlay` | Floating content | Menus, popovers, dialogs, sheets, and the command palette |

Use the matching Tailwind utilities, such as `bg-surface-panel`. Surface names describe their role rather than a particular component. Both themes use these roles, with colors defined in the shared stylesheet.

Ordinary controls use `--control-background`, which maps to the panel surface, and the shared `--border` for their outline. Madlib pickers use `--madlib-background` and `--madlib-hover` to distinguish inline choices within a panel. Standalone inputs and inputs inside panels share the same fill. Input groups own the fill; their inner inputs remain transparent.

Containment does not automatically add elevation. Use Card for contained content and `variant="flush"` for groups of divided settings rows. Keep ordinary list rows transparent at rest. Use `--border` for canvas outlines, cards, dividers, controls, and overlays. Both themes define one shared neutral border color.

Use `--control-hover` for control hover fills and retain visible keyboard focus and invalid-field indicators.

### Content Palette

TBD: snow

## Typography

Use the shared Geist sans-serif font for interface text and Geist Mono for code. Use Florets Heading and Text components and their shared styles.

| Role | Treatment |
| --- | --- |
| Detail-page title | Heading level 1 or EditableText title: 24px, medium weight |
| Subheading | Heading level 2: 18px, medium weight |
| Section heading | Heading level 3: 16px, medium weight; compact form sections may use 14px |
| Field label | FieldLabel: 14px, medium weight |
| Controls and helper text | 14px; muted foreground for supporting text |
| Small metadata | 12px |

Keep text sizes consistent across viewport widths. Use semantic heading levels for document structure and adjust their visual size when the context calls for a compact heading.

## Spacing and alignment

Use SectionStack for gaps between groups: 40px at narrow widths and 48px at wider widths. Section separates its header from content by 16px. SectionHeader keeps a heading and its description 8px apart.

Use SectionHeader inset above panels to align its text with panel content. Panel text uses a 16px inset inside the border. SettingsRow uses 16px horizontal and 12px vertical padding, with 4px between its label and description. Keep related controls compact while giving distinct sections room.

Keep each settings label and description together beside its control. Let text wrap and controls size to their content. Narrow layouts adapt through wrapping and available width; preserve typography and padding. Use an explicit stacked field layout when a complex control needs the full width.

## Components and composition

| Need | Use |
| --- | --- |
| Named object's editable title and description | EditableText; save with the containing form |
| Section rhythm and aligned headings | SectionStack, Section, SectionHeader inset |
| Related settings in a divided panel | SettingsGroup and SettingsRow |
| Ordinary form entry | FieldLabel, Input, Textarea, NativeSelect |
| Select sized to its current choice | NativeSelect width="content" |
| Choices embedded in a sentence | MadlibPicker with a menu or popover; MadlibSelect for a native select |
| Text entry with supporting controls | TextareaPanel, TextareaPanelInput, TextareaPanelFooter |

SettingsRow builds on Field. Connect its label to the control with htmlFor and id. When it has helper text, give that text a descriptionId and reference it from the control's aria-describedby. Labels remain useful even when descriptions are omitted.

Madlib pickers use a distinct fill, compact consistent sizing, and no caret. Put connecting words such as “on” and “in” inside the picker using its prefix. Keep multi-select menus open while choosing multiple values and summarize the selection in the trigger.

TextareaPanel owns the surface and border around text entry and its footer. Put useful supporting controls in the footer, such as model selection or output format. Application-specific discovery, persistence, and execution behavior stays in Flora; share its UI across application screens.

See the [composed settings example](../florets/docs/src/examples/upstream/settings-group.tsx) for wide and narrow layouts with long labels. [Automations](../web/src/automations.tsx) demonstrates the same components in a saved detail form.

## Interaction and copy

EditableText uses a native input or textarea with transparent fill and border at rest and during focus; its caret indicates text editing. Textarea keeps its panel treatment during focus. Other form controls and picker triggers retain their visible keyboard focus indicators. Preserve disabled states, invalid-field indicators, and accessible labels when composing controls.

Use short descriptions when they explain the setting or help the user choose. Helper phrases omit trailing periods. Keep validation errors specific to the action that needs correction.

Use explicit Save for forms that collect several edits. Changing or blurring an editable title follows the containing form's save behavior. Keep drafts intact on errors.

## Page structure

Detail screens sit on the app's rounded canvas. Keep the canvas within the viewport, scroll its content internally, and keep topbar actions available. Render a topbar when it contains navigation or actions.

Use shared card, control, and overlay radii and shadows. Cards and dividers use the shared neutral border; floating menus and dialogs use the overlay surface and their shared shadow treatment.

Check wide and narrow layouts in both themes, including long values, wrapping, keyboard focus, disabled and invalid controls, and internal scrolling.
