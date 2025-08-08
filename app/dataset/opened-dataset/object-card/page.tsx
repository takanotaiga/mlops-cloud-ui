"use client"

import {
  Box,
  Flex,
  VStack,
  SimpleGrid,
  Heading,
  CheckboxGroup,
  Checkbox,
  Fieldset,
  Text,
  HStack,
  For,
} from "@chakra-ui/react"
import ContentCard from "@/components/content-card"

export default function Page() {
  return (
    <Box px="10%" py="20px">

      <HStack align="center" justify="space-between" pb="10px">
        <Heading size="2xl" >
          Dataset / Person / hoge.MOV
        </Heading>
      </HStack>


      <Flex align="flex-start">
        <VStack align="start" w="25%" gap="10px">
          <Fieldset.Root>
            <Fieldset.Legend>
              <Text fontWeight="bold">Label</Text>
            </Fieldset.Legend>
            <Fieldset.Content>
              <CheckboxGroup name="label" defaultValue={["Bounding Box"]}>
                <For each={["Bounding Box", "Segmentation", "Text"]}>
                  {(value) => (
                    <Checkbox.Root key={value} value={value}>
                      <Checkbox.HiddenInput />
                      <Checkbox.Control />
                      <Checkbox.Label>{value}</Checkbox.Label>
                    </Checkbox.Root>
                  )}
                </For>
              </CheckboxGroup>
            </Fieldset.Content>
          </Fieldset.Root>

          <Fieldset.Root>
            <Fieldset.Legend>
              <Text fontWeight="bold">Media Type</Text>
            </Fieldset.Legend>
            <Fieldset.Content>
              <CheckboxGroup name="media" defaultValue={["Image"]}>
                <For each={["Video", "Image", "PointCloud", "ROSBag"]}>
                  {(value) => (
                    <Checkbox.Root key={value} value={value}>
                      <Checkbox.HiddenInput />
                      <Checkbox.Control />
                      <Checkbox.Label>{value}</Checkbox.Label>
                    </Checkbox.Root>
                  )}
                </For>
              </CheckboxGroup>
            </Fieldset.Content>
          </Fieldset.Root>
        </VStack>

        <Box flex="1" ml={8}>
          <SimpleGrid columns={[2, 3, 4]} gap="10px">
            {Array.from({ length: 11 }).map((_, i) => (
              <ContentCard key={i} />
            ))}
          </SimpleGrid>
        </Box>
      </Flex>
    </Box>
  )
}
