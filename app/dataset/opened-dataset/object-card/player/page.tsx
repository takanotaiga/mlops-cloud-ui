import { Suspense } from "react";
import PlayerClient from "./player-client";

export default function Page() {
  return (
    <Suspense fallback={<div />}> 
      <PlayerClient />
    </Suspense>
  );
}

