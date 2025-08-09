import { Suspense } from "react"
import ClientObjectCardPage from "./client"

export default function Page() {
  return (
    <Suspense fallback={<div />}> 
      <ClientObjectCardPage />
    </Suspense>
  )
}

