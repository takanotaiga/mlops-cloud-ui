import { Suspense } from "react";
import TerminalPage from "@/components/terminal/terminal-page";

export default function Page() {
  return (
    <Suspense fallback={<div />}>
      <TerminalPage />
    </Suspense>
  );
}
