"use client";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ColorModeProvider } from "@/components/ui/color-mode";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SurrealProvider } from "@/components/surreal/SurrealProvider";
import React from "react";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";

const queryClient = new QueryClient();

export default function RootLayout(props: { children: React.ReactNode; initialLang?: "en" | "ja" }) {
  return (
    <ChakraProvider value={defaultSystem}>
      <ColorModeProvider forcedTheme="light" attribute="class" disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>
          <LanguageProvider initialLang={props.initialLang}>
            <SurrealProvider autoConnect>
              {props.children}
            </SurrealProvider>
          </LanguageProvider>
        </QueryClientProvider>
      </ColorModeProvider>
    </ChakraProvider>
  );
}
