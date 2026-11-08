import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@flora/florets";

export function Example() {
  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="details">
        <AccordionTrigger>What is Florets?</AccordionTrigger>
        <AccordionContent>Flora’s shared shadcn Radix/Rhea component library.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="theme">
        <AccordionTrigger>Does it support dark mode?</AccordionTrigger>
        <AccordionContent>Use the theme switch to try both palettes.</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
