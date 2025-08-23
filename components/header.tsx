"use client";

import { Box, HStack, Heading, Text, LinkBox, LinkOverlay, IconButton, Drawer, Button, Portal, CloseButton, VStack, Link } from "@chakra-ui/react";
import { LuMenu } from "react-icons/lu";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import ConnectionStatus from "./status/connection-status";
import { useI18n } from "@/components/i18n/LanguageProvider";

export default function Header() {
    const { t } = useI18n();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        // Close the drawer on route changes
        setOpen(false);
    }, [pathname]);
    return (
        <Box
            as="header"
            bg="white"
            color="black"
            position="sticky"
            top="0"
            zIndex="sticky"
            borderBottomColor="gray.200"
            borderBottomWidth="1.0px"
            px={4} py={3}>
            <HStack justify="space-between" align="center" w="85%" maxW="7xl" mx="auto">
                <LinkBox h="25px">
                    <LinkOverlay href="/" >
                        <Heading size="md" >
                            MLOps Cloud v1.5
                        </Heading>
                    </LinkOverlay>
                </LinkBox>

                {/* Connection status: dot on small screens, full on md+ */}
                <Box h="25px" px="30px" display={{ base: "flex", md: "none" }} alignItems="center" marginEnd="auto">
                    <ConnectionStatus variant="dot" />
                </Box>
                <Box h="25px" px="30px" display={{ base: "none", md: "flex" }} alignItems="center" marginEnd="auto">
                    <ConnectionStatus variant="full" />
                </Box>

                {/* Desktop nav */}
                <HStack display={{ base: "none", md: "flex" }}>
                    <LinkBox px="10px" h="25px">
                        <LinkOverlay href="/dataset" >
                            <Text textStyle="sm">{t("nav.datasets", "Datasets")}</Text>
                        </LinkOverlay>
                    </LinkBox>
                    <LinkBox px="10px" h="25px">
                        <LinkOverlay href="/inference" >
                            <Text textStyle="sm">{t("nav.inference", "Inference")}</Text>
                        </LinkOverlay>
                    </LinkBox>
                    <LinkBox px="10px" h="25px">
                        <LinkOverlay href="/hardware_metric" >
                            <Text textStyle="sm">{t("nav.hardware", "Hardware")}</Text>
                        </LinkOverlay>
                    </LinkBox>
                    <LinkBox px="10px" h="25px">
                        <LinkOverlay href="/docs" >
                            <Text textStyle="sm">{t("nav.docs", "Docs")}</Text>
                        </LinkOverlay>
                    </LinkBox>
                    <LinkBox px="10px" h="25px">
                        <LinkOverlay href="/settings" >
                            <Text textStyle="sm">{t("nav.settings", "Settings")}</Text>
                        </LinkOverlay>
                    </LinkBox>
                </HStack>

                {/* Mobile nav (Drawer) */}
                <Drawer.Root open={open} onOpenChange={(e: any) => setOpen(!!e.open)}>
                    <Drawer.Trigger asChild>
                        <IconButton
                            aria-label="Open menu"
                            variant="outline"
                            size="sm"
                            display={{ base: "inline-flex", md: "none" }}
                            onClick={() => setOpen(true)}
                        >
                            <LuMenu />
                        </IconButton>
                    </Drawer.Trigger>
                    <Portal>
                        <Drawer.Backdrop />
                        <Drawer.Positioner>
                            <Drawer.Content>
                                <Drawer.Header>
                                    <Drawer.Title>{t("nav.menu", "Menu")}</Drawer.Title>
                                </Drawer.Header>
                                <Drawer.Body>
                                    <VStack align="stretch" gap={2}>
                                        <Link asChild>
                                            <NextLink href="/dataset">
                                                <Button variant="ghost" justifyContent="flex-start" onClick={() => setOpen(false)}>
                                                    {t("nav.datasets", "Datasets")}
                                                </Button>
                                            </NextLink>
                                        </Link>
                                        <Link asChild>
                                            <NextLink href="/inference">
                                                <Button variant="ghost" justifyContent="flex-start" onClick={() => setOpen(false)}>
                                                    {t("nav.inference", "Inference")}
                                                </Button>
                                            </NextLink>
                                        </Link>
                                        <Link asChild>
                                            <NextLink href="/hardware_metric">
                                                <Button variant="ghost" justifyContent="flex-start" onClick={() => setOpen(false)}>
                                                    {t("nav.hardware", "Hardware")}
                                                </Button>
                                            </NextLink>
                                        </Link>
                                        <Link asChild>
                                            <NextLink href="/docs">
                                                <Button variant="ghost" justifyContent="flex-start" onClick={() => setOpen(false)}>
                                                    {t("nav.docs", "Docs")}
                                                </Button>
                                            </NextLink>
                                        </Link>
                                        <Link asChild>
                                            <NextLink href="/settings">
                                                <Button variant="ghost" justifyContent="flex-start" onClick={() => setOpen(false)}>
                                                    {t("nav.settings", "Settings")}
                                                </Button>
                                            </NextLink>
                                        </Link>
                                    </VStack>
                                </Drawer.Body>
                                <Drawer.Footer>
                                    <Drawer.CloseTrigger asChild>
                                        <CloseButton size="sm" />
                                    </Drawer.CloseTrigger>
                                </Drawer.Footer>
                            </Drawer.Content>
                        </Drawer.Positioner>
                    </Portal>
                </Drawer.Root>
            </HStack>
        </Box>
    );
}
