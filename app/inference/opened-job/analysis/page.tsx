"use client";

import { Suspense } from "react";
import ClientDetailedAnalysisPage from "./client";

export default function Page() {
  return (
    <Suspense fallback={<div />}> 
      <ClientDetailedAnalysisPage />
    </Suspense>
  );
}

