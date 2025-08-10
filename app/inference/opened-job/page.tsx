import { Suspense } from "react"
import ClientOpenedInferenceJobPage from "./client"

export default function Page() {
  return (
    <Suspense fallback={<div />}> 
      <ClientOpenedInferenceJobPage />
    </Suspense>
  )
}

