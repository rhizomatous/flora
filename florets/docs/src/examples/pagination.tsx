import { useState } from "react";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@flora/florets";

export function Example() {
  const [page, setPage] = useState(1);
  return (
    <Pagination>
      <PaginationContent>
        {[1, 2, 3].map((number) => (
          <PaginationItem key={number}>
            <PaginationLink
              href="#example-pagination"
              isActive={page === number}
              onClick={(event) => {
                event.preventDefault();
                setPage(number);
              }}
            >
              {number}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
