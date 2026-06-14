"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  createContributor,
  type ContributorSummary,
} from "@/lib/agents/actions";
import { declareVolley } from "@/lib/ledger/actions";
import { sanitizeReference } from "@/lib/ledger/sanitizeReference";
import {
  AGENT_TYPE_LABELS,
  AGENT_TYPES,
  DELTA_TYPES,
  ROLE_LABELS,
  VOLLEY_ORIGINS,
  VOLLEY_ROLES,
  ORIGIN_LABELS,
  DELTA_LABELS,
  formatSeq,
  type AgentType,
  type DeltaType,
  type VolleyOrigin,
  type VolleyRole,
} from "@/lib/ledger/types";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-base text-foreground outline-none transition placeholder:text-muted/60 focus:border-cert-red/60 focus:bg-white/[0.07] focus:ring-1 focus:ring-cert-red/40";
const selectClass = `${inputClass} appearance-none`;
const labelClass = "flex flex-col gap-1.5";
const labelText = "text-xs font-medium text-muted";

export function VolleyEditor({
  workId,
  agents: initialAgents,
  suggestedSeq,
}: {
  workId: number;
  agents: ContributorSummary[];
  suggestedSeq: number;
}) {
  const router = useRouter();
  const [agents, setAgents] = useState<ContributorSummary[]>(initialAgents);
  const [agentId, setAgentId] = useState<string>(initialAgents[0]?.id ?? "");
  const [seq, setSeq] = useState<string>(String(suggestedSeq));
  const [role, setRole] = useState<VolleyRole>("lyric_thrown");
  const [origin, setOrigin] = useState<VolleyOrigin>("HUMAN");
  const [deltaType, setDeltaType] = useState<DeltaType>("added");

  const [prompt, setPrompt] = useState("");
  const [styleRef, setStyleRef] = useState("");
  const [rejected, setRejected] = useState("");
  const [rationale, setRationale] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Add-contributor sub-form.
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<AgentType>("ai_model");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, startAdd] = useTransition();

  // Live sanitizer preview — the creator always sees what will become public.
  const refResult = useMemo(() => sanitizeReference(styleRef), [styleRef]);

  function onAddContributor() {
    setAddError(null);
    if (!newName.trim()) {
      setAddError("Name the contributor.");
      return;
    }
    startAdd(async () => {
      const result = await createContributor({
        name: newName.trim(),
        type: newType,
      });
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      setAgents((prev) => [...prev, result.agent]);
      setAgentId(result.agent.id);
      setNewName("");
      setAdding(false);
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!agentId) {
      setError("Credit a contributor for this volley.");
      return;
    }
    const seqNum = Number(seq);
    if (!Number.isFinite(seqNum)) {
      setError("Enter a sequence number (e.g. 0, 1, 1.5).");
      return;
    }

    startTransition(async () => {
      const result = await declareVolley({
        workId,
        seq: seqNum,
        agentId,
        role,
        origin,
        deltaType,
        craft: {
          prompt,
          style_reference_raw: styleRef,
          rejected_branches: rejected,
          rationale,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Reset the sealed craft; advance the sequence.
      setPrompt("");
      setStyleRef("");
      setRejected("");
      setRationale("");
      setSeq(String(Math.floor(seqNum) + 1));
      setNotice(
        result.sanitized.unknownReference
          ? `Volley ${formatSeq(seqNum)} sealed. The name stayed private — describe the sound to surface it publicly.`
          : `Volley ${formatSeq(seqNum)} sealed.`,
      );
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-5 rounded-xl border border-white/10 bg-white/[0.02] p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">
          Declare a volley
        </h2>
        <p className="text-xs text-muted">
          The public ledger records the <em>shape</em> of the move. The craft
          (prompt, reference, branches, rationale) is sealed — encrypted,
          creator-owned, never served.
        </p>
      </div>

      {/* Public shape */}
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          <span className={labelText}>Sequence</span>
          <input
            className={inputClass}
            value={seq}
            onChange={(e) => setSeq(e.target.value)}
            inputMode="decimal"
            placeholder="0, 1, 1.5…"
            disabled={pending}
          />
        </label>

        <label className={labelClass}>
          <span className={labelText}>Contributor</span>
          <select
            className={selectClass}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={pending}
          >
            <option value="" disabled>
              Choose…
            </option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {AGENT_TYPE_LABELS[a.type]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start text-xs text-cert-red underline-offset-4 hover:underline"
          disabled={pending}
        >
          + Add a contributor
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              className={inputClass}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (e.g. Suno)"
              disabled={addPending}
            />
            <select
              className={selectClass}
              value={newType}
              onChange={(e) => setNewType(e.target.value as AgentType)}
              disabled={addPending}
            >
              {AGENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {AGENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          {addError ? (
            <p className="text-xs text-cert-red">{addError}</p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onAddContributor}
              disabled={addPending}
              className="rounded-md bg-cert-red px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {addPending ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setAddError(null);
              }}
              disabled={addPending}
              className="rounded-md border border-white/12 px-3 py-1.5 text-xs text-muted transition hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <label className={labelClass}>
          <span className={labelText}>Role</span>
          <select
            className={selectClass}
            value={role}
            onChange={(e) => setRole(e.target.value as VolleyRole)}
            disabled={pending}
          >
            {VOLLEY_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span className={labelText}>Origin</span>
          <select
            className={selectClass}
            value={origin}
            onChange={(e) => setOrigin(e.target.value as VolleyOrigin)}
            disabled={pending}
          >
            {VOLLEY_ORIGINS.map((o) => (
              <option key={o} value={o}>
                {ORIGIN_LABELS[o]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span className={labelText}>Delta</span>
          <select
            className={selectClass}
            value={deltaType}
            onChange={(e) => setDeltaType(e.target.value as DeltaType)}
            disabled={pending}
          >
            {DELTA_TYPES.map((d) => (
              <option key={d} value={d}>
                {DELTA_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Sealed craft */}
      <div className="flex flex-col gap-3 border-t border-white/8 pt-4">
        <span className="text-[11px] uppercase tracking-[0.18em] text-muted/70">
          Sealed craft — encrypted, never served
        </span>

        <label className={labelClass}>
          <span className={labelText}>Prompt (verbatim)</span>
          <textarea
            className={`${inputClass} min-h-20 resize-y`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="The actual prompt you used. Sealed — never public."
            disabled={pending}
          />
        </label>

        <label className={labelClass}>
          <span className={labelText}>Sound / style reference</span>
          <input
            className={inputClass}
            value={styleRef}
            onChange={(e) => setStyleRef(e.target.value)}
            placeholder="Describe the sound. Names get sealed, not shown."
            disabled={pending}
          />
          <ReferencePreview styleRef={styleRef} result={refResult} />
        </label>

        <label className={labelClass}>
          <span className={labelText}>Rejected branches (optional)</span>
          <textarea
            className={`${inputClass} min-h-16 resize-y`}
            value={rejected}
            onChange={(e) => setRejected(e.target.value)}
            placeholder="What you tried and dropped. Sealed."
            disabled={pending}
          />
        </label>

        <label className={labelClass}>
          <span className={labelText}>Rationale (optional)</span>
          <textarea
            className={`${inputClass} min-h-16 resize-y`}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Why this move. Sealed."
            disabled={pending}
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-cert-red">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-cert-red/25 bg-cert-red/10 px-3 py-2 text-sm text-foreground">
          {notice}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Sealing…" : "Seal this volley"}
      </button>
    </form>
  );
}

function ReferencePreview({
  styleRef,
  result,
}: {
  styleRef: string;
  result: ReturnType<typeof sanitizeReference>;
}) {
  if (!styleRef.trim()) {
    return (
      <span className="text-[11px] text-muted/60">
        Genres and descriptors pass through publicly. Artist names never do.
      </span>
    );
  }
  if (result.unknownReference) {
    return (
      <span className="text-[11px] text-cert-red">
        That reads like a name — it will be sealed, never shown. Describe the
        sound instead to make it public.
      </span>
    );
  }
  if (result.matched) {
    return (
      <span className="text-[11px] text-emerald-400">
        Reference recognized. Public descriptors:{" "}
        <span className="text-muted">{result.descriptors.join(", ")}</span> — the
        name stays sealed.
      </span>
    );
  }
  return (
    <span className="text-[11px] text-muted/70">
      Public descriptors:{" "}
      <span className="text-muted">{result.descriptors.join(", ")}</span>
    </span>
  );
}
