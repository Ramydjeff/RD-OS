import { ProcessesPage } from "@/components/processes/ProcessesPage";

export default function SimulatorApp() {
  return (
    <div className="h-full">
      <ProcessesPage showMetrics={false} />
    </div>
  );
}
