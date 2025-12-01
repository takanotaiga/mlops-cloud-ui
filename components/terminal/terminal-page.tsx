"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  HStack,
  IconButton,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useColorModeValue } from "@/components/ui/color-mode";
import {
  LuActivity,
  LuSend,
  LuTerminal,
  LuTrash2,
} from "react-icons/lu";

type LogEntry = {
  type: "system" | "output" | "error" | "input";
  text: string;
  at: number;
};

type WsMessage =
  | { type: "ready"; sessionId?: string }
  | { type: "output"; sessionId?: string; data?: string }
  | { type: "exit"; sessionId?: string; code?: number }
  | { type: "pong"; sessionId?: string }
  | { type: string; [key: string]: unknown };

const MAX_LOG_LINES = 600;

function useLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const push = (entry: Omit<LogEntry, "at">) => {
    setEntries((prev) => {
      const next = [...prev, { ...entry, at: Date.now() }];
      if (next.length > MAX_LOG_LINES) {
        return next.slice(next.length - MAX_LOG_LINES);
      }
      return next;
    });
  };

  const clear = () => setEntries([]);

  return { entries, push, clear };
}

export default function TerminalPage() {
  const heroBg = useColorModeValue(
    "linear-gradient(135deg, #f8fafc 0%, #eef2ff 35%, #e0f2fe 100%)",
    "linear-gradient(135deg, #0b1222 0%, #0f172a 35%, #0b1222 100%)",
  );
  const panelBg = useColorModeValue("white", "gray.800");
  const panelBorder = useColorModeValue("gray.200", "gray.700");
  const terminalBg = useColorModeValue("#0f172a", "#0b1020");
  const terminalText = useColorModeValue("teal.100", "teal.100");
  const defaultEndpoint = useMemo(() => {
    if (typeof window === "undefined") return "ws://127.0.0.1:8765";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.hostname || "127.0.0.1";
    const port = "8765";
    return `${proto}://${host}:${port}`;
  }, []);
  const [cols, setCols] = useState(120);
  const [rows, setRows] = useState(32);
  const [status, setStatus] = useState<"idle" | "connecting" | "ready" | "closed" | "error">("idle");
  const [inputValue, setInputValue] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const { entries, push, clear } = useLog();

  const fullUrl = useMemo(() => {
    const base = defaultEndpoint.trim();
    const withProtocol = base.startsWith("ws://") || base.startsWith("wss://") ? base : `ws://${base}`;
    return `${withProtocol.replace(/\/$/, "")}`;
  }, [defaultEndpoint]);

  const isOpen = socketRef.current?.readyState === WebSocket.OPEN;
  const autoConnectRef = useRef(false);

  const appendSystem = (text: string) => push({ type: "system", text });
  const appendOutput = (text: string) => push({ type: "output", text });
  const appendError = (text: string) => push({ type: "error", text });

  useEffect(() => {
    if (entries.length === 0) return;
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [entries]);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const computeSize = () => {
      const width = outputRef.current?.clientWidth ?? window.innerWidth;
      const height = window.innerHeight;
      const approxCharWidth = 8;
      const approxCharHeight = 20;
      const nextCols = Math.max(60, Math.floor(width / approxCharWidth));
      const nextRows = Math.max(18, Math.floor((height - 260) / approxCharHeight));
      setCols(nextCols);
      setRows(nextRows);
    };
    computeSize();
    window.addEventListener("resize", computeSize);
    return () => window.removeEventListener("resize", computeSize);
  }, []);

  useEffect(() => {
    if (autoConnectRef.current) return;
    autoConnectRef.current = true;
    connect();
  }, []);

  useEffect(() => {
    if (!isOpen || status !== "ready") return;
    try {
      socketRef.current?.send(JSON.stringify({ type: "resize", cols, rows }));
      appendSystem(`Resized terminal to ${cols}x${rows}`);
    } catch (err) {
      appendError(`Resize failed: ${String(err)}`);
    }
  }, [cols, rows, isOpen, status]);

  const connect = () => {
    if (isOpen) {
      socketRef.current?.close();
    }
    try {
      const ws = new WebSocket(fullUrl);
      socketRef.current = ws;
      setStatus("connecting");
      appendSystem(`Connecting to ${fullUrl} ...`);

      ws.onopen = () => {
        appendSystem("WebSocket open. Waiting for ready …");
      };

      ws.onerror = () => {
        setStatus("error");
        appendError("WebSocket error. Check endpoint and server status.");
      };

      ws.onclose = (event) => {
        setStatus("closed");
        appendSystem(`Connection closed${typeof event.code === "number" ? ` (code ${event.code})` : ""}.`);
      };

      ws.onmessage = (event) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(String(event.data));
        } catch (err) {
          appendError(`Non-JSON message: ${String(event.data)}`);
          return;
        }

        if (!msg?.type) {
          appendError(`Unknown frame: ${String(event.data)}`);
          return;
        }

        switch (msg.type) {
          case "ready": {
            setStatus("ready");
            appendSystem("Shell is ready. Send commands to begin.");
            try {
              ws.send(JSON.stringify({ type: "resize", cols, rows }));
            } catch (err) {
              appendError(`Resize failed: ${String(err)}`);
            }
            break;
          }
          case "output": {
            const data = (msg as any)?.data ?? "";
            appendOutput(String(data));
            break;
          }
          case "exit": {
            const code = (msg as any)?.code;
            setStatus("closed");
            appendSystem(`Shell exited${typeof code === "number" ? ` (code ${code})` : ""}.`);
            ws.close();
            break;
          }
          case "pong": {
            appendSystem("pong");
            break;
          }
          default: {
            appendSystem(`Received ${msg.type}`);
          }
        }
      };
    } catch (err) {
      setStatus("error");
      appendError(`Failed to connect: ${String(err)}`);
    }
  };

  const sendInput = () => {
    if (!isOpen) {
      appendSystem("Not connected. Open a session first.");
      return;
    }
    if (!inputValue.trim()) return;
    const payload = { type: "input", data: inputValue.endsWith("\n") ? inputValue : `${inputValue}\n` };
    try {
      socketRef.current?.send(JSON.stringify(payload));
      push({ type: "input", text: `$ ${inputValue}` });
      setInputValue("");
    } catch (err) {
      appendError(`Failed to send input: ${String(err)}`);
    }
  };

  const sendPing = () => {
    if (!isOpen) {
      appendSystem("Not connected. Open a session first.");
      return;
    }
    try {
      socketRef.current?.send(JSON.stringify({ type: "ping" }));
      appendSystem("ping →");
    } catch (err) {
      appendError(`Ping failed: ${String(err)}`);
    }
  };

  const softClear = () => {
    clear();
    appendSystem("Console cleared.");
  };

  type AnsiStyle = { fg?: string; bg?: string; bold?: boolean };

  const ansiColor = (code: number): string | undefined => {
    const base: Record<number, string> = {
      30: "#6b7280",
      31: "#ef4444",
      32: "#10b981",
      33: "#eab308",
      34: "#3b82f6",
      35: "#a855f7",
      36: "#06b6d4",
      37: "#f3f4f6",
      90: "#9ca3af",
      91: "#f87171",
      92: "#34d399",
      93: "#facc15",
      94: "#60a5fa",
      95: "#c084fc",
      96: "#22d3ee",
      97: "#ffffff",
    };
    return base[code];
  };

  const parseAnsi = (input: string) => {
    const nodes: { text: string; style: AnsiStyle }[] = [];
    let i = 0;
    let buffer = "";
    let style: AnsiStyle = {};

    const flush = () => {
      if (buffer.length === 0) return;
      nodes.push({ text: buffer, style: { ...style } });
      buffer = "";
    };

    while (i < input.length) {
      const ch = input[i];
      if (ch === "\x1b") {
        const next = input[i + 1];
        // OSC
        if (next === "]") {
          const end = input.indexOf("\x07", i + 2);
          const st = input.indexOf("\x1b\\", i + 2);
          let term = -1;
          if (end !== -1 && st !== -1) term = Math.min(end, st + 2);
          else term = end !== -1 ? end + 1 : st !== -1 ? st + 2 : input.length;
          i = term;
          continue;
        }
        // CSI
        if (next === "[") {
          let end = i + 2;
          while (end < input.length && !/[A-Za-z]/.test(input[end])) end++;
          if (end >= input.length) break;
          const cmd = input[end];
          const params = input.slice(i + 2, end).split(";").filter(Boolean).map((n) => Number(n));
          if (cmd === "m") {
            if (params.length === 0) {
              style = {};
            }
            for (const code of params) {
              if (code === 0) {
                style = {};
              } else if (code === 1) {
                style.bold = true;
              } else if (code === 22) {
                style.bold = false;
              } else if (code >= 30 && code <= 37 || (code >= 90 && code <= 97)) {
                style.fg = ansiColor(code);
              } else if (code === 39) {
                style.fg = undefined;
              } else if (code >= 40 && code <= 47) {
                style.bg = ansiColor(code - 10);
              } else if (code >= 100 && code <= 107) {
                style.bg = ansiColor(code - 60);
              } else if (code === 49) {
                style.bg = undefined;
              }
            }
          }
          // Skip other CSI commands (e.g., K, H)
          i = end + 1;
          continue;
        }
      }
      buffer += ch;
      i++;
    }
    flush();
    return nodes;
  };

  const renderAnsiText = (value: string, keyPrefix: string) => {
    const nodes = parseAnsi(value);
    if (nodes.length === 0) return value;
    return nodes.map((seg, idx) => (
      <Box
        as="span"
        key={`${keyPrefix}-${idx}`}
        color={seg.style.fg || undefined}
        bg={seg.style.bg || undefined}
        fontWeight={seg.style.bold ? "bold" : "normal"}
        whiteSpace="pre-wrap"
      >
        {seg.text}
      </Box>
    ));
  };

  return (
    <Box bgGradient={heroBg} minH="calc(100vh - 64px)" py={12}>
      <VStack gap={8} maxW="100%" mx="auto" px={{ base: 4, md: 8 }} align="stretch">
        <Box
          rounded="2xl"
          bg={panelBg}
          borderWidth="1px"
          borderColor={panelBorder}
          shadow="md"
          overflow="hidden"
          w="100%"
        >
          <Box px={{ base: 4, md: 6 }} py={4} borderBottomWidth="1px" borderColor={panelBorder} bg="whiteAlpha.70">
            <HStack justify="space-between" align="center">
              <HStack gap={3}>
                <Box
                  w="36px"
                  h="36px"
                  rounded="lg"
                  bgGradient="linear(to-br, teal.500, cyan.500)"
                  display="grid"
                  placeItems="center"
                  color="white"
                >
                  <LuTerminal />
                </Box>
                <VStack align="start" gap={0}>
                  <Text fontWeight="semibold">Interactive shell</Text>
                  <Text color="gray.600" fontSize="sm">Live stdout/stderr stream</Text>
                </VStack>
              </HStack>
              <HStack gap={2}>
                <IconButton aria-label="Ping" size="sm" variant="ghost" onClick={sendPing}>
                  <LuActivity />
                </IconButton>
                <IconButton aria-label="Clear output" size="sm" variant="ghost" onClick={softClear}>
                  <LuTrash2 />
                </IconButton>
              </HStack>
            </HStack>
          </Box>

          <Box px={{ base: 4, md: 6 }} py={4} bg={terminalBg} color={terminalText} minH="420px" maxH="560px" overflowY="auto" ref={outputRef}>
            <VStack align="start" gap={1}>
              {entries.length === 0 ? (
                <Text color="teal.200" fontFamily="mono">
                  Waiting for output...
                </Text>
              ) : (
                entries.map((entry) => (
                  <Text
                    key={`${entry.at}-${entry.text.slice(0, 12)}`}
                    fontFamily="mono"
                    fontSize="sm"
                    whiteSpace="pre-wrap"
                    color={
                      entry.type === "error"
                        ? "red.200"
                        : entry.type === "system"
                          ? "cyan.200"
                          : entry.type === "input"
                            ? "green.200"
                            : undefined
                    }
                  >
                    {entry.type === "output" ? renderAnsiText(entry.text, `${entry.at}`) : entry.text}
                  </Text>
                ))
              )}
            </VStack>
          </Box>

          <Box px={{ base: 4, md: 6 }} py={4} borderTopWidth="1px" borderColor={panelBorder} bg="whiteAlpha.80">
            <Text mb={2} fontWeight="semibold">Send command</Text>
            <Textarea
              placeholder="Type a command, press Enter to send. Shift+Enter adds a newline."
              rows={3}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendInput();
                }
              }}
              fontFamily="mono"
            />
            <HStack justify="flex-end" mt={3}>
              <Button size="sm" onClick={sendInput} colorPalette="teal">
                <HStack gap={2}>
                  <LuSend />
                  <Text>Send</Text>
                </HStack>
              </Button>
            </HStack>
          </Box>
        </Box>
      </VStack>
    </Box>
  );
}
