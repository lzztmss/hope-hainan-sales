import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { SalesSystemApp } from "./SalesSystemApp";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("未找到应用挂载节点");
}

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <SalesSystemApp />
    </AppErrorBoundary>
  </StrictMode>,
);
