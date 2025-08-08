"use client"

import { ChakraProvider, defaultSystem } from "@chakra-ui/react"
import { ColorModeProvider } from "@/components/ui/color-mode"

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <ChakraProvider value={defaultSystem}>
      <ColorModeProvider forcedTheme="light" attribute="class" disableTransitionOnChange>
        {props.children}
      </ColorModeProvider>
    </ChakraProvider>
  )
}
