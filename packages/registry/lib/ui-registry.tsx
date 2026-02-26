"use client";

import { chainOfThoughtRegistryItem } from "@/app/docs/components/chain-of-thought/config";
import { fullAgentRegistryItem } from "@/app/docs/components/full-agent/config";
import { messageRegistryItem } from "@/app/docs/components/message/config";
import { promptRegistryItem } from "@/app/docs/components/prompt/config";
import { threadRegistryItem } from "@/app/docs/components/thread/config";
import { useThreadRegistryItem } from "@/app/docs/components/use-thread/config";
import type { RegistryItem } from "@/lib/registry-types";

export const registryData: RegistryItem[] = [
  messageRegistryItem,
  promptRegistryItem,
  chainOfThoughtRegistryItem,
  threadRegistryItem,
  useThreadRegistryItem,
  fullAgentRegistryItem,
];
