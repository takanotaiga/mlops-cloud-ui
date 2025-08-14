import { Suspense } from "react";
import { HomeHero } from "@/components/home/hero";
import { HomeFeatures } from "@/components/home/features";

export default function Page() {
  return (
    <Suspense fallback={<div />}> 
      <HomeHero />
      <HomeFeatures />
    </Suspense>
  );
}
