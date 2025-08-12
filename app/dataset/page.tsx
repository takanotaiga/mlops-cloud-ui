import { Suspense } from "react"
import DatasetListPage from "@/components/dataset/dataset-list-page"

export default function Page() {
  return (
    <Suspense fallback={<div />}> 
      <DatasetListPage />
    </Suspense>
  )
}
