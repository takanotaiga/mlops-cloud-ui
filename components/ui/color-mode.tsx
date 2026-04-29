"use client";

import type { IconButtonProps, SpanProps } from "@chakra-ui/react";
import { ClientOnly, IconButton, Skeleton, Span } from "@chakra-ui/react";
import * as React from "react";
import { LuMoon, LuSun } from "react-icons/lu";

export type ColorMode = "light" | "dark"

export interface UseColorModeReturn {
  colorMode: ColorMode
  setColorMode: (colorMode: ColorMode) => void
  toggleColorMode: () => void
}

export interface ColorModeProviderProps {
  children?: React.ReactNode
  forcedTheme?: ColorMode
  defaultTheme?: ColorMode
  attribute?: string
  disableTransitionOnChange?: boolean
}

const ColorModeContext = React.createContext<UseColorModeReturn | undefined>(undefined);

export function ColorModeProvider({
  children,
  forcedTheme,
  defaultTheme = "light",
}: ColorModeProviderProps) {
  const [theme, setTheme] = React.useState<ColorMode>(defaultTheme);
  const colorMode = forcedTheme ?? theme;
  const setColorMode = React.useCallback((next: ColorMode) => {
    if (!forcedTheme) {
      setTheme(next);
    }
  }, [forcedTheme]);
  const toggleColorMode = React.useCallback(() => {
    if (!forcedTheme) {
      setTheme((current) => current === "dark" ? "light" : "dark");
    }
  }, [forcedTheme]);
  const value = React.useMemo<UseColorModeReturn>(() => ({
    colorMode,
    setColorMode,
    toggleColorMode,
  }), [colorMode, setColorMode, toggleColorMode]);

  return (
    <ColorModeContext.Provider value={value}>
      {children}
    </ColorModeContext.Provider>
  );
}

export function useColorMode(): UseColorModeReturn {
  const context = React.useContext(ColorModeContext);
  if (!context) {
    throw new Error("useColorMode must be used within ColorModeProvider");
  }
  return context;
}

export function useColorModeValue<T>(light: T, dark: T) {
  const { colorMode } = useColorMode();
  return colorMode === "dark" ? dark : light;
}

export function ColorModeIcon() {
  const { colorMode } = useColorMode();
  return colorMode === "dark" ? <LuMoon /> : <LuSun />;
}

interface ColorModeButtonProps extends Omit<IconButtonProps, "aria-label"> {}

export const ColorModeButton = React.forwardRef<
  HTMLButtonElement,
  ColorModeButtonProps
>(function ColorModeButton(props, ref) {
  const { toggleColorMode } = useColorMode();
  return (
    <ClientOnly fallback={<Skeleton boxSize="8" />}>
      <IconButton
        onClick={toggleColorMode}
        variant="ghost"
        aria-label="Toggle color mode"
        size="sm"
        ref={ref}
        {...props}
        css={{
          _icon: {
            width: "5",
            height: "5",
          },
        }}
      >
        <ColorModeIcon />
      </IconButton>
    </ClientOnly>
  );
});

export const LightMode = React.forwardRef<HTMLSpanElement, SpanProps>(
  function LightMode(props, ref) {
    return (
      <Span
        color="fg"
        display="contents"
        className="chakra-theme light"
        colorPalette="gray"
        colorScheme="light"
        ref={ref}
        {...props}
      />
    );
  },
);

export const DarkMode = React.forwardRef<HTMLSpanElement, SpanProps>(
  function DarkMode(props, ref) {
    return (
      <Span
        color="fg"
        display="contents"
        className="chakra-theme dark"
        colorPalette="gray"
        colorScheme="dark"
        ref={ref}
        {...props}
      />
    );
  },
);
