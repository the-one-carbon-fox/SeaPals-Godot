export default function CardsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-800">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-4xl font-bold">Card Gallery</h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Explore SeaPals card previews, featured creatures, and future expansions.
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            Bull Shark
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            Blue Whale
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            Killer Whales
          </div>
        </div>
      </div>
    </main>
  );
}