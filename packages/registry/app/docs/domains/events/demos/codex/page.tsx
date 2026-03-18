import { EventDemoPage } from "@/lib/domains/events/demo-page";
import { codexEventsScenario } from "@/lib/domains/events/demo-scenarios";

export default function EventsCodexDemoPage() {
  return <EventDemoPage scenario={codexEventsScenario} />;
}
