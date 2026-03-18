import { EventDemoPage } from "@/lib/domains/events/demo-page";
import { scriptedEventsScenario } from "@/lib/domains/events/demo-scenarios";

export default function EventsScriptedDemoPage() {
  return <EventDemoPage scenario={scriptedEventsScenario} />;
}
