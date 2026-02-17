"use client";

import { useState } from "react";

type OperatingSystem = "mac" | "windows";

const COMMAND_BY_OS: Record<OperatingSystem, string> = {
  mac: "curl -fsSL https://app.factory.ai/cli | sh",
  windows: "iwr -useb https://app.factory.ai/cli | iex",
};

const OS_OPTIONS: { id: OperatingSystem; label: string }[] = [
  { id: "mac", label: "macOS / Linux" },
  { id: "windows", label: "Windows" },
];

const FEATURE_CARDS = [
  {
    eyebrow: "IDE → Prod",
    title: "Ship refactors without context switching",
    description:
      "Hand entire files to Droids. They coordinate reviews, run tests, and land the change.",
  },
  {
    eyebrow: "CI / CD",
    title: "Close incidents before paging humans",
    description:
      "Droids investigate logs, apply mitigations, and open follow-up tasks while you sleep.",
  },
  {
    eyebrow: "Migrations",
    title: "Modernize legacy systems in parallel",
    description:
      "Batch schema updates, SDK upgrades, or framework lifts with zero babysitting.",
  },
];

const LOGO_ITEMS = ["Pitch", "ParaFin", "Framer", "Clari", "Adobe", "Bayer"];

const WORKFLOW_POINTS = [
  "Delegate complete tasks from IDE to CI/CD.",
  "Droids coordinate code reviews and tests.",
  "Incident and migration playbooks stay aligned.",
];

const SLIDER_LINES = [
  { id: "lane-1", nodes: 8, accent: [3] },
  { id: "lane-2", nodes: 8, accent: [4, 5] },
  { id: "lane-3", nodes: 8, accent: [2] },
  { id: "lane-4", nodes: 8, accent: [5] },
  { id: "lane-5", nodes: 8, accent: [1] },
];

function App()
{
  const [selectedOS, setSelectedOS] = useState<OperatingSystem>("mac");

  return (
    <main className="min-h-screen bg-[#030304] text-[#F4F4F6]">
      <div className="relative overflow-hidden">
        <BackgroundGlow />
        <HeroSection selectedOS={selectedOS} onChangeOs={setSelectedOS} />
        <FeatureGrid />
        <WorkflowSection />
        <LogoStrip />
        <CTASection />
      </div>
    </main>
  );
}

