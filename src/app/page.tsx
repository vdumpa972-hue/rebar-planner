export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="mx-auto max-w-4xl rounded-lg bg-white p-6 shadow">

        <h1 className="mb-6 text-4xl font-bold">
          Rebar Planner
        </h1>

        <div className="grid gap-4">

          <div>
            <label className="mb-1 block font-semibold">
              Project Name
            </label>
            <input
              type="text"
              placeholder="ADU Foundation"
              className="w-full rounded border p-2"
            />
          </div>

          <div>
            <label className="mb-1 block font-semibold">
              Horizontal Lap Length (inches)
            </label>
            <input
              type="number"
              defaultValue="24"
              className="w-full rounded border p-2"
            />
          </div>

          <div>
            <label className="mb-1 block font-semibold">
              V-E Lap Length (inches)
            </label>
            <input
              type="number"
              defaultValue="6"
              className="w-full rounded border p-2"
            />
          </div>

          <div>
            <label className="mb-1 block font-semibold">
              Rebar Stick Length (feet)
            </label>
            <input
              type="number"
              defaultValue="20"
              className="w-full rounded border p-2"
            />
          </div>

          <div>
            <label className="mb-1 block font-semibold">
              Upload Foundation Plan
            </label>
            <input
              type="file"
              className="w-full rounded border p-2"
            />
          </div>

          <button
            className="rounded bg-blue-600 p-3 text-white hover:bg-blue-700"
          >
            Generate Rebar Schedule
          </button>

        </div>
      </div>
    </main>
  );
}