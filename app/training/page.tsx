import { Suspense } from "react";
import TrainingJobsPage from "@/components/training/training-jobs-page";

export default function Page() {
  return (
    <Suspense fallback={<div />}> 
      <TrainingJobsPage />
    </Suspense>
  );
}
