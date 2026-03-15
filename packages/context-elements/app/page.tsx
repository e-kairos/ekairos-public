import { getComponentCatalog } from "@/lib/registry-data";
import { LandingClient } from "./landing.client";

export default async function HomePage() {
  const catalog = await getComponentCatalog();
  return <LandingClient catalog={catalog} />;
}

