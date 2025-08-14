import { Suspense } from "react";
import ClientOpenedJobPage from "./client";

export default function Page() {
  return (
    <Suspense fallback={<div />}> 
      <ClientOpenedJobPage />
    </Suspense>
  );
}

