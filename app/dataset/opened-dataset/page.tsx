import { Suspense } from "react";
import ClientOpenedDatasetPage from "./client";

export default function Page() {
  return (
    <Suspense fallback={<div />}> 
      <ClientOpenedDatasetPage />
    </Suspense>
  );
}

