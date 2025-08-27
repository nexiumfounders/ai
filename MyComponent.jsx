import React, { useMemo, useState, useEffect, useRef } from "react";

const founders = [
  { id: "faris", name: "Faris Elnabarawi" },
  { id: "omar", name: "Omar Badr" },
  { id: "ahmed", name: "Ahmed Sherif" },
];

const EGP = (v) => `${v.toFixed(2)} EGP`;

function isSameMonthYear(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function addMonths(date, delta) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + delta);
  return d;
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function* monthRange(start, end) {
  const s = new Date(start.getFullYear(), start.getMonth(), 1);
  const e = new Date(end.getFullYear(), end.getMonth(), 1);
  for (let d = new Date(s); d <= e; d.setMonth(d.getMonth() + 1)) {
    yield new Date(d);
  }
}

// helpers to build zeroed maps
function zeroSettlementMatrix() {
  return Object.fromEntries(
    founders.map((d) => [d.id, Object.fromEntries(founders.map((c) => [c.id, 0]))])
  );
}
function zeroSettlementInputs() {
  return Object.fromEntries(
    founders.map((d) => [d.id, Object.fromEntries(founders.map((c) => [c.id, ""]))])
  );
}

// ---- Simple Undo/Redo history for app state (payers, settlements, viewDate) ----
function useHistoryController(states, setters) {
  // states: { settlements, payers, viewDate }
  // setters: { setSettlements, setPayers, setViewDate }
  const history = useRef({ past: [], future: [] });

  const snapshot = () => {
    const snap = {
      settlements: JSON.parse(JSON.stringify(states.settlements)),
      payers: JSON.parse(JSON.stringify(states.payers)),
      viewDate: new Date(states.viewDate),
    };
    history.current.past.push(snap);
    history.current.future = [];
  };

  const undo = () => {
    const h = history.current;
    if (!h.past.length) return;
    const current = {
      settlements: JSON.parse(JSON.stringify(states.settlements)),
      payers: JSON.parse(JSON.stringify(states.payers)),
      viewDate: new Date(states.viewDate),
    };
    const prev = h.past.pop();
    h.future.push(current);
    setters.setSettlements(prev.settlements);
    setters.setPayers(prev.payers);
    setters.setViewDate(prev.viewDate);
  };

  const redo = () => {
    const h = history.current;
    if (!h.future.length) return;
    const current = {
      settlements: JSON.parse(JSON.stringify(states.settlements)),
      payers: JSON.parse(JSON.stringify(states.payers)),
      viewDate: new Date(states.viewDate),
    };
    const next = h.future.pop();
    h.past.push(current);
    setters.setSettlements(next.settlements);
    setters.setPayers(next.payers);
    setters.setViewDate(next.viewDate);
  };

  const canUndo = () => history.current.past.length > 0;
  const canRedo = () => history.current.future.length > 0;

  return { snapshot, undo, redo, canUndo, canRedo };
}

