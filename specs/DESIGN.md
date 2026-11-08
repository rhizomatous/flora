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

TBD: ink

### Content Palette

TBD: snow

## Typography

### Font Stack

TBD: needs a good sans for interface and headers, and a monospace for code stuff. start with ShadCN/Tailwind defaults?

### Type Scale

TBD

## Spacing

TBD

## Border Radius

TBD

## Shadows

TBD

## Components

TBD: Use ShadCN, extract shared components as a library

## Do's and Don'ts

TBD
