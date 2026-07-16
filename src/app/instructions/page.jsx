import Image from "next/image";
import Link from "next/link";
import AskFinnButton from "./AskFinnButton";
import Faq from "./Faq";
import InstructionsNav from "./InstructionsNav";
import { PLAYER_GLOSSARY } from "@/data/rules/playerGlossary.mjs";
import { CORE_RULES } from "@/lib/rulesAssistant.mjs";
import { SIMULATOR_RULES } from "@/lib/seapalsRulesKnowledge.mjs";

export const metadata = {
  title: "How to Play SeaPals | Beginner Guide & Complete Rules",
  description:
    "Learn SeaPals TCG with a quick first-game guide, clear examples, complete rules, a glossary, and answers to common questions.",
};

const fullRulesUrl =
  "https://docs.google.com/document/d/1k7GxLQC_imLxc6d9n_dxsq0CqQtJ0lPzwARsrBNLifA/edit?tab=t.0";

const iconBase = "/images/icons";

const turnSteps = [
  {
    number: "1",
    name: "Choose",
    prompt: "Which deck helps me most?",
    description:
      "Draw 1 card from either your Foundation Deck or your Pals Deck. You do not draw from both unless a card effect says so.",
    color: "border-blue-200 bg-blue-50 text-blue-950",
  },
  {
    number: "2",
    name: "Collect",
    prompt: "How much RP do I gain?",
    description:
      "Gain 1 RP, then add the RP produced by your active Foundations. Apply modifiers and discard RP above your current bank cap.",
    color: "border-amber-200 bg-amber-50 text-amber-950",
  },
  {
    number: "3",
    name: "Build",
    prompt: "What can I add to my ocean?",
    description:
      "Spend RP to play legal cards, upgrade Foundations, and use paid Actions. Meet every requirement before paying the cost.",
    color: "border-emerald-200 bg-emerald-50 text-emerald-950",
  },
  {
    number: "4",
    name: "Attack",
    prompt: "What can my Pals target?",
    description:
      "Use available attacks one at a time. Choose a legal target and completely resolve that attack before beginning another.",
    color: "border-rose-200 bg-rose-50 text-rose-950",
  },
];

const glossary = [
  ["VP", "Victory Points — your score. Only VP on cards currently in your ecosystem counts."],
  ["RP", "Resource Points — the currency used to play cards and pay Action costs."],
  ["Ecosystem", "All of your cards currently in play. Your hand, decks, and discard are not part of it."],
  ["Foundation", "The base of an ecosystem. Coral and Creature Schools are Foundation cards."],
  ["Pal", "A creature you play, such as a Fish, Predator, Apex, Invertebrate, or Filter Feeder."],
  ["Condition", "A shared card revealed at the start of a round that affects every player."],
  ["Habitat", "A persistent card, such as Open Ocean or Abyss, that enables or changes an ecosystem."],
  ["Slot", "A space supplied by Coral or another rule that accepts specific habitats and creature classes."],
  ["Requirement", "Something that must already be true to play a card. Checking it does not spend it."],
  ["Cost", "What you pay to play a card or use an Action, usually RP or a printed additional cost."],
  ["Passive", "An ability that stays active while its card is in play and its printed condition is true."],
  ["On Play", "An ability that resolves once when the card is successfully played."],
  ["Action", "An ability you choose to use at its printed timing after paying its cost and choosing legal targets."],
  ["Defense", "The target's roll against a normal attack. A tied total means the defender stays in play."],
  ["School Density", "An Oceanic value supplied by Creature Schools. It is checked for requirements, not spent like RP."],
  ["Discard", "Cards that are spent, discarded, or destroyed. They are no longer in play."],
];


const completeRuleCards = [
  ...CORE_RULES.map((rule) => ({
    title: rule.title,
    text: rule.text,
    source: "Core rule",
  })),
  ...SIMULATOR_RULES.map((rule) => ({
    title: rule.title,
    text: rule.text,
    source: "Simulator-enforced rule",
  })),
];

const fullGlossary = [
  ...glossary.map(([term, definition]) => ({ term, definition, source: "Player shortcut" })),
  ...PLAYER_GLOSSARY.map((entry) => ({
    term: entry.title,
    definition: entry.text,
    source: entry.category ? entry.category.replace(/-/g, " ") : "Glossary",
  })),
].filter((entry, index, entries) =>
  entries.findIndex((candidate) => candidate.term.toLowerCase() === entry.term.toLowerCase()) === index,
);