export default function App() {
  const today = new Date();
  const [viewDate, setViewDate] = useState(() => new Date());

  // Inter‑founder settlements actually recorded (debtor -> creditor)
  const [settlements, setSettlements] = useState(() => {
    try {
      const saved = localStorage.getItem("nexium-settlements");
      if (saved) return JSON.parse(saved);
    } catch {}
    return zeroSettlementMatrix();
  });
  const [settlePayInput, setSettlePayInput] = useState(() => zeroSettlementInputs());
  useEffect(
    () => localStorage.setItem("nexium-settlements", JSON.stringify(settlements)),
    [settlements]
  );

  // Subscription rules with default payers
  const subscriptions = useMemo(
    () => [
      {
        id: "chatgpt",
        name: "ChatGPT Plus",
        price: 600,
        start: new Date("2025-08-07"),
        firstMonthFree: false,
        defaultPayer: "faris",
      },
      {
        id: "gemini",
        name: "Gemini Pro",
        price: 700,
        start: new Date("2025-08-01"),
        firstMonthFree: true,
        defaultPayer: "ahmed",
      },
    ],
    []
  );

  const earliestStart = useMemo(
    () => subscriptions.reduce((min, s) => (s.start < min ? s.start : min), subscriptions[0].start),
    [subscriptions]
  );

  const keyMonth = monthKey(viewDate);

  // Per-subscription payer per month (overrides)
  const [payers, setPayers] = useState(() => {
    try {
      const saved = localStorage.getItem("nexium-payers");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });
  useEffect(() => localStorage.setItem("nexium-payers", JSON.stringify(payers)), [payers]);

  // History controller
  const { snapshot, undo, redo, canUndo, canRedo } = useHistoryController(
    { settlements, payers, viewDate },
    { setSettlements, setPayers, setViewDate }
  );

  // Keyboard shortcuts: Ctrl+Z / Cmd+Z for undo, Ctrl+Y or Ctrl+Shift+Z for redo
  useEffect(() => {
    const onKeyDown = (e) => {
      const isEditable =
        e.target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName);
      if (isEditable) return;

      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;

      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const getPayer = (month, sub) => {
    const pm = payers[month];
    return (pm && pm[sub.id]) || sub.defaultPayer;
  };
  const setPayer = (month, subId, founderId) => {
    snapshot();
    setPayers((prev) => ({
      ...prev,
      [month]: { ...(prev[month] || {}), [subId]: founderId },
    }));
  };

  // Charges for selected month per subscription
  const monthCharges = useMemo(() => {
    return subscriptions.map((s) => {
      const beforeStart =
        s.start.getFullYear() * 12 + s.start.getMonth() >
        viewDate.getFullYear() * 12 + viewDate.getMonth();
      if (beforeStart) return { ...s, charge: 0, status: "Not started" };
      const firstMonth = isSameMonthYear(s.start, viewDate);
      const isFree = s.firstMonthFree && firstMonth;
      return {
        ...s,
        charge: isFree ? 0 : s.price,
        status: isFree ? "First Month Free" : "Due",
      };
    });
  }, [subscriptions, viewDate]);

  // Build inter‑founder dues up to selected month
  const rawSettle = zeroSettlementMatrix();
  for (const d of monthRange(earliestStart, viewDate)) {
    for (const s of subscriptions) {
      const beforeStart =
        s.start.getFullYear() * 12 + s.start.getMonth() >
        d.getFullYear() * 12 + d.getMonth();
      if (beforeStart) continue;
      const isFree = s.firstMonthFree && isSameMonthYear(s.start, d);
      const charge = isFree ? 0 : s.price;
      if (charge === 0) continue;
      const mk = monthKey(d);
      const payerId = getPayer(mk, s);
      founders.forEach((f) => {
        if (f.id !== payerId) rawSettle[f.id][payerId] += charge / 3;
      });
    }
  }

  // Pairwise netting
  const netPairs = zeroSettlementMatrix();
  founders.forEach((a) => {
    founders.forEach((b) => {
      if (a.id === b.id) return;
      const ab = rawSettle[a.id][b.id] || 0;
      const ba = rawSettle[b.id][a.id] || 0;
      netPairs[a.id][b.id] = Math.max(ab - ba, 0);
    });
  });

  // Apply recorded settlements
  const netAfterPayments = zeroSettlementMatrix();
  founders.forEach((a) => {
    founders.forEach((b) => {
      if (a.id === b.id) return;
      const owed = netPairs[a.id][b.id] || 0;
      const paid = settlements[a.id]?.[b.id] || 0;
      netAfterPayments[a.id][b.id] = Math.max(owed - paid, 0);
    });
  });

  // Aggregates per founder
  const dueTo = Object.fromEntries(founders.map((f) => [f.id, 0]));
  const dueBy = Object.fromEntries(founders.map((f) => [f.id, 0]));
  founders.forEach((deb) => {
    founders.forEach((cred) => {
      if (deb.id === cred.id) return;
      const amt = netAfterPayments[deb.id][cred.id] || 0;
      dueBy[deb.id] += amt;
      dueTo[cred.id] += amt;
    });
  });

  function recordSettlement(debtorId, creditorId) {
    const raw = settlePayInput[debtorId][creditorId];
    const amt = Number(raw);
    if (!Number.isFinite(amt) || amt <= 0) return;
    snapshot();
    setSettlements((prev) => ({
      ...prev,
      [debtorId]: {
        ...(prev[debtorId] || {}),
        [creditorId]: (prev[debtorId]?.[creditorId] || 0) + amt,
      },
    }));
    setSettlePayInput((prev) => ({
      ...prev,
      [debtorId]: { ...(prev[debtorId] || {}), [creditorId]: "" },
    }));
  }

  function resetAll() {
    snapshot();
    localStorage.removeItem("nexium-settlements");
    localStorage.removeItem("nexium-payers");
    setSettlements(zeroSettlementMatrix());
    setSettlePayInput(zeroSettlementInputs());
    setPayers({});
  }

  function goMonth(delta) {
    snapshot();
    setViewDate((d) => addMonths(d, delta));
  }

  function setMonthFromInput(value) {
    snapshot();
    const [y, m] = value.split("-").map(Number);
    setViewDate(new Date(y, m - 1, 1));
  }

  return (
    <div className="min-h-screen w-full p-6 bg-gray-50">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <header className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Today: {today.toLocaleDateString()}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => undo()}
                disabled={!canUndo()}
                className={`text-xs px-3 py-1 rounded-full ${
                  canUndo() ? "bg-gray-800 text-white" : "bg-gray-300 text-gray-500"
                }`}
                title="Undo (Ctrl+Z / Cmd+Z)"
              >
                Undo
              </button>
              <button
                onClick={() => redo()}
                disabled={!canRedo()}
                className={`text-xs px-3 py-1 rounded-full ${
                  canRedo() ? "bg-gray-800 text-white" : "bg-gray-300 text-gray-500"
                }`}
                title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
              >
                Redo
              </button>
              <button
                onClick={resetAll}
                className="text-xs px-3 py-1 rounded-full bg-red-600 text-white hover:opacity-90"
                title="Clear all recorded transfers and start fresh"
              >
                Reset All Data
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-bold">
              Nexium AI Subscriptions Splitter
            </h1>
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1 rounded-full bg-black text-white text-xs"
                onClick={() => goMonth(-1)}
              >
                ◀
              </button>
              <div className="text-sm text-gray-700 w-40 text-center">
                {viewDate.toLocaleString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
              </div>
              <button
                className="px-3 py-1 rounded-full bg-black text-white text-xs"
                onClick={() => goMonth(1)}
              >
                ▶
              </button>
              <input
                type="month"
                className="ml-3 border rounded px-2 py-1 text-sm"
                value={`${viewDate.getFullYear()}-${String(
                  viewDate.getMonth() + 1
                ).padStart(2, "0")}`}
                onChange={(e) => setMonthFromInput(e.target.value)}
              />
            </div>
          </div>
        </header>

        {/* Subscriptions */}
        <section className="rounded-2xl shadow bg-white p-4">
          <h2 className="font-semibold mb-3">Subscriptions</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {monthCharges.map((s) => {
              const badge =
                s.status === "First Month Free"
                  ? "bg-blue-500"
                  : s.status === "Due"
                  ? "bg-orange-400"
                  : "bg-gray-300";
              const currentPayerId = getPayer(keyMonth, s);
              const currentPayer = founders.find((x) => x.id === currentPayerId)?.name;
              return (
                <div key={s.id} className="border rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{s.name}</div>
                    <span
                      className={`text-xs px-2 py-1 rounded-full text-white ${badge}`}
                    >
                      {s.status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-700">
                    Start: {s.start.toLocaleDateString()}
                  </div>
                  <div className="text-sm">Monthly: {EGP(s.price)}</div>
                  <div className="text-sm">
                    Current payer (card):{" "}
                    <span className="font-medium">{currentPayer}</span>
                  </div>
                  <div className="text-base font-medium">
                    This month charge: {EGP(s.charge)}
                  </div>
                  <div className="pt-2 border-t">
                    <div className="text-sm font-medium mb-1">
                      Choose payer on card for{" "}
                      <u>
                        {viewDate.toLocaleString(undefined, {
                          month: "long",
                          year: "numeric",
                        })}
                      </u>
                    </div>
                    <select
                      className="border rounded px-2 py-1 text-sm"
                      value={currentPayerId}
                      onChange={(e) =>
                        setPayer(keyMonth, s.id, e.target.value)
                      }
                      title="Exactly one card payer per subscription per month"
                    >
                      {founders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-600 mt-2">
                      Default payers: Faris for ChatGPT, Ahmed for Gemini.
                      Changing month changes the selection context.
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Founder balances */}
        <section className="rounded-2xl shadow bg-white p-4">
          <h2 className="font-semibold mb-3">Founder Balances</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {founders.map((f) => {
              const peerLines = founders
                .filter((x) => x.id !== f.id)
                .map((other) => {
                  const youOwe = netAfterPayments[f.id][other.id] || 0;
                  const theyOwe = netAfterPayments[other.id][f.id] || 0;
                  return { other, youOwe, theyOwe };
                });
              const totalOwe = peerLines.reduce((sum, p) => sum + p.youOwe, 0);
              const totalOwed = peerLines.reduce((sum, p) => sum + p.theyOwe, 0);
              return (
                <div key={f.id} className="border rounded-xl p-4 space-y-3">
                  <div className="font-semibold">{f.name}</div>
                  <div className="space-y-2">
                    {peerLines.map(({ other, youOwe, theyOwe }) => (
                      <div key={other.id} className="text-sm">
                        {youOwe > 0 ? (
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              Owe {other.name}: {EGP(youOwe)}
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="border rounded px-2 py-1 text-xs w-20"
                                value={settlePayInput[f.id][other.id]}
                                onChange={(e) =>
                                  setSettlePayInput((prev) => ({
                                    ...prev,
                                    [f.id]: {
                                      ...(prev[f.id] || {}),
                                      [other.id]: e.target.value,
                                    },
                                  }))
                                }
                              />
                              <button
                                className="text-xs px-2 py-1 rounded bg-black text-white"
                                onClick={() => recordSettlement(f.id, other.id)}
                              >
                                Pay
                              </button>
                            </div>
                          </div>
                        ) : theyOwe > 0 ? (
                          <div>
                            {other.name} owes you: {EGP(theyOwe)}
                          </div>
                        ) : (
                          <div>Settled with {other.name}</div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t text-xs text-gray-600">
                    <div>Total you owe others: {EGP(totalOwe)}</div>
                    <div>Total others owe you: {EGP(totalOwed)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Amounts due summary */}
        <section className="rounded-2xl shadow bg-white p-4">
          <h2 className="font-semibold mb-3">Amounts Due To Each Founder</h2>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Founder</th>
                <th className="py-2 pr-4">Amount due to them</th>
              </tr>
            </thead>
            <tbody>
              {founders.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{f.name}</td>
                  <td className="py-2 pr-4 font-medium">
                    {EGP(dueTo[f.id] || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-600">
            Figures are cumulative from subscription start through the selected
            month, netted pairwise, and reduced by any recorded transfers. Use
            Reset All Data to start from zero again.
          </p>
        </section>
      </div>
    </div>
  );
}
