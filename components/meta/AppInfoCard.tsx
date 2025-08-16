"use client";

import { Box, Heading, VStack, HStack, Text } from "@chakra-ui/react";

export const APP_NAME = "MLOps Cloud";
export const APP_VERSION = "Beta 1.0";
export const APP_VARIANT = "main";
export const APP_COPYRIGHT = `Taiga Takano`;

export function AppInfoCard() {
  return (
    <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
      <VStack align="start" gap="8px">
        <Heading size="xl">{APP_NAME}</Heading>
        <Text textStyle="sm" color="gray.700">Version {APP_VERSION}</Text>
        <HStack><Text textStyle="sm" color="gray.600">Variant:</Text><Text textStyle="sm" fontWeight="bold">{APP_VARIANT}</Text></HStack>
        <Text textStyle="sm" color="gray.700">{APP_COPYRIGHT}</Text>
      </VStack>
    </Box>
  );
}

export default AppInfoCard;

