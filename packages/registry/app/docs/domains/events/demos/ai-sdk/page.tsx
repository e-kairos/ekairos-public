import { EventDemoPage } from "@/lib/domains/events/demo-page";
import { aiSdkEventsScenario } from "@/lib/domains/events/demo-scenarios";

export default function EventsAiSdkDemoPage() {
  return <EventDemoPage scenario={aiSdkEventsScenario} />;
}
