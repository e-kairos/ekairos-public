"use client";

import { chainOfThoughtRegistryItem } from "@/app/docs/components/chain-of-thought/config";
import { fullAgentRegistryItem } from "@/app/docs/components/full-agent/config";
import { messageRegistryItem } from "@/app/docs/components/message/config";
import { promptRegistryItem } from "@/app/docs/components/prompt/config";
import { contextRegistryItem } from "@/app/docs/components/context/config";
import { eventStepsRegistryItem } from "@/app/docs/components/event-steps/config";
import { useContextRegistryItem } from "@/app/docs/components/use-context/config";
import type { RegistryItem } from "@/lib/registry-types";

export const registryData: RegistryItem[] = [
  messageRegistryItem,
  promptRegistryItem,
  chainOfThoughtRegistryItem,
  contextRegistryItem,
  eventStepsRegistryItem,
  useContextRegistryItem,
  fullAgentRegistryItem,
];
