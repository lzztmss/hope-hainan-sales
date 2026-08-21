import { useCallback, useEffect, useMemo, useState } from "react";

import "./pagination.css";

export const LIST_PAGE_SIZE = 20;

export const usePagination = <Item,>(
  items: readonly Item[],
  pageSize = LIST_PAGE_SIZE,
) => {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const visibleItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const resetPage = useCallback(() => setPage(1), []);

  return { page, pageSize, resetPage, setPage, totalPages, visibleItems };
};

interface PaginationProps {
  page: number;
  pageSize?: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

export const Pagination = ({
  onPageChange,
  page,
  pageSize = LIST_PAGE_SIZE,
  totalItems,
}: PaginationProps) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalItems);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter((value) => value === 1 || value === totalPages || Math.abs(value - page) <= 1);

  return (
    <nav aria-label="列表分页" className="app-pagination">
      <span className="app-pagination__summary">
        共 {totalItems} 条，当前显示 {first}–{last} 条
      </span>
      <div className="app-pagination__controls">
        <button disabled={page === 1} onClick={() => onPageChange(page - 1)} type="button">
          上一页
        </button>
        {pageNumbers.map((value, index) => {
          const previous = pageNumbers[index - 1];
          return (
            <span className="app-pagination__page-slot" key={value}>
              {previous && value - previous > 1 ? <span aria-hidden="true">…</span> : null}
              <button
                aria-current={value === page ? "page" : undefined}
                className={value === page ? "is-current" : undefined}
                onClick={() => onPageChange(value)}
                type="button"
              >
                {value}
              </button>
            </span>
          );
        })}
        <button disabled={page === totalPages} onClick={() => onPageChange(page + 1)} type="button">
          下一页
        </button>
      </div>
    </nav>
  );
};