const faqQuestions = [
  {
    question: "What do we need for a first game?",
    answer:
      "SeaPals is for 2–4 players. Each player needs a legal 60-card deck separated into Foundation and Pals decks. Share one Conditions Deck, and gather RP counters, damage or HP counters, and the dice named on your cards (D4, D6, D8, D10, D12, and D20).",
  },
  {
    question: "Should beginners play to 10 VP or 30 VP?",
    answer:
      "Use 10 VP for a learning game and 30 VP for the recommended full game. Agree on the target before setup. In either version, only VP currently in play counts.",
  },
  {
    question: "What are the four steps of a turn?",
    answer:
      "The canonical order is Choose, Collect, Build, then Attack, followed by end-of-turn maintenance. The simulator automates collection before it shows the deck-choice prompt, so its first two prompts may appear in the opposite visual order.",
  },
  {
    question: "Which deck do I draw from?",
    answer:
      "During Choose, draw 1 card from either your Foundation Deck or your Pals Deck. Choose only one of those decks unless a card or Condition grants another draw.",
  },
  {
    question: "How much RP do I collect, and how much can I keep?",
    answer:
      "During Collect, gain 1 RP plus the RP produced by your active Foundations, then apply card and Condition modifiers. The default RP bank cap is 8. Discard anything above the active cap.",
  },
  {
    question: "How do I know where a creature can go?",
    answer:
      "Check two things: habitat and class. Reef and Deep creatures need a compatible slot in their own habitat. A Fish slot takes Fish, a Predator slot takes Fish or Predators, and an Apex slot takes Fish, Predators, or Apex. Specific card text can create an exception.",
  },
  {
    question: "Where do Oceanic creatures go?",
    answer:
      "Oceanic creatures live in open water rather than on Reef or Deep Coral slots. Creature Schools are Oceanic Foundations and supply School Density; other Oceanic cards often require enough School Density or an enabling Habitat such as Open Ocean.",
  },
  {
    question: "Who wins when an attack and defense tie?",
    answer:
      "The defender wins a tie and stays in play. A normal attack succeeds only when the final attack total is higher than the final defense total.",
  },
  {
    question: "What does ×2, ×3, or ×4 on an attack mean?",
    answer:
      "It is the attack count. Resolve that many separate attacks, each with its own legal target and rolls. The same physical target cannot be selected twice during that repeated sequence.",
  },
  {
    question: "How are Creature Schools and bait balls attacked?",
    answer:
      "They do not make a defense roll. Instead, they take damage equal to the attack roll multiplied by 10. Discard the Creature School when its HP reaches 0.",
  },
  {
    question: "What happens to VP when a card leaves play?",
    answer:
      "Subtract that card's VP from your current total immediately. Conditional VP also stops counting whenever its printed requirement is no longer true.",
  },
  {
    question: "Do Support cards stay in play?",
    answer:
      "Normally, no. Resolve the Support card's printed effect and put it in discard. It remains in play only if its own text explicitly says that it does.",
  },
  {
    question: "Is there a hand limit?",
    answer:
      "There is no fixed hand limit by default. A Condition can set a temporary limit. If a draw, search, or recovery exceeds that limit, keep cards only up to the limit and put the overflow into discard in resolution order.",
  },
  {
    question: "Does upgrading a Coral heal its damage?",
    answer:
      "No. Have the next printed stage in hand, meet its requirement, and pay its RP cost. Place it over the current stage. Existing damage stays, while the upgrade increases maximum HP as printed. A Coral normally upgrades only once per turn.",
  },
  {
    question: "What happens when both of my decks are empty?",
    answer:
      "You lose when you must draw and both your Foundation Deck and Pals Deck are depleted. Simply having an empty deck is not the loss trigger if no draw is currently required.",
  },
  {
    question: "Do Conditions affect everyone?",
    answer:
      "Yes. Reveal a shared Condition at the start of the round and apply its printed effect to every player for the stated duration. A Condition matching a Coral weakness stops that Coral's RP production for the round; it does not destroy the Coral by itself.",
  },
  {
    question: "What if a card and this guide seem to disagree?",
    answer:
      "Follow the more specific printed card text when it clearly creates an exception to a general rule. If the printed effect is incomplete or the timing is not defined, do not invent an extra effect—check the current rules document or ask Finn for the latest grounded answer.",
  },
];

function SectionHeading({ number, title, children }) {
  return (
    <div className="max-w-3xl">
      <h2 className="flex items-start gap-4 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
        <span className="mt-0.5 flex h-10 min-w-10 items-center justify-center rounded-full bg-cyan-100 px-2 text-sm font-black text-cyan-800">
          {number}
        </span>
        <span>{title}</span>
      </h2>
      {children ? (
        <p className="mt-4 text-base leading-7 text-slate-600 md:text-lg">
          {children}
        </p>
      ) : null}
    </div>
  );
}

