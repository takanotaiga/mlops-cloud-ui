import { Suspense } from "react"
import InferenceJobsPage from "@/components/inference/inference-jobs-page"

export default function Page() {
  return (
    <Suspense fallback={<div />}> 
      <InferenceJobsPage />
    </Suspense>
  )
}
