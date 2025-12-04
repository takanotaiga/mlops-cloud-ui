"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  HStack,
  IconButton,
  Input,
  Button,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useColorModeValue } from "@/components/ui/color-mode";
import {
  LuCopy,
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
  const heroBg = useColorModeValue("white", "gray.900");
  const panelBg = useColorModeValue("white", "gray.900");
  const panelBorder = useColorModeValue("gray.200", "gray.700");
  const terminalBg = useColorModeValue("#0f172a", "#0b1020");
  const terminalText = useColorModeValue("teal.100", "teal.100");
  const statusTextColor = useColorModeValue("gray.600", "gray.300");
  const defaultEndpoint = useMemo(() => {
    if (typeof window === "undefined") return "ws://127.0.0.1:8765";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.hostname || "127.0.0.1";
    const port = "8765";
    return `${proto}://${host}:${port}`;
  }, []);
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cols, setCols] = useState(120);
  const [rows, setRows] = useState(32);
  const [status, setStatus] = useState<"idle" | "connecting" | "ready" | "closed" | "error">("idle");
  const [inputValue, setInputValue] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const { entries, push, clear } = useLog();

  const fullUrl = useMemo(() => {
    const base = endpoint.trim();
    const withProtocol = base.startsWith("ws://") || base.startsWith("wss://") ? base : `ws://${base}`;
    return `${withProtocol.replace(/\/$/, "")}`;
  }, [endpoint]);

  const isOpen = socketRef.current?.readyState === WebSocket.OPEN;

  const appendSystem = (text: string) => push({ type: "system", text });
  const appendOutput = (text: string) => push({ type: "output", text });
  const appendError = (text: string) => push({ type: "error", text });

  useEffect(() => {
    if (entries.length === 0) return;
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
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
    if (!isOpen || status !== "ready") return;
    try {
      socketRef.current?.send(JSON.stringify({ type: "resize", cols, rows }));
      appendSystem(`Resized terminal to ${cols}x${rows}`);
    } catch (err) {
      appendError(`Resize failed: ${String(err)}`);
    }
  }, [cols, rows, isOpen, status]);

  const connect = () => {
    if (!endpoint.trim()) {
      appendError("Endpoint is required to connect.");
      return;
    }
    if (!username.trim() || !password.trim()) {
      appendError("Username and password are required to authenticate.");
      return;
    }
    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      socketRef.current.onmessage = null;
      socketRef.current.onopen = null;
      socketRef.current.close();
    }
    try {
      const ws = new WebSocket(fullUrl);
      socketRef.current = ws;
      setStatus("connecting");
      appendSystem(`Connecting to ${fullUrl} ...`);

      ws.onopen = () => {
        appendSystem("WebSocket open. Sending credentials ...");
        try {
          ws.send(
            JSON.stringify({
              type: "auth",
              username: username.trim(),
              password,
              cols,
              rows,
            }),
          );
          appendSystem("Auth frame sent. Waiting for ready ...");
        } catch (err) {
          setStatus("error");
          appendError(`Failed to send auth frame: ${String(err)}`);
        }
      };

      ws.onerror = () => {
        setStatus("error");
        appendError("WebSocket error. Check endpoint and server status.");
      };

      ws.onclose = (event) => {
        setStatus((prev) => (prev === "error" ? "error" : "closed"));
        appendSystem(
          `Connection closed${typeof event.code === "number" ? ` (code ${event.code})` : ""}${
            event.reason ? `: ${event.reason}` : "."
          }`,
        );
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
          case "error": {
            const message = (msg as any)?.message ?? "error";
            setStatus("error");
            appendError(`Server error: ${String(message)}`);
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
    if (!isOpen || status !== "ready") {
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

  const softClear = () => {
    clear();
    appendSystem("Console cleared.");
  };

  const copyAll = async () => {
    try {
      const text = entries.map((entry) => entry.text).join("\n");
      await navigator.clipboard.writeText(text);
      appendSystem("Copied terminal output to clipboard.");
    } catch (err) {
      appendError(`Copy failed: ${String(err)}`);
    }
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
    <Box bg={heroBg} minH="calc(100vh - 64px)" py={4}>
      <VStack gap={4} maxW="100%" mx="auto" px={{ base: 3, md: 4 }} align="stretch">
        <Box
          rounded="lg"
          bg={panelBg}
          borderWidth="1px"
          borderColor={panelBorder}
          shadow="sm"
          overflow="hidden"
          w="100%"
          display="flex"
          flexDir="column"
          minH="0"
        >
          <Box
            px={{ base: 3, md: 4 }}
            py={2}
            borderBottomWidth="1px"
            borderColor={panelBorder}
            bg="whiteAlpha.60"
            borderTopRadius="lg"
          >
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
                </VStack>
              </HStack>
              <HStack gap={2}>
                <IconButton aria-label="Copy output" size="sm" variant="ghost" onClick={copyAll}>
                  <LuCopy />
                </IconButton>
                <IconButton aria-label="Clear output" size="sm" variant="ghost" onClick={softClear}>
                  <LuTrash2 />
                </IconButton>
              </HStack>
            </HStack>
            <HStack gap={2} mt={3} flexWrap="wrap">
              <Input
                placeholder="ws://host:8765"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                size="sm"
                maxW="260px"
              />
              <Input
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                size="sm"
                maxW="180px"
              />
              <Input
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    connect();
                  }
                }}
                type="password"
                size="sm"
                maxW="180px"
              />
              <Button size="sm" colorScheme="teal" onClick={connect} disabled={status === "connecting"}>
                {status === "ready" ? "Reconnect" : "Connect"}
              </Button>
              <Text
                fontSize="sm"
                color={status === "ready" ? "green.500" : status === "error" ? "red.500" : statusTextColor}
              >
                Status: {status}
              </Text>
            </HStack>
          </Box>

          <Box
            px={{ base: 3, md: 4 }}
            py={3}
            bg={terminalBg}
            color={terminalText}
            display="flex"
            flexDir="column"
            gap={3}
            ref={outputRef}
            borderBottomRadius="lg"
            minH="75vh"
            maxH="80vh"
            overflowY="auto"
          >
            <VStack align="start" gap={1} flex="1" overflowY="visible">
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
            <HStack
              borderTopWidth="1px"
              borderColor={panelBorder}
              pt={2}
              align="center"
              gap={2}
              color={terminalText}
              pb={2}
            >
              <Text fontFamily="mono" fontSize="sm" color="teal.200">$</Text>
              <Input
                variant="flushed"
                placeholder="Type command and press Enter"
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
            </HStack>
          </Box>
        </Box>
      </VStack>
    </Box>
  );
}
