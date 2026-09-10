import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Pagination, usePagination } from "./Pagination";

const Fixture = () => {
  const [items] = useState(Array.from({ length: 45 }, (_, index) => `第 ${index + 1} 条`));
  const pagination = usePagination(items);
  return (
    <>
      <div>{pagination.visibleItems.map((item) => <span key={item}>{item}</span>)}</div>
      <Pagination
        onPageChange={pagination.setPage}
        page={pagination.page}
        totalItems={items.length}
      />
    </>
  );
};

describe("统一列表分页", () => {
  it("每页展示 20 条并可切换到下一页", () => {
    render(<Fixture />);

    expect(screen.getByText("第 1 条")).toBeInTheDocument();
    expect(screen.getByText("第 20 条")).toBeInTheDocument();
    expect(screen.queryByText("第 21 条")).not.toBeInTheDocument();
    expect(screen.getByText("共 45 条，当前显示 1–20 条")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("第 21 条")).toBeInTheDocument();
    expect(screen.getByText("第 40 条")).toBeInTheDocument();
    expect(screen.getByText("共 45 条，当前显示 21–40 条")).toBeInTheDocument();
  });
});
