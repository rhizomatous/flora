import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@flora/florets";

export function Example() {
  return (
    <div className="w-full px-10">
      <Carousel>
        <CarouselContent>
          {[1, 2, 3].map((slide) => (
            <CarouselItem key={slide}>
              <div className="flex h-40 items-center justify-center rounded-xl bg-muted text-3xl font-semibold">
                {slide}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>
    </div>
  );
}