function HeroSection(props: { selectedOS: OperatingSystem; onChangeOs: (os: OperatingSystem) => void })
{
  return (
    <section className="relative mx-auto flex min-h-[85vh] max-w-6xl flex-col gap-12 px-6 pb-24 pt-32 lg:flex-row lg:items-center lg:gap-20">
      <div className="flex-1 space-y-6">
        <Badge label="Vision" />
        <h1 className="font-semibold leading-[1.05] tracking-[-0.04em] text-[#F4F4F6] text-[clamp(2.8rem,6vw,4.75rem)]">
          Agent-Native Software Development
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-[#9EA0AA]">
          The only software development agents that work inside your existing stack. Delegate refactors, incidents, and migrations without swapping tools.
        </p>
        <CommandCard selectedOS={props.selectedOS} onChangeOs={props.onChangeOs} />
      </div>
      <div className="flex-1">
        <SliderVisual />
      </div>
    </section>
  );
}

function CommandCard(props: { selectedOS: OperatingSystem; onChangeOs: (os: OperatingSystem) => void })
{
  const [isCopied, setIsCopied] = useState(false);
  const commandText = COMMAND_BY_OS[props.selectedOS];

  const handleCopy = async () =>
  {
    try
    {
      await navigator.clipboard.writeText(commandText);
      setIsCopied(true);
      window.setTimeout(() =>
      {
        setIsCopied(false);
      }, 1800);
    }
    catch (error)
    {
      console.error("Clipboard unavailable", error);
    }
  };

  let copyLabel = "Copy";
  if (isCopied)
  {
    copyLabel = "Copied";
  }

  return (
    <div className="w-full border border-[#1F1F26] bg-[#0A0A0F] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
      <div className="mb-4 flex gap-2 border border-[#1F1F26] bg-[#050506] p-1">
        {OS_OPTIONS.map((option) =>
        {
          const isActive = option.id === props.selectedOS;
          const buttonClass = getOsButtonClass(isActive);
          return (
            <button
              key={option.id}
              className={buttonClass}
              onClick={() => props.onChangeOs(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-3 border border-[#1F1F26] bg-[#050506] p-4 text-sm text-[#F4F4F6] font-['IBM_Plex_Mono',_SFMono-Regular,_monospace]">
        <div className="text-xs uppercase tracking-[0.4em] text-[#9EA0AA]">
          Install CLI
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <span className="flex-1 break-words">
            {commandText}
          </span>
          <button
            className="rounded-md bg-[#FF5C1B] px-4 py-2 text-sm font-semibold text-[#030304] transition hover:bg-[#ff6e33]"
            onClick={handleCopy}
          >
            {copyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function SliderVisual()
{
  return (
    <div className="relative h-[420px] border border-[#1F1F26] bg-gradient-to-b from-[#0D0D12] to-[#050506] p-10 shadow-[0_20px_120px_rgba(0,0,0,0.6)]">
      <div className="absolute inset-x-6 inset-y-10 grid grid-rows-5 gap-6">
        {SLIDER_LINES.map((line) =>
        {
          return (
            <div key={line.id} className="flex items-center justify-between">
              {Array.from({ length: line.nodes }).map((_, index) =>
              {
                const isAccent = line.accent.includes(index);
                const nodeClass = getSliderNodeClass(isAccent);
                return <span key={`${line.id}-${index}`} className={nodeClass} />;
              })}
            </div>
          );
        })}
      </div>
      <div className="relative z-10 flex h-full flex-col justify-center gap-6">
        <Badge label="Orchestrate" />
        <p className="max-w-sm text-lg leading-relaxed text-[#9EA0AA]">
          Droids align multi-stage workflows across IDE, CI, and production using the same control plane.
        </p>
        <div className="flex gap-6">
          <div>
            <div className="text-3xl font-semibold text-[#F4F4F6]">24/7</div>
            <p className="text-xs uppercase tracking-[0.3em] text-[#9EA0AA]">Uptime Coverage</p>
          </div>
          <div>
            <div className="text-3xl font-semibold text-[#F4F4F6]">10x</div>
            <p className="text-xs uppercase tracking-[0.3em] text-[#9EA0AA]">Faster Migrations</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureGrid()
{
  return (
    <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 pb-24 pt-4 md:grid-cols-2 lg:grid-cols-3">
      {FEATURE_CARDS.map((feature) =>
      {
        return (
          <article
            key={feature.title}
            className="border border-[#1F1F26] bg-[#0A0A0F] p-6 shadow-[0_10px_60px_rgba(0,0,0,0.35)] transition-transform hover:-translate-y-1 hover:border-[#FF5C1B]"
          >
            <Badge label={feature.eyebrow} />
            <h3 className="mt-4 text-2xl font-semibold text-[#F4F4F6]">
              {feature.title}
            </h3>
            <p className="mt-3 text-sm leading-6 text-[#9EA0AA]">
              {feature.description}
            </p>
            <div className="mt-6 text-sm font-semibold text-[#FF5C1B]">
              Delegate to Droids →
            </div>
          </article>
        );
      })}
    </section>
  );
}

function WorkflowSection()
{
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-10 px-6 pb-24 lg:flex-row lg:items-center">
      <div className="flex-1 space-y-4">
        <Badge label="Workflow" />
        <h2 className="text-4xl font-semibold tracking-[-0.02em] text-[#F4F4F6]">
          From incident to migration in one control plane
        </h2>
        <ul className="space-y-3 text-sm text-[#9EA0AA]">
          {WORKFLOW_POINTS.map((point) =>
          {
            return (
              <li key={point} className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-[#FF5C1B]" />
                <span>{point}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex-1 rounded-[32px] border border-[#1F1F26] bg-[#050506] p-8 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
        <div className="space-y-6">
          {SLIDER_LINES.slice(0, 4).map((line) =>
          {
            return (
              <div key={`timeline-${line.id}`} className="flex items-center gap-4">
                <div className="relative h-[2px] flex-1 bg-[#1F1F26]">
                  {line.accent.map((index) =>
                  {
                    const offset = (index / (line.nodes - 1)) * 100;
                    return (
                      <span
                        key={`${line.id}-point-${index}`}
                        className="absolute -top-1 h-3 w-3 rounded-full bg-[#FF5C1B] shadow-[0_0_25px_rgba(255,92,27,0.6)]"
                        style={{ left: `${offset}%` }}
                      />
                    );
                  })}
                </div>
                <div className="text-xs uppercase tracking-[0.25em] text-[#9EA0AA]">
                  Stage
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function LogoStrip()
{
  return (
    <section className="mx-auto max-w-6xl px-6 pb-16">
      <div className="text-xs uppercase tracking-[0.5em] text-[#9EA0AA]">
        Trusted By Teams At
      </div>
      <div className="mt-6 grid grid-cols-2 gap-6 text-center text-[#F4F4F6] opacity-60 mix-blend-screen sm:grid-cols-3 lg:grid-cols-6">
        {LOGO_ITEMS.map((logo) =>
        {
          return (
            <div key={logo} className="rounded-2xl border border-[#1F1F26] px-4 py-3 text-sm font-semibold">
              {logo}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CTASection()
{
  return (
    <section className="mx-auto my-16 max-w-5xl overflow-hidden border border-[#1F1F26] bg-[#0A0A0F] p-10 shadow-[0_30px_120px_rgba(0,0,0,0.65)]">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-center">
        <div className="flex-1 space-y-4">
          <Badge label="Next" />
          <h3 className="text-3xl font-semibold text-[#F4F4F6]">
            Spin up your first Droid in minutes
          </h3>
          <p className="text-sm text-[#9EA0AA]">
            Install the CLI, connect your repo, and invite the Droids to your workflow. No new IDE, no new rituals.
          </p>
          <div className="flex flex-wrap gap-4">
            <button className="rounded-full bg-[#FF5C1B] px-6 py-3 text-sm font-semibold text-[#030304] transition hover:bg-[#ff6e33]">
              Launch Console
            </button>
            <button className="rounded-full border border-[#1F1F26] px-6 py-3 text-sm font-semibold text-[#F4F4F6] transition hover:border-[#FF5C1B]">
              Contact Sales
            </button>
          </div>
        </div>
        <div className="flex-1 rounded-3xl border border-[#1F1F26] bg-[#050506] p-6">
          <div className="text-xs uppercase tracking-[0.35em] text-[#9EA0AA]">
            Launch Checklist
          </div>
          <ul className="mt-4 space-y-3 text-sm text-[#F4F4F6]">
            <li>1. Install CLI + connect GitHub.</li>
            <li>2. Define guardrails and test suites.</li>
            <li>3. Delegate first refactor or incident drill.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function Badge(props: { label: string })
{
  return (
    <span className="inline-flex items-center rounded-full border border-[#1F1F26] bg-[#050506] px-3 py-1 text-xs font-semibold uppercase tracking-[0.4em] text-[#9EA0AA]">
      • {props.label}
    </span>
  );
}

function BackgroundGlow()
{
  return (
    <div className="pointer-events-none">
      <div className="absolute left-1/2 top-24 h-72 w-72 -translate-x-1/2 rounded-full bg-[#FF5C1B] opacity-20 blur-[140px]" />
      <div className="absolute right-16 top-0 h-72 w-72 rounded-full bg-[#6C1BFF] opacity-10 blur-[180px]" />
    </div>
  );
}

function getOsButtonClass(isActive: boolean): string
{
  const baseClass = "flex-1 border border-[#1F1F26] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition";
  if (isActive)
  {
    return baseClass + " bg-[#F4F4F6] text-[#030304]";
  }

  return baseClass + " text-[#9EA0AA]";
}

function getSliderNodeClass(isAccent: boolean): string
{
  if (isAccent)
  {
    return "h-3 w-3 rounded-full bg-[#FF5C1B] shadow-[0_0_25px_rgba(255,92,27,0.6)]";
  }

  return "h-2 w-2 rounded-full bg-[#2D2E34]";
}

export default App;