function RuleDetails({ title, summary, children, open = false }) {
  return (
    <details
      open={open}
      className="group rounded-2xl border border-slate-200 bg-white shadow-sm open:border-cyan-300 open:ring-4 open:ring-cyan-50"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-5 px-5 py-4 [&::-webkit-details-marker]:hidden md:px-6 md:py-5">
        <div>
          <h3 className="text-lg font-bold text-slate-950 md:text-xl">{title}</h3>
          {summary ? (
            <p className="mt-1 text-sm leading-6 text-slate-500">{summary}</p>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-xl font-bold text-cyan-800 transition group-open:rotate-45 group-open:bg-cyan-700 group-open:text-white"
        >
          +
        </span>
      </summary>
      <div className="border-t border-slate-100 px-5 py-5 text-sm leading-7 text-slate-600 md:px-6 md:text-base">
        {children}
      </div>
    </details>
  );
}

function CheckItem({ children }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-black text-emerald-800"
      >
        ✓
      </span>
      <span>{children}</span>
    </li>
  );
}

function CardIcon({ src, alt, size = 46 }) {
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      className="block shrink-0 object-contain"
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
}

function SimulatorPromo() {
  return (
    <aside
      data-rules-ignore
      aria-label="SeaPals Simulator promotion"
      className="relative mt-8 overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-xl"
    >
      <div aria-hidden="true" className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="relative grid gap-6 p-6 md:p-8 lg:grid-cols-[1fr_auto] lg:items-end lg:p-10">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">
            Learn by playing
          </p>
          <h2 className="mt-3 max-w-3xl text-3xl font-black tracking-tight md:text-5xl">
            The fastest way to learn SeaPals is to play a game
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 md:text-lg md:leading-8">
            The simulator handles setup, tracks RP, VP, and Conditions, and tells you
            why a move is—or is not—legal. Play a complete match against a computer
            rival without needing a deck or a second player.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-cyan-50 md:text-sm">
            {[
              "Computer opponent",
              "Instant move feedback",
              "Full rules in action",
              "Play at your own pace",
            ].map((benefit) => (
              <li key={benefit} className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-2">
                <span aria-hidden="true" className="text-emerald-300">✓</span>
                {benefit}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <Link
            href="/simulator"
            className="inline-flex items-center justify-center rounded-full bg-amber-300 px-7 py-3.5 text-sm font-black text-slate-950 shadow-lg transition hover:-translate-y-0.5 hover:bg-amber-200"
          >
            Play in the simulator →
          </Link>
          <span className="text-xs font-semibold text-slate-400">
            Plays right in your browser
          </span>
        </div>
      </div>

      <Link
        href="/simulator"
        aria-label="Open the SeaPals Simulator"
        className="group relative block border-t border-white/10 bg-gradient-to-br from-cyan-950 to-emerald-900 p-2 sm:p-3 md:p-5"
      >
        <Image
          src="/images/promo/seapals-simulator-gameplay.png"
          alt="A full SeaPals Simulator match showing the player's ecosystem, rival ecosystem, hand, Conditions, RP bank, and current scores"
          width={1800}
          height={1254}
          sizes="(min-width: 1280px) 1152px, 100vw"
          className="h-auto w-full rounded-xl border border-cyan-300/30 shadow-2xl transition duration-300 group-hover:border-cyan-200/70 group-hover:brightness-105"
        />
        <span className="absolute bottom-5 right-5 hidden rounded-full bg-slate-950/90 px-4 py-2 text-xs font-black text-white shadow-xl backdrop-blur transition group-hover:bg-cyan-700 sm:block md:bottom-8 md:right-8">
          Open simulator ↗
        </span>
      </Link>
    </aside>
  );
}

export default function InstructionsPage() {
  return (
    <main className="pb-20">
      <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-8 text-white shadow-xl md:px-10 md:py-12 lg:px-12 lg:py-14">
        <div aria-hidden="true" className="absolute -right-24 -top-28 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-emerald-400/15 blur-3xl" />
        <div className="relative grid gap-9 lg:grid-cols-[1.12fr_0.88fr] lg:items-center">
          <div>
            <p data-rules-ignore className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-300">
              SeaPals how-to-play guide
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight md:text-6xl md:leading-[1.05]">
              How to get started with SeaPals
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 md:text-lg md:leading-8">
              Set up the table, learn the four parts of a turn, and play your first
              game. Start with the essentials, then use the full rules when a card
              raises a question.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <a
                href="#start-here"
                className="inline-flex items-center justify-center rounded-full bg-amber-300 px-6 py-3 text-sm font-black text-slate-950 shadow-lg transition hover:bg-amber-200"
              >
                Start with the basics ↓
              </a>
              <Link
                href="/simulator"
                className="inline-flex items-center justify-center rounded-full border border-cyan-300/60 bg-cyan-300/10 px-6 py-3 text-sm font-bold text-cyan-50 transition hover:bg-cyan-300/20"
              >
                Practice in the simulator
              </Link>
              <AskFinnButton className="inline-flex items-center justify-center rounded-full border border-white/20 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/10">
                Ask Finn a question
              </AskFinnButton>
            </div>

            <dl className="mt-8 flex flex-wrap gap-x-7 gap-y-3 border-t border-white/10 pt-6 text-sm">
              <div className="flex items-baseline gap-2">
                <dt className="text-slate-400">Players</dt>
                <dd className="font-black text-white">2–4</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-slate-400">Learning game</dt>
                <dd className="font-black text-white">10 VP</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-slate-400">Full game</dt>
                <dd className="font-black text-white">30 VP</dd>
              </div>
            </dl>
          </div>

          <div className="relative rounded-3xl border border-white/15 bg-white/10 p-5 shadow-2xl backdrop-blur md:p-7">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-300">
              SeaPals at a glance
            </p>
            <p className="mt-4 text-xl font-bold leading-8 text-white md:text-2xl md:leading-9">
              Build an ocean ecosystem with Foundations and Pals. Cards in your
              ecosystem earn Victory Points, and the first player to reach 10 VP wins
              a learning game.
            </p>
            <p className="mt-5 border-t border-white/10 pt-4 text-sm leading-6 text-cyan-100">
              Each turn, choose a deck, collect RP, play cards, and attack. Learn the
              special rules as they come up.
            </p>
          </div>
        </div>
      </section>

      <SimulatorPromo />

      <div className="mt-8 grid gap-8 lg:grid-cols-[230px_minmax(0,1fr)] xl:gap-10">
        <InstructionsNav />

        <article className="min-w-0 space-y-16 md:space-y-20">
          <section id="start-here" className="scroll-mt-24">
            <SectionHeading number="START" title="Four things to know before you play">
              These terms appear throughout the game. Learn them first, and the cards
              and rules will be much easier to understand.
            </SectionHeading>

            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              {[
                ["VP", "Your score", "VP only counts while the card is in your ecosystem."],
                ["RP", "Your spending money", "Use RP to play cards and pay Action costs."],
                ["Foundation", "Your ocean's base", "Coral and Creature Schools help support what you can play."],
                ["Pals", "The creatures you play", "Fish, Predators, Apex, Invertebrates, and Filter Feeders."],
              ].map(([term, label, description], index) => (
                <div
                  key={term}
                  className="rounded-2xl border border-cyan-100 bg-white/85 p-5 shadow-sm backdrop-blur"
                >
                  <div className="flex items-center gap-4">
                    <span
                      className={`flex h-12 min-w-12 shrink-0 items-center justify-center whitespace-nowrap rounded-2xl px-3 text-sm font-black ${
                        index === 0
                          ? "bg-amber-100 text-amber-900"
                          : index === 1
                            ? "bg-cyan-100 text-cyan-900"
                            : index === 2
                              ? "bg-emerald-100 text-emerald-900"
                              : "bg-blue-100 text-blue-900"
                      }`}
                    >
                      {term}
                    </span>
                    <div>
                      <h3 className="font-bold text-slate-950">{label}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <a
                href="#goal"
                className="group rounded-2xl bg-cyan-700 p-5 text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-cyan-800"
              >
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Brand new?</p>
                <h3 className="mt-2 text-lg font-bold">Follow the next 4 sections</h3>
                <p className="mt-2 text-sm leading-6 text-cyan-50">Goal, setup, one turn, then your first round.</p>
              </a>
              <a
                href="#faq"
                className="group rounded-2xl border border-cyan-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-400"
              >
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Already playing?</p>
                <h3 className="mt-2 text-lg font-bold text-slate-950">Jump to the FAQ</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">Search the questions that stop games most often.</p>
              </a>
            </div>
          </section>

          <section id="goal" className="scroll-mt-24">
            <SectionHeading number="01" title="How to win">
              Build an ecosystem whose cards add up to the agreed Victory Point
              target. Protecting your points matters as much as gaining them.
            </SectionHeading>

            <div className="mt-7 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-lg md:p-8">
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-300">The winning rule</p>
                <p className="mt-3 text-2xl font-black leading-9 md:text-3xl">
                  Be the first player to reach the target with VP currently in play.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-white/10 p-4">
                    <p className="text-3xl font-black text-amber-300">10 VP</p>
                    <p className="mt-1 text-sm text-slate-300">Best for a first or quick game</p>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-4">
                    <p className="text-3xl font-black text-cyan-300">30 VP</p>
                    <p className="mt-1 text-sm text-slate-300">Recommended full game</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <h3 className="font-bold text-amber-950">VP can go back down</h3>
                  <p className="mt-2 text-sm leading-6 text-amber-900">
                    If a VP card leaves your ecosystem—or a conditional VP requirement
                    stops being true—subtract those points.
                  </p>
                </div>
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
                  <h3 className="font-bold text-rose-950">The deck-out loss</h3>
                  <p className="mt-2 text-sm leading-6 text-rose-900">
                    If you must draw and both of your personal decks are depleted,
                    you lose.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section id="setup" className="scroll-mt-24">
            <SectionHeading number="02" title="Set up the table">
              Each player’s 60 cards become two personal decks. The Conditions Deck
              is separate and shared by everyone.
            </SectionHeading>

            <div className="mt-7 rounded-3xl border border-cyan-100 bg-white/90 p-5 shadow-sm md:p-7">
              <div className="grid gap-4 md:grid-cols-3">
                {[
                  ["Foundation Deck", "Coral, Creature Schools, and their stages", "bg-amber-100 text-amber-950"],
                  ["Pals Deck", "Creatures, Support cards, and Habitat cards", "bg-cyan-100 text-cyan-950"],
                  ["Conditions Deck", "One separate shared deck; affects everybody", "bg-violet-100 text-violet-950"],
                ].map(([name, description, color]) => (
                  <div key={name} className={`rounded-2xl p-5 ${color}`}>
                    <h3 className="text-lg font-bold">{name}</h3>
                    <p className="mt-2 text-sm leading-6 opacity-80">{description}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl bg-cyan-50 p-5 ring-1 ring-cyan-100">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-800">Simple table map</p>
                <div className="mt-4 grid gap-3 text-center text-xs font-bold uppercase tracking-[0.12em] text-slate-700 sm:grid-cols-[0.7fr_1.6fr_0.7fr]">
                  <div className="rounded-xl border-2 border-dashed border-amber-300 bg-white px-3 py-5">Foundation Deck</div>
                  <div className="rounded-xl border-2 border-cyan-300 bg-white px-3 py-5">Your ecosystem</div>
                  <div className="rounded-xl border-2 border-dashed border-blue-300 bg-white px-3 py-5">Pals Deck</div>
                </div>
                <div className="mt-3 grid gap-3 text-center text-xs font-bold uppercase tracking-[0.12em] text-slate-700 sm:grid-cols-3">
                  <div className="rounded-xl bg-amber-100 px-3 py-3">RP bank</div>
                  <div className="rounded-xl bg-violet-100 px-3 py-3">Shared Conditions</div>
                  <div className="rounded-xl bg-slate-100 px-3 py-3">Discard</div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-xl font-bold text-slate-950">Bring to the table</h3>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                  <CheckItem>One legal deck per player, separated into two piles</CheckItem>
                  <CheckItem>One shared Conditions Deck</CheckItem>
                  <CheckItem>RP counters plus damage or HP counters</CheckItem>
                  <CheckItem>D4, D6, D8, D10, D12, and D20 dice as cards require</CheckItem>
                </ul>
              </div>

              <div className="rounded-3xl bg-cyan-800 p-6 text-white shadow-lg">
                <h3 className="text-xl font-bold">Opening setup, in order</h3>
                <ol className="mt-5 space-y-4 text-sm leading-6 text-cyan-50">
                  {[
                    "Draw 4 cards from your Foundation Deck.",
                    "Draw 4 cards from your Pals Deck. You now have 8 cards.",
                    "Place 3 RP in your RP bank.",
                    "Spend setup RP to play a valid base Foundation.",
                    "If your Foundation hand cannot play one, redraw that Foundation hand.",
                    "Once everyone has a starting Foundation, begin round one.",
                  ].map((step, index) => (
                    <li key={step} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-300 text-xs font-black text-slate-950">
                        {index + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950">
              <strong>For a first game:</strong> use a Base Coral or base Creature School as the starting Foundation, and choose the first player by agreement. The current rules do not prescribe a first-player method.
            </p>
          </section>

          <section id="turn" className="scroll-mt-24">
            <SectionHeading number="03" title="Take a turn: Choose, Collect, Build, Attack">
              Say the four words out loud for the first few turns. The rhythm becomes
              automatic quickly.
            </SectionHeading>

            <ol className="mt-7 grid gap-4 md:grid-cols-2">
              {turnSteps.map((step) => (
                <li key={step.name} className={`rounded-3xl border p-5 ${step.color}`}>
                  <div className="flex items-start gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-sm font-black shadow-sm">
                      {step.number}
                    </span>
                    <div>
                      <h3 className="text-xl font-black">{step.name}</h3>
                      <p className="mt-1 text-xs font-bold uppercase tracking-[0.14em] opacity-60">{step.prompt}</p>
                      <p className="mt-3 text-sm leading-6 opacity-85">{step.description}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            <div data-rules-ignore className="mt-5 rounded-2xl border border-cyan-200 bg-white p-5 shadow-sm">
              <h3 className="font-bold text-slate-950">Playing in the simulator?</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                The canonical rule order is Choose → Collect → Build → Attack. The
                simulator currently automates collection before it presents the
                deck-choice prompt; it is handling those start-of-turn jobs for you.
              </p>
            </div>
          </section>

          <section id="first-round" className="scroll-mt-24">
            <SectionHeading number="04" title="Play the first round together">
              A round starts with one shared Condition. Then each player takes a
              complete turn.
            </SectionHeading>

            <div className="mt-7 overflow-hidden rounded-3xl border border-cyan-100 bg-white shadow-sm">
              <div className="bg-violet-700 px-6 py-5 text-white">
                <h3 className="text-xl font-bold">Start of round: reveal a Condition</h3>
                <p className="mt-2 text-sm leading-6 text-violet-100">
                  Read it aloud and apply its printed effect to everyone for the stated duration.
                </p>
              </div>
              <div className="grid gap-0 md:grid-cols-2">
                <div className="p-6">
                  <h3 className="font-bold text-slate-950">The table-talk script</h3>
                  <ol className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                    <li><strong>1.</strong> “Which deck are you choosing?”</li>
                    <li><strong>2.</strong> “Add 1 RP. What do your Foundations produce?”</li>
                    <li><strong>3.</strong> “What can you afford, and where can it legally go?”</li>
                    <li><strong>4.</strong> “Does one of your cards have a legal attack?”</li>
                  </ol>
                </div>
                <div className="border-t border-cyan-100 bg-cyan-50 p-6 md:border-l md:border-t-0">
                  <h3 className="font-bold text-slate-950">Pause only for these checks</h3>
                  <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                    <CheckItem>Can the player pay the full RP and additional cost?</CheckItem>
                    <CheckItem>Does the Pal match its habitat and legal space?</CheckItem>
                    <CheckItem>Does the attack icon allow that target?</CheckItem>
                    <CheckItem>Did the current Condition change the rule?</CheckItem>
                  </ul>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-3xl bg-gradient-to-r from-cyan-700 to-emerald-700 p-6 text-white sm:flex-row sm:items-center">
              <div>
                <h3 className="text-xl font-bold">You now know enough to start.</h3>
                <p className="mt-2 text-sm text-cyan-50">Use the sections below only when the game asks for them.</p>
              </div>
              <Link href="/simulator" className="shrink-0 rounded-full bg-white px-5 py-3 text-sm font-black text-cyan-800 shadow-sm hover:bg-cyan-50">
                Practice a turn →
              </Link>
            </div>
          </section>

          <section id="read-a-card" className="scroll-mt-24">
            <SectionHeading number="05" title="Read a card without reading every word">
              Start with the corners and labels. Read the full rules box only when
              you are about to play or use the card.
            </SectionHeading>

            <div className="mt-7 grid gap-6 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
              <div className="rounded-3xl border border-cyan-100 bg-cyan-50 p-4 shadow-sm">
                <Image
                  src="/images/cards/fish/Reef/picasso-triggerfish.png"
                  alt="Picasso Triggerfish SeaPals card used as a reading example"
                  width={500}
                  height={700}
                  className="mx-auto h-auto w-full max-w-sm rounded-2xl shadow-lg"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["1", "VP", "Top-left score. It counts only while this card is in play."],
                  ["2", "Name, kind & habitat", "Identify what the card is and whether it is Reef, Oceanic, or Deep."],
                  ["3", "RP cost", "Top-right amount paid when the card is played."],
                  ["4", "Requirements", "Checks that must already be true before you pay the cost."],
                  ["5", "Rules labels", "Passive is ongoing, On Play happens once, and Action is chosen and paid."],
                  ["6", "Attack & Defense", "The attack lists die, legal targets, and count; Defense is the opposing roll."],
                ].map(([number, title, text]) => (
                  <div key={title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-700 text-xs font-black text-white">{number}</span>
                      <h3 className="font-bold text-slate-950">{title}</h3>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{text}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 rounded-3xl bg-slate-950 p-6 text-white">
              <h3 className="text-xl font-bold">Four different labels answer four different questions</h3>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Card kind", "Creature, Coral, Support, Habitat, or Condition"],
                  ["Habitat zone", "Reef, Oceanic, or Deep"],
                  ["Creature class", "Fish, Predator, Apex, Invertebrate, or Filter Feeder"],
                  ["Subtype", "A narrower printed identity, such as Baitball"],
                ].map(([title, text]) => (
                  <div key={title} className="rounded-2xl bg-white/10 p-4">
                    <h3 className="font-bold text-cyan-200">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{text}</p>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-sm leading-6 text-slate-300">
                A Deep Predator and a Reef Predator share the Predator class, but
                their habitat zones are different. Both labels matter.
              </p>
            </div>
          </section>

          <section id="slots" className="scroll-mt-24">
            <SectionHeading number="06" title="Place cards: match habitat first, then class">
              A legal play must satisfy both checks unless specific card text creates
              an exception.
            </SectionHeading>

            <div className="mt-7 grid gap-5 md:grid-cols-2">
              <div className="rounded-3xl border border-cyan-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Check 1</p>
                <h3 className="mt-2 text-xl font-bold text-slate-950">Does the habitat match?</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Reef creatures use compatible Reef slots. Deep creatures use
                  compatible Deep slots. They do not cross between those habitats
                  unless a printed rule says they can.
                </p>
              </div>
              <div className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Check 2</p>
                <h3 className="mt-2 text-xl font-bold text-slate-950">Does the class fit?</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  A slot’s icon tells you the largest class it can hold. The hierarchy
                  applies only inside the matching habitat.
                </p>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              {[
                ["Fish slot", `${iconBase}/fish-any.png`, ["Fish"]],
                ["Predator slot", `${iconBase}/predator-any.png`, ["Fish", "Predator"]],
                ["Apex slot", `${iconBase}/apex-any.png`, ["Fish", "Predator", "Apex"]],
                ["Invertebrate slot", `${iconBase}/invertebrate_any.png`, ["Invertebrate"]],
                ["Filter Feeder slot", `${iconBase}/filter-feeder-any.png`, ["Filter Feeder"]],
              ].map(([slot, icon, accepts]) => (
                <div key={slot} className="grid gap-4 border-b border-slate-100 p-5 last:border-0 sm:grid-cols-[190px_1fr] sm:items-center">
                  <div className="flex items-center gap-3">
                    <CardIcon src={icon} alt="" size={42} />
                    <h3 className="font-bold text-slate-950">{slot}</h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Can hold</span>
                    {accepts.map((item) => (
                      <span key={item} className="rounded-full bg-cyan-50 px-3 py-1.5 text-sm font-bold text-cyan-900 ring-1 ring-cyan-100">{item}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div className="rounded-3xl bg-blue-900 p-6 text-white">
                <div className="flex items-center gap-3">
                  <CardIcon src={`${iconBase}/oceanic-fish-icon.png`} alt="Oceanic Fish icon" size={48} />
                  <h3 className="text-xl font-bold">Oceanic creatures use open water</h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-blue-100">
                  Non-school Oceanic creatures are not placed into Reef or Deep Coral
                  slots. Creature Schools form the Oceanic Foundation and supply School
                  Density; cards may also require an enabling Habitat such as Open Ocean.
                </p>
              </div>
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
                <h3 className="text-xl font-bold text-amber-950">Upgrading Coral</h3>
                <p className="mt-3 text-sm leading-6 text-amber-900">
                  Have the next stage in hand, meet its requirement, and pay its RP
                  cost. Place it over the current stage. Existing damage stays, and a
                  Coral normally upgrades only once per turn.
                </p>
              </div>
            </div>
          </section>

          <section id="combat" className="scroll-mt-24">
            <SectionHeading number="07" title="Attack and defend">
              Read the attack indicator from left to right: die, legal target icons,
              then attack count.
            </SectionHeading>

            <div className="mt-7 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="rounded-3xl border border-cyan-100 bg-white p-6 shadow-sm">
                <h3 className="text-xl font-bold text-slate-950">The attack indicator</h3>
                <div className="mt-5 rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-100">
                  <Image
                    src={`${iconBase}/attack-icon.png`}
                    alt="SeaPals attack indicator showing attack die, legal target icons, and repeated attack count"
                    width={520}
                    height={260}
                    className="mx-auto h-auto w-full max-w-md"
                  />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Die", "D8 means roll an 8-sided die."],
                    ["Targets", "Every icon is a legal target family."],
                    ["Count", "×2 means two separate attacks."],
                  ].map(([title, text]) => (
                    <div key={title} className="rounded-2xl bg-cyan-50 p-4">
                      <h3 className="font-bold text-cyan-950">{title}</h3>
                      <p className="mt-1 text-xs leading-5 text-cyan-900">{text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-lg">
                <h3 className="text-xl font-bold">Resolve a normal attack</h3>
                <ol className="mt-5 space-y-4 text-sm leading-6 text-slate-300">
                  {[
                    "Choose a target allowed by the target icons and every printed restriction.",
                    "Roll the printed attack die. The target rolls its Defense die.",
                    "Apply valid + or − modifiers. A modified total cannot go below 0.",
                    "The attacker succeeds only if its final total is higher. A tie goes to the defender.",
                    "A successful normal attack discards the defending creature unless an effect saves it.",
                  ].map((step, index) => (
                    <li key={step} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-400 text-xs font-black text-slate-950">{index + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>

                <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl bg-white/10 p-5 text-center">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-300">Attack</p>
                    <p className="mt-2 text-4xl font-black text-white">7</p>
                  </div>
                  <p className="text-2xl font-black text-amber-300">&gt;</p>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-300">Defense</p>
                    <p className="mt-2 text-4xl font-black text-white">5</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
                <div className="flex items-center gap-3">
                  <CardIcon src={`${iconBase}/bait-ball-icon.png`} alt="Creature School icon" size={46} />
                  <h3 className="text-lg font-bold text-amber-950">Creature Schools take damage</h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-amber-900">
                  They do not roll Defense. Damage equals the attack roll ×10. Discard
                  the School when it reaches 0 HP.
                </p>
              </div>
              <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
                <h3 className="text-lg font-bold text-rose-950">Repeated attacks use distinct targets</h3>
                <p className="mt-3 text-sm leading-6 text-rose-900">
                  Resolve each attack separately. During one repeated sequence, the
                  same physical target cannot be selected twice.
                </p>
              </div>
            </div>
          </section>

          <section id="advanced" className="scroll-mt-24">
            <div className="rounded-[2rem] bg-gradient-to-br from-slate-950 to-cyan-950 p-6 text-white shadow-xl md:p-9">
              <p data-rules-ignore className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-300">Complete reference</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Advanced rules and edge cases</h2>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300 md:text-lg">
                This is the currently documented general rules layer. Open only the
                topic you need. A card’s more specific printed text wins when it
                clearly creates an exception.
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <RuleDetails
                open
                title="Deck construction and card routing"
                summary="60 cards, copy limits, printed VP, and which personal deck holds each card"
              >
                <ul className="space-y-2">
                  <li>• A standard personal deck contains exactly <strong>60 cards</strong>, no more than <strong>4 copies</strong> of one card, at least one base Foundation, and at least <strong>30 total printed VP</strong>.</li>
                  <li>• “30 printed VP in your deck” is a construction rule. “30 current VP in play” is the recommended full-game win target.</li>
                  <li>• Coral, Creature Schools, and their stages go in the Foundation Deck.</li>
                  <li>• Regular creatures, Support cards, and playable Habitat cards go in the Pals Deck.</li>
                  <li>• Conditions use a separate shared deck and are not part of either player’s 60 cards.</li>
                  <li>• Tournament-specific rules may override the standard construction limits.</li>
                </ul>
              </RuleDetails>

              <RuleDetails
                title="Coral, Foundations, damage, and destruction"
                summary="Upgrades preserve damage; weaknesses suppress production; VP leaves with the card"
              >
                <ul className="space-y-2">
                  <li>• Upgrade only to the next printed stage during Build. Meet its requirement, pay its RP cost, and place it over the current card.</li>
                  <li>• Existing damage remains through an upgrade. The higher stage changes maximum HP as printed; it does not fully heal the Coral.</li>
                  <li>• A Coral normally upgrades only once per turn.</li>
                  <li>• When a Condition matches a Coral weakness, that Coral does not produce RP for the round. The weakness alone does not remove or damage it.</li>
                  <li>• A destroyed Foundation leaves play for discard and its VP immediately stops counting.</li>
                  <li>• The current knowledge base says occupants should move to compatible empty slots when possible. Because cleanup for creatures with no legal slot is not fully ruled, use the latest official ruling for that edge case.</li>
                </ul>
              </RuleDetails>

              <RuleDetails
                title="Oceanic ecosystems and School Density"
                summary="Creature Schools are Foundations; density is checked, not spent"
              >
                <ul className="space-y-2">
                  <li>• Creature Schools are Oceanic Foundations with School Density and HP.</li>
                  <li>• School Density is a current ecosystem value. A play requirement checks it; the value is not spent like RP.</li>
                  <li>• Non-school Oceanic creatures live in open water rather than Reef or Deep Coral slots. Obey any printed School Density and Habitat requirements.</li>
                  <li>• Creature Schools do not roll Defense. An attack deals the attack roll ×10 as damage, and the School is discarded at 0 HP.</li>
                  <li>• When an Oceanic Apex uses the printed additional sacrifice cost, discard either 1 Oceanic Predator or 2 distinct physical Oceanic Fish, in addition to RP and other requirements.</li>
                  <li>• Sardine Run and Krill Bloom can reduce the next qualifying School Density requirement once per player as printed.</li>
                </ul>
              </RuleDetails>

              <RuleDetails
                title="Abilities, timing, and Support cards"
                summary="Passive, On Play, Action, Special Rules, searching, and recovery"
              >
                <ul className="space-y-2">
                  <li>• A <strong>Passive</strong> is active while its card remains in play and its printed condition is true.</li>
                  <li>• An <strong>On Play</strong> ability resolves when a card is successfully played. It does not repeat each turn.</li>
                  <li>• An <strong>Action</strong> is chosen at its printed timing: pay its cost, choose legal targets, and resolve its instructions in order.</li>
                  <li>• <strong>Special Rules</strong> has no universal effect. Apply the exact text on that card.</li>
                  <li>• A Support normally resolves and goes to discard unless it explicitly remains in play.</li>
                  <li>• Search the named deck or zone for a matching card, reveal or move it as instructed, and shuffle when required. Recovery moves an eligible card from discard to its stated destination.</li>
                  <li>• Moving a physical card does not reset its identity or a once-per-turn use that belongs to it.</li>
                </ul>
              </RuleDetails>

              <RuleDetails
                title="Combat keywords and dice"
                summary="Advantage, disadvantage, Toxic, Regenerate, Cloak, Transparency, and Massive"
              >
                <ul className="space-y-2">
                  <li>• D4, D6, D8, D10, D12, and D20 name dice with that many sides. Apply a written + or − after rolling; modified totals cannot fall below 0.</li>
                  <li>• <strong>Advantage</strong> rolls twice and keeps the higher result. <strong>Disadvantage</strong> rolls twice and keeps the lower result.</li>
                  <li>• <strong>Toxic When Eaten</strong> triggers only when a creature successfully consumes that Toxic card, unless explicit immunity or protection applies.</li>
                  <li>• <strong>Regenerate</strong> is optional. After a successful attack, the controller may pay the printed RP to keep that creature in play.</li>
                  <li>• <strong>Cloak</strong> does not make a creature untargetable; current Cloak cards grant their printed +3 Defense benefit.</li>
                  <li>• <strong>Transparency</strong> checks the attack’s printed die size, not the modified result.</li>
                  <li>• <strong>Massive</strong> is not identical on every card. Read whether that card changes the attack roll or Defense roll.</li>
                </ul>
              </RuleDetails>

              <RuleDetails
                title="Habitats, hosted cards, and continuous HP"
                summary="Persistent Habitats, attachments, capacity, and health bonuses"
              >
                <ul className="space-y-2">
                  <li>• Habitat cards are played from the Pals Deck and remain as independent cards in the ecosystem. Each physical copy tracks its own HP and effects.</li>
                  <li>• Open Ocean and Abyss enable their related strategies. Deep-targeting restrictions still apply; a similar tag does not make a Reef creature Deep.</li>
                  <li>• Coral Reef has 40 HP and requires 4 true Corals, 2 non-school Fish, and 2 non-school Invertebrates. At end of turn, each copy takes 10 damage while that composition is not met.</li>
                  <li>• Hosted or attached cards are legal only when printed text permits the host, tag, and capacity. The hosted card keeps its own physical identity.</li>
                  <li>• A hosted card moves with its primary host only when the applicable rule says it does.</li>
                  <li>• Continuous HP bonuses raise current and maximum HP while active without erasing damage. Removing the bonus reduces both; a card at 0 HP is destroyed.</li>
                </ul>
              </RuleDetails>

              <RuleDetails
                title="Conditions, limits, and overflow"
                summary="Shared round effects, the RP cap, hand limits, and mandatory draws"
              >
                <ul className="space-y-2">
                  <li>• Reveal and apply a shared Condition at the start of each round. Read its printed duration; some effects last for the round and some are persistent until used.</li>
                  <li>• Conditions can prevent card types from being played, change RP costs or bank caps, add draws, set a hand limit, suppress Coral RP, or reduce School Density requirements.</li>
                  <li>• The default RP bank cap is 8. When the active cap becomes lower, discard RP above it as instructed.</li>
                  <li>• There is no default hand limit. If a Condition sets one, draw, search, or recovery overflow goes to discard in resolution order.</li>
                  <li>• A required draw causes a loss when both personal decks are depleted.</li>
                  <li>• VP counts only while its card is in the ecosystem and any printed VP condition remains true.</li>
                </ul>
              </RuleDetails>

              <RuleDetails
                title="Current rulings boundaries"
                summary="What the published rules do not yet define—do not invent extra effects"
              >
                <p>
                  The current source set does not prescribe a first-player method, a
                  complete Conditions Deck exhaustion procedure, or an exact tiebreaker
                  when players reach identical VP simultaneously. Agree on a neutral
                  method before play or check the latest official ruling.
                </p>
                <p className="mt-3">
                  The Lost Zone exists as a table zone, but no complete general rule
                  sends cards there. Stunned can be applied by printed effects, but it
                  has no universal extra penalty or automatic expiration in the current
                  rules. Do not add either behavior unless a printed or official rule
                  explicitly supplies it.
                </p>
              </RuleDetails>
            </div>

            <div className="mt-8 rounded-[2rem] border border-cyan-100 bg-white p-5 shadow-sm md:p-7">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-700">Rules index</p>
                  <h3 className="mt-2 text-2xl font-black text-slate-950">All current rules loaded into the site</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                    This index mirrors the same core and simulator-enforced rule set used by Finn, so the rules page is not just a beginner guide. Open a card below when you need exact wording during play.
                  </p>
                </div>
                <div className="rounded-2xl bg-cyan-50 px-4 py-3 text-sm font-bold text-cyan-900 ring-1 ring-cyan-100">
                  {completeRuleCards.length} rule entries
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {completeRuleCards.map((rule, index) => (
                  <details key={`${rule.source}-${rule.title}-${index}`} className="group rounded-2xl border border-slate-200 bg-slate-50/70 open:bg-white open:shadow-sm">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <span>
                        <span className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-cyan-700">{rule.source}</span>
                        <span className="mt-1 block font-bold text-slate-950">{rule.title}</span>
                      </span>
                      <span aria-hidden="true" className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-lg font-black text-cyan-800 ring-1 ring-cyan-100 transition group-open:rotate-45 group-open:bg-cyan-700 group-open:text-white">+</span>
                    </summary>
                    <p className="border-t border-slate-200 px-4 py-4 text-sm leading-6 text-slate-600">{rule.text}</p>
                  </details>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-3xl border border-cyan-200 bg-cyan-50 p-6 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-lg font-bold text-slate-950">Need the working source document?</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">Use it for card-specific comparisons and the latest wording.</p>
              </div>
              <a href={fullRulesUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-cyan-700 px-5 py-3 text-sm font-bold text-white hover:bg-cyan-800">
                Open full rules document ↗
              </a>
            </div>
          </section>

          <section id="glossary" className="scroll-mt-24">
            <SectionHeading number="REF" title="Glossary">
              Short definitions for the words most likely to come up during a game.
            </SectionHeading>

            <dl className="mt-7 grid gap-3 sm:grid-cols-2">
              {fullGlossary.map(({ term, definition, source }) => (
                <div key={term} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <dt className="font-black text-cyan-800">{term}</dt>
                  <dd className="mt-2 text-sm leading-6 text-slate-600">{definition}</dd>
                  <dd className="mt-3 text-[0.65rem] font-black uppercase tracking-[0.16em] text-slate-400">{source}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 rounded-3xl border border-cyan-100 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-bold text-slate-950">Target icon shortcut</h3>
              <div className="mt-4 flex flex-wrap gap-3">
                {[
                  ["Any Fish", `${iconBase}/fish-any.png`],
                  ["Any Predator", `${iconBase}/predator-any.png`],
                  ["Any Apex", `${iconBase}/apex-any.png`],
                  ["Any Creature", `${iconBase}/any-creature.png`],
                ].map(([label, icon]) => (
                  <div key={label} className="flex items-center gap-2 rounded-full bg-slate-50 py-2 pl-2 pr-4 ring-1 ring-slate-100">
                    <CardIcon src={icon} alt="" size={36} />
                    <span className="text-sm font-bold text-slate-700">{label}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                A colored circle with a star means any subtype in the pictured family.
                The target must still satisfy habitat, controller, visibility, and
                specific card-text restrictions.
              </p>
            </div>
          </section>

          <section id="faq" className="scroll-mt-24">
            <SectionHeading number="FAQ" title="Questions that stop games most often">
              Search a word, open one answer, and get everyone back to playing.
            </SectionHeading>

            <div className="mt-7">
              <Faq questions={faqQuestions} />
            </div>

            <div className="mt-7 rounded-[2rem] bg-slate-950 p-7 text-white md:flex md:items-center md:justify-between md:gap-8">
              <div>
                <h3 className="text-2xl font-black">Still not sure?</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                  Ask Finn in plain language. Finn uses this guide and the structured
                  SeaPals rules knowledge to answer without guessing.
                </p>
              </div>
              <AskFinnButton className="mt-5 shrink-0 rounded-full bg-amber-300 px-6 py-3 text-sm font-black text-slate-950 hover:bg-amber-200 md:mt-0">
                Ask Finn now
              </AskFinnButton>
            </div>
          </section>
        </article>
      </div>
    </main>
  );
}
