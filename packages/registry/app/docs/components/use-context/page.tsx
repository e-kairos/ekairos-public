"use client";

import { ComponentDocPage } from "../_component-page";
import { useContextRegistryItem } from "./config";

export default function UseContextPage() {
  return <ComponentDocPage item={useContextRegistryItem} />;
}
